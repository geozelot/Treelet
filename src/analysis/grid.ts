// ============================================================================
// treelet.js - Grid helpers
//
// Pure functions on row-major grids (row 0 to the north, cell-registered:
// cell (i, j) covers [i, i+1] × [j, j+1] of the grid's bounds and its value
// sits at the cell center). Shared by the raster coat (CPU sampling must
// match rasters.glsl), the region loader and the worker analyses.
// ============================================================================

/** Value the raster textures store for "no data" (the shader tests < −1e37). */
export const RASTER_NODATA = -3.0e38;

/** Values at or below this are no data (RASTER_NODATA in the shader and on the CPU). */
export const RASTER_NODATA_THRESHOLD = -1.0e37;

/** Whether a grid value is data (finite and above the nodata sentinel). */
export function isGridValue(v: number): boolean {
  return Number.isFinite(v) && v > RASTER_NODATA_THRESHOLD;
}

/** Mercator y (unitless, radians) of a latitude in degrees. */
export function mercatorY(lat: number): number {
  const phi = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + phi / 2));
}

/** Latitude in degrees of a Mercator y (radians). */
export function latitudeOfMercatorY(y: number): number {
  return ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
}

/**
 * Resample a grid whose rows are evenly spaced in latitude (EPSG:4326) into
 * one whose rows are evenly spaced in Web Mercator y, so it can be drawn
 * with a linear mapping. Columns are unchanged (longitude is linear in
 * both). `channels` is 1 for values (NaN = nodata) or 4 for RGBA bytes.
 */
export function resampleRowsToMercator<T extends Float32Array | Uint8Array | Uint8ClampedArray>(
  data: T, width: number, height: number, south: number, north: number, channels: 1 | 4,
): T {
  const out = new (data.constructor as { new (n: number): T })(data.length);
  const yN = mercatorY(north);
  const yS = mercatorY(south);
  const rowLen = width * channels;
  for (let j = 0; j < height; j++) {
    // Center of output row j in Mercator y → latitude → fractional source row
    const y = yN + ((j + 0.5) / height) * (yS - yN);
    const lat = latitudeOfMercatorY(y);
    const r = ((north - lat) / (north - south)) * height - 0.5;
    const r0 = Math.max(0, Math.min(height - 1, Math.floor(r)));
    const r1 = Math.min(height - 1, r0 + 1);
    const f = Math.max(0, Math.min(1, r - r0));
    const o = j * rowLen;
    const a = r0 * rowLen;
    const b = r1 * rowLen;
    for (let k = 0; k < rowLen; k++) {
      const va = data[a + k];
      const vb = data[b + k];
      if (channels === 4) {
        out[o + k] = Math.round(va + (vb - va) * f);
      } else if (va !== va) {
        out[o + k] = f > 0.5 ? vb : NaN;
      } else if (vb !== vb) {
        out[o + k] = f < 0.5 ? va : NaN;
      } else {
        out[o + k] = va + (vb - va) * f;
      }
    }
  }
  return out;
}

/** Min and max of the values that are data (null when there are none). */
export function gridRange(data: ArrayLike<number>, nodata?: number): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!isGridValue(v) || v === nodata) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? [min, max] : null;
}

/**
 * Bilinear value at fractional cell coordinates (px, py) measured from the
 * grid's NW corner in cells (so the first cell center is at 0.5, 0.5),
 * ignoring nodata taps (NaN or RASTER_NODATA), as rasters.glsl does. Null outside the grid
 * or where all taps are nodata.
 */
export function sampleGrid(data: ArrayLike<number>, width: number, height: number, px: number, py: number): number | null {
  if (!(px >= 0 && py >= 0 && px <= width && py <= height)) return null;
  const tx = px - 0.5;
  const ty = py - 0.5;
  const i0f = Math.floor(tx);
  const j0f = Math.floor(ty);
  const fx = tx - i0f;
  const fy = ty - j0f;
  const ia = Math.max(0, Math.min(width - 1, i0f));
  const ib = Math.max(0, Math.min(width - 1, i0f + 1));
  const ja = Math.max(0, Math.min(height - 1, j0f));
  const jb = Math.max(0, Math.min(height - 1, j0f + 1));
  const taps: Array<[number, number]> = [
    [data[ja * width + ia], (1 - fx) * (1 - fy)],
    [data[ja * width + ib], fx * (1 - fy)],
    [data[jb * width + ia], (1 - fx) * fy],
    [data[jb * width + ib], fx * fy],
  ];
  let sum = 0;
  let ws = 0;
  for (const [v, w] of taps) {
    if (isGridValue(v)) {
      sum += v * w;
      ws += w;
    }
  }
  return ws > 1e-4 ? sum / ws : null;
}

/**
 * Approximate percentiles (0–1) of the finite values, from a sample of at
 * most `sampleSize` values. Null when there are none.
 */
export function gridPercentiles(data: ArrayLike<number>, lo: number, hi: number, sampleSize = 20000): [number, number] | null {
  const stride = Math.max(1, Math.floor(data.length / sampleSize));
  const values: number[] = [];
  for (let i = 0; i < data.length; i += stride) {
    const v = data[i];
    if (Number.isFinite(v)) values.push(v);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const at = (q: number) => values[Math.max(0, Math.min(values.length - 1, Math.round(q * (values.length - 1))))];
  return [at(lo), at(hi)];
}
