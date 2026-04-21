// ============================================================================
// Tests for src/tiles/TileGrid.ts
//
// TileGrid owns the tile <-> world-plane math used by the quadtree LOD
// selector on the render hot path. Precision and boundary handling matter.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { TileGrid } from '../../src/tiles/TileGrid';
import { WEB_MERCATOR_EXTENT } from '../../src/core/constants';

const WORLD_SCALE = 40075.016686;

// ---------------------------------------------------------------------------
// Construction + lookup tables
// ---------------------------------------------------------------------------

describe('TileGrid construction', () => {
  it('exposes the worldScale and maxZoomLevels it was built with', () => {
    const grid = new TileGrid(WORLD_SCALE, 22);
    expect(grid.worldScale).toBe(WORLD_SCALE);
    expect(grid.maxZoomLevels).toBe(22);
  });

  it('defaults maxZoomLevels to 30', () => {
    const grid = new TileGrid(WORLD_SCALE);
    expect(grid.maxZoomLevels).toBe(30);
  });

  it('precomputes tile counts (powers of two) per zoom level', () => {
    const grid = new TileGrid(WORLD_SCALE, 10);
    expect(grid.getTileCount(0)).toBe(1);
    expect(grid.getTileCount(1)).toBe(2);
    expect(grid.getTileCount(5)).toBe(32);
    expect(grid.getTileCount(10)).toBe(1024);
  });

  it('halves the tile size with each zoom level', () => {
    const grid = new TileGrid(WORLD_SCALE, 5);
    expect(grid.getTileSize(0)).toBeCloseTo(WORLD_SCALE, 4);
    expect(grid.getTileSize(1)).toBeCloseTo(WORLD_SCALE / 2, 4);
    expect(grid.getTileSize(5)).toBeCloseTo(WORLD_SCALE / 32, 4);
  });

  it('metersPerPixel at zoom 0 matches the classic ~156543.03 m/px value', () => {
    const grid = new TileGrid(WORLD_SCALE, 5);
    const expected = (WEB_MERCATOR_EXTENT * 2) / 256;
    expect(grid.getMetersPerPixel(0)).toBeCloseTo(expected, 4);
    // Classic reference value: about 156543 m/px at z=0 for 256px tiles
    expect(grid.getMetersPerPixel(0)).toBeGreaterThan(156000);
    expect(grid.getMetersPerPixel(0)).toBeLessThan(157000);
  });

  it('halves metersPerPixel at each zoom', () => {
    const grid = new TileGrid(WORLD_SCALE, 5);
    expect(grid.getMetersPerPixel(1)).toBeCloseTo(grid.getMetersPerPixel(0) / 2, 4);
    expect(grid.getMetersPerPixel(4)).toBeCloseTo(grid.getMetersPerPixel(0) / 16, 4);
  });
});

// ---------------------------------------------------------------------------
// world ↔ tile
// ---------------------------------------------------------------------------

describe('TileGrid.worldToTile', () => {
  const grid = new TileGrid(WORLD_SCALE, 20);

  it('maps the world origin (0, 0) to the single tile at z=0', () => {
    const tile = grid.worldToTile({ x: 0, y: 0 }, 0);
    expect(tile).toEqual({ z: 0, x: 0, y: 0 });
  });

  it('maps the world origin to the correct center tile at z=1 (boundary falls to floor=1)', () => {
    // At z=1 the world is split into a 2×2 grid with a seam at (0, 0).
    // Math.floor at the seam rounds to the lower-right tile.
    const tile = grid.worldToTile({ x: 0, y: 0 }, 1);
    expect(tile.z).toBe(1);
    // Exactly-zero x goes to tile x=1 (since px = 0 + halfScale = tileSize → floor = 1)
    expect(tile.x).toBe(1);
    // For y, 0 goes to tile y=1 as well (halfScale - 0 = halfScale = tileSize → floor = 1)
    expect(tile.y).toBe(1);
  });

  it('flips Y: positive world-Y (north) → tile y=0', () => {
    // A point slightly north and west of origin at z=1 should be tile (0, 0)
    const tile = grid.worldToTile({ x: -WORLD_SCALE / 4, y: WORLD_SCALE / 4 }, 1);
    expect(tile.z).toBe(1);
    expect(tile.x).toBe(0);
    expect(tile.y).toBe(0);
  });

  it('clamps out-of-range positive world coords to the last tile', () => {
    const tile = grid.worldToTile({ x: WORLD_SCALE * 10, y: -WORLD_SCALE * 10 }, 3);
    const max = grid.getTileCount(3) - 1;
    expect(tile.x).toBe(max);
    expect(tile.y).toBe(max);
  });

  it('clamps out-of-range negative world coords to the first tile', () => {
    const tile = grid.worldToTile({ x: -WORLD_SCALE * 10, y: WORLD_SCALE * 10 }, 3);
    expect(tile.x).toBe(0);
    expect(tile.y).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tile → world
// ---------------------------------------------------------------------------

describe('TileGrid.tileToWorldTL / tileToWorldCenter', () => {
  const grid = new TileGrid(WORLD_SCALE, 10);

  it('tileToWorldTL for (z=0,0,0) is at the top-left corner of the world', () => {
    const tl = grid.tileToWorldTL({ z: 0, x: 0, y: 0 });
    expect(tl.x).toBeCloseTo(-WORLD_SCALE / 2, 4);
    expect(tl.y).toBeCloseTo(WORLD_SCALE / 2, 4);
  });

  it('tileToWorldCenter for (z=0,0,0) is the world origin', () => {
    const c = grid.tileToWorldCenter({ z: 0, x: 0, y: 0 });
    expect(c.x).toBeCloseTo(0, 4);
    expect(c.y).toBeCloseTo(0, 4);
  });

  it('tile centers are exactly a half-tile away from their top-left corners', () => {
    for (const z of [1, 5, 8]) {
      const tl = grid.tileToWorldTL({ z, x: 3, y: 4 });
      const c = grid.tileToWorldCenter({ z, x: 3, y: 4 });
      const tileSize = grid.getTileSize(z);
      expect(c.x - tl.x).toBeCloseTo(tileSize / 2, 4);
      expect(tl.y - c.y).toBeCloseTo(tileSize / 2, 4);
    }
  });

  it('tileToWorldCenterOut writes into an output object without allocating', () => {
    const out = { x: 0, y: 0 };
    grid.tileToWorldCenterOut(5, 7, 9, out);
    const ref = grid.tileToWorldCenter({ z: 5, x: 7, y: 9 });
    expect(out.x).toBeCloseTo(ref.x, 6);
    expect(out.y).toBeCloseTo(ref.y, 6);
  });
});

// ---------------------------------------------------------------------------
// Extent queries
// ---------------------------------------------------------------------------

describe('TileGrid.getTilesInExtent', () => {
  const grid = new TileGrid(WORLD_SCALE, 10);

  it('returns the single world tile at z=0 when asked for the full extent', () => {
    const tiles = grid.getTilesInExtent(
      { x: -WORLD_SCALE / 2, y: -WORLD_SCALE / 2 },
      { x: WORLD_SCALE / 2, y: WORLD_SCALE / 2 },
      0,
    );
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toEqual({ z: 0, x: 0, y: 0 });
  });

  it('returns all 4 tiles at z=1 when asked for the full extent', () => {
    const tiles = grid.getTilesInExtent(
      { x: -WORLD_SCALE / 2, y: -WORLD_SCALE / 2 },
      { x: WORLD_SCALE / 2, y: WORLD_SCALE / 2 },
      1,
    );
    expect(tiles).toHaveLength(4);
    const keys = new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`));
    expect(keys.has('1/0/0')).toBe(true);
    expect(keys.has('1/1/0')).toBe(true);
    expect(keys.has('1/0/1')).toBe(true);
    expect(keys.has('1/1/1')).toBe(true);
  });

  it('returns tiles covering a localized extent only', () => {
    // A small box in the northwest quadrant
    const tiles = grid.getTilesInExtent(
      { x: -WORLD_SCALE / 2, y: WORLD_SCALE / 4 },
      { x: -WORLD_SCALE / 4, y: WORLD_SCALE / 2 },
      2,
    );
    // This should only touch the NW quadrant at z=2 → tile (0, 0)
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.z).toBe(2);
      expect(t.x).toBeLessThanOrEqual(1);
      expect(t.y).toBeLessThanOrEqual(1);
    }
  });
});
