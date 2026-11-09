// ============================================================================
// treelet.js - CPU surface sampler
//
// The fragment shader's `sampleSurface` (surface.glsl) on a CPU grid: the 12
// texels around a point (a 4×4 block without corners), central-difference
// gradients at the 4 inner texels, bilinear interpolation of elevation,
// gradient and second derivatives. Readouts, picking and the descriptors'
// `cpu()` functions see the same surface the shader draws.
// ============================================================================

import type { SurfaceSample } from './types';

/** Reads the texel at integer (i, j); i east, j south. Indices may lie outside the grid. */
export type GridReader = (i: number, j: number) => number;

/**
 * Sample the surface at texel coordinates (tx, ty) of a corner-aligned grid
 * whose last index is `imax`. `texelMeters` is the ground distance between
 * texels; `nodata` the threshold below which a texel has no data. Returns
 * null when none of the four inner texels has data.
 */
export function sampleSurfaceGrid(
  read: GridReader, imax: number, tx: number, ty: number, texelMeters: number, nodata: number,
): SurfaceSample | null {
  const clampI = (v: number) => Math.max(0, Math.min(imax, v));
  const texel = (i: number, j: number) => read(clampI(i), clampI(j));
  const tap = (i: number, j: number, fallback: number) => {
    const v = texel(i, j);
    return v > nodata ? v : fallback;
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

  const hm0 = tap(i0 - 1, j0, h00);
  const hm1 = tap(i0 - 1, j0 + 1, h01);
  const h20 = tap(i0 + 2, j0, h10);
  const h21 = tap(i0 + 2, j0 + 1, h11);
  const h0m = tap(i0, j0 - 1, h00);
  const h1m = tap(i0 + 1, j0 - 1, h10);
  const h02 = tap(i0, j0 + 2, h01);
  const h12 = tap(i0 + 1, j0 + 2, h11);

  // Central differences over the true index span (shorter at the borders)
  const grad = (i: number, j: number, hL: number, hR: number, hU: number, hD: number): [number, number] => {
    const spanX = Math.min(i + 1, imax) - Math.max(i - 1, 0);
    const spanY = Math.min(j + 1, imax) - Math.max(j - 1, 0);
    return [(hR - hL) / Math.max(spanX, 1), (hD - hU) / Math.max(spanY, 1)];
  };
  const g00 = grad(i0, j0, hm0, h10, h0m, h01);
  const g10 = grad(i0 + 1, j0, h00, h20, h1m, h11);
  const g01 = grad(i0, j0 + 1, hm1, h11, h00, h02);
  const g11 = grad(i0 + 1, j0 + 1, h01, h21, h10, h12);

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
