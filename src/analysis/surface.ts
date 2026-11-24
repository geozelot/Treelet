// ============================================================================
// treelet.js - CPU surface sampler
//
// The fragment shader's `sampleSurface` (surface.glsl) on a CPU grid: the 12
// texels around a point (a 4×4 block without corners), central-difference
// gradients at the 4 inner texels, bilinear interpolation of elevation,
// gradient and second derivatives. Taps one texel past the grid's border
// come from an optional second reader (the neighbouring tile's texels, the
// shader's halo), so slopes at tile edges are central differences as well.
// Readouts, picking and the descriptors' `cpu()` functions see the same
// surface the shader draws.
// ============================================================================

import type { SurfaceSample } from './types';

/** Reads the texel at integer (i, j) inside the grid; i east, j south. */
export type GridReader = (i: number, j: number) => number;

/**
 * Reads the texel one step past a border of the grid: (−1, j), (imax + 1, j),
 * (i, −1) or (i, imax + 1), from the neighbouring grid. A value not above
 * the nodata threshold means there is none.
 */
export type OutsideReader = (i: number, j: number) => number;

/**
 * Sample the surface at texel coordinates (tx, ty) of a corner-aligned grid
 * whose last index is `imax`. `texelMeters` is the ground distance between
 * texels; `nodata` the threshold below which a texel has no data. `outside`
 * supplies the texels one step past the borders; without it (or where it
 * has none) the slope at a border is one-sided. Returns null when none of
 * the four inner texels has data.
 */
export function sampleSurfaceGrid(
  read: GridReader, imax: number, tx: number, ty: number, texelMeters: number, nodata: number,
  outside?: OutsideReader,
): SurfaceSample | null {
  const clampI = (v: number) => Math.max(0, Math.min(imax, v));
  const texel = (i: number, j: number) => read(clampI(i), clampI(j));
  /**
   * Elevation one step from an inner texel and its reach: 1 for a real
   * neighbour (in the grid, or past its border in `outside`), 0 when there
   * is none and the tap falls back to the inner texel itself.
   */
  const tap = (i: number, j: number, fallback: number): [number, number] => {
    if (i >= 0 && i <= imax && j >= 0 && j <= imax) {
      const v = read(i, j);
      return [v > nodata ? v : fallback, 1];
    }
    const v = outside ? outside(i, j) : NaN;
    return v > nodata ? [v, 1] : [fallback, 0];
  };

  const i0 = Math.min(Math.floor(tx), Math.max(imax - 1, 0));
  const j0 = Math.min(Math.floor(ty), Math.max(imax - 1, 0));
  const fx = Math.max(0, Math.min(1, tx - i0));
  const fy = Math.max(0, Math.min(1, ty - j0));

  let h00 = texel(i0, j0);
  let h10 = texel(i0 + 1, j0);
  let h01 = texel(i0, j0 + 1);
  let h11 = texel(i0 + 1, j0 + 1);
  const inner = [h00, h10, h01, h11];
  let count = 0;
  let sum = 0;
  for (const h of inner) if (h > nodata) { count++; sum += h; }
  if (count === 0) return null;
  const mean = sum / count;
  if (!(h00 > nodata)) h00 = mean;
  if (!(h10 > nodata)) h10 = mean;
  if (!(h01 > nodata)) h01 = mean;
  if (!(h11 > nodata)) h11 = mean;

  const [hm0, rm0] = tap(i0 - 1, j0, h00);
  const [hm1, rm1] = tap(i0 - 1, j0 + 1, h01);
  const [h20, r20] = tap(i0 + 2, j0, h10);
  const [h21, r21] = tap(i0 + 2, j0 + 1, h11);
  const [h0m, r0m] = tap(i0, j0 - 1, h00);
  const [h1m, r1m] = tap(i0 + 1, j0 - 1, h10);
  const [h02, r02] = tap(i0, j0 + 2, h01);
  const [h12, r12] = tap(i0 + 1, j0 + 2, h11);

  // Differences over the span the taps lie apart: 2 (central), or 1 where a
  // border has no neighbour. The inner texels are one step apart.
  const one = imax > 0 ? 1 : 0;
  const grad = (hL: number, hR: number, hU: number, hD: number, spanX: number, spanY: number): [number, number] =>
    [(hR - hL) / Math.max(spanX, 1), (hD - hU) / Math.max(spanY, 1)];
  const g00 = grad(hm0, h10, h0m, h01, rm0 + one, r0m + one);
  const g10 = grad(h00, h20, h1m, h11, one + r20, r1m + one);
  const g01 = grad(hm1, h11, h00, h02, rm1 + one, one + r02);
  const g11 = grad(h01, h21, h10, h12, one + r21, one + r12);

  const mix = (a: number, b: number, f: number) => a + (b - a) * f;
  const bil = (a: number, b: number, c: number, d: number) => mix(mix(a, b, fx), mix(c, d, fx), fy);

  const h = bil(h00, h10, h01, h11);
  const gx = bil(g00[0], g10[0], g01[0], g11[0]);
  const gy = bil(g00[1], g10[1], g01[1], g11[1]);
  // Second derivatives from the change of the inner gradients (per texel²)
  const hxx = mix(g10[0] - g00[0], g11[0] - g01[0], fy);
  const hyy = mix(g01[1] - g00[1], g11[1] - g10[1], fx);
  const hxy = 0.5 * (mix(g10[1] - g00[1], g11[1] - g01[1], fy) + mix(g01[0] - g00[0], g11[0] - g10[0], fx));

  // Texel y runs south; world y runs north
  const tm = Math.max(texelMeters, 1e-9);
  const dx = gx / tm;
  const dy = -gy / tm;
  const len = Math.hypot(dx, dy, 1);
  return {
    h,
    n: [-dx / len, -dy / len, 1 / len],
    g: [dx, dy],
    c: [hxx / (tm * tm), hyy / (tm * tm), -hxy / (tm * tm)],
  };
}
