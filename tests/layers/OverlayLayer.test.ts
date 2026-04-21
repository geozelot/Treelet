// ============================================================================
// Tests for src/layers/OverlayLayer.ts
//
// OverlayLayer is currently a stub for future vector/marker work;
// it still participates in the Layer interface and must resolve its
// options identically to the other layer kinds.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { OverlayLayer } from '../../src/layers/OverlayLayer';

describe('OverlayLayer construction', () => {
  it('assigns a unique "overlay-"-prefixed id', () => {
    const a = new OverlayLayer({ layerName: 'A' });
    const b = new OverlayLayer({ layerName: 'B' });
    expect(a.id).not.toBe(b.id);
    expect(a.id.startsWith('overlay-')).toBe(true);
  });

  it('applies default min/max zoom of 0/20', () => {
    const layer = new OverlayLayer({ layerName: 'T' });
    expect(layer.minZoom).toBe(0);
    expect(layer.maxZoom).toBe(20);
  });

  it('respects custom min/max zoom', () => {
    const layer = new OverlayLayer({ layerName: 'T', minZoom: 5, maxZoom: 18 });
    expect(layer.minZoom).toBe(5);
    expect(layer.maxZoom).toBe(18);
  });

  it('applies default display: visible=true, opacity=1.0', () => {
    const layer = new OverlayLayer({ layerName: 'T' });
    expect(layer.display.visible).toBe(true);
    expect(layer.display.opacity).toBe(1.0);
    expect(layer.visible).toBe(true);
  });

  it('honors explicit display options', () => {
    const layer = new OverlayLayer({
      layerName: 'T',
      layerDisplay: { visible: false, opacity: 0.3 },
    });
    expect(layer.display.visible).toBe(false);
    expect(layer.display.opacity).toBe(0.3);
    expect(layer.visible).toBe(false);
  });

  it('defaults attribution to the empty string (overlays have no source)', () => {
    const layer = new OverlayLayer({ layerName: 'T' });
    expect(layer.attribution).toBe('');
  });

  it('respects an explicit layerAttribution', () => {
    const layer = new OverlayLayer({
      layerName: 'T',
      layerAttribution: '© Vector Provider',
    });
    expect(layer.attribution).toBe('© Vector Provider');
  });

  it('does not expose a source (Layer.source is optional)', () => {
    const layer = new OverlayLayer({ layerName: 'T' });
    // OverlayLayer currently has no source field; it's typed as optional on Layer.
    expect((layer as unknown as { source?: unknown }).source).toBeUndefined();
  });
});
