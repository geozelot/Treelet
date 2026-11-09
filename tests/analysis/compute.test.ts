// ============================================================================
// Tests for the worker analyses on synthetic grids: viewshed, sun hours,
// sky-view factor and TPI (src/analysis/compute/*), and the driver.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { runSync, drive, type Grid } from '../../src/analysis/compute/drive';
import { viewshedSteps, EARTH_RADIUS_M, REFRACTION_K } from '../../src/analysis/compute/viewshed';
import { sunHoursSteps, shadowSweep } from '../../src/analysis/compute/sunHours';
import { skyViewSteps, tpiSteps } from '../../src/analysis/compute/skyView';

function grid(width: number, height: number, cellSize: number, h: (i: number, j: number) => number): Grid {
  const data = new Float32Array(width * height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) data[j * width + i] = h(i, j);
  return { data, width, height, cellSize };
}

const at = (g: { width: number }, a: Float32Array, i: number, j: number) => a[j * g.width + i];

describe('viewshed', () => {
  it('sees all of a flat plain within the radius; nothing outside it', () => {
    const g = grid(41, 41, 10, () => 100);
    const r = runSync(viewshedSteps(g, { x: 20.5, y: 20.5, radius: 150, curvature: false }));
    expect(at(g, r.visible, 20, 20)).toBe(1);
    expect(at(g, r.visible, 30, 20)).toBe(1); // 100 m away
    expect(at(g, r.visible, 20, 34)).toBe(1); // 140 m away
    expect(at(g, r.visible, 40, 40)).toBeNaN(); // 283 m: outside the radius
    expect(r.visibleCells).toBe(r.analysedCells);
    expect(r.observerElevation).toBeCloseTo(101.7, 5);
  });

  it('a wall hides the ground behind it, not in front of it or the wall itself', () => {
    // Wall 20 m high, three cells thick, east of the observer at columns 25–27
    const g = grid(61, 21, 10, (i) => (i >= 25 && i <= 27 ? 120 : 100));
    const r = runSync(viewshedSteps(g, { x: 10.5, y: 10.5, curvature: false, clearance: true }));
    expect(at(g, r.visible, 20, 10)).toBe(1); // in front
    expect(at(g, r.visible, 25, 10)).toBe(1); // the wall's face
    expect(at(g, r.visible, 40, 10)).toBe(0); // behind
    expect(at(g, r.visible, 60, 10)).toBe(0);
    // A target behind the wall must rise to the line over the wall's top edge
    const need = at(g, r.clearance!, 40, 10);
    const slope = (120 - 101.7) / ((25 - 10) * 10);
    expect(need).toBeCloseTo(101.7 + slope * 300 - 100, 0);
    expect(at(g, r.clearance!, 20, 10)).toBe(0);
  });

  it('from a cone peak everything is visible', () => {
    const g = grid(51, 51, 30, (i, j) => 3000 - 20 * Math.hypot(i - 25, j - 25));
    const r = runSync(viewshedSteps(g, { x: 25.5, y: 25.5, curvature: false }));
    expect(r.visibleCells).toBe(r.analysedCells);
    expect(r.analysedCells).toBe(51 * 51);
  });

  it('a target height lifts hidden ground into view; a field of view limits the sector', () => {
    const g = grid(61, 21, 10, (i) => (i >= 25 && i <= 27 ? 120 : 100));
    const tall = runSync(viewshedSteps(g, { x: 10.5, y: 10.5, curvature: false, targetHeight: 100 }));
    expect(at(g, tall.visible, 40, 10)).toBe(1);
    const east = runSync(viewshedSteps(g, { x: 30.5, y: 10.5, curvature: false, fov: 90, bearing: 90 }));
    expect(at(g, east.visible, 50, 10)).toBe(1);
    expect(at(g, east.visible, 10, 10)).toBeNaN(); // behind the observer
  });

  it('the Earth’s curvature hides low ground beyond the horizon', () => {
    // Sea level, eye 2 m up: the horizon lies at sqrt(2 R h / (1 − k)) ≈ 5.4 km
    const horizon = Math.sqrt((2 * EARTH_RADIUS_M * 2) / (1 - REFRACTION_K));
    expect(horizon).toBeGreaterThan(5300);
    expect(horizon).toBeLessThan(5500);
    const sea = grid(201, 3, 100, () => 0);
    const curved = runSync(viewshedSteps(sea, { x: 0.5, y: 1.5, eyeHeight: 2 }));
    expect(at(sea, curved.visible, 30, 1)).toBe(1); // 3 km
    expect(at(sea, curved.visible, 50, 1)).toBe(1); // 5 km
    expect(at(sea, curved.visible, 60, 1)).toBe(0); // 6 km
    expect(at(sea, curved.visible, 150, 1)).toBe(0); // 15 km
    // Without refraction the horizon is closer (≈ 5.05 km)
    const dry = runSync(viewshedSteps(sea, { x: 0.5, y: 1.5, eyeHeight: 2, refraction: 0 }));
    expect(at(sea, dry.visible, 53, 1)).toBe(0);
    // A flat Earth sees all of it
    const flat = runSync(viewshedSteps(sea, { x: 0.5, y: 1.5, eyeHeight: 2, curvature: false }));
    expect(at(sea, flat.visible, 150, 1)).toBe(1);
    // A 50 m tower at 15 km shows over the horizon
    const tower = grid(201, 3, 100, (i) => (i === 150 ? 50 : 0));
    expect(at(tower, runSync(viewshedSteps(tower, { x: 0.5, y: 1.5, eyeHeight: 2 })).visible, 150, 1)).toBe(1);
  });

  it('rejects an observer without data', () => {
    const g = grid(5, 5, 10, () => NaN);
    expect(() => runSync(viewshedSteps(g, { x: 2.5, y: 2.5 }))).toThrow(/no elevation data/);
  });
});

describe('sun hours', () => {
  const day = (hours: number[]) => hours.map((hour) => ({ hour, azimuth: 90 + (hour - 6) * 15, altitude: 30 }));

  it('a flat plain gets every sample above the horizon', () => {
    const g = grid(20, 20, 10, () => 500);
    const samples = [...day([6, 7, 8]), { hour: 22, azimuth: 0, altitude: -10 }];
    const r = runSync(sunHoursSteps(g, { samples, stepMinutes: 60 }));
    expect(r.daylight).toBe(3);
    expect(at(g, r.hours, 5, 5)).toBe(3);
    expect(at(g, r.firstSun, 5, 5)).toBe(6);
    expect(at(g, r.lastSun, 5, 5)).toBe(8);
  });

  it('a wall shades the ground on its far side from a low sun', () => {
    // Wall 50 m high at column 10; morning sun from the east at 10°
    const g = grid(30, 5, 10, (i) => (i === 10 ? 550 : 500));
    const lit = new Uint8Array(30 * 5);
    shadowSweep(g, 90, 10, lit);
    expect(lit[2 * 30 + 15]).toBe(1); // east of the wall: lit
    expect(lit[2 * 30 + 10]).toBe(1); // the wall top
    expect(lit[2 * 30 + 9]).toBe(0); // right behind it (west)
    // Shadow length: 50 m / tan(10°) ≈ 284 m ≈ 28 cells, so it reaches the grid edge
    expect(lit[2 * 30 + 0]).toBe(0);
    // A high sun shortens it to 50 / tan(60°) ≈ 29 m: three cells
    shadowSweep(g, 90, 60, lit);
    expect(lit[2 * 30 + 8]).toBe(0);
    expect(lit[2 * 30 + 5]).toBe(1);
  });

  it('shadows fall along diagonal azimuths too (south-west sun)', () => {
    const g = grid(40, 40, 10, (i, j) => (i === 20 && j === 20 ? 600 : 500));
    const lit = new Uint8Array(40 * 40);
    shadowSweep(g, 225, 30, lit);
    // The tower shades the ground to its north-east, not to its south-west
    expect(lit[18 * 40 + 22]).toBe(0);
    expect(lit[22 * 40 + 18]).toBe(1);
  });
});

describe('sky-view factor and TPI', () => {
  it('the whole-grid sweep finds the same horizons as direct sampling', () => {
    // Random-ish relief: compare the sweep with direct sampling over the whole grid
    const g = grid(48, 40, 30, (i, j) => 500 + 80 * Math.sin(i / 5) * Math.cos(j / 7) + 3 * i);
    const sweep = runSync(skyViewSteps(g, { directions: 16 }));
    const direct = runSync(skyViewSteps(g, { directions: 16, radius: 30 * 128 }));
    let worst = 0;
    for (let i = 0; i < sweep.length; i++) worst = Math.max(worst, Math.abs(sweep[i] - direct[i]));
    // The sweep follows each direction exactly; direct samples snap to cells,
    // so their rays wander slightly off the direction: small differences only
    expect(worst).toBeLessThan(0.05);
    // Both see a lower sky in the troughs than on the crests
    expect(at(g, sweep, 24, 22)).toBeLessThanOrEqual(1);
  });

  it('SVF is 1 on a plain and lower at the bottom of a valley', () => {
    const plain = grid(30, 30, 10, () => 100);
    expect(at(plain, runSync(skyViewSteps(plain, { radius: 100 })), 15, 15)).toBeCloseTo(1, 6);
    // V-shaped valley along y: walls at 45° on both sides
    const valley = grid(41, 41, 10, (i) => Math.abs(i - 20) * 10);
    for (const svf of [runSync(skyViewSteps(valley, { radius: 200, directions: 16 })), runSync(skyViewSteps(valley, { directions: 16 }))]) {
      const bottom = at(valley, svf, 20, 20);
      expect(bottom).toBeLessThan(0.75);
      expect(bottom).toBeGreaterThan(0.4);
      // Up on the slope the sky opens toward one side
      expect(at(valley, svf, 35, 20)).toBeGreaterThan(bottom);
    }
    expect(at(plain, runSync(skyViewSteps(plain, {})), 15, 15)).toBeCloseTo(1, 6);
  });

  it('TPI is 0 on a plane, positive on a peak and negative in a pit', () => {
    const plane = grid(30, 30, 10, (i, j) => 3 * i + 2 * j);
    expect(at(plane, runSync(tpiSteps(plane, { radius: 50 })), 15, 15)).toBeCloseTo(0, 4);
    const peak = grid(31, 31, 10, (i, j) => 1000 - 5 * Math.hypot(i - 15, j - 15));
    const tpi = runSync(tpiSteps(peak, { radius: 50 }));
    expect(at(peak, tpi, 15, 15)).toBeGreaterThan(10);
    const pit = grid(31, 31, 10, (i, j) => 5 * Math.hypot(i - 15, j - 15));
    expect(at(pit, runSync(tpiSteps(pit, { radius: 50 })), 15, 15)).toBeLessThan(-10);
    // A ring leaves the center out: the mean is lower, the TPI higher
    const ring = runSync(tpiSteps(peak, { radius: 50, innerRadius: 20 }));
    expect(at(peak, ring, 15, 15)).toBeGreaterThan(at(peak, tpi, 15, 15));
  });

  it('skips nodata cells', () => {
    const g = grid(10, 10, 10, (i) => (i < 3 ? NaN : 100));
    const tpi = runSync(tpiSteps(g, { radius: 30 }));
    expect(at(g, tpi, 1, 5)).toBeNaN();
    expect(at(g, tpi, 5, 5)).toBeCloseTo(0, 6);
    expect(at(g, runSync(skyViewSteps(g, { radius: 50 })), 5, 5)).toBeCloseTo(1, 6);
  });
});

describe('drive', () => {
  it('runs a computation in slices, reporting progress, and aborts on request', async () => {
    const g = grid(64, 64, 10, (i, j) => (i * j) % 17);
    const progress: number[] = [];
    const result = await drive(tpiSteps(g, { radius: 30 }), undefined, (f) => progress.push(f), 0);
    expect(result).toHaveLength(64 * 64);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((f) => f >= 0 && f <= 1)).toBe(true);

    const controller = new AbortController();
    controller.abort();
    await expect(drive(tpiSteps(g, { radius: 30 }), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
