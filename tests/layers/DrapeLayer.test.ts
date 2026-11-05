// ============================================================================
// Tests for src/layers/DrapeLayer.ts
//
// DrapeLayer is a configuration + identity object — fetching and GPU
// residency happen in TerrainRenderer + DrapeAtlas. We validate
// construction defaults, the (deprecated) LOD-offset clamping, the source
// zoom chosen per terrain tile, attribution resolution, and source-ready
// delegation.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DrapeLayer } from '../../src/layers/DrapeLayer';
import type { TileSource } from '../../src/sources/TileSource';
import type { TileCoord } from '../../src/core/types';

// ---------------------------------------------------------------------------
// Mock TileSource
// ---------------------------------------------------------------------------

function makeMockSource(overrides: Partial<TileSource> = {}): TileSource {
  const base: TileSource = {
    tileSize: 256,
    minZoom: 0,
    maxZoom: 22,
    attribution: 'Drape Source',
    maxConcurrency: 12,
    getTileUrl(coord: TileCoord): string {
      return `mock://drape/${coord.z}/${coord.x}/${coord.y}.png`;
    },
    async ensureReady() {
      /* no-op */
    },
    getSchedulingHints() {
      return { maxConcurrentFetches: 12, deferWrites: false };
    },
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Construction + defaults
// ---------------------------------------------------------------------------

describe('DrapeLayer construction', () => {
  it('assigns a unique "drape-"-prefixed id', () => {
    const a = new DrapeLayer({ layerName: 'A', layerSource: makeMockSource() });
    const b = new DrapeLayer({ layerName: 'B', layerSource: makeMockSource() });
    expect(a.id).not.toBe(b.id);
    expect(a.id.startsWith('drape-')).toBe(true);
  });

  it('applies default minZoom=0 / maxZoom=22', () => {
    const layer = new DrapeLayer({ layerName: 'T', layerSource: makeMockSource() });
    expect(layer.minZoom).toBe(0);
    expect(layer.maxZoom).toBe(22);
  });

  it('applies default display: visible=true, opacity=1.0, blendMode="hillshade"', () => {
    const layer = new DrapeLayer({ layerName: 'T', layerSource: makeMockSource() });
    expect(layer.display.visible).toBe(true);
    expect(layer.display.opacity).toBe(1.0);
    expect(layer.display.blendMode).toBe('hillshade');
    expect(layer.display.hillshadeStrength).toBe(0.5);
    expect(layer.visible).toBe(true);
  });

  it('honors explicit display options', () => {
    const layer = new DrapeLayer({
      layerName: 'T',
      layerSource: makeMockSource(),
      layerDisplay: {
        visible: false,
        opacity: 0.25,
        blendMode: 'softlight',
        hillshadeStrength: 0.8,
      },
    });
    expect(layer.display.visible).toBe(false);
    expect(layer.display.opacity).toBe(0.25);
    expect(layer.display.blendMode).toBe('softlight');
    expect(layer.display.hillshadeStrength).toBe(0.8);
    expect(layer.visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lodOffset clamping
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DrapeLayer.lodOffset', () => {
  // lodOffset > 1 prints a deprecation warning (covered below).
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('defaults to 1 (match elevation zoom)', () => {
    const layer = new DrapeLayer({ layerName: 'T', layerSource: makeMockSource() });
    expect(layer.lodOffset).toBe(1);
  });

  it('accepts valid values 1, 2, and 3', () => {
    const a = new DrapeLayer({ layerName: 'A', layerSource: makeMockSource(), lodOffset: 1 });
    const b = new DrapeLayer({ layerName: 'B', layerSource: makeMockSource(), lodOffset: 2 });
    const c = new DrapeLayer({ layerName: 'C', layerSource: makeMockSource(), lodOffset: 3 });
    expect(a.lodOffset).toBe(1);
    expect(b.lodOffset).toBe(2);
    expect(c.lodOffset).toBe(3);
  });

  it('clamps values below 1 to 1 and above 3 to 3 (defensive runtime clamp)', () => {
    // The public type is 1 | 2 | 3, but the runtime clamp guards against
    // invalid values slipping through at the JS boundary. Cast to exercise it.
    const low = new DrapeLayer({
      layerName: 'T',
      layerSource: makeMockSource(),
      lodOffset: 0 as unknown as 1 | 2 | 3,
    });
    const high = new DrapeLayer({
      layerName: 'T',
      layerSource: makeMockSource(),
      lodOffset: 99 as unknown as 1 | 2 | 3,
    });
    expect(low.lodOffset).toBe(1);
    expect(high.lodOffset).toBe(3);
  });
});

describe('DrapeLayer.lodOffset deprecation', () => {
  it('warns once that lodOffset is ignored', async () => {
    vi.resetModules();
    const { DrapeLayer: Fresh } = await import('../../src/layers/DrapeLayer');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new Fresh({ layerName: 'A', layerSource: makeMockSource(), lodOffset: 1 });
    expect(warn).not.toHaveBeenCalled();
    new Fresh({ layerName: 'B', layerSource: makeMockSource(), lodOffset: 2 });
    new Fresh({ layerName: 'C', layerSource: makeMockSource(), lodOffset: 3 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/drapeSlotSize/));
  });
});

// ---------------------------------------------------------------------------
// Source zoom per terrain tile
// ---------------------------------------------------------------------------

describe('DrapeLayer.sourceZoomFor', () => {
  const layer = (o: Partial<TileSource> = {}) => new DrapeLayer({ layerName: 'T', layerSource: makeMockSource(o) });

  it('fetches the tile zoom when one source tile fills the slot', () => {
    expect(layer().sourceZoomFor(12, 256)).toBe(12);
  });

  it('fetches finer source tiles when the slot holds them at full resolution', () => {
    expect(layer().sourceZoomFor(12, 512)).toBe(13); // 2×2 tiles
    expect(layer().sourceZoomFor(12, 1024)).toBe(14); // 4×4 tiles
    expect(layer().sourceZoomFor(12, 4096)).toBe(14); // never more than 4×4
    expect(layer({ tileSize: 512 }).sourceZoomFor(12, 512)).toBe(12);
    // Larger source tiles than the slot: downsampled, never finer (no wasted requests).
    expect(layer({ tileSize: 512 }).sourceZoomFor(12, 256)).toBe(12);
  });

  it('caps at the source maxZoom; finer terrain tiles crop a max-zoom tile', () => {
    const l = layer({ maxZoom: 16 });
    expect(l.sourceZoomFor(15, 512)).toBe(16);
    expect(l.sourceZoomFor(16, 512)).toBe(16);
    expect(l.sourceZoomFor(18, 512)).toBe(18); // <= tile zoom: cropped from z16
    expect(l.slotZoomRoom(512)).toBe(1);
  });

  it('composites finer tiles below the source minZoom, up to 4×4', () => {
    const l = layer({ minZoom: 5 });
    expect(l.sourceZoomFor(3, 256)).toBe(5);
    expect(l.sourceZoomFor(2, 256)).toBe(-1);
  });

  it('treats an unknown tile size as one source tile per slot', () => {
    const l = layer({ tileSize: undefined as unknown as number });
    expect(l.tilePixels).toBe(0);
    expect(l.slotZoomRoom(512)).toBe(0);
    expect(l.sourceZoomFor(12, 512)).toBe(12);
    expect(l.finestTileZoom(512)).toBe(22);
  });

  it('counts retina images by their pixel size', () => {
    const l = layer({ pixelRatio: 2 });
    expect(l.tilePixels).toBe(512);
    expect(l.sourceZoomFor(12, 512)).toBe(12); // one @2x tile fills a 512 slot
  });

  it('switches to the measured image size, reporting a wrong declaration once', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const l = new DrapeLayer({ layerName: 'Wrong', layerSource: makeMockSource({ tileSize: 512, maxZoom: 19 }) });
    expect(l.sourceZoomFor(12, 512)).toBe(12);
    expect(l.finestTileZoom(512)).toBe(19);
    l.observeTileSize(256);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/"Wrong" declares 512-px tiles but serves 256-px/));
    expect(l.tilePixels).toBe(256);
    expect(l.sourceZoomFor(12, 512)).toBe(13);
    expect(l.finestTileZoom(512)).toBe(18);
    l.observeTileSize(512); // only the first measurement counts
    expect(l.tilePixels).toBe(256);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('measures silently when the declaration was right', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const l = layer();
    l.observeTileSize(256);
    expect(info).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Source images per drape slot
// ---------------------------------------------------------------------------

describe('DrapeLayer.drapeParts', () => {
  const layer = (o: Partial<TileSource> = {}) => new DrapeLayer({ layerName: 'T', layerSource: makeMockSource(o) });

  it('uses one source tile when it fills the slot', () => {
    const r = layer().drapeParts(12, 100, 200, 256)!;
    expect(r.z).toBe(12);
    expect(r.parts).toEqual([{ url: 'mock://drape/12/100/200.png', dx: 0, dy: 0, dSize: 256, crop: null }]);
  });

  it('composites a 2×2 grid of finer tiles into a 512 slot', () => {
    const r = layer().drapeParts(12, 100, 200, 512)!;
    expect(r.z).toBe(13);
    expect(r.parts.map((p) => [p.url, p.dx, p.dy, p.dSize])).toEqual([
      ['mock://drape/13/200/400.png', 0, 0, 256],
      ['mock://drape/13/201/400.png', 256, 0, 256],
      ['mock://drape/13/200/401.png', 0, 256, 256],
      ['mock://drape/13/201/401.png', 256, 256, 256],
    ]);
  });

  it('crops a max-zoom tile past the source maxZoom', () => {
    const r = layer({ maxZoom: 16 }).drapeParts(18, 1001, 2002, 512)!;
    expect(r.z).toBe(18);
    expect(r.parts).toEqual([{
      url: 'mock://drape/16/250/500.png', dx: 0, dy: 0, dSize: 512,
      crop: { x: 0.25, y: 0.5, w: 0.25, h: 0.25 },
    }]);
  });

  it('composites up to the source maxZoom when the slot would hold more', () => {
    const r = layer({ maxZoom: 13 }).drapeParts(12, 0, 0, 1024)!;
    expect(r.z).toBe(13);
    expect(r.parts).toHaveLength(4);
    expect(r.parts[0].dSize).toBe(512);
  });

  it('returns null where the source cannot cover the tile', () => {
    expect(layer({ minZoom: 8 }).drapeParts(4, 0, 0, 256)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

describe('DrapeLayer attribution', () => {
  it('prefers layerAttribution over source attribution', () => {
    const layer = new DrapeLayer({
      layerName: 'T',
      layerSource: makeMockSource({ attribution: 'Source' }),
      layerAttribution: 'Layer',
    });
    expect(layer.attribution).toBe('Layer');
  });

  it('falls back to source attribution', () => {
    const layer = new DrapeLayer({
      layerName: 'T',
      layerSource: makeMockSource({ attribution: 'Source' }),
    });
    expect(layer.attribution).toBe('Source');
  });

  it('falls back to empty string when neither is set', () => {
    const layer = new DrapeLayer({
      layerName: 'T',
      layerSource: makeMockSource({ attribution: '' }),
    });
    expect(layer.attribution).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Source + identity surface
// ---------------------------------------------------------------------------

describe('DrapeLayer identity + source surface', () => {
  it('exposes the underlying source so TerrainRenderer can fetch directly', () => {
    const source = makeMockSource();
    const layer = new DrapeLayer({ layerName: 'T', layerSource: source });
    expect(layer.source).toBe(source);
  });

  it('does not expose a per-layer texture cache API', () => {
    // Fetching and GPU residency live in TerrainRenderer/DrapeAtlas.
    // The layer intentionally has no fetchTexture/getCachedTexture surface.
    const layer = new DrapeLayer({ layerName: 'T', layerSource: makeMockSource() });
    expect((layer as unknown as { fetchTexture?: unknown }).fetchTexture).toBeUndefined();
    expect((layer as unknown as { getCachedTexture?: unknown }).getCachedTexture).toBeUndefined();
    expect((layer as unknown as { disposeTexture?: unknown }).disposeTexture).toBeUndefined();
    expect((layer as unknown as { dispose?: unknown }).dispose).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ensureSourceReady
// ---------------------------------------------------------------------------

describe('DrapeLayer.ensureSourceReady', () => {
  it('delegates to source.ensureReady', async () => {
    let called = false;
    const source = makeMockSource({
      async ensureReady() {
        called = true;
      },
    });
    const layer = new DrapeLayer({ layerName: 'T', layerSource: source });
    await layer.ensureSourceReady();
    expect(called).toBe(true);
  });
});
