// ============================================================================
// treelet.js - Sky-view factor and topographic position index
//
// Sky-view factor (SVF): the fraction of the sky hemisphere visible from a
// cell, from the horizon angle γ in `directions` directions: SVF = 1 −
// mean(sin γ), with γ ≥ 0. 1 on an open plain, lower in valleys and
// gullies. Without a radius the horizon is searched across the whole grid
// with a sweep per direction along parallel lines that keeps the upper
// convex hull of the terrain ahead (O(cells) per direction, exact). With a
// radius, each cell samples its neighbours up to the radius directly.
//
// Topographic position index (TPI): a cell's elevation minus the mean
// elevation of a square window (or ring, with an inner radius) around it;
// positive on ridges and crests, negative in valleys. Box sums come from a
// summed-area table, so the cost doesn't depend on the radius.
// ============================================================================

import type { Grid, Steps } from './drive';

export interface SkyViewOptions {
  /** Search radius in meters (default: the whole grid). */
  radius?: number;
  /** Search directions (default 16). */
  directions?: number;
}

/** Most cells searched per direction with a radius (bounds the cost). */
export const MAX_SEARCH_CELLS = 128;

/**
 * Add sin(horizon angle) in direction (ux, uy) (grid x east, y south) to
 * `sum` for every cell, searching the whole grid: lines parallel to the
 * direction are walked from their far end back, keeping the upper convex
 * hull of the points ahead; the tangent from the current point to that hull
 * is its horizon. Points are interpolated along the minor axis and count
 * for the nearest cell.
 */
export function horizonSweep(grid: Grid, ux: number, uy: number, sum: Float64Array, stackX: Float64Array, stackZ: Float64Array): void {
  const { data, width: W, height: H, cellSize } = grid;
  const majorX = Math.abs(ux) >= Math.abs(uy);
  const M = majorX ? W : H;
  const L = majorX ? H : W;
  const um = majorX ? ux : uy;
  const un = majorX ? uy : ux;
  const sgn = um >= 0 ? 1 : -1;
  const ratio = un / Math.abs(um); // minor shift per major step ahead
  const step = cellSize * Math.sqrt(1 + ratio * ratio);
  // Line s holds points (m, s + ratio·sgn·m); cell (m, j) lies on line j − round(ratio·sgn·m)
  const r0 = 0;
  const r1 = Math.round(ratio * sgn * (M - 1));
  const sMin = -Math.max(r0, r1);
  const sMax = L - 1 - Math.min(r0, r1);
  const mStart = sgn > 0 ? M - 1 : 0;

  for (let s = sMin; s <= sMax; s++) {
    let top = -1;
    for (let k = 0; k < M; k++) {
      const m = mStart - sgn * k;
      const y = s + ratio * sgn * m;
      // Points within half a cell of the grid count (exact edges suffer from rounding)
      if (y < -0.5 || y >= L - 0.5) continue;
      const yc = y < 0 ? 0 : y > L - 1 ? L - 1 : y;
      const y0 = Math.floor(yc);
      const y1 = y0 + 1 < L ? y0 + 1 : y0;
      const f = yc - y0;
      const a = majorX ? data[y0 * W + m] : data[m * W + y0];
      const b = majorX ? data[y1 * W + m] : data[m * W + y1];
      const z = a + (b - a) * f;
      const x = -k; // position along the direction (ahead = larger)

      // The cell's horizon, from its own elevation: the tangent to the hull
      // of the points ahead (slopes to hull points rise, then fall)
      const cell = Math.round(yc);
      const idx = majorX ? cell * W + m : m * W + cell;
      const zc = data[idx];
      if (top >= 0 && zc === zc) {
        let lo = 0;
        let hi = top;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          // slope(mid) < slope(mid + 1), cross-multiplied (distances are positive)
          if ((stackZ[mid] - zc) * (stackX[mid + 1] - x) < (stackZ[mid + 1] - zc) * (stackX[mid] - x)) lo = mid + 1;
          else hi = mid;
        }
        const slope = (stackZ[lo] - zc) / ((stackX[lo] - x) * step);
        if (slope > 0) sum[idx] += slope / Math.sqrt(1 + slope * slope);
      }

      // Add the line point to the hull: drop the near hull points it hides
      if (!(z === z)) continue;
      while (top >= 1 && (stackZ[top - 1] - z) * (stackX[top] - x) >= (stackZ[top] - z) * (stackX[top - 1] - x)) top--;
      stackX[++top] = x;
      stackZ[top] = z;
    }
  }
}

export function* skyViewSteps(grid: Grid, options: SkyViewOptions): Steps<Float32Array> {
  const { data, width: W, height: H, cellSize } = grid;
  const D = Math.max(4, Math.round(options.directions ?? 16));

  if (options.radius === undefined) {
    const sum = new Float64Array(W * H);
    const stackX = new Float64Array(Math.max(W, H));
    const stackZ = new Float64Array(Math.max(W, H));
    // Directions closer to north–south walk columns: run them on a transposed
    // copy so every sweep reads and writes along rows (much kinder to caches)
    let transposed: { grid: Grid; sum: Float64Array } | null = null;
    for (let d = 0; d < D; d++) {
      const a = (2 * Math.PI * d) / D;
      const ux = Math.sin(a);
      const uy = -Math.cos(a);
      if (Math.abs(ux) >= Math.abs(uy)) {
        horizonSweep(grid, ux, uy, sum, stackX, stackZ);
      } else {
        if (!transposed) {
          const t = new Float32Array(W * H);
          for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) t[i * H + j] = data[j * W + i];
          transposed = { grid: { data: t, width: H, height: W, cellSize }, sum: new Float64Array(W * H) };
        }
        horizonSweep(transposed.grid, uy, ux, transposed.sum, stackX, stackZ);
      }
      yield (d + 1) / D;
    }
    if (transposed) {
      const ts = transposed.sum;
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) sum[j * W + i] += ts[i * H + j];
    }
    const out = new Float32Array(W * H);
    for (let i = 0; i < out.length; i++) out[i] = data[i] === data[i] ? 1 - sum[i] / D : NaN;
    return out;
  }

  const K = Math.max(1, Math.min(MAX_SEARCH_CELLS, Math.round(options.radius / cellSize)));

  // Integer cell offsets per direction (duplicates along a ray dropped) and their distances
  const offX: Int32Array[] = [];
  const offY: Int32Array[] = [];
  const invDist: Float64Array[] = [];
  for (let d = 0; d < D; d++) {
    const a = (2 * Math.PI * d) / D;
    const ux = Math.sin(a);
    const uy = -Math.cos(a);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let k = 1; k <= K; k++) {
      const ox = Math.round(ux * k);
      const oy = Math.round(uy * k);
      if (xs.length && xs[xs.length - 1] === ox && ys[ys.length - 1] === oy) continue;
      xs.push(ox);
      ys.push(oy);
    }
    offX.push(Int32Array.from(xs));
    offY.push(Int32Array.from(ys));
    invDist.push(Float64Array.from(xs.map((x, i) => 1 / (Math.hypot(x, ys[i]) * cellSize))));
  }

  const out = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const h = data[j * W + i];
      if (!(h === h)) { out[j * W + i] = NaN; continue; }
      let sum = 0;
      for (let d = 0; d < D; d++) {
        const xs = offX[d];
        const ys = offY[d];
        const inv = invDist[d];
        let best = 0;
        for (let k = 0; k < xs.length; k++) {
          const ii = i + xs[k];
          const jj = j + ys[k];
          if (ii < 0 || ii >= W || jj < 0 || jj >= H) break;
          const v = data[jj * W + ii];
          if (!(v === v)) continue;
          const s = (v - h) * inv[k];
          if (s > best) best = s;
        }
        sum += best / Math.sqrt(1 + best * best); // sin(atan(s))
      }
      out[j * W + i] = 1 - sum / D;
    }
    if ((j & 7) === 7) yield (j + 1) / H;
  }
  return out;
}

export interface TpiOptions {
  /** Half-size of the window in meters. */
  radius: number;
  /** Half-size of an inner window left out of the mean (a ring), meters (default 0). */
  innerRadius?: number;
}

export function* tpiSteps(grid: Grid, options: TpiOptions): Steps<Float32Array> {
  const { data, width: W, height: H, cellSize } = grid;
  const r = Math.max(1, Math.round(options.radius / cellSize));
  const ri = options.innerRadius && options.innerRadius > 0 ? Math.round(options.innerRadius / cellSize) : -1;

  // Summed-area tables of the values and of the valid-cell counts
  const W1 = W + 1;
  const sum = new Float64Array(W1 * (H + 1));
  const cnt = new Float64Array(W1 * (H + 1));
  for (let j = 0; j < H; j++) {
    let rowSum = 0;
    let rowCnt = 0;
    for (let i = 0; i < W; i++) {
      const v = data[j * W + i];
      if (v === v) { rowSum += v; rowCnt++; }
      sum[(j + 1) * W1 + i + 1] = sum[j * W1 + i + 1] + rowSum;
      cnt[(j + 1) * W1 + i + 1] = cnt[j * W1 + i + 1] + rowCnt;
    }
  }
  yield 0.2;

  const box = (t: Float64Array, i0: number, j0: number, i1: number, j1: number): number => {
    const a = Math.max(0, i0);
    const b = Math.max(0, j0);
    const c = Math.min(W, i1 + 1);
    const d = Math.min(H, j1 + 1);
    if (c <= a || d <= b) return 0;
    return t[d * W1 + c] - t[b * W1 + c] - t[d * W1 + a] + t[b * W1 + a];
  };

  const out = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const h = data[j * W + i];
      if (!(h === h)) { out[j * W + i] = NaN; continue; }
      let s = box(sum, i - r, j - r, i + r, j + r);
      let c = box(cnt, i - r, j - r, i + r, j + r);
      if (ri >= 0) {
        s -= box(sum, i - ri, j - ri, i + ri, j + ri);
        c -= box(cnt, i - ri, j - ri, i + ri, j + ri);
      }
      out[j * W + i] = c > 0 ? h - s / c : NaN;
    }
    if ((j & 31) === 31) yield 0.2 + (0.8 * (j + 1)) / H;
  }
  return out;
}
