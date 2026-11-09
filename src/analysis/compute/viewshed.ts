// ============================================================================
// treelet.js - Viewshed
//
// Which cells an observer can see. Rays run from the observer to every cell
// on the perimeter of the square that bounds the search radius, one step per
// cell along the ray's major axis, so every cell in the square lies on a
// ray. Along a ray the running maximum of the terrain's elevation slope
// (rise over distance) is the horizon; a cell is visible when the target on
// it rises to or above the horizon seen so far. Distant ground drops by the
// Earth's curvature, reduced by atmospheric refraction (coefficient k):
// drop = d² (1 − k) / 2R.
// ============================================================================

import type { Grid, Steps } from './drive';

export const EARTH_RADIUS_M = 6371008.8;
/** Standard coefficient of atmospheric refraction. */
export const REFRACTION_K = 0.13;

export interface ViewshedOptions {
  /** Observer position in cells from the grid's NW corner (cell centers sit at .5). */
  x: number;
  y: number;
  /** Observer eye above the ground, meters (default 1.7). */
  eyeHeight?: number;
  /** Height above the ground of what is looked for, meters (default 0: the ground itself). */
  targetHeight?: number;
  /** Search radius in meters (default: the whole grid). */
  radius?: number;
  /** Field of view in degrees (default 360) centered on `bearing` (degrees clockwise from north). */
  fov?: number;
  bearing?: number;
  /** Correct for the Earth's curvature (default true). */
  curvature?: boolean;
  /** Refraction coefficient (default 0.13); 0 for none. */
  refraction?: number;
  /** Also compute how much higher a hidden target would have to be to be seen. */
  clearance?: boolean;
}

export interface ViewshedResult {
  /** 1 visible, 0 hidden, NaN outside the radius / field of view or without data. */
  visible: Float32Array;
  /** Meters a target would have to rise to be seen (0 where visible), when requested. */
  clearance: Float32Array | null;
  /** Elevation of the observer's eye in meters. */
  observerElevation: number;
  visibleCells: number;
  analysedCells: number;
}

function bearingOf(dx: number, dy: number): number {
  // Grid x east, y south; bearing clockwise from north
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Whether a bearing in [0, 360) lies within fov / 2 of `center`, which must be in [0, 360) too. */
function inFov(bearing: number, center: number, fov: number): boolean {
  if (fov >= 360) return true;
  const d = Math.abs(((bearing - center + 540) % 360) - 180);
  return d <= fov / 2;
}

export function* viewshedSteps(grid: Grid, options: ViewshedOptions): Steps<ViewshedResult> {
  const { data, width: W, height: H, cellSize } = grid;
  const eye = options.eyeHeight ?? 1.7;
  const target = options.targetHeight ?? 0;
  const fov = Math.max(0, Math.min(360, options.fov ?? 360));
  // Any bearing, e.g. 720 or −90, reduced to [0, 360) once (inFov relies on it)
  const center = (((options.bearing ?? 0) % 360) + 360) % 360;
  const k = options.refraction ?? REFRACTION_K;
  const curve = options.curvature !== false ? (1 - k) / (2 * EARTH_RADIUS_M) : 0;

  // Work in cell-center coordinates: cell (i, j) is at (i, j)
  const cx = options.x - 0.5;
  const cy = options.y - 0.5;
  const height = (x: number, y: number): number => {
    const i0 = Math.floor(x);
    const j0 = Math.floor(y);
    const fx = x - i0;
    const fy = y - j0;
    const ia = Math.max(0, Math.min(W - 1, i0));
    const ib = Math.max(0, Math.min(W - 1, i0 + 1));
    const ja = Math.max(0, Math.min(H - 1, j0));
    const jb = Math.max(0, Math.min(H - 1, j0 + 1));
    const a = data[ja * W + ia];
    const b = data[ja * W + ib];
    const c = data[jb * W + ia];
    const d = data[jb * W + ib];
    if (a === a && b === b && c === c && d === d) {
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
    let s = 0;
    let w = 0;
    const acc = (v: number, wt: number) => { if (v === v) { s += v * wt; w += wt; } };
    acc(a, (1 - fx) * (1 - fy)); acc(b, fx * (1 - fy)); acc(c, (1 - fx) * fy); acc(d, fx * fy);
    return w > 1e-6 ? s / w : NaN;
  };

  const ground = height(cx, cy);
  if (!(ground === ground)) throw new Error('treelet: no elevation data at the viewshed observer');
  const hObs = ground + eye;

  const maxR = Math.hypot(Math.max(cx, W - 1 - cx), Math.max(cy, H - 1 - cy));
  const R = Math.min(options.radius !== undefined ? options.radius / cellSize : Infinity, maxR + 1);

  // Cells inside the radius and field of view start hidden; everything else is nodata
  const visible = new Float32Array(W * H).fill(NaN);
  const clearance = options.clearance ? new Float32Array(W * H).fill(NaN) : null;
  const iMin = Math.max(0, Math.floor(cx - R));
  const iMax = Math.min(W - 1, Math.ceil(cx + R));
  const jMin = Math.max(0, Math.floor(cy - R));
  const jMax = Math.min(H - 1, Math.ceil(cy + R));
  for (let j = jMin; j <= jMax; j++) {
    for (let i = iMin; i <= iMax; i++) {
      const dx = i - cx;
      const dy = j - cy;
      if (dx * dx + dy * dy > R * R) continue;
      if (!(data[j * W + i] === data[j * W + i])) continue;
      if (!inFov(bearingOf(dx, dy), center, fov)) continue;
      visible[j * W + i] = 0;
      if (clearance) clearance[j * W + i] = Infinity;
    }
  }
  const oi = Math.round(cx);
  const oj = Math.round(cy);
  if (oi >= 0 && oi < W && oj >= 0 && oj < H) {
    visible[oj * W + oi] = 1;
    if (clearance) clearance[oj * W + oi] = 0;
  }

  // Rays to every perimeter cell of the bounding square. A sample stands for
  // the cell it rounds to, which can lie up to half a cell diagonal (≈ 0.71
  // cells) nearer than the sample: rays march one cell past the radius so
  // that every cell whose center is within it gets a sample (only those
  // cells, marked above, are written).
  const reach = R + 1;
  const targets: Array<[number, number]> = [];
  for (let i = iMin; i <= iMax; i++) { targets.push([i, jMin]); if (jMax !== jMin) targets.push([i, jMax]); }
  for (let j = jMin + 1; j < jMax; j++) { targets.push([iMin, j]); if (iMax !== iMin) targets.push([iMax, j]); }

  for (let r = 0; r < targets.length; r++) {
    const [ti, tj] = targets[r];
    const dx = ti - cx;
    const dy = tj - cy;
    const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
    if (n === 0) continue;
    const len = Math.hypot(dx, dy);
    let horizon = -Infinity;
    for (let s = 1; s <= n; s++) {
      const f = s / n;
      const dist = f * len;
      if (dist > reach) break;
      const x = cx + dx * f;
      const y = cy + dy * f;
      const h = height(x, y);
      if (!(h === h)) continue;
      const dm = dist * cellSize;
      const drop = dm * dm * curve;
      const groundSlope = (h - drop - hObs) / dm;
      const ii = Math.round(x);
      const jj = Math.round(y);
      const idx = jj * W + ii;
      if (ii >= 0 && ii < W && jj >= 0 && jj < H && visible[idx] === visible[idx]) {
        const targetSlope = groundSlope + target / dm;
        if (targetSlope >= horizon) {
          visible[idx] = 1;
          if (clearance) clearance[idx] = 0;
        } else if (clearance) {
          const need = (horizon - targetSlope) * dm;
          if (need < clearance[idx]) clearance[idx] = need;
        }
      }
      if (groundSlope > horizon) horizon = groundSlope;
    }
    if ((r & 63) === 63) yield r / targets.length;
  }

  let visibleCells = 0;
  let analysedCells = 0;
  for (let i = 0; i < visible.length; i++) {
    const v = visible[i];
    if (v === v) {
      analysedCells++;
      if (v === 1) visibleCells++;
    }
    if (clearance && clearance[i] === Infinity) clearance[i] = NaN;
  }
  return { visible, clearance, observerElevation: hObs, visibleCells, analysedCells };
}
