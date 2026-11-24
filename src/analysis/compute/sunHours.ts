// ============================================================================
// treelet.js - Sun hours
//
// Hours of direct sun per cell over a day: for each sun position (sampled
// every few minutes while the sun is up) a shadow sweep marks the lit
// cells. The sweep runs along the sun's azimuth, from the side facing the
// sun inwards, carrying a shadow surface: it starts at the terrain, sinks
// by tan(altitude) per meter away from the sun, and is raised again by any
// terrain that pokes through it. A cell is lit where its terrain reaches
// the shadow surface carried from its sun-ward neighbour. O(cells) per sun
// position. Terrain outside the grid casts no shadow, and the Earth's
// curvature is ignored (the grid is treated as flat).
// ============================================================================

import type { Grid, Steps } from './drive';

export interface SunSample {
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Degrees above the horizon. */
  altitude: number;
  /** Time of day of the sample in hours (for first / last sun). */
  hour: number;
}

export interface SunHoursOptions {
  /** Sun positions, one per time step (positions below the horizon are skipped). */
  samples: SunSample[];
  /** Minutes each sample stands for. */
  stepMinutes: number;
}

export interface SunHoursResult {
  /** Hours of direct sun (NaN without data). */
  hours: Float32Array;
  /** Time of day (hours) of the first and last lit sample, NaN when never lit. */
  firstSun: Float32Array;
  lastSun: Float32Array;
  /** Hours the sun is above the horizon. */
  daylight: number;
}

/** Shadow surface value of cells that cast no shadow (nodata, outside). */
const NONE = -1e30;

/**
 * Lit mask for one sun position: `lit[i]` = 1 where direct sun reaches the
 * terrain, 0 in shadow (nodata cells are 0).
 */
export function shadowSweep(grid: Grid, azimuth: number, altitude: number, lit: Uint8Array): void {
  const { data, width: W, height: H, cellSize } = grid;
  const az = (azimuth * Math.PI) / 180;
  // Toward the sun in grid coordinates (x east, y south)
  const sx = Math.sin(az);
  const sy = -Math.cos(az);
  const tanAlt = Math.tan((Math.max(altitude, 1e-3) * Math.PI) / 180);

  const majorX = Math.abs(sx) >= Math.abs(sy);
  const lines = majorX ? W : H; // processed lines (columns or rows)
  const len = majorX ? H : W; // cells per line
  const sgn = (majorX ? sx : sy) >= 0 ? 1 : -1;
  const ratio = majorX ? sy / Math.abs(sx) : sx / Math.abs(sy); // minor-axis shift per step toward the sun
  const drop = tanAlt * cellSize * Math.sqrt(1 + ratio * ratio);

  let prev = new Float64Array(len);
  let cur = new Float64Array(len);
  // Cell index = line·lineStride + k·cellStride
  const lineStride = majorX ? 1 : W;
  const cellStride = majorX ? W : 1;

  // The line facing the sun first, then away from it
  const start = sgn > 0 ? lines - 1 : 0;
  for (let step = 0; step < lines; step++) {
    const line = start - sgn * step;
    const base = line * lineStride;
    for (let k = 0; k < len; k++) {
      const idx = base + k * cellStride;
      const h = data[idx];
      let shadow = NONE;
      if (step > 0) {
        const r = k + ratio;
        if (r >= 0 && r <= len - 1) {
          const r0 = Math.floor(r);
          const f = r - r0;
          const r1 = Math.min(r0 + 1, len - 1);
          shadow = prev[r0] * (1 - f) + prev[r1] * f - drop;
        }
      }
      if (!(h === h)) {
        lit[idx] = 0;
        cur[k] = shadow;
      } else if (h >= shadow) {
        lit[idx] = 1;
        cur[k] = h;
      } else {
        lit[idx] = 0;
        cur[k] = shadow;
      }
    }
    const t = prev; prev = cur; cur = t;
  }
}

export function* sunHoursSteps(grid: Grid, options: SunHoursOptions): Steps<SunHoursResult> {
  const n = grid.width * grid.height;
  const counts = new Uint16Array(n);
  const firstSun = new Float32Array(n).fill(NaN);
  const lastSun = new Float32Array(n).fill(NaN);
  const lit = new Uint8Array(n);
  const up = options.samples.filter((s) => s.altitude > 0);

  for (let s = 0; s < up.length; s++) {
    const sample = up[s];
    shadowSweep(grid, sample.azimuth, sample.altitude, lit);
    for (let i = 0; i < n; i++) {
      if (!lit[i]) continue;
      counts[i]++;
      if (!(firstSun[i] === firstSun[i])) firstSun[i] = sample.hour;
      lastSun[i] = sample.hour;
    }
    yield (s + 1) / up.length;
  }

  const perSample = options.stepMinutes / 60;
  const hours = new Float32Array(n);
  for (let i = 0; i < n; i++) hours[i] = grid.data[i] === grid.data[i] ? counts[i] * perSample : NaN;
  return { hours, firstSun, lastSun, daylight: up.length * perSample };
}
