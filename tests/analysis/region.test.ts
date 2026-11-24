// ============================================================================
// Tests for region planning (src/analysis/region.ts), tile loading and
// assembly with mocked tiles (src/analysis/compute/region.ts), and the grid
// helpers (src/analysis/grid.ts).
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import {
  planRegion, tileX, tileY, lngOfTileX, latOfTileY, cellSizeAt, boundsAround,
} from '../../src/analysis/region';
import { loadRegionTiles, assembleRegion, type DecodedTile } from '../../src/analysis/compute/region';
import {
  sampleGrid, gridRange, gridPercentiles, resampleRowsToMercator, mercatorY, latitudeOfMercatorY,
} from '../../src/analysis/grid';

const innsbruck = { west: 11.3, east: 11.5, south: 47.2, north: 47.35 };

describe('planRegion', () => {
  it('uses the finest zoom whose tile count fits the budget', () => {
    const plan = planRegion(innsbruck, { minZoom: 0, maxZoom: 15, maxTiles: 64 });
    const count = (z: number) => {
      const w = { x0: tileX(innsbruck.west, z), x1: tileX(innsbruck.east, z), y0: tileY(innsbruck.north, z), y1: tileY(innsbruck.south, z) };
      return (Math.ceil(w.x1) - Math.floor(w.x0)) * (Math.ceil(w.y1) - Math.floor(w.y0));
    };
    expect(count(plan.zoom)).toBeLessThanOrEqual(64);
    expect(count(plan.zoom + 1)).toBeGreaterThan(64);
    expect(plan.tiles).toHaveLength(count(plan.zoom));
    // Tiles listed row by row from the north-west
    expect(plan.tiles[0]).toEqual({ x: Math.floor(plan.window.x0), y: Math.floor(plan.window.y0) });
  });

  it('honors a requested zoom and the source range', () => {
    expect(planRegion(innsbruck, { minZoom: 0, maxZoom: 15, zoom: 9 }).zoom).toBe(9);
    expect(planRegion(innsbruck, { minZoom: 0, maxZoom: 10, zoom: 14 }).zoom).toBeLessThanOrEqual(10);
    expect(() => planRegion({ ...innsbruck, east: innsbruck.west }, { minZoom: 0, maxZoom: 15 })).toThrow(/empty/);
    expect(() => planRegion({ west: -170, east: 170, south: -80, north: 80 }, { minZoom: 5, maxZoom: 15, maxTiles: 4 })).toThrow(/more than 4 tiles/);
  });

  it('tile coordinates and their inverses agree; cell sizes shrink with latitude', () => {
    expect(lngOfTileX(tileX(11.39, 12), 12)).toBeCloseTo(11.39, 9);
    expect(latOfTileY(tileY(47.27, 12), 12)).toBeCloseTo(47.27, 9);
    expect(cellSizeAt(0, 0, 256)).toBeCloseTo(156543.03, 1);
    expect(cellSizeAt(60, 0, 256)).toBeCloseTo(156543.03 / 2, 1);
    const b = boundsAround(11.39, 47.27, 10000);
    expect((b.north - b.south) * 111319.49).toBeCloseTo(20000, -1);
  });
});

/** A synthetic tile whose pixel values encode their global pixel position. */
function tileOf(x: number, y: number, T: number): DecodedTile {
  const data = new Float32Array(T * T);
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) data[j * T + i] = (y * T + j) * 10000 + (x * T + i);
  return { data, w: T, h: T };
}

describe('assembleRegion', () => {
  it('copies the pixels of the window from the right tiles', () => {
    const T = 8;
    // Window from pixel (10, 3) to (21, 13) at this zoom: tiles x 1–2, y 0–1
    const window = { x0: 10 / T, y0: 3 / T, x1: 21 / T, y1: 13 / T };
    const refs = [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }];
    const r = assembleRegion(window, refs, refs.map((t) => tileOf(t.x, t.y, T)));
    expect([r.width, r.height, r.px0, r.py0, r.tileSize]).toEqual([11, 10, 10, 3, T]);
    for (const [i, j] of [[0, 0], [10, 9], [5, 4], [6, 5]]) {
      expect(r.data[j * r.width + i]).toBe((3 + j) * 10000 + (10 + i));
    }
    expect(r.min).toBe(3 * 10000 + 10);
  });

  it('leaves missing tiles as nodata and rejects mixed tile sizes', () => {
    const T = 4;
    const window = { x0: 0, y0: 0, x1: 2, y1: 1 };
    const refs = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const r = assembleRegion(window, refs, [tileOf(0, 0, T), null]);
    expect(r.data[0]).toBe(0);
    expect(r.data[T]).toBeNaN(); // first pixel of the missing tile
    expect(() => assembleRegion(window, refs, [tileOf(0, 0, 4), tileOf(1, 0, 8)])).toThrow(/differ in size/);
  });
});

describe('loadRegionTiles', () => {
  const refs = Array.from({ length: 6 }, (_, i) => ({ x: i, y: 0, url: `t/${i}` }));

  it('loads every tile with limited concurrency and reports progress', async () => {
    let running = 0;
    let peak = 0;
    const onTile = vi.fn();
    const r = await loadRegionTiles(refs, async (ref) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((res) => setTimeout(res, 1));
      running--;
      return ref.x === 3 ? null : tileOf(ref.x, 0, 2);
    }, { concurrency: 2, onTile });
    expect(peak).toBe(2);
    expect(r.tiles.filter(Boolean)).toHaveLength(5);
    expect(r.missing).toBe(1);
    expect(onTile).toHaveBeenLastCalledWith(6, 6);
  });

  it('retries failing tiles with backoff, then gives up on them', async () => {
    const attempts = new Map<string, number>();
    const r = await loadRegionTiles(refs, async (ref) => {
      const n = (attempts.get(ref.url) ?? 0) + 1;
      attempts.set(ref.url, n);
      if (ref.x === 1 && n < 3) throw new Error('HTTP 503');
      if (ref.x === 2) throw new Error('HTTP 500');
      return tileOf(ref.x, 0, 2);
    }, { retries: 2, retryDelayMs: 1 });
    expect(attempts.get('t/1')).toBe(3);
    expect(r.tiles[1]).not.toBeNull();
    expect(attempts.get('t/2')).toBe(3);
    expect(r.failed).toBe(1);
    await expect(loadRegionTiles(refs, async () => { throw new Error('offline'); }, { retries: 0 }))
      .rejects.toThrow(/no elevation tile.*offline/);
  });

  it('stops on cancellation', async () => {
    const controller = new AbortController();
    const load = vi.fn(async () => {
      controller.abort();
      return tileOf(0, 0, 2);
    });
    await expect(loadRegionTiles(refs, load, { concurrency: 1, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('grid helpers', () => {
  it('sampleGrid filters between cell centers, skips nodata and matches cells at their centers', () => {
    const data = Float32Array.from([0, 10, 20, NaN]);
    expect(sampleGrid(data, 2, 2, 0.5, 0.5)).toBe(0);
    expect(sampleGrid(data, 2, 2, 1, 0.5)).toBe(5);
    expect(sampleGrid(data, 2, 2, 1.5, 1.5)).toBeNull(); // only the nodata tap has weight
    expect(sampleGrid(data, 2, 2, 1, 1)).toBeCloseTo(10, 6); // mean of the three valid taps
    expect(sampleGrid(data, 2, 2, -0.1, 1)).toBeNull();
    expect(sampleGrid(data, 2, 2, 0.1, 0.1)).toBe(0); // clamped at the border
  });

  it('gridRange and gridPercentiles ignore nodata', () => {
    const data = Float32Array.from([NaN, 3, -2, 7, -9999]);
    expect(gridRange(data, -9999)).toEqual([-2, 7]);
    expect(gridRange(Float32Array.from([NaN]))).toBeNull();
    const ramp = Float32Array.from({ length: 101 }, (_, i) => i);
    expect(gridPercentiles(ramp, 0.1, 0.9)).toEqual([10, 90]);
  });

  it('resamples EPSG:4326 rows to evenly spaced Mercator rows', () => {
    expect(latitudeOfMercatorY(mercatorY(47.27))).toBeCloseTo(47.27, 9);
    // Each row holds its center latitude: after resampling, row j holds the
    // latitude at the center of Mercator row j
    const south = 40;
    const north = 60;
    const height = 200;
    const data = Float32Array.from({ length: height }, (_, j) => north - ((j + 0.5) / height) * (north - south));
    const out = resampleRowsToMercator(data, 1, height, south, north, 1);
    for (const j of [0, 50, 100, 199]) {
      const y = mercatorY(north) + ((j + 0.5) / height) * (mercatorY(south) - mercatorY(north));
      expect(out[j]).toBeCloseTo(latitudeOfMercatorY(y), 1);
    }
    // RGBA rows keep their bytes
    const rgba = resampleRowsToMercator(new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255]), 1, 2, 0, 1, 4);
    expect([...rgba]).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
  });
});
