// ============================================================================
// treelet.js - Raster Utilities (worker-side, pure functions)
//
// Elevation resampling into atlas slots, nodata masking, and gamma-correct
// mip chain generation for drape imagery. Kept DOM-free so they can run in
// workers and be unit-tested directly.
// ============================================================================

/** Atlas value for "no data". Shaders treat anything below −99990 as nodata. */
export const ELEVATION_NODATA = -99999;

/** Sub-rectangle of a source tile in normalized [0, 1] coordinates (y down). */
export interface NormalizedRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Mark pixels with alpha 0 as nodata (NaN). Transparent pixels in encoded
 * DEM tiles carry no elevation; decoding their RGB would produce spikes or
 * pits (−10000 m for terrain-rgb, −32768 m for terrarium).
 */
export function applyAlphaNodata(pixels: ArrayLike<number>, elevations: Float32Array): void {
  for (let i = 0, n = elevations.length; i < n; i++) {
    if (pixels[i * 4 + 3] === 0) elevations[i] = NaN;
  }
}

/** Resampled elevation slot plus statistics. */
export interface ResampleResult {
  min: number;
  max: number;
  /** Number of output texels with valid data. */
  valid: number;
}

/**
 * Resample a decoded elevation raster into a size×size atlas slot.
 *
 * Output texels are corner-aligned: texel (i, j) sits at normalized tile
 * position (i/(size−1), j/(size−1)), so texel 0 lies exactly on the west/
 * north tile edge and texel size−1 on the east/south edge. Adjacent tiles
 * therefore sample their shared edge at identical positions, which is what
 * makes CPU edge stitching and seamless geomorphing possible.
 *
 * Source pixels are treated as point samples at their centers ((p+0.5)/W).
 * Bilinear interpolation ignores non-finite taps and renormalizes weights;
 * texels without any valid tap become ELEVATION_NODATA.
 */
export function resampleElevation(
  src: Float32Array,
  srcW: number,
  srcH: number,
  size: number,
  region: NormalizedRegion | null,
  out: Float32Array,
): ResampleResult {
  const rx = region ? region.x : 0;
  const ry = region ? region.y : 0;
  const rw = region ? region.w : 1;
  const rh = region ? region.h : 1;
  const inv = 1 / (size - 1);

  // Precompute horizontal taps once per column.
  const x0s = new Int32Array(size);
  const x1s = new Int32Array(size);
  const fxs = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const px = Math.min(Math.max((rx + rw * i * inv) * srcW - 0.5, 0), srcW - 1);
    const x0 = Math.min(Math.floor(px), srcW - 1);
    x0s[i] = x0;
    x1s[i] = Math.min(x0 + 1, srcW - 1);
    fxs[i] = px - x0;
  }

  let min = Infinity;
  let max = -Infinity;
  let valid = 0;

  for (let j = 0; j < size; j++) {
    const py = Math.min(Math.max((ry + rh * j * inv) * srcH - 0.5, 0), srcH - 1);
    const y0 = Math.min(Math.floor(py), srcH - 1);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const fy = py - y0;
    const row0 = y0 * srcW;
    const row1 = y1 * srcW;
    const outRow = j * size;

    for (let i = 0; i < size; i++) {
      const x0 = x0s[i];
      const x1 = x1s[i];
      const fx = fxs[i];
      const a = src[row0 + x0];
      const b = src[row0 + x1];
      const c = src[row1 + x0];
      const d = src[row1 + x1];
      const wa = (1 - fx) * (1 - fy);
      const wb = fx * (1 - fy);
      const wc = (1 - fx) * fy;
      const wd = fx * fy;

      let v: number;
      if (a === a && b === b && c === c && d === d &&
          a !== Infinity && b !== Infinity && c !== Infinity && d !== Infinity &&
          a !== -Infinity && b !== -Infinity && c !== -Infinity && d !== -Infinity) {
        v = a * wa + b * wb + c * wc + d * wd;
      } else {
        let sum = 0;
        let ws = 0;
        if (Number.isFinite(a)) { sum += a * wa; ws += wa; }
        if (Number.isFinite(b)) { sum += b * wb; ws += wb; }
        if (Number.isFinite(c)) { sum += c * wc; ws += wc; }
        if (Number.isFinite(d)) { sum += d * wd; ws += wd; }
        v = ws > 1e-9 ? sum / ws : NaN;
      }

      if (v === v) {
        out[outRow + i] = v;
        if (v < min) min = v;
        if (v > max) max = v;
        valid++;
      } else {
        out[outRow + i] = ELEVATION_NODATA;
      }
    }
  }

  if (valid === 0) {
    min = 0;
    max = 0;
  }
  return { min, max, valid };
}

// ---------------------------------------------------------------------------
// Gamma-correct mip chain
// ---------------------------------------------------------------------------

let SRGB_TO_LINEAR: Float32Array | null = null;
let LINEAR_TO_SRGB: Uint8Array | null = null;
const LINEAR_LUT_SIZE = 4096;

function initLuts(): void {
  if (SRGB_TO_LINEAR) return;
  SRGB_TO_LINEAR = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  LINEAR_TO_SRGB = new Uint8Array(LINEAR_LUT_SIZE + 1);
  for (let i = 0; i <= LINEAR_LUT_SIZE; i++) {
    const l = i / LINEAR_LUT_SIZE;
    const s = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
    LINEAR_TO_SRGB[i] = Math.max(0, Math.min(255, Math.round(s * 255)));
  }
}

/**
 * Build a full mip chain (size → 1) from an sRGB RGBA image.
 *
 * Each level is a 2×2 box filter in linear light with alpha-weighted color
 * (premultiplied averaging), so downsampled imagery keeps its brightness and
 * transparent borders don't bleed dark halos. Level 0 is returned as-is.
 */
export function buildMipChain(level0: Uint8Array, size: number): Uint8Array[] {
  initLuts();
  const toLin = SRGB_TO_LINEAR!;
  const toSrgb = LINEAR_TO_SRGB!;
  const levels: Uint8Array[] = [level0];
  let src = level0;
  let srcSize = size;

  while (srcSize > 1) {
    const dstSize = srcSize >> 1;
    const dst = new Uint8Array(dstSize * dstSize * 4);
    for (let y = 0; y < dstSize; y++) {
      for (let x = 0; x < dstSize; x++) {
        const i0 = ((y * 2) * srcSize + x * 2) * 4;
        const i1 = i0 + 4;
        const i2 = i0 + srcSize * 4;
        const i3 = i2 + 4;
        const a0 = src[i0 + 3], a1 = src[i1 + 3], a2 = src[i2 + 3], a3 = src[i3 + 3];
        const aSum = a0 + a1 + a2 + a3;
        const o = (y * dstSize + x) * 4;
        if (aSum === 0) {
          dst[o] = dst[o + 1] = dst[o + 2] = dst[o + 3] = 0;
          continue;
        }
        for (let c = 0; c < 3; c++) {
          const lin = (toLin[src[i0 + c]] * a0 + toLin[src[i1 + c]] * a1 +
            toLin[src[i2 + c]] * a2 + toLin[src[i3 + c]] * a3) / aSum;
          dst[o + c] = toSrgb[Math.round(lin * LINEAR_LUT_SIZE)];
        }
        dst[o + 3] = (aSum + 2) >> 2;
      }
    }
    levels.push(dst);
    src = dst;
    srcSize = dstSize;
  }
  return levels;
}

/** Stable 32-bit FNV-1a hash of a string (worker affinity routing). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}
