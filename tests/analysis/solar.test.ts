// ============================================================================
// Tests for src/analysis/solar.ts against published values.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { sunPosition, sunPathOfDay, refraction } from '../../src/analysis/solar';

describe('sunPosition', () => {
  it('matches the NREL SPA reference example (Golden, CO, 2003-10-17 12:30:30 −07:00)', () => {
    // Reda & Andreas (2004), table A5.1: topocentric zenith 50.11162°, azimuth 194.34024°
    const p = sunPosition(new Date('2003-10-17T19:30:30Z'), -105.1786, 39.742476);
    expect(Math.abs(90 - p.altitude - 50.11162)).toBeLessThan(0.05);
    expect(Math.abs(p.azimuth - 194.34024)).toBeLessThan(0.05);
  });

  it('declination peaks near +23.44° at the June solstice and is near 0 at the equinox', () => {
    expect(sunPosition(new Date('2024-06-20T20:51:00Z'), 0, 0).declination).toBeCloseTo(23.44, 1);
    expect(Math.abs(sunPosition(new Date('2024-03-20T03:06:00Z'), 0, 0).declination)).toBeLessThan(0.02);
  });

  it('equation of time: about +16.4 min in early November, −14.2 min in mid February', () => {
    expect(sunPosition(new Date('2024-11-03T12:00:00Z'), 0, 0).equationOfTime).toBeCloseTo(16.45, 0);
    expect(sunPosition(new Date('2024-02-11T12:00:00Z'), 0, 0).equationOfTime).toBeCloseTo(-14.2, 0);
  });

  it('noon sun stands due south in the northern mid-latitudes, north in the southern', () => {
    // Solar noon at Greenwich ≈ 12:00 UTC − EoT
    const north = sunPosition(new Date('2024-06-21T12:02:00Z'), 0, 47);
    expect(Math.abs(north.azimuth - 180)).toBeLessThan(1);
    expect(north.altitude).toBeCloseTo(90 - 47 + 23.44, 0);
    const south = sunPosition(new Date('2024-06-21T12:02:00Z'), 0, -33);
    expect(Math.min(south.azimuth, 360 - south.azimuth)).toBeLessThan(1);
  });

  it('refraction lifts the sun about 0.57° at the horizon and nothing near the zenith', () => {
    expect(refraction(0)).toBeCloseTo(0.482, 2);
    expect(refraction(-0.3)).toBeGreaterThan(0.5);
    expect(refraction(89)).toBe(0);
    expect(refraction(45)).toBeCloseTo(0.016, 3);
  });
});

describe('sunPathOfDay', () => {
  it('samples the local day in the middle of each step', () => {
    const path = sunPathOfDay(new Date('2024-06-21T10:00:00Z'), 11.39, 47.27, 60, 2);
    expect(path).toHaveLength(24);
    expect(path[0].hour).toBe(0.5);
    expect(path[23].hour).toBe(23.5);
    // Daylight at Innsbruck around the solstice: about 16 hours with the sun up
    const up = path.filter((p) => p.altitude > 0).length;
    expect(up).toBeGreaterThanOrEqual(15);
    expect(up).toBeLessThanOrEqual(17);
    // The local morning sun is in the east, the evening sun in the west
    expect(path[8].azimuth).toBeGreaterThan(60);
    expect(path[8].azimuth).toBeLessThan(130);
    expect(path[19].azimuth).toBeGreaterThan(260);
  });
});
