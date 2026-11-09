// ============================================================================
// treelet.js - Region loading and assembly (worker side)
//
// Loads the tiles a RegionPlan lists (a few at a time, retrying failures
// with backoff, missing tiles become nodata) and copies their pixels into
// one grid covering the plan's window. The tile loader is injected, so this
// runs in the worker with the decode cache and in tests with mocks.
// ============================================================================

import type { RegionWindow } from '../region';
import { abortError } from './drive';

/** A decoded elevation tile (row-major meters, NaN = nodata), or null when the tile doesn't exist. */
export interface DecodedTile {
  data: Float32Array;
  w: number;
  h: number;
}

export interface RegionTileRef {
  x: number;
  y: number;
  url: string;
}

export interface LoadTilesOptions {
  /** Requests at once (default 6). */
  concurrency?: number;
  /** Extra attempts for a failing tile (default 2). */
  retries?: number;
  /** Delay before the first retry in ms; doubles each time (default 400). */
  retryDelayMs?: number;
  signal?: AbortSignal;
  /** Called after each tile with (done, total). */
  onTile?: (done: number, total: number) => void;
}

export interface LoadedTiles {
  tiles: Array<DecodedTile | null>;
  /** Tiles that don't exist at the source (nodata). */
  missing: number;
  /** Tiles that kept failing (nodata). */
  failed: number;
}

function isAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError';
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Load every tile; throws when all of them failed or on cancellation. */
export async function loadRegionTiles(
  refs: readonly RegionTileRef[],
  load: (ref: RegionTileRef, signal?: AbortSignal) => Promise<DecodedTile | null>,
  options: LoadTilesOptions = {},
): Promise<LoadedTiles> {
  const concurrency = Math.max(1, options.concurrency ?? 6);
  const retries = Math.max(0, options.retries ?? 2);
  const delay = options.retryDelayMs ?? 400;
  const signal = options.signal;
  const out: Array<DecodedTile | null> = new Array(refs.length).fill(null);
  let missing = 0;
  let failed = 0;
  let done = 0;
  let next = 0;
  let lastError: unknown = null;

  const worker = async () => {
    while (next < refs.length) {
      const i = next++;
      for (let attempt = 0; ; attempt++) {
        if (signal?.aborted) throw abortError();
        try {
          const tile = await load(refs[i], signal);
          out[i] = tile;
          if (!tile) missing++;
          break;
        } catch (err) {
          if (isAbort(err) || signal?.aborted) throw abortError();
          lastError = err;
          if (attempt >= retries) { failed++; break; }
          await wait(delay * 2 ** attempt, signal);
        }
      }
      done++;
      options.onTile?.(done, refs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, refs.length) }, worker));
  if (refs.length > 0 && failed === refs.length) {
    throw new Error(`treelet: no elevation tile of the region could be loaded (${(lastError as Error)?.message ?? lastError})`);
  }
  return { tiles: out, missing, failed };
}

export interface AssembledRegion {
  data: Float32Array;
  width: number;
  height: number;
  /** Pixel size of the source tiles. */
  tileSize: number;
  /** The grid's NW corner in global pixels at the plan's zoom. */
  px0: number;
  py0: number;
  min: number;
  max: number;
}

/**
 * Copy tile pixels into one grid covering `window` (expanded to whole
 * pixels). Tiles must be square and share one size; null tiles leave NaN.
 */
export function assembleRegion(
  window: RegionWindow,
  refs: ReadonlyArray<{ x: number; y: number }>,
  tiles: ReadonlyArray<DecodedTile | null>,
  fallbackTileSize = 256,
): AssembledRegion {
  const first = tiles.find((t): t is DecodedTile => t !== null);
  const T = first ? first.w : fallbackTileSize;
  for (const t of tiles) {
    if (t && (t.w !== T || t.h !== T)) {
      throw new Error(`treelet: region tiles differ in size (${t.w}×${t.h} vs ${T}×${T})`);
    }
  }
  const px0 = Math.floor(window.x0 * T + 1e-6);
  const py0 = Math.floor(window.y0 * T + 1e-6);
  const px1 = Math.ceil(window.x1 * T - 1e-6);
  const py1 = Math.ceil(window.y1 * T - 1e-6);
  const width = Math.max(1, px1 - px0);
  const height = Math.max(1, py1 - py0);
  const data = new Float32Array(width * height).fill(NaN);
  let min = Infinity;
  let max = -Infinity;

  for (let k = 0; k < refs.length; k++) {
    const tile = tiles[k];
    if (!tile) continue;
    const gx0 = refs[k].x * T;
    const gy0 = refs[k].y * T;
    const ix0 = Math.max(px0, gx0);
    const ix1 = Math.min(px0 + width, gx0 + T);
    const iy0 = Math.max(py0, gy0);
    const iy1 = Math.min(py0 + height, gy0 + T);
    for (let gy = iy0; gy < iy1; gy++) {
      const src = (gy - gy0) * T;
      const dst = (gy - py0) * width;
      for (let gx = ix0; gx < ix1; gx++) {
        const v = tile.data[src + gx - gx0];
        data[dst + gx - px0] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!(min <= max)) { min = 0; max = 0; }
  return { data, width, height, tileSize: T, px0, py0, min, max };
}
