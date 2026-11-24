// ============================================================================
// Tests for src/terrain/TerrainRenderer.ts without WebGL or workers: what an
// instance draws while tiles are still loading. A tile without its own data
// is drawn from the nearest loaded ancestor; a coarser tile is requested
// first when that ancestor is far up; only the loaded parent is a morph
// target; and the skirts cover the elevation range of the data in use until
// every tile has its own data and parent.
// ============================================================================

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { TerrainRenderer, type FrameView } from '../../src/terrain/TerrainRenderer';
import { TileGrid } from '../../src/tiles/TileGrid';
import { packTileKey } from '../../src/tiles/TileIndex';
import { registerBuiltinAnalyses } from '../../src/analysis/builtins';
import type { ElevationAtlas } from '../../src/terrain/ElevationAtlas';
import type { SelectedTile } from '../../src/terrain/TilePool';

beforeAll(() => registerBuiltinAnalyses());

const S = 16;
const W = 40075.016686;
const STRIDE = 17;

/** The renderer's private parts the tests look at. */
interface Internals {
  atlas: ElevationAtlas;
  tilePool: { _selected: SelectedTile[] };
  instanceData: Float32Array;
  instanceCount: number;
  originX: number;
  originY: number;
  material: { uniforms: Record<string, { value: unknown }> };
}

function setup(loadElevation: (req: { url: string }) => Promise<unknown> = () => new Promise(() => {})) {
  const gl = { MAX_ARRAY_TEXTURE_LAYERS: 1, getParameter: () => 2048, isContextLost: () => true };
  const renderer = { getContext: () => gl, capabilities: { maxTextureSize: 4096, getMaxAnisotropy: () => 1 } };
  const requested: Array<{ z: number; x: number; y: number }> = [];
  const base = {
    minZoom: 0, maxZoom: 22, decoderType: 'terrarium', decoderSource: null,
    source: {
      minZoom: 0, maxZoom: 15,
      ensureReady: async () => {},
      getSchedulingHints: () => ({ maxConcurrentFetches: 4, deferWrites: false }),
    },
    getTileUrl: (c: { z: number; x: number; y: number }) => { requested.push(c); return `dem/${c.z}/${c.x}/${c.y}`; },
    getOverzoomRegion: () => null,
  };
  // Requests never complete: the tests write tiles into the atlas themselves
  const workerPool = { loadElevation: vi.fn(loadElevation), cancel: vi.fn() };
  const tr = new TerrainRenderer({
    tileGrid: new TileGrid(W),
    workerPool,
    renderer,
    layerRegistry: { getActiveBaseLayer: () => base },
    metersToScene: 0.001,
    segments: 8,
    tileCacheSize: 512,
    slotSize: S,
    drapeSlotSize: 256,
    maxInstances: 512,
    maxConcurrentFetches: 4,
    lodQuality: 1,
    morphWidth: 0.25,
    requestRender: () => {},
  } as never);
  return { tr, internals: tr as unknown as Internals, requested, base };
}

/** Looking straight down from 8 world units above (100, 50); every tile passes the side planes. */
function view(): FrameView {
  const frustum = new Float64Array(16);
  for (let i = 0; i < 4; i++) frustum[i * 4 + 3] = 1;
  return {
    cameraX: 100, cameraY: 50, cameraZ: 8,
    targetX: 100, targetY: 50, targetZ: 0,
    zoom: 13, focalLength: 693, exaggeration: 1, horizon: 30,
    frustum, teleported: true,
  };
}

const flat = (h: number) => new Float32Array(S * S).fill(h);
const tileAt = (z: number, wx: number, wy: number): [number, number] => {
  const size = W / 2 ** z;
  return [Math.floor((wx + W / 2) / size), Math.floor((W / 2 - wy) / size)];
};

/** Instance of a selected tile: its elevation and parent references. */
function instanceOf(r: Internals, t: SelectedTile) {
  const d = r.instanceData;
  for (let i = 0; i < r.instanceCount; i++) {
    const o = i * STRIDE;
    if (Math.abs(d[o] - (t.centerX - r.originX)) < 1e-3 && Math.abs(d[o + 1] - (t.centerY - r.originY)) < 1e-3 && Math.abs(d[o + 2] - t.size) < 1e-6) {
      return { elevLayer: d[o + 3], elevScale: d[o + 6], parentLayer: d[o + 7], parentScale: d[o + 10] };
    }
  }
  return null;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('TerrainRenderer while tiles load', () => {
  it('requests a tile three levels up first when the nearest ancestor is much coarser', async () => {
    const { tr, internals, requested } = setup();
    // Only a level-8 tile around the camera is loaded
    const [ax, ay] = tileAt(8, 100, 50);
    internals.atlas.write(8, ax, ay, flat(1000), 1000, 1000);
    tr.update(view());
    const selected = [...internals.tilePool._selected];
    const finest = Math.max(...selected.map((t) => t.z));
    expect(finest).toBeGreaterThanOrEqual(12);
    expect(internals.instanceCount).toBeGreaterThan(0);
    await settle();
    // Four requests may run at once: all are fill-in tiles, none a selected tile yet
    expect(requested.length).toBe(4);
    const selectedKeys = new Set(selected.map((t) => t.key));
    for (const c of requested) expect(selectedKeys.has(packTileKey(c.z, c.x, c.y))).toBe(false);
    // The nearest tile's region comes first: three levels above the finest tile under the camera
    const [fx, fy] = tileAt(finest - 3, 100, 50);
    expect(requested[0]).toEqual({ z: finest - 3, x: fx, y: fy });
    tr.dispose();
  });

  it("a fill-in the source doesn't have leaves the ancestor's real heights in place", async () => {
    // Every request answers 'empty' (a sparse pyramid: the intermediate level is missing)
    const { tr, internals } = setup(async () => ({ status: 'empty' }));
    const [ax, ay] = tileAt(8, 100, 50);
    internals.atlas.write(8, ax, ay, flat(1000), 1000, 1000);
    const ancestor = internals.atlas.get(packTileKey(8, ax, ay))!.layer;
    tr.update(view());
    const finest = Math.max(...internals.tilePool._selected.map((t) => t.z));
    await settle();
    await settle();
    tr.update(view());
    const [fx, fy] = tileAt(finest - 3, 100, 50);
    expect(internals.atlas.has(packTileKey(finest - 3, fx, fy))).toBe(false); // not stored as a flat tile
    const under = internals.tilePool._selected.find((t) => t.z === finest && t.x === tileAt(finest, 100, 50)[0] && t.y === tileAt(finest, 100, 50)[1])!;
    expect(instanceOf(internals, under)!.elevLayer).toBe(ancestor);
    tr.dispose();
  });

  it('reports every elevation as changed when the finest level it samples from changes', () => {
    const { tr, base } = setup();
    tr.update(view());
    const version = tr.elevationVersion;
    expect(tr.elevationChangesSince(version)).toEqual([]);
    base.source.maxZoom = 11; // the levels the CPU reads from change
    tr.update(view());
    expect(tr.elevationChangesSince(version)).toBeNull();
    tr.dispose();
  });

  it('asks for no fill-in tile when an ancestor within three levels is loaded', async () => {
    const { tr, internals, requested } = setup();
    tr.update(view()); // nothing loaded: learn the selection (its requests stay pending)
    const selected = [...internals.tilePool._selected];
    requested.length = 0;
    const second = setup();
    for (const t of selected) {
      const up = Math.min(3, t.z);
      second.internals.atlas.write(t.z - up, t.x >> up, t.y >> up, flat(700), 700, 700);
    }
    second.tr.update(view());
    await settle();
    const selectedKeys = new Set(selected.map((t) => t.key));
    expect(second.requested.length).toBe(4);
    for (const c of second.requested) expect(selectedKeys.has(packTileKey(c.z, c.x, c.y))).toBe(true);
    tr.dispose();
    second.tr.dispose();
  });

  it('morphs only toward the loaded parent, never toward a coarser ancestor', () => {
    const { tr, internals } = setup();
    const [ax, ay] = tileAt(8, 100, 50);
    const sloped = new Float32Array(S * S).map((_, i) => 500 + (i % S) * 60); // 500 … 1400 m
    internals.atlas.write(8, ax, ay, sloped, 500, 1400);
    tr.update(view());
    // A tile that morphs somewhere (needs its parent) and lies under the loaded ancestor
    const t = internals.tilePool._selected.find((s) => s.needsParent && instanceOf(internals, s) !== null)!;
    expect(t).toBeDefined();
    const { z, x, y } = t;
    const fromAncestor = instanceOf(internals, t)!;
    expect(fromAncestor.elevScale).toBeCloseTo(1 / 2 ** (z - 8), 9);
    expect(fromAncestor.parentScale).toBe(0);

    // Its own data arrives, the parent has not: it keeps its own heights (no stand-in parent)
    const own = internals.atlas.write(z, x, y, flat(900), 900, 900)!;
    tr.update(view());
    const same = () => internals.tilePool._selected.find((s) => s.z === z && s.x === x && s.y === y)!;
    const ownOnly = instanceOf(internals, same())!;
    expect(ownOnly.elevLayer).toBe(own.layer);
    expect(ownOnly.elevScale).toBe(1);
    expect(ownOnly.parentScale).toBe(0);

    // The parent arrives: now it is the morph target
    const parent = internals.atlas.write(z - 1, x >> 1, y >> 1, flat(905), 905, 905)!;
    tr.update(view());
    const withParent = instanceOf(internals, same())!;
    expect(withParent.parentLayer).toBe(parent.layer);
    expect(withParent.parentScale).toBe(0.5);
    tr.dispose();
  });

  it('skirts cover the range of the data in use until every tile has its own data and parent', () => {
    const { tr, internals } = setup();
    const relief = () => internals.material.uniforms.uSkirtRelief.value as number;
    const [ax, ay] = tileAt(8, 100, 50);
    const sloped = new Float32Array(S * S).map((_, i) => 500 + (i % S) * 60);
    internals.atlas.write(8, ax, ay, sloped, 500, 1400);
    tr.update(view());
    expect(relief()).toBe(900); // tiles drawn from the ancestor: its range

    // Every selected tile gets its own data, a little apart, and every parent it morphs toward
    const selected = [...internals.tilePool._selected];
    for (const t of selected) {
      internals.atlas.write(t.z, t.x, t.y, flat(1000 + t.z), 1000 + t.z, 1000 + t.z);
    }
    tr.update(view());
    const needParents = internals.tilePool._selected.filter((t) => t.needsParent);
    expect(needParents.length).toBeGreaterThan(0);
    expect(relief()).toBeGreaterThan(0); // parents still missing
    for (const t of needParents) {
      internals.atlas.write(t.z - 1, t.x >> 1, t.y >> 1, flat(1000 + t.z - 1), 1000 + t.z - 1, 1000 + t.z - 1);
    }
    tr.update(view());
    expect(relief()).toBe(0); // all exact: skirts follow the tile size only
    for (const t of internals.tilePool._selected) expect(instanceOf(internals, t)!.elevScale).toBe(1);
    tr.dispose();
  });
});
