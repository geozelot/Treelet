// ============================================================================
// Tests for src/terrain/TileGeometry.ts
//
// Back-face culling depends on consistent winding: the surface must face +Z
// and every skirt must face away from the tile.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { buildTileGrid } from '../../src/terrain/TileGeometry';

function triangleNormals(N: number) {
  const geo = buildTileGrid(N);
  const pos = geo.getAttribute('position').array as Float32Array;
  const idx = geo.getIndex()!.array as ArrayLike<number>;
  const out: Array<{ n: [number, number, number]; c: [number, number, number] }> = [];
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    out.push({
      n: [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]],
      c: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3],
    });
  }
  return { geo, tris: out };
}

describe('buildTileGrid', () => {
  it('uses 16-bit indices for the default resolution', () => {
    const geo = buildTileGrid(64);
    expect(geo.getIndex()!.array).toBeInstanceOf(Uint16Array);
    expect(geo.getAttribute('position').count).toBe(65 * 65 + 4 * 65);
  });

  it('winds the surface counter-clockwise from above (+Z) and skirts outward', () => {
    const N = 8;
    const { tris } = triangleNormals(N);
    const surface = tris.slice(0, N * N * 2);
    const skirts = tris.slice(N * N * 2);
    for (const t of surface) expect(t.n[2]).toBeGreaterThan(0);
    expect(skirts).toHaveLength(4 * N * 2);
    for (const t of skirts) {
      // Outward: normal points the same way as the triangle's offset from the tile center.
      const dot = t.n[0] * t.c[0] + t.n[1] * t.c[1];
      expect(dot).toBeGreaterThan(0);
      expect(Math.abs(t.n[2])).toBeLessThan(1e-9);
    }
  });

  it('rejects odd resolutions (geomorphing needs an even grid)', () => {
    expect(() => buildTileGrid(63)).toThrow(/even/);
  });
});
