// ============================================================================
// Tests for src/terrain/TilePool.ts (CDLOD selection)
//
// The selection must (1) cover the view without gaps or overlaps, (2) keep
// neighbours within one level of each other, and (3) place LOD boundaries
// where the finer tile is fully morphed and the coarser one isn't morphing at
// all — that is what makes geomorphed boundaries watertight.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { TileGrid } from '../../src/tiles/TileGrid';
import { TilePool, type SelectParams, type SelectedTile } from '../../src/terrain/TilePool';
import { MIN_LOD_RANGE_FACTOR } from '../../src/core/constants';

const W = 40075.016686;
const grid = new TileGrid(W, 22);

function params(overrides: Partial<SelectParams> = {}): SelectParams {
  return {
    cameraX: 1200,
    cameraY: 5900,
    cameraZ: 3,
    refZ: 1,
    rangeFactor: 4,
    minLevel: 0,
    maxLevel: 17,
    morphWidth: 0.3,
    budget: 4000,
    cull: { minX: 1100, minY: 5800, maxX: 1300, maxY: 6000, planes: null },
    ...overrides,
  };
}

function bounds(t: SelectedTile) {
  const h = t.size / 2;
  return { w: t.centerX - h, e: t.centerX + h, s: t.centerY - h, n: t.centerY + h };
}

function dist3(p: SelectParams, x: number, y: number): number {
  return Math.hypot(x - p.cameraX, y - p.cameraY, p.cameraZ - p.refZ);
}

describe('TilePool.select', () => {
  it('covers the cull region exactly once (no gaps, no overlaps)', () => {
    const p = params();
    const tiles = new TilePool(grid).select(p);
    expect(tiles.length).toBeGreaterThan(10);
    for (let i = 0; i < 400; i++) {
      const x = p.cull.minX + ((i * 7919) % 400) / 400 * (p.cull.maxX - p.cull.minX);
      const y = p.cull.minY + ((i * 104729) % 397) / 397 * (p.cull.maxY - p.cull.minY);
      const hits = tiles.filter((t) => { const b = bounds(t); return x >= b.w && x < b.e && y >= b.s && y < b.n; });
      expect(hits.length).toBe(1);
    }
  });

  it('keeps edge-adjacent tiles within one level and makes boundaries watertight', () => {
    const p = params();
    const tiles = [...new TilePool(grid).select(p)];
    let boundaries = 0;
    const eps = 1e-9;
    for (const f of tiles) {
      for (const c of tiles) {
        if (c === f || c.z >= f.z) continue;
        const bf = bounds(f), bc = bounds(c);
        const shareV = (Math.abs(bf.e - bc.w) < eps || Math.abs(bf.w - bc.e) < eps) && bf.s < bc.n && bf.n > bc.s;
        const shareH = (Math.abs(bf.n - bc.s) < eps || Math.abs(bf.s - bc.n) < eps) && bf.w < bc.e && bf.e > bc.w;
        if (!shareV && !shareH) continue;
        boundaries++;
        expect(f.z - c.z).toBe(1);
        // Sample the shared edge segment.
        for (let k = 0; k <= 16; k++) {
          const t = k / 16;
          let x: number, y: number;
          if (shareV) {
            x = Math.abs(bf.e - bc.w) < eps ? bf.e : bf.w;
            y = Math.max(bf.s, bc.s) + t * (Math.min(bf.n, bc.n) - Math.max(bf.s, bc.s));
          } else {
            y = Math.abs(bf.n - bc.s) < eps ? bf.n : bf.s;
            x = Math.max(bf.w, bc.w) + t * (Math.min(bf.e, bc.e) - Math.max(bf.w, bc.w));
          }
          const d = dist3(p, x, y);
          expect(d).toBeGreaterThanOrEqual(f.morphEnd * (1 - 1e-9)); // fine side fully morphed
          expect(d).toBeLessThanOrEqual(c.morphStart * (1 + 1e-9)); // coarse side not morphing
        }
      }
    }
    expect(boundaries).toBeGreaterThan(0);
  });

  it('refines toward the camera and stops at maxLevel', () => {
    const p = params({ maxLevel: 14 });
    const tiles = new TilePool(grid).select(p);
    expect(Math.max(...tiles.map((t) => t.z))).toBe(14);
    const nearest = tiles[0];
    const farthest = tiles[tiles.length - 1];
    expect(nearest.distance).toBeLessThanOrEqual(farthest.distance);
    expect(nearest.z).toBeGreaterThanOrEqual(farthest.z);
  });

  it('fits the budget by coarsening before dropping tiles', () => {
    const pool = new TilePool(grid);
    const generous = pool.select(params({ rangeFactor: 12 })).length;
    const tight = pool.select(params({ rangeFactor: 12, budget: Math.floor(generous / 2) }));
    expect(tight.length).toBeLessThanOrEqual(Math.floor(generous / 2));
    expect(pool.rangeFactor).toBeLessThan(12);
    expect(pool.rangeFactor).toBeGreaterThanOrEqual(MIN_LOD_RANGE_FACTOR);
  });

  it('never morphs coarsest-level tiles and flags tiles that can morph', () => {
    const p = params({ minLevel: 8, cameraZ: 50 });
    const tiles = new TilePool(grid).select(p);
    for (const t of tiles) {
      if (t.z === 8) {
        expect(t.morphStart).toBeGreaterThan(1e19);
        expect(t.needsParent).toBe(false);
      } else {
        expect(t.morphStart).toBeLessThan(t.morphEnd);
      }
    }
  });

  it('culls tiles outside the frustum half-planes', () => {
    // Half-plane x >= 1200 (nx=1, ny=0, d=-1200).
    const planes = new Float32Array([1, 0, -1200, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const tiles = new TilePool(grid).select(params({ cull: { minX: 1100, minY: 5800, maxX: 1300, maxY: 6000, planes } }));
    for (const t of tiles) expect(bounds(t).e).toBeGreaterThanOrEqual(1200);
  });
});
