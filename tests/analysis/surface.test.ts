// ============================================================================
// Tests for the CPU surface sampler (src/analysis/surface.ts) and the
// descriptors' CPU formulas on synthetic surfaces: planes give exact
// gradients and zero curvature, paraboloids their analytic curvature, and
// slope / aspect / curvature agree with what the shader formulas compute.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { sampleSurfaceGrid } from '../../src/analysis/surface';
import { slopeDegrees, aspectDegrees, curvatureOf, curvatureValue, inSector } from '../../src/analysis/builtins';
import { slope } from '../../src/analysis/builtins/slope';
import { aspect } from '../../src/analysis/builtins/aspect';
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

  it('the aspect coat fades in on sin(slope) from 1° to 5° of slope', () => {
    const fade = /smoothstep\(([\d.]+), ([\d.]+), sinSlope\)/.exec(aspect.glsl);
    expect(fade).not.toBeNull();
    expect(aspect.glsl).toContain('float sinSlope = length(s.n.xy);');
    expect(Number(fade![1])).toBeCloseTo(Math.sin(Math.PI / 180), 6);
    expect(Number(fade![2])).toBeCloseTo(Math.sin((5 * Math.PI) / 180), 6);
  });

  it('inSector: a clockwise span of 360° or more is every bearing', () => {
    for (const b of [0, 0.5, 90, 180, 270, 359.9, 360, -45, 725]) {
      expect(inSector(b, 0, 360)).toBe(true);
      expect(inSector(b, -180, 180)).toBe(true);
      expect(inSector(b, 90, 450)).toBe(true);
      expect(inSector(b, 10, 1000)).toBe(true);
    }
    // Counter-clockwise ends are a sector, as the parameter resolver reads them:
    // [400, -10] runs clockwise from 40° to 350°
    expect(inSector(180, 400, -10)).toBe(true);
    expect(inSector(20, 400, -10)).toBe(false);
  });

  it('inSector: [350, 10] wraps through north, [10, 350] goes the long way round', () => {
    for (const b of [350, 355, 0, 360, 5, 10, -5]) expect(inSector(b, 350, 10)).toBe(true);
    for (const b of [11, 90, 180, 270, 349]) expect(inSector(b, 350, 10)).toBe(false);
    for (const b of [10, 11, 90, 180, 270, 349, 350]) expect(inSector(b, 10, 350)).toBe(true);
    for (const b of [351, 355, 0, 360, 5, 9]) expect(inSector(b, 10, 350)).toBe(false);
    // Ends outside [0, 360) mean the same bearings
    expect(inSector(0, -10, 10)).toBe(true);
    expect(inSector(180, -10, 10)).toBe(false);
    expect(inSector(25, 370, 400)).toBe(true);
    expect(inSector(5, 370, 400)).toBe(false);
  });

  it('slope packs a full-circle aspect mask as no mask; other masks reduced to [0, 360)', () => {
    const pack = (aspectMask: [number, number] | null) => slope.pack({ range: [0, 60], aspectMask }, [0, 60]);
    const off = { p0: [0, 60, 0, 360], p1: [0, 0, 0, 0] };
    expect(pack(null)).toEqual(off);
    expect(pack([0, 360])).toEqual(off);
    expect(pack([10, 370])).toEqual(off);
    // [360, 0] runs clockwise from north to north: just that bearing
    expect(pack([360, 0])).toEqual({ p0: [0, 60, 0, 0], p1: [1, 0, 0, 0] });
    expect(pack([350, 10])).toEqual({ p0: [0, 60, 350, 10], p1: [1, 0, 0, 0] });
    expect(pack([10, 350])).toEqual({ p0: [0, 60, 10, 350], p1: [1, 0, 0, 0] });
    expect(pack([-10, 10])).toEqual({ p0: [0, 60, 350, 10], p1: [1, 0, 0, 0] });
    expect(pack([370, 400])).toEqual({ p0: [0, 60, 10, 40], p1: [1, 0, 0, 0] });
  });

  it('the packed mask, tested as the shader tests it, agrees with inSector', () => {
    // The shader: mask off (p1.x ≤ 0.5) passes every bearing; otherwise
    // p0.z ≤ p0.w is a plain range, p0.z > p0.w passes through north
    const shaderInside = (b: number, p0: number[], p1: number[]) =>
      p1[0] <= 0.5 || (p0[2] <= p0[3] ? b >= p0[2] && b <= p0[3] : b >= p0[2] || b <= p0[3]);
    const spans: Array<[number, number]> = [
      [0, 360], [360, 0], [-180, 180], [350, 10], [10, 350], [315, 45], [45, 135], [-10, 10], [370, 400], [0, 0], [90, 89],
    ];
    for (const [from, to] of spans) {
      const { p0, p1 } = slope.pack({ range: [0, 60], aspectMask: [from, to] }, [0, 60]);
      for (let b = 0; b < 360; b += 2.5) expect(shaderInside(b, p0, p1), `${b} in [${from}, ${to}]`).toBe(inSector(b, from, to));
    }
  });
});

describe('sampleSurfaceGrid across a tile border', () => {
  // A curved surface cut into two corner-aligned grids that share their edge texels
  const tm = 10;
  const h = (d: number) => 0.002 * d * d + 3 * Math.sin(d / 40); // d in meters along the cut direction
  const west = (i: number) => h(i * tm);                 // texels 0…IMAX at 0…150 m
  const east = (i: number) => h((i + IMAX) * tm);        // texel 0 at 150 m
  const none = NODATA - 1;

  it('without the neighbour the slope steps at the border (one-sided differences)', () => {
    const a = sampleSurfaceGrid((i) => west(i), IMAX, IMAX, 7.5, tm, NODATA)!;
    const b = sampleSurfaceGrid((i) => east(i), IMAX, 0, 7.5, tm, NODATA)!;
    expect(a.h).toBeCloseTo(b.h, 9); // the shared edge
    expect(Math.abs(a.g![0] - b.g![0])).toBeGreaterThan(0.02);
  });

  it("with the neighbour's texels the slope is the central difference from both sides", () => {
    const a = sampleSurfaceGrid((i) => west(i), IMAX, IMAX, 7.5, tm, NODATA, (i) => (i > IMAX ? east(1) : none))!;
    const b = sampleSurfaceGrid((i) => east(i), IMAX, 0, 7.5, tm, NODATA, (i) => (i < 0 ? west(IMAX - 1) : none))!;
    const central = (h((IMAX + 1) * tm) - h((IMAX - 1) * tm)) / (2 * tm);
    expect(a.g![0]).toBeCloseTo(central, 12);
    expect(b.g![0]).toBeCloseTo(central, 12);
    for (let k = 0; k < 3; k++) expect(a.n[k]).toBeCloseTo(b.n[k], 12);
  });

  it('works the same across a north–south border', () => {
    const north = (_i: number, j: number) => h(j * tm);
    const south = (_i: number, j: number) => h((j + IMAX) * tm);
    const a = sampleSurfaceGrid(north, IMAX, 7.5, IMAX, tm, NODATA, (i, j) => (j > IMAX ? south(i, 1) : none))!;
    const b = sampleSurfaceGrid(south, IMAX, 7.5, 0, tm, NODATA, (i, j) => (j < 0 ? north(i, IMAX - 1) : none))!;
    const central = (h((IMAX + 1) * tm) - h((IMAX - 1) * tm)) / (2 * tm);
    // Texel j runs south, world y north: the northward slope is the negative
    expect(a.g![1]).toBeCloseTo(-central, 12);
    expect(b.g![1]).toBeCloseTo(-central, 12);
  });

  it('a neighbour without data there leaves the border one-sided', () => {
    const lone = sampleSurfaceGrid((i) => west(i), IMAX, IMAX, 7.5, tm, NODATA)!;
    const gap = sampleSurfaceGrid((i) => west(i), IMAX, IMAX, 7.5, tm, NODATA, () => none)!;
    expect(gap.g![0]).toBe(lone.g![0]);
    expect(gap.g![0]).toBeCloseTo((h(IMAX * tm) - h((IMAX - 1) * tm)) / tm, 12);
  });
});
