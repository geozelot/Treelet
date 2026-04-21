// ============================================================================
// Tests for src/tiles/TileIndex.ts
//
// Tile keys are used as Map keys across the renderer; a broken pack/parse
// round-trip would silently corrupt every tile cache.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  packTileKey,
  parseTileKey,
  tileKeyStr,
  NO_TILE_KEY,
  parentTile,
  childTiles,
  neighborTiles,
  isValidTile,
} from '../../src/tiles/TileIndex';

// ---------------------------------------------------------------------------
// packTileKey / parseTileKey
// ---------------------------------------------------------------------------

describe('packTileKey / parseTileKey', () => {
  it('round-trips the zero tile', () => {
    const key = packTileKey(0, 0, 0);
    expect(parseTileKey(key)).toEqual({ z: 0, x: 0, y: 0 });
  });

  it('round-trips small coordinates', () => {
    const coords = [
      { z: 1, x: 0, y: 1 },
      { z: 5, x: 10, y: 20 },
      { z: 12, x: 2048, y: 1024 },
    ];
    for (const c of coords) {
      const key = packTileKey(c.z, c.x, c.y);
      expect(parseTileKey(key)).toEqual(c);
    }
  });

  it('round-trips the maximum supported coordinates (z=22)', () => {
    // At z=22 max x,y = 2^22 - 1 = 4194303
    const coord = { z: 22, x: 4194303, y: 4194303 };
    const key = packTileKey(coord.z, coord.x, coord.y);
    expect(parseTileKey(key)).toEqual(coord);
  });

  it('produces distinct keys for distinct coordinates', () => {
    const seen = new Set<number>();
    const coords = [
      { z: 3, x: 1, y: 2 },
      { z: 3, x: 2, y: 1 },
      { z: 4, x: 1, y: 2 },
      { z: 3, x: 0, y: 0 },
      { z: 0, x: 0, y: 0 },
    ];
    for (const c of coords) {
      const key = packTileKey(c.z, c.x, c.y);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('keeps keys within the safe integer range up to z=22', () => {
    const key = packTileKey(22, 4194303, 4194303);
    expect(Number.isSafeInteger(key)).toBe(true);
  });
});

describe('tileKeyStr', () => {
  it('formats a tile key as z/x/y', () => {
    expect(tileKeyStr(packTileKey(5, 10, 20))).toBe('5/10/20');
    expect(tileKeyStr(packTileKey(0, 0, 0))).toBe('0/0/0');
  });
});

describe('NO_TILE_KEY sentinel', () => {
  it('is -1 (outside the positive-integer space used for real keys)', () => {
    expect(NO_TILE_KEY).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// parentTile / childTiles
// ---------------------------------------------------------------------------

describe('parentTile', () => {
  it('returns (0,0,0) when called on a z=0 tile', () => {
    expect(parentTile({ z: 0, x: 0, y: 0 })).toEqual({ z: 0, x: 0, y: 0 });
  });

  it('halves x and y at the previous zoom level', () => {
    expect(parentTile({ z: 5, x: 10, y: 14 })).toEqual({ z: 4, x: 5, y: 7 });
    expect(parentTile({ z: 3, x: 7, y: 3 })).toEqual({ z: 2, x: 3, y: 1 });
  });

  it('is consistent with the XYZ convention (parent tile covers 2x2 children)', () => {
    const parent = { z: 5, x: 3, y: 4 };
    for (const child of childTiles(parent)) {
      expect(parentTile(child)).toEqual(parent);
    }
  });
});

describe('childTiles', () => {
  it('returns 4 children at the next zoom level', () => {
    const children = childTiles({ z: 2, x: 1, y: 1 });
    expect(children).toHaveLength(4);
    for (const c of children) expect(c.z).toBe(3);
  });

  it('returns the correct x,y quadrants', () => {
    const children = childTiles({ z: 2, x: 1, y: 1 });
    // Expected children: (3, 2, 2) (3, 3, 2) (3, 2, 3) (3, 3, 3)
    const keys = new Set(children.map((c) => `${c.x}/${c.y}`));
    expect(keys.has('2/2')).toBe(true);
    expect(keys.has('3/2')).toBe(true);
    expect(keys.has('2/3')).toBe(true);
    expect(keys.has('3/3')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// neighborTiles
// ---------------------------------------------------------------------------

describe('neighborTiles', () => {
  it('returns east and west neighbors at the same zoom', () => {
    const n = neighborTiles({ z: 5, x: 10, y: 5 });
    expect(n.east).toEqual({ z: 5, x: 11, y: 5 });
    expect(n.west).toEqual({ z: 5, x: 9, y: 5 });
  });

  it('wraps x horizontally at the antimeridian', () => {
    const max = 1 << 3; // 8
    const n = neighborTiles({ z: 3, x: max - 1, y: 2 });
    // east of last tile wraps to x=0
    expect(n.east).toEqual({ z: 3, x: 0, y: 2 });

    const n2 = neighborTiles({ z: 3, x: 0, y: 2 });
    // west of first tile wraps to last
    expect(n2.west).toEqual({ z: 3, x: max - 1, y: 2 });
  });

  it('clamps north to null at y=0 (no polar neighbor)', () => {
    const n = neighborTiles({ z: 3, x: 1, y: 0 });
    expect(n.north).toBeNull();
    expect(n.south).toEqual({ z: 3, x: 1, y: 1 });
  });

  it('clamps south to null at the last y row', () => {
    const max = 1 << 3;
    const n = neighborTiles({ z: 3, x: 1, y: max - 1 });
    expect(n.south).toBeNull();
    expect(n.north).toEqual({ z: 3, x: 1, y: max - 2 });
  });
});

// ---------------------------------------------------------------------------
// isValidTile
// ---------------------------------------------------------------------------

describe('isValidTile', () => {
  it('accepts tiles within bounds', () => {
    expect(isValidTile({ z: 0, x: 0, y: 0 })).toBe(true);
    expect(isValidTile({ z: 5, x: 31, y: 31 })).toBe(true);
  });

  it('rejects negative coordinates', () => {
    expect(isValidTile({ z: 5, x: -1, y: 0 })).toBe(false);
    expect(isValidTile({ z: 5, x: 0, y: -1 })).toBe(false);
    expect(isValidTile({ z: -1, x: 0, y: 0 })).toBe(false);
  });

  it('rejects coordinates at or beyond 2^z', () => {
    const max = 1 << 5;
    expect(isValidTile({ z: 5, x: max, y: 0 })).toBe(false);
    expect(isValidTile({ z: 5, x: 0, y: max })).toBe(false);
    expect(isValidTile({ z: 5, x: max + 10, y: max + 10 })).toBe(false);
  });
});
