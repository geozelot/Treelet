// ============================================================================
// Tests for geodesy (src/analysis/geodesy.ts), line of sight
// (src/analysis/lineOfSight.ts) and measurements (src/tools/measure.ts).
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  geodesicDistance, haversineDistance, pathLength, ringArea, polygonArea, AUTHALIC_RADIUS,
} from '../../src/analysis/geodesy';
import { lineOfSightProfile } from '../../src/analysis/lineOfSight';
import { measurePath, measureSurfaceArea, pointInRing, geodesicAreaOf } from '../../src/tools/measure';

const dms = (d: number, m: number, s: number) => Math.sign(d) * (Math.abs(d) + m / 60 + s / 3600);

describe('geodesy', () => {
  it('Vincenty matches the classic Flinders Peak → Buninyong reference (54 972.271 m)', () => {
    const flinders = { lat: dms(-37, 57, 3.7203), lng: dms(144, 25, 29.5244) };
    const buninyong = { lat: dms(-37, 39, 10.1561), lng: dms(143, 55, 35.3839) };
    expect(geodesicDistance(flinders, buninyong)).toBeCloseTo(54972.271, 2);
  });

  it('one degree along the equator and along a meridian', () => {
    expect(geodesicDistance({ lng: 0, lat: 0 }, { lng: 1, lat: 0 })).toBeCloseTo(111319.49, 1);
    // Meridian degree at 45°: 111 132.95 m
    expect(geodesicDistance({ lng: 0, lat: 44.5 }, { lng: 0, lat: 45.5 })).toBeCloseTo(111132.95, -1);
    expect(geodesicDistance({ lng: 5, lat: 5 }, { lng: 5, lat: 5 })).toBe(0);
    // Nearly antipodal points fall back to the sphere instead of failing
    const d = geodesicDistance({ lng: 0, lat: 0 }, { lng: 179.9, lat: 0.1 });
    expect(d).toBeGreaterThan(19.9e6);
    expect(haversineDistance({ lng: 0, lat: 0 }, { lng: 180, lat: 0 })).toBeCloseTo(Math.PI * AUTHALIC_RADIUS, 0);
  });

  it('path length sums the segments', () => {
    const pts = [{ lng: 0, lat: 0 }, { lng: 1, lat: 0 }, { lng: 2, lat: 0 }];
    expect(pathLength(pts)).toBeCloseTo(2 * 111319.49, 0);
  });

  it('ring areas: a small box matches the spherical zone formula; holes subtract; orientation and closure don’t matter', () => {
    const box = [{ lng: 10, lat: 46 }, { lng: 10.1, lat: 46 }, { lng: 10.1, lat: 46.1 }, { lng: 10, lat: 46.1 }];
    const R = AUTHALIC_RADIUS;
    const zone = R * R * (0.1 * Math.PI / 180) * (Math.sin(46.1 * Math.PI / 180) - Math.sin(46 * Math.PI / 180));
    expect(ringArea(box) / zone).toBeCloseTo(1, 3);
    expect(ringArea([...box].reverse())).toBeCloseTo(ringArea(box), 3);
    expect(ringArea([...box, box[0]])).toBeCloseTo(ringArea(box), 3);
    const hole = [{ lng: 10.02, lat: 46.02 }, { lng: 10.04, lat: 46.02 }, { lng: 10.04, lat: 46.04 }, { lng: 10.02, lat: 46.04 }];
    expect(polygonArea([box, hole])).toBeCloseTo(ringArea(box) - ringArea(hole), 3);
    expect(ringArea(box.slice(0, 2))).toBe(0);
  });
});

describe('lineOfSightProfile', () => {
  const flat = (n: number, step: number, h: (d: number) => number) =>
    Array.from({ length: n }, (_, i) => ({ distance: i * step, elevation: h(i * step) }));

  it('sees across flat ground and is blocked by a ridge', () => {
    const open = lineOfSightProfile(flat(11, 100, () => 100), { curvature: false });
    expect(open.visible).toBe(true);
    expect(open.clearance).toBeCloseTo(1.7 * 0.1, 6); // the line sinks toward the 0 m target height
    const ridge = lineOfSightProfile(flat(11, 100, (d) => (d === 500 ? 110 : 100)), { curvature: false });
    expect(ridge.visible).toBe(false);
    expect(ridge.obstructionIndex).toBe(5);
    expect(ridge.clearance).toBeLessThan(0);
    // A tall enough target is seen over it
    expect(lineOfSightProfile(flat(11, 100, (d) => (d === 500 ? 110 : 100)), { curvature: false, toHeight: 30 }).visible).toBe(true);
  });

  it('the sight line runs from the eye to the target; curvature bends it over the terrain profile', () => {
    const r = lineOfSightProfile(flat(3, 5000, () => 0), { fromHeight: 2, toHeight: 0 });
    expect(r.sight[0]).toBeCloseTo(2, 9);
    expect(r.sight[2]).toBeCloseTo(0, 9);
    // Drawn over a flat profile, the line sags below the straight chord (1 m) by the
    // Earth's bulge, d (D − d)(1 − k) / 2R: here below the sea surface, so it is blocked
    const bulge = (5000 * 5000 * (1 - 0.13)) / (2 * 6371008.8);
    expect(r.sight[1]).toBeCloseTo(1 - bulge, 6);
    expect(r.visible).toBe(false);
    // Flat sea, eye 2 m: a 0 m target at 10 km lies beyond the horizon
    expect(lineOfSightProfile(flat(101, 100, () => 0), { fromHeight: 2 }).visible).toBe(false);
    expect(lineOfSightProfile(flat(31, 100, () => 0), { fromHeight: 2 }).visible).toBe(true);
  });

  it('skips samples without data and rejects ends without data', () => {
    const samples = flat(5, 100, () => 50);
    samples[2].elevation = null;
    expect(lineOfSightProfile(samples).visible).toBe(true);
    samples[4].elevation = null;
    expect(() => lineOfSightProfile(samples)).toThrow(/ends/);
  });
});

describe('measurePath', () => {
  it('measures a climb: geodesic length, surface length, gain and loss', () => {
    // 1 km east along the equator over a 100 m rise and a 40 m drop (1 m per meter of lng)
    const a = { lng: 0, lat: 0 };
    const b = { lng: 0.008983, lat: 0 }; // ≈ 1000 m
    const elev = (p: { lng: number }) => {
      const x = (p.lng / 0.008983) * 1000;
      return x < 500 ? x * 0.2 : 100 - (x - 500) * 0.08;
    };
    const m = measurePath([a, b], elev, 10);
    expect(m.distance).toBeCloseTo(1000, -1);
    expect(m.gain).toBeCloseTo(100, 0);
    expect(m.loss).toBeCloseTo(40, 0);
    expect(m.surfaceDistance).toBeCloseTo(Math.hypot(500, 100) + Math.hypot(500, 40), -1);
    expect(m.minElevation).toBeCloseTo(0, 6);
    expect(m.maxElevation).toBeCloseTo(100, 0);
    expect(m.profile[0].distance).toBe(0);
    expect(m.profile.at(-1)!.distance).toBeCloseTo(m.distance, 6);
    expect(m.vertexDistances).toEqual([0, m.distance]);
  });

  it('caps the sample count and tolerates missing data', () => {
    const pts = [{ lng: 0, lat: 0 }, { lng: 1, lat: 0 }];
    const m = measurePath(pts, () => null, 1, 500);
    expect(m.profile.length).toBeLessThanOrEqual(502);
    expect(m.gain).toBe(0);
    expect(m.minElevation).toBeNull();
    expect(m.surfaceDistance).toBeCloseTo(m.distance, 0);
  });
});

describe('surface area', () => {
  const square: Array<[number, number]> = [[0, 0], [100, 0], [100, 100], [0, 100]];

  it('a flat square has its planar area; a 45° slope √2 times it', () => {
    const flat = measureSurfaceArea([square], { cells: 64, metersPerUnit: () => 1, surfaceAt: () => ({ h: 10, nz: 1 }) });
    expect(flat.surfaceArea).toBeCloseTo(10000, 0);
    expect(flat.planarArea).toBeCloseTo(10000, 0);
    const slope = measureSurfaceArea([square], { cells: 64, metersPerUnit: () => 1, surfaceAt: () => ({ h: 10, nz: Math.SQRT1_2 }) });
    expect(slope.surfaceArea / slope.planarArea).toBeCloseTo(Math.SQRT2, 6);
  });

  it('leaves out holes and cells outside a triangle', () => {
    const hole: Array<[number, number]> = [[25, 25], [75, 25], [75, 75], [25, 75]];
    const r = measureSurfaceArea([square, hole], { cells: 100, metersPerUnit: () => 2, surfaceAt: () => null });
    expect(r.planarArea).toBeCloseTo(4 * (10000 - 2500), -2);
    const tri = measureSurfaceArea([[[0, 0], [100, 0], [0, 100]]], { cells: 200, metersPerUnit: () => 1, surfaceAt: () => null });
    expect(tri.planarArea / 5000).toBeCloseTo(1, 1);
    expect(pointInRing(10, 10, square)).toBe(true);
    expect(pointInRing(-1, 10, square)).toBe(false);
  });

  it('geodesic area and perimeter of a ring', () => {
    const ring = [{ lng: 0, lat: 0 }, { lng: 0.01, lat: 0 }, { lng: 0.01, lat: 0.01 }, { lng: 0, lat: 0.01 }];
    const r = geodesicAreaOf(ring);
    // 0.01° of longitude on the equator is 1113.2 m, of latitude 1105.7 m
    expect(r.perimeter).toBeCloseTo(2 * 1113.19 + 2 * 1105.74, 0);
    expect(r.area / 1e6).toBeCloseTo(1.23, 1);
  });
});
