// ============================================================================
// Tests for src/layers/LayerRegistry.ts
//
// The registry enforces base-layer exclusivity (radio selection) and
// centralizes attribution collection. Both behaviors are directly visible
// in the UI and affect terrain correctness.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { LayerRegistry } from '../../src/layers/LayerRegistry';
import type { TileSource } from '../../src/sources/TileSource';
import type { TileCoord } from '../../src/core/types';

// ---------------------------------------------------------------------------
// Mock TileSource
// ---------------------------------------------------------------------------

function makeMockSource(attribution: string = ''): TileSource {
  return {
    tileSize: 256,
    minZoom: 0,
    maxZoom: 22,
    attribution,
    maxConcurrency: 12,
    getTileUrl(coord: TileCoord): string {
      return `mock://${coord.z}/${coord.x}/${coord.y}`;
    },
    async ensureReady() {
      /* no-op */
    },
    getSchedulingHints() {
      return { maxConcurrentFetches: 12, deferWrites: false };
    },
  };
}

// ---------------------------------------------------------------------------
// Base layer management
// ---------------------------------------------------------------------------

describe('LayerRegistry base layers', () => {
  it('is empty on construction', () => {
    const reg = new LayerRegistry();
    expect(reg.hasBaseLayers()).toBe(false);
    expect(reg.getAllBaseLayers()).toHaveLength(0);
    expect(reg.getActiveBaseLayer()).toBeNull();
  });

  it('auto-activates the first added base layer', () => {
    const reg = new LayerRegistry();
    const h = reg.addBaseLayer({ layerName: 'A', layerSource: makeMockSource() });
    const active = reg.getActiveBaseLayer();
    expect(active).not.toBeNull();
    expect(active!.id).toBe(h.id);
    expect(active!.visible).toBe(true);
  });

  it('setActiveBaseLayer enforces radio exclusivity (only one visible)', () => {
    const reg = new LayerRegistry();
    const a = reg.addBaseLayer({ layerName: 'A', layerSource: makeMockSource() });
    const b = reg.addBaseLayer({ layerName: 'B', layerSource: makeMockSource() });

    reg.setActiveBaseLayer(b);

    const layers = reg.getAllBaseLayers();
    const visible = layers.filter((l) => l.visible);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe(b.id);
    expect(reg.getActiveBaseLayer()!.id).toBe(b.id);

    // Switching back also enforces exclusivity
    reg.setActiveBaseLayer(a);
    expect(reg.getAllBaseLayers().filter((l) => l.visible)).toHaveLength(1);
    expect(reg.getActiveBaseLayer()!.id).toBe(a.id);
  });

  it('setActiveBaseLayer throws for an unknown id', () => {
    const reg = new LayerRegistry();
    expect(() => reg.setActiveBaseLayer('missing-id')).toThrow(/not found/);
  });

  it('setActiveBaseLayer accepts both LayerHandle and string id', () => {
    const reg = new LayerRegistry();
    const h = reg.addBaseLayer({ layerName: 'A', layerSource: makeMockSource() });
    // Add another and switch using the handle object
    const other = reg.addBaseLayer({ layerName: 'B', layerSource: makeMockSource() });
    reg.setActiveBaseLayer(other);
    expect(reg.getActiveBaseLayer()!.id).toBe(other.id);
    // Now switch back using a raw string id
    reg.setActiveBaseLayer(h.id);
    expect(reg.getActiveBaseLayer()!.id).toBe(h.id);
  });

  it('removeBaseLayer falls back to the first remaining layer if the active one is removed', () => {
    const reg = new LayerRegistry();
    const a = reg.addBaseLayer({ layerName: 'A', layerSource: makeMockSource() });
    const b = reg.addBaseLayer({ layerName: 'B', layerSource: makeMockSource() });

    reg.setActiveBaseLayer(a);
    expect(reg.removeBaseLayer(a)).toBe(true);

    expect(reg.getActiveBaseLayer()!.id).toBe(b.id);
    expect(reg.getActiveBaseLayer()!.visible).toBe(true);
  });

  it('removeBaseLayer clears active state when the last layer is removed', () => {
    const reg = new LayerRegistry();
    const h = reg.addBaseLayer({ layerName: 'Only', layerSource: makeMockSource() });
    expect(reg.removeBaseLayer(h)).toBe(true);
    expect(reg.getActiveBaseLayer()).toBeNull();
    expect(reg.hasBaseLayers()).toBe(false);
  });

  it('removeBaseLayer returns false for unknown handles', () => {
    const reg = new LayerRegistry();
    expect(reg.removeBaseLayer('nope')).toBe(false);
  });

  it('getBaseLayer returns the layer instance for known handles, undefined for unknown', () => {
    const reg = new LayerRegistry();
    const h = reg.addBaseLayer({ layerName: 'A', layerSource: makeMockSource() });
    expect(reg.getBaseLayer(h)?.id).toBe(h.id);
    expect(reg.getBaseLayer('nope')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Drape layer management
// ---------------------------------------------------------------------------

describe('LayerRegistry drape layers', () => {
  it('is empty on construction', () => {
    const reg = new LayerRegistry();
    expect(reg.hasDrapeLayers()).toBe(false);
    expect(reg.getAllDrapeLayers()).toHaveLength(0);
  });

  it('registers multiple drape layers (registry allows many)', () => {
    const reg = new LayerRegistry();
    reg.addDrapeLayer({ layerName: 'A', layerSource: makeMockSource() });
    reg.addDrapeLayer({ layerName: 'B', layerSource: makeMockSource() });
    expect(reg.getAllDrapeLayers()).toHaveLength(2);
    expect(reg.hasDrapeLayers()).toBe(true);
  });

  it('setDrapeLayerActive flips the visible flag on the target layer', () => {
    const reg = new LayerRegistry();
    const h = reg.addDrapeLayer({ layerName: 'A', layerSource: makeMockSource() });
    const layer = reg.getDrapeLayer(h)!;

    expect(layer.visible).toBe(true); // default visible
    reg.setDrapeLayerActive(h, false);
    expect(layer.visible).toBe(false);
    reg.setDrapeLayerActive(h, true);
    expect(layer.visible).toBe(true);
  });

  it('removeDrapeLayer returns true on success and removes from the list', () => {
    const reg = new LayerRegistry();
    const h = reg.addDrapeLayer({ layerName: 'A', layerSource: makeMockSource() });
    expect(reg.removeDrapeLayer(h)).toBe(true);
    expect(reg.getAllDrapeLayers()).toHaveLength(0);
    expect(reg.getDrapeLayer(h)).toBeUndefined();
  });

  it('removeDrapeLayer returns false for unknown handles', () => {
    const reg = new LayerRegistry();
    expect(reg.removeDrapeLayer('nope')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Overlay layer management
// ---------------------------------------------------------------------------

describe('LayerRegistry overlay layers', () => {
  it('registers and removes overlay layers', () => {
    const reg = new LayerRegistry();
    const h = reg.addOverlayLayer({ layerName: 'A' });
    expect(reg.getAllOverlayLayers()).toHaveLength(1);
    expect(reg.getOverlayLayer(h)?.id).toBe(h.id);

    expect(reg.removeOverlayLayer(h)).toBe(true);
    expect(reg.getAllOverlayLayers()).toHaveLength(0);
    expect(reg.getOverlayLayer(h)).toBeUndefined();
  });

  it('removeOverlayLayer returns false for unknown handles', () => {
    const reg = new LayerRegistry();
    expect(reg.removeOverlayLayer('nope')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Attribution aggregation
// ---------------------------------------------------------------------------

describe('LayerRegistry.getAllAttributions', () => {
  it('collects attributions from all registered layer kinds', () => {
    const reg = new LayerRegistry();
    reg.addBaseLayer({
      layerName: 'B1',
      layerSource: makeMockSource('© DEM'),
    });
    reg.addDrapeLayer({
      layerName: 'D1',
      layerSource: makeMockSource('© Imagery'),
    });
    reg.addOverlayLayer({
      layerName: 'O1',
      layerAttribution: '© Overlay',
    });

    const attrs = reg.getAllAttributions();
    expect(attrs).toContain('© DEM');
    expect(attrs).toContain('© Imagery');
    expect(attrs).toContain('© Overlay');
  });

  it('deduplicates identical attribution strings', () => {
    const reg = new LayerRegistry();
    reg.addBaseLayer({ layerName: 'A', layerSource: makeMockSource('© Same') });
    reg.addDrapeLayer({ layerName: 'B', layerSource: makeMockSource('© Same') });

    const attrs = reg.getAllAttributions();
    expect(attrs.filter((a) => a === '© Same')).toHaveLength(1);
  });

  it('omits empty attributions', () => {
    const reg = new LayerRegistry();
    reg.addBaseLayer({ layerName: 'A', layerSource: makeMockSource('') });
    const attrs = reg.getAllAttributions();
    expect(attrs).not.toContain('');
  });
});
