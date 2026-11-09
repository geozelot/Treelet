// ============================================================================
// Tests for the CPU surface sampler (src/analysis/surface.ts) and the
// descriptors' CPU formulas on synthetic surfaces: planes give exact
// gradients and zero curvature, paraboloids their analytic curvature, and
// slope / aspect / curvature agree with what the shader formulas compute.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { sampleSurfaceGrid } from '../../src/analysis/surface';
import { slopeDegrees, aspectDegrees, curvatureOf, curvatureValue, inSector } from '../../src/analysis/builtins';
import type { SurfaceSample } from '../../src/analysis/types';

const NODATA = -99998;
const IMAX = 15;

/** A grid reader over h(x, y) in meters with x east, y north and `tm` meters per texel. */
function grid(h: (x: number, y: number) => number, tm: number) {
  return (i: number, j: number) => h(i * tm, -j * tm);
}

function sample(h: (x: number, y: number) => number, tm: number, tx = 7.3, ty = 6.6): SurfaceSample {
  const s = sampleSurfaceGrid(grid(h, tm), IMAX, tx, ty, tm, NODATA);
  if (!s) throw new Error('no sample');
  return s;
}

describe('sampleSurfaceGrid', () => {
  it('reproduces a plane: elevation, gradient, normal; zero curvature', () => {
    const tm = 30;
    const s = sample((x, y) => 500 + 0.25 * x - 0.5 * y, tm);
    expect(s.h).toBeCloseTo(500 + 0.25 * 7.3 * tm - 0.5 * -6.6 * tm, 6);
    expect(s.g![0]).toBeCloseTo(0.25, 9);
    expect(s.g![1]).toBeCloseTo(-0.5, 9);
    const len = Math.hypot(0.25, 0.5, 1);
    expect(s.n[0]).toBeCloseTo(-0.25 / len, 9);
    expect(s.n[1]).toBeCloseTo(0.5 / len, 9);
    expect(s.n[2]).toBeCloseTo(1 / len, 9);
    for (const c of s.c!) expect(Math.abs(c)).toBeLessThan(1e-9);
  });

  it('is independent of the texel spacing for the same surface', () => {
    const h = (x: number, y: number) => 0.3 * x + 0.1 * y;
    const a = sample(h, 10, 4, 4);
    const b = sample(h, 1000, 4, 4);
    expect(a.g).toEqual(b.g);
    expect(a.n).toEqual(b.n);
  });

  it('measures the curvature of a paraboloid and a saddle', () => {
    const tm = 10;
    const k = 0.002; // h = k (x² + y²): hxx = hyy = 2k
    const bowl = sample((x, y) => k * (x * x + y * y), tm, 7, 7);
    expect(bowl.c![0]).toBeCloseTo(2 * k, 9);
    expect(bowl.c![1]).toBeCloseTo(2 * k, 9);
    expect(Math.abs(bowl.c![2])).toBeLessThan(1e-12);
    // Total curvature: concave bowl → negative
    expect(curvatureValue(bowl, { mode: 'total', range: [-1, 1] })).toBeCloseTo(-(4 * k) * 1000, 6);

    const saddle = sample((x, y) => 0.001 * x * y, tm, 7, 7);
    expect(Math.abs(saddle.c![0])).toBeLessThan(1e-12);
    expect(Math.abs(saddle.c![1])).toBeLessThan(1e-12);
    expect(saddle.c![2]).toBeCloseTo(0.001, 9);
  });

  it('fills nodata inner texels from their neighbours and returns null without data', () => {
    const tm = 1;
    const read = (i: number, j: number) => (i === 8 && j === 7 ? NODATA - 1 : 100 + i);
    const s = sampleSurfaceGrid(read, IMAX, 7.5, 6.5, tm, NODATA)!;
    expect(s.h).toBeGreaterThan(107);
    expect(s.h).toBeLessThan(109);
    expect(sampleSurfaceGrid(() => NODATA - 1, IMAX, 7.5, 6.5, tm, NODATA)).toBeNull();
  });

  it('clamps at the grid border and uses the shorter index span there', () => {
    const tm = 5;
    const s = sampleSurfaceGrid(grid((x) => 2 * x, tm), IMAX, 0, 0, tm, NODATA)!;
    expect(s.g![0]).toBeCloseTo(2, 9);
    expect(s.h).toBeCloseTo(0, 9);
  });
});

describe('descriptor CPU formulas', () => {
  it('slope and aspect follow the normal of a tilted plane', () => {
    // Rises toward the north-east by 1 m per 2 m: downslope points south-west
    const s = sample((x, y) => 0.5 * (x + y) / Math.SQRT2, 50);
    expect(slopeDegrees(s)).toBeCloseTo(Math.atan(0.5) * 180 / Math.PI, 6);
    expect(aspectDegrees(s)).toBeCloseTo(225, 6);
    expect(aspectDegrees(sample(() => 100, 50))).toBeNaN();
  });

  it('curvature modes: profile along the slope, plan across it, total the Laplacian', () => {
    // Cylinder along y: h = -k x² on a slope p along x → profile curvature set by hxx, plan 0
    const p = 0.5, k = 0.001;
    const r = -2 * k;
    expect(curvatureOf('plan', p, 0, r, 0, 0)).toBeCloseTo(0, 12);
    expect(curvatureOf('profile', p, 0, r, 0, 0)).toBeCloseTo(-(p * p * r) / (p * p * Math.pow(1 + p * p, 1.5)) * 1000, 9);
    expect(curvatureOf('total', p, 0, r, 0, 0)).toBeCloseTo(-r * 1000, 12);
    // Convex ridge (r < 0) is positive in every mode
    expect(curvatureOf('profile', p, 0, r, 0, 0)).toBeGreaterThan(0);
    // Flat ground: profile and plan are undefined and read 0
    expect(curvatureOf('profile', 0, 0, r, r, 0)).toBe(0);
    expect(curvatureOf('plan', 0, 0, r, r, 0)).toBe(0);
    expect(curvatureValue({ h: 0, n: [0, 0, 1] }, { mode: 'total', range: [-1, 1] })).toBeNaN();
  });

  it('inSector handles sectors through north', () => {
    expect(inSector(10, 315, 45)).toBe(true);
    expect(inSector(350, 315, 45)).toBe(true);
    expect(inSector(180, 315, 45)).toBe(false);
    expect(inSector(90, 45, 135)).toBe(true);
    expect(inSector(200, 45, 135)).toBe(false);
    expect(inSector(-10, 315, 45)).toBe(true);
  });
});
