// ============================================================================
// Tests for src/layers/DrapeLayer.ts
//
// DrapeLayer is a configuration + identity object — fetching and GPU
// residency happen in TerrainRenderer + UnifiedDrapeAtlas. We validate
// construction defaults, LOD-offset clamping, attribution resolution,
// and source-ready delegation.
// ============================================================================

import { describe, it, expect } from 'vitest';
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

describe('DrapeLayer.lodOffset', () => {
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
    // Fetching and GPU residency live in TerrainRenderer/UnifiedDrapeAtlas.
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
