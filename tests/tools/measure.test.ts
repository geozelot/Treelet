// ============================================================================
// Tests for joinPathMeasures (src/tools/measure.ts): a path measured in two
// parts and joined equals the path measured whole, up to sampling.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { measurePath, joinPathMeasures, type PathMeasure } from '../../src/tools/measure';
import type { LngLat } from '../../src/core/types';

const terrain = (p: LngLat) => 500 + 300 * Math.sin(p.lng * 200) + 200 * Math.cos(p.lat * 150);

/**
 * Sampling: the parts are sampled at the same places as the whole. Their
 * sample distances are rescaled from the sphere to the ellipsoid per part
 * instead of once for the whole path (the ratio depends on the direction, by
 * up to a few per mille), so vertices land on their exact geodesic distances
 * and the samples between them may move by a few meters per kilometer.
 */
function expectSame(joined: PathMeasure, whole: PathMeasure) {
  expect(joined.distance).toBeCloseTo(whole.distance, 6);
  expect(Math.abs(joined.surfaceDistance - whole.surfaceDistance) / whole.surfaceDistance).toBeLessThan(1e-3);
  expect(joined.gain).toBeCloseTo(whole.gain, 6);
  expect(joined.loss).toBeCloseTo(whole.loss, 6);
  expect(joined.minElevation).toBeCloseTo(whole.minElevation!, 6);
  expect(joined.maxElevation).toBeCloseTo(whole.maxElevation!, 6);
  expect(joined.vertexDistances).toHaveLength(whole.vertexDistances.length);
  joined.vertexDistances.forEach((d, i) => expect(d).toBeCloseTo(whole.vertexDistances[i], 6));
  expect(joined.profile).toHaveLength(whole.profile.length);
  joined.profile.forEach((s, i) => {
    expect(s.lngLat.lng).toBeCloseTo(whole.profile[i].lngLat.lng, 12);
    expect(s.lngLat.lat).toBeCloseTo(whole.profile[i].lngLat.lat, 12);
    expect(s.elevation === null).toBe(whole.profile[i].elevation === null);
    if (s.elevation !== null) expect(s.elevation).toBeCloseTo(whole.profile[i].elevation!, 6);
    expect(Math.abs(s.distance - whole.profile[i].distance)).toBeLessThan(whole.distance * 5e-3);
  });
}

describe('joinPathMeasures', () => {
  const pts: LngLat[] = [{ lng: 0.01, lat: 0.01 }, { lng: 0.06, lat: 0.02 }, { lng: 0.09, lat: 0.07 }, { lng: 0.04, lat: 0.095 }];

  it('joins at a vertex: lengths, ascent, descent, range, vertices and profile', () => {
    const whole = measurePath(pts, terrain, 20);
    expectSame(joinPathMeasures(measurePath(pts.slice(0, 3), terrain, 20), measurePath(pts.slice(2), terrain, 20)), whole);
    expectSame(joinPathMeasures(measurePath(pts.slice(0, 2), terrain, 20), measurePath(pts.slice(1), terrain, 20)), whole);
    // Three parts, as while dragging a point
    const middle = joinPathMeasures(measurePath(pts.slice(0, 2), terrain, 20), measurePath(pts.slice(1, 3), terrain, 20));
    expectSame(joinPathMeasures(middle, measurePath(pts.slice(2), terrain, 20)), whole);
  });

  it('a single-point first part adds nothing', () => {
    const b = measurePath(pts.slice(0, 2), terrain, 20);
    expectSame(joinPathMeasures(measurePath(pts.slice(0, 1), terrain, 20), b), b);
  });

  it('climbs across a gap without data at the joint', () => {
    const gappy = (p: LngLat) => (p.lng > 0.055 && p.lng < 0.07 ? null : terrain(p));
    const whole = measurePath(pts.slice(0, 3), gappy, 20);
    const a = measurePath(pts.slice(0, 2), gappy, 20);
    const b = measurePath(pts.slice(1, 3), gappy, 20);
    const joined = joinPathMeasures(a, b);
    expect(a.profile.at(-1)!.elevation).toBeNull();
    // The climb across the gap is in neither part
    expect(Math.abs(joined.gain + joined.loss - (a.gain + a.loss + b.gain + b.loss))).toBeGreaterThan(1);
    expectSame(joined, whole);
  });

  it('does not change its inputs', () => {
    const a = measurePath(pts.slice(0, 2), terrain, 20);
    const b = measurePath(pts.slice(1, 3), terrain, 20);
    const before = JSON.stringify([a, b]);
    joinPathMeasures(a, b);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});
