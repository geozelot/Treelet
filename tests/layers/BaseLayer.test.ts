// ============================================================================
// Tests for src/layers/BaseLayer.ts
//
// A BaseLayer binds a TileSource to an elevation decoder and resolves
// per-layer display defaults. It also hosts the overzoom logic — any
// source whose maxZoom < render zoom must still produce stable URLs.
// ============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { BaseLayer } from '../../src/layers/BaseLayer';
import type { TileSource } from '../../src/sources/TileSource';
import type { TileCoord } from '../../src/core/types';
import {
  RawRGBDecoder,
  MapboxDecoder,
  TerrariumDecoder,
  registerDecoder,
  type ElevationDecoder,
} from '../../src/decoders/ElevationDecoder';

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Mock TileSource
// ---------------------------------------------------------------------------

function makeMockSource(overrides: Partial<TileSource> = {}): TileSource {
  const urls: string[] = [];
  const base: TileSource = {
    tileSize: 256,
    minZoom: 0,
    maxZoom: 22,
    attribution: 'Mock Source',
    maxConcurrency: 12,
    getTileUrl(coord: TileCoord): string {
      const url = `mock://tile/${coord.z}/${coord.x}/${coord.y}`;
      urls.push(url);
      return url;
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
// Decoder resolution
// ---------------------------------------------------------------------------

describe('BaseLayer decoder resolution', () => {
  it('defaults to RawRGBDecoder (terrain-rgb) when no decoder is specified', () => {
    const layer = new BaseLayer({
      layerName: 'Test',
      layerSource: makeMockSource(),
    });
    expect(layer.decoder).toBe(RawRGBDecoder);
    expect(layer.decoderType).toBe('terrain-rgb');
  });

  it('resolves the built-in "mapbox" name', () => {
    const layer = new BaseLayer({
      layerName: 'Test',
      layerSource: makeMockSource(),
      decoder: 'mapbox',
    });
    expect(layer.decoder).toBe(MapboxDecoder);
    expect(layer.decoderType).toBe('mapbox');
  });

  it('resolves the built-in "terrarium" name', () => {
    const layer = new BaseLayer({
      layerName: 'Test',
      layerSource: makeMockSource(),
      decoder: 'terrarium',
    });
    expect(layer.decoder).toBe(TerrariumDecoder);
    expect(layer.decoderType).toBe('terrarium');
  });

  it('accepts a custom decoder function and labels it as "custom"', () => {
    const custom = (pixels: Uint8ClampedArray, w: number, h: number) =>
      new Float32Array(w * h);
    const layer = new BaseLayer({
      layerName: 'Test',
      layerSource: makeMockSource(),
      decoder: custom,
    });
    expect(layer.decoder).toBe(custom);
    expect(layer.decoderType).toBe('custom');
  });
});

// ---------------------------------------------------------------------------
// Decoder source transport (for worker dispatch)
// ---------------------------------------------------------------------------

describe('BaseLayer decoderSource', () => {
  it('is null for all three hard-coded built-ins (workers know them natively)', () => {
    for (const name of ['terrain-rgb', 'mapbox', 'terrarium'] as const) {
      const layer = new BaseLayer({
        layerName: 'T',
        layerSource: makeMockSource(),
        decoder: name,
      });
      expect(layer.decoderSource).toBeNull();
    }
  });

  it('defaults to null when no decoder is specified (built-in terrain-rgb)', () => {
    const layer = new BaseLayer({ layerName: 'T', layerSource: makeMockSource() });
    expect(layer.decoderSource).toBeNull();
  });

  it('serializes a custom decoder function so workers can compile it', () => {
    const custom = (pixels: Uint8ClampedArray, w: number, h: number) =>
      new Float32Array(w * h);
    const layer = new BaseLayer({
      layerName: 'T',
      layerSource: makeMockSource(),
      decoder: custom,
    });
    expect(layer.decoderSource).toBe(custom.toString());
    expect(typeof layer.decoderSource).toBe('string');
  });

  it('serializes a registered (non-built-in) named decoder', () => {
    const registered: ElevationDecoder = (pixels, w, h) => new Float32Array(w * h);
    registerDecoder('base-layer-test-custom-name', registered);

    const layer = new BaseLayer({
      layerName: 'T',
      layerSource: makeMockSource(),
      // Cast to bypass the DecoderName union type — runtime resolve allows any registered name.
      decoder: 'base-layer-test-custom-name' as unknown as 'terrain-rgb',
    });
    expect(layer.decoderSource).toBe(registered.toString());
  });
});

// ---------------------------------------------------------------------------
// Attribution resolution
// ---------------------------------------------------------------------------

describe('BaseLayer attribution', () => {
  it('prefers layerAttribution over source attribution', () => {
    const layer = new BaseLayer({
      layerName: 'Test',
      layerSource: makeMockSource({ attribution: 'Source' }),
      layerAttribution: 'Layer',
    });
    expect(layer.attribution).toBe('Layer');
  });

  it('falls back to source attribution when layerAttribution is absent', () => {
    const layer = new BaseLayer({
      layerName: 'Test',
      layerSource: makeMockSource({ attribution: 'Source' }),
    });
    expect(layer.attribution).toBe('Source');
  });

  it('falls back to an empty string when neither is set', () => {
    const layer = new BaseLayer({
      layerName: 'Test',
      layerSource: makeMockSource({ attribution: '' }),
    });
    expect(layer.attribution).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Display + terrainDisplay defaults
// ---------------------------------------------------------------------------

describe('BaseLayer display defaults', () => {
  it('applies the documented defaults when no display options are provided', () => {
    const layer = new BaseLayer({
      layerName: 'Test',
      layerSource: makeMockSource(),
    });
    expect(layer.display.visible).toBe(true);
    expect(layer.display.exaggeration).toBe(1.0);
    expect(layer.visible).toBe(true);
  });

  it('honors explicit exaggeration and visibility', () => {
    const layer = new BaseLayer({
      layerName: 'Test',
      layerSource: makeMockSource(),
      layerDisplay: { visible: false, exaggeration: 2.5 },
    });
    expect(layer.display.exaggeration).toBe(2.5);
    expect(layer.display.visible).toBe(false);
    expect(layer.visible).toBe(false);
  });

  it('resolves the terrainDisplay defaults', () => {
    const layer = new BaseLayer({
      layerName: 'Test',
      layerSource: makeMockSource(),
    });
    expect(layer.terrainDisplay.isoplethInterval).toBe(100);
    expect(layer.terrainDisplay.isolineStrength).toBe(1.5);
    expect(layer.terrainDisplay.isolineColor).toEqual([0.12, 0.08, 0.04]);
    expect(layer.terrainDisplay.rampInterpolationRange).toEqual([0, 4000]);
    expect(layer.terrainDisplay.rampDefaultElevation).toBe('hypsometric');
    expect(layer.terrainDisplay.rampDefaultSlope).toBe('viridis');
    expect(layer.terrainDisplay.rampDefaultAspect).toBe('inferno');
  });

  it('overrides selected terrainDisplay fields while keeping the rest at defaults', () => {
    const layer = new BaseLayer({
      layerName: 'Test',
      layerSource: makeMockSource(),
      terrainDisplay: {
        isoplethInterval: 50,
        rampInterpolationRange: 'auto',
      },
    });
    expect(layer.terrainDisplay.isoplethInterval).toBe(50);
    expect(layer.terrainDisplay.rampInterpolationRange).toBe('auto');
    // Unspecified fields still use defaults
    expect(layer.terrainDisplay.isolineStrength).toBe(1.5);
    expect(layer.terrainDisplay.rampDefaultElevation).toBe('hypsometric');
  });
});

// ---------------------------------------------------------------------------
// Zoom + identity
// ---------------------------------------------------------------------------

describe('BaseLayer identity and zoom', () => {
  it('has a unique id per instance and a "base-" prefix', () => {
    const a = new BaseLayer({ layerName: 'A', layerSource: makeMockSource() });
    const b = new BaseLayer({ layerName: 'B', layerSource: makeMockSource() });
    expect(a.id).not.toBe(b.id);
    expect(a.id.startsWith('base-')).toBe(true);
    expect(b.id.startsWith('base-')).toBe(true);
  });

  it('applies default min/max zoom of 0/22', () => {
    const layer = new BaseLayer({ layerName: 'Test', layerSource: makeMockSource() });
    expect(layer.minZoom).toBe(0);
    expect(layer.maxZoom).toBe(22);
  });

  it('respects custom min/max zoom', () => {
    const layer = new BaseLayer({
      layerName: 'Test',
      layerSource: makeMockSource(),
      minZoom: 3,
      maxZoom: 15,
    });
    expect(layer.minZoom).toBe(3);
    expect(layer.maxZoom).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Overzoom: getTileUrl / getOverzoomRegion
// ---------------------------------------------------------------------------

describe('BaseLayer overzoom handling', () => {
  it('delegates directly to the source when the tile zoom is within range', () => {
    const source = makeMockSource({ maxZoom: 15 });
    const layer = new BaseLayer({ layerName: 'T', layerSource: source });
    expect(layer.getTileUrl({ z: 10, x: 50, y: 60 })).toBe('mock://tile/10/50/60');
    expect(layer.getOverzoomRegion({ z: 10, x: 50, y: 60 })).toBeNull();
    expect(layer.getOverzoomRegion({ z: 15, x: 1, y: 2 })).toBeNull();
  });

  it('clamps zoom and right-shifts coordinates when overzooming', () => {
    const source = makeMockSource({ maxZoom: 15 });
    const layer = new BaseLayer({ layerName: 'T', layerSource: source });

    // Tile at z=18 is 3 levels beyond source max. Expected URL is at z=15
    // with x=16>>3=2, y=24>>3=3 → "mock://tile/15/2/3".
    expect(layer.getTileUrl({ z: 18, x: 16, y: 24 })).toBe('mock://tile/15/2/3');
  });

  it('getOverzoomRegion returns dz and sub-tile offsets for overzoom tiles', () => {
    const source = makeMockSource({ maxZoom: 15 });
    const layer = new BaseLayer({ layerName: 'T', layerSource: source });

    // At z=18, dz=3, divisor=8; coord (16, 24) ⇒ relX=0, relY=0
    expect(layer.getOverzoomRegion({ z: 18, x: 16, y: 24 })).toEqual({
      dz: 3,
      relX: 0,
      relY: 0,
    });

    // coord (19, 27) at z=18 ⇒ relX=3, relY=3
    expect(layer.getOverzoomRegion({ z: 18, x: 19, y: 27 })).toEqual({
      dz: 3,
      relX: 3,
      relY: 3,
    });
  });

  it('is a no-op for exactly-at-max zoom tiles', () => {
    const source = makeMockSource({ maxZoom: 10 });
    const layer = new BaseLayer({ layerName: 'T', layerSource: source });
    expect(layer.getTileUrl({ z: 10, x: 5, y: 7 })).toBe('mock://tile/10/5/7');
    expect(layer.getOverzoomRegion({ z: 10, x: 5, y: 7 })).toBeNull();
  });

  it('warns when a tile is below source.minZoom (defensive last-line check)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = makeMockSource({ minZoom: 5, maxZoom: 15 });
    const layer = new BaseLayer({ layerName: 'T', layerSource: source });

    // A tile below the source's min zoom: we still produce a URL (best-effort)
    // but flag the upstream contract violation so it surfaces in development.
    layer.getTileUrl({ z: 2, x: 0, y: 0 });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/below source\.minZoom/);
  });

  it('does not warn for in-range or overzoom tiles', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = makeMockSource({ minZoom: 5, maxZoom: 15 });
    const layer = new BaseLayer({ layerName: 'T', layerSource: source });

    layer.getTileUrl({ z: 5, x: 0, y: 0 });   // exactly at min
    layer.getTileUrl({ z: 10, x: 0, y: 0 });  // middle
    layer.getTileUrl({ z: 18, x: 0, y: 0 });  // overzoom

    expect(warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ensureSourceReady
// ---------------------------------------------------------------------------

describe('BaseLayer.ensureSourceReady', () => {
  it('resolves by delegating to source.ensureReady', async () => {
    let called = false;
    const source = makeMockSource({
      async ensureReady() {
        called = true;
      },
    });
    const layer = new BaseLayer({ layerName: 'T', layerSource: source });
    await layer.ensureSourceReady();
    expect(called).toBe(true);
  });
});
