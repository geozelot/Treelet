// ============================================================================
// Tests for src/terrain/ElevationAtlas.ts (CPU-side behaviour)
//
// Slot allocation, LRU eviction with pinning, slot generations, sampling
// conventions and edge stitching. GPU uploads are exercised in the browser.
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { ElevationAtlas, ELEVATION_NODATA, HALO_EDGES } from '../../src/terrain/ElevationAtlas';
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

describe('ElevationAtlas change log', () => {
  it('reports changes only as far back as the trimmed log still holds them all', () => {
    const atlas = new ElevationAtlas(S, 2);
    // Rewrites of a resident tile and evicting writes, until the log is trimmed
    for (let i = 0; i < 5000; i++) atlas.write(4, i % 3, 0, tile(() => i), i, i);
    const first = (atlas as unknown as { changeLog: Array<{ version: number }> }).changeLog[0].version;
    expect(atlas.changedSince(first - 1)).toBeNull(); // entries of `first` may be cut
    expect(atlas.changedSince(first)).not.toBeNull();
    expect(atlas.changedSince(atlas.version)).toEqual([]);
  });
});

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

describe('ElevationAtlas halos (the neighbours\' texels one step past each border)', () => {
  const { TOP, BOTTOM, LEFT, RIGHT } = HALO_EDGES;
  const halo = (atlas: ElevationAtlas, key: number, edge: number, i: number) =>
    atlas.halo[atlas.get(key)!.layer * 4 * S + edge * S + i];

  /** Every halo equals the neighbour's current row or column one step in from the shared edge. */
  function expectHalosCurrent(atlas: ElevationAtlas): void {
    const last = S - 1;
    for (const slot of atlas.slots()) {
      const { z, x, y } = slot;
      const sides: Array<[number, number, number, (i: number) => [number, number]]> = [
        [TOP, x, y - 1, (i) => [i, last - 1]],
        [BOTTOM, x, y + 1, (i) => [i, 1]],
        [LEFT, x - 1, y, (i) => [last - 1, i]],
        [RIGHT, x + 1, y, (i) => [1, i]],
      ];
      for (const [edge, nx, ny, at] of sides) {
        const nKey = packTileKey(z, nx, ny);
        if (!atlas.has(nKey) || atlas.get(nKey)!.empty) continue;
        for (let i = 0; i < S; i++) {
          const [ci, cj] = at(i);
          expect(halo(atlas, slot.key, edge, i)).toBe(texel(atlas, nKey, ci, cj));
        }
      }
    }
  }

  it('holds nodata without a neighbour, and the neighbour\'s second column once it loads', () => {
    const atlas = new ElevationAtlas(S, 8);
    const a = packTileKey(4, 5, 5);
    const b = packTileKey(4, 6, 5);
    atlas.write(4, 5, 5, tile((i) => 100 + i), 100, 107);
    for (const edge of [TOP, BOTTOM, LEFT, RIGHT]) expect(halo(atlas, a, edge, 3)).toBe(ELEVATION_NODATA);
    atlas.write(4, 6, 5, tile((i) => 200 + i), 200, 207);
    for (let j = 0; j < S; j++) {
      expect(halo(atlas, a, RIGHT, j)).toBe(201);     // b's column 1
      expect(halo(atlas, b, LEFT, j)).toBe(106);      // a's column S − 2
    }
    expect(halo(atlas, a, LEFT, 3)).toBe(ELEVATION_NODATA);
    atlas.write(4, 5, 4, tile((_i, j) => 300 + j), 300, 307); // north of a
    for (let i = 0; i < S; i++) {
      expect(halo(atlas, a, TOP, i)).toBe(306);
      expect(halo(atlas, packTileKey(4, 5, 4), BOTTOM, i)).toBe(texel(atlas, a, i, 1));
    }
    expect(atlas.hasPendingUploads).toBe(true);
  });

  it('stays current when stitching moves texels inside the band (overzoomed tiles, any load order)', () => {
    const atlas = new ElevationAtlas(S, 16);
    // A 3 × 3 block with a wide stitch band, loaded centre last
    const order: Array<[number, number]> = [[0, 0], [2, 2], [1, 0], [0, 1], [2, 1], [1, 2], [2, 0], [0, 2], [1, 1]];
    for (const [dx, dy] of order) {
      atlas.write(5, 10 + dx, 10 + dy, tile((i, j) => 50 * dx + 30 * dy + i * 3 + j * 2), 0, 500, 2);
      expectHalosCurrent(atlas);
    }
    // Reloading an edge tile re-stitches its neighbours
    atlas.write(5, 11, 10, tile(() => 400), 400, 400, 2);
    expectHalosCurrent(atlas);
  });

  it('is cleared when a layer is reused by another tile', () => {
    const atlas = new ElevationAtlas(S, 2);
    atlas.write(4, 5, 5, tile(() => 100), 100, 100);
    atlas.write(4, 6, 5, tile(() => 110), 110, 110);
    const far = packTileKey(4, 12, 12);
    atlas.write(4, 12, 12, tile(() => 5), 5, 5); // evicts the first tile and takes its layer
    expect(atlas.has(packTileKey(4, 5, 5))).toBe(false);
    for (const edge of [TOP, BOTTOM, LEFT, RIGHT]) {
      for (let i = 0; i < S; i++) expect(halo(atlas, far, edge, i)).toBe(ELEVATION_NODATA);
    }
  });

  it('gives the same slope from both sides of a shared edge', () => {
    const atlas = new ElevationAtlas(S, 4);
    const last = S - 1;
    const h = (c: number) => 0.5 * c * c + 4 * Math.sin(c); // c: texel column across both tiles
    const a = packTileKey(6, 20, 20);
    const b = packTileKey(6, 21, 20);
    atlas.write(6, 20, 20, tile((i) => h(i)), 0, 100);
    // Before the neighbour: one-sided at the edge
    const alone = atlas.sampleSurface(a, 1, 0.5, 10)!;
    expect(alone.g![0]).toBeCloseTo((h(last) - h(last - 1)) / 10, 5);
    atlas.write(6, 21, 20, tile((i) => h(i + last)), 0, 100);
    const fromA = atlas.sampleSurface(a, 1, 0.5, 10)!;
    const fromB = atlas.sampleSurface(b, 0, 0.5, 10)!;
    expect(fromA.g![0]).toBeCloseTo((h(last + 1) - h(last - 1)) / 20, 5);
    expect(fromB.g![0]).toBeCloseTo(fromA.g![0], 9);
    expect(fromB.h).toBeCloseTo(fromA.h, 9);
  });
});
