// ============================================================================
// Tests for src/terrain/ElevationAtlas.ts (CPU-side behaviour)
//
// Slot allocation, LRU eviction with pinning, slot generations, sampling
// conventions and edge stitching. GPU uploads are exercised in the browser.
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { ElevationAtlas, ELEVATION_NODATA } from '../../src/terrain/ElevationAtlas';
import { packTileKey } from '../../src/tiles/TileIndex';

const S = 8;

function tile(fn: (i: number, j: number) => number): Float32Array {
  const a = new Float32Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) a[j * S + i] = fn(i, j);
  return a;
}

function texel(atlas: ElevationAtlas, key: number, i: number, j: number): number {
  const slot = atlas.get(key)!;
  return atlas.data[slot.layer * S * S + j * S + i];
}

describe('ElevationAtlas allocation', () => {
  it('evicts the least recently used unpinned tile and reports it', () => {
    const atlas = new ElevationAtlas(S, 2);
    const evicted = vi.fn();
    atlas.onEvict = (slot) => evicted(slot.key);
    atlas.write(1, 0, 0, tile(() => 1), 1, 1);
    atlas.write(1, 1, 0, tile(() => 2), 2, 2);
    atlas.touch(packTileKey(1, 0, 0)); // (1,1,0) is now the LRU
    atlas.write(1, 0, 1, tile(() => 3), 3, 3);
    expect(evicted).toHaveBeenCalledWith(packTileKey(1, 1, 0));
    expect(atlas.has(packTileKey(1, 0, 0))).toBe(true);
  });

  it('refuses to evict pinned tiles and reports saturation', () => {
    const atlas = new ElevationAtlas(S, 2);
    atlas.write(1, 0, 0, tile(() => 1), 1, 1);
    atlas.write(1, 1, 0, tile(() => 1), 1, 1);
    atlas.pin(packTileKey(1, 0, 0));
    atlas.pin(packTileKey(1, 1, 0));
    expect(atlas.available).toBe(0);
    expect(atlas.write(1, 0, 1, tile(() => 1), 1, 1)).toBeNull();
    atlas.clearPins();
    expect(atlas.available).toBe(2);
  });

  it('assigns a new generation whenever a layer is reused', () => {
    const atlas = new ElevationAtlas(S, 1);
    const a = atlas.write(1, 0, 0, tile(() => 1), 1, 1)!;
    const genA = a.gen;
    atlas.write(1, 1, 0, tile(() => 1), 1, 1);
    expect(atlas.gen(packTileKey(1, 0, 0))).toBe(0);
    atlas.write(1, 0, 0, tile(() => 1), 1, 1);
    expect(atlas.gen(packTileKey(1, 0, 0))).not.toBe(genA);
  });
});

describe('ElevationAtlas pin limit', () => {
  it('refuses pins beyond ~90% of capacity so loading can always progress', () => {
    const atlas = new ElevationAtlas(S, 20);
    for (let i = 0; i < 20; i++) atlas.write(6, i, 0, tile(() => i), i, i);
    let pinned = 0;
    for (let i = 0; i < 20; i++) if (atlas.pin(packTileKey(6, i, 0))) pinned++;
    expect(pinned).toBe(18);
    expect(atlas.available).toBe(2);
    expect(atlas.write(6, 0, 1, tile(() => 1), 1, 1)).not.toBeNull();
  });
});

describe('ElevationAtlas sampling', () => {
  it('uses corner-aligned texels (u=0 → first texel, u=1 → last texel)', () => {
    const atlas = new ElevationAtlas(S, 4);
    const key = packTileKey(3, 2, 2);
    atlas.write(3, 2, 2, tile((i) => i * 10), 0, 70);
    expect(atlas.sample(key, 0, 0.5)).toBe(0);
    expect(atlas.sample(key, 1, 0.5)).toBe(70);
    expect(atlas.sample(key, 0.5, 0.5)).toBeCloseTo(35, 6);
  });

  it('skips nodata taps and returns null when nothing is valid', () => {
    const atlas = new ElevationAtlas(S, 4);
    const key = packTileKey(3, 1, 1);
    atlas.write(3, 1, 1, tile(() => ELEVATION_NODATA), 0, 0);
    expect(atlas.sample(key, 0.3, 0.3)).toBeNull();
  });
});

describe('ElevationAtlas edge stitching', () => {
  it('makes shared edges identical and is stable when re-stitched', () => {
    const atlas = new ElevationAtlas(S, 8);
    const left = packTileKey(4, 5, 5);
    const right = packTileKey(4, 6, 5);
    atlas.write(4, 5, 5, tile(() => 100), 100, 100);
    atlas.write(4, 6, 5, tile(() => 110), 110, 110);
    for (let j = 0; j < S; j++) {
      expect(texel(atlas, left, S - 1, j)).toBeCloseTo(105, 6);
      expect(texel(atlas, right, 0, j)).toBeCloseTo(105, 6);
    }
    // Reloading the right tile re-stitches; values must not drift.
    atlas.write(4, 6, 5, tile(() => 110), 110, 110);
    for (let j = 0; j < S; j++) {
      expect(texel(atlas, left, S - 1, j)).toBeCloseTo(105, 6);
      expect(texel(atlas, left, S - 2, j)).toBeCloseTo(100, 6); // band 1: interior untouched
    }
  });

  it('fades the correction over a band proportional to texels per source pixel', () => {
    const atlas = new ElevationAtlas(S, 8);
    const top = packTileKey(4, 3, 3);
    atlas.write(4, 3, 3, tile(() => 0), 0, 0, 2);
    atlas.write(4, 3, 4, tile(() => 20), 20, 20, 2); // south neighbour
    expect(texel(atlas, top, 3, S - 1)).toBeCloseTo(10, 6);
    expect(texel(atlas, top, 3, S - 2)).toBeCloseTo(5, 6);
    expect(texel(atlas, top, 3, S - 3)).toBeCloseTo(0, 6);
  });

  it('averages corners over every tile that touches them', () => {
    const atlas = new ElevationAtlas(S, 8);
    atlas.write(4, 0, 0, tile(() => 0), 0, 0);
    atlas.write(4, 1, 0, tile(() => 4), 4, 4);
    atlas.write(4, 0, 1, tile(() => 8), 8, 8);
    atlas.write(4, 1, 1, tile(() => 12), 12, 12);
    const expected = (0 + 4 + 8 + 12) / 4;
    expect(texel(atlas, packTileKey(4, 0, 0), S - 1, S - 1)).toBeCloseTo(expected, 6);
    expect(texel(atlas, packTileKey(4, 1, 1), 0, 0)).toBeCloseTo(expected, 6);
  });

  it('never stitches against empty (nonexistent) tiles', () => {
    const atlas = new ElevationAtlas(S, 8);
    atlas.write(4, 2, 2, tile(() => 500), 500, 500);
    atlas.writeEmpty(4, 3, 2);
    expect(texel(atlas, packTileKey(4, 2, 2), S - 1, 3)).toBe(500);
  });

  it('keeps every seam exact around a corner shared by three tiles (wide band)', () => {
    const N = 16;
    const atlas = new ElevationAtlas(N, 8);
    const flat = (v: number) => new Float32Array(N * N).fill(v);
    const at = (key: number, i: number, j: number) => atlas.data[atlas.get(key)!.layer * N * N + j * N + i];
    const A = packTileKey(5, 10, 10), T = packTileKey(5, 10, 9), L = packTileKey(5, 9, 10);
    atlas.write(5, 10, 10, flat(100), 100, 100, 4);
    atlas.write(5, 10, 9, flat(200), 200, 200, 4); // north neighbour
    atlas.write(5, 9, 10, flat(0), 0, 0, 4);       // west neighbour
    for (let i = 0; i < N; i++) {
      expect(at(A, i, 0)).toBeCloseTo(at(T, i, N - 1), 6); // A top == T bottom
      expect(at(A, 0, i)).toBeCloseTo(at(L, N - 1, i), 6); // A left == L right
    }
  });

  it('stitches across the antimeridian', () => {
    const atlas = new ElevationAtlas(S, 8);
    atlas.write(2, 3, 1, tile(() => 10), 10, 10); // easternmost column at z2
    atlas.write(2, 0, 1, tile(() => 30), 30, 30); // westernmost
    expect(texel(atlas, packTileKey(2, 3, 1), S - 1, 4)).toBeCloseTo(20, 6);
  });
});
