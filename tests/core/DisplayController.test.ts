// ============================================================================
// Tests for src/core/DisplayController.ts: coat display on any drape,
// parameter copies, ramp presets per analysis, the manual sun, and the
// coats handed to the renderer.
// ============================================================================

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DisplayController } from '../../src/core/DisplayController';
import { LayerRegistry } from '../../src/layers/LayerRegistry';
import { registerBuiltinAnalyses } from '../../src/analysis/builtins';
import type { TerrainRenderer } from '../../src/terrain/TerrainRenderer';
import type { SceneManager } from '../../src/scene/SceneManager';
import type { ResolvedTreeletOptions } from '../../src/core/types';
import type { CoatInput } from '../../src/terrain/CoatStack';

beforeAll(() => registerBuiltinAnalyses());

function setup() {
  const registry = new LayerRegistry();
  const renderer = {
    setCoats: vi.fn(),
    drawnCoatIds: vi.fn((): string[] => []),
    setDrapeShown: vi.fn(),
    setSunDirection: vi.fn(),
    rasterSlot: () => -1,
    autoElevationRange: [500, 2500] as [number, number],
  };
  const dc = new DisplayController(renderer as unknown as TerrainRenderer, registry, {} as SceneManager, {} as ResolvedTreeletOptions);
  return { dc, registry, renderer };
}

const drapeOptions = (opacity?: number) => ({
  layerName: 'Ortho',
  layerSource: { attribution: '' } as never,
  layerDisplay: opacity === undefined ? undefined : { opacity },
});

describe('DisplayController', () => {
  it('opacity and blend mode reach a drape that is not active (kept for when it is)', () => {
    const { dc, registry } = setup();
    const h = registry.addDrapeLayer(drapeOptions(0.5));
    expect(dc.getLayerOpacity(h)).toBe(0.5);
    expect(dc.setLayerOpacity(h, 0.3)).toBe(true);
    expect(dc.setLayerOpacity(h, 0.3)).toBe(false); // unchanged
    expect(dc.setLayerBlendMode(h, 'multiply')).toBe(true);
    registry.setActiveDrape(h);
    expect(dc.getLayerOpacity(h)).toBe(0.3);
    expect(dc.getLayerBlendMode(h)).toBe('multiply');
  });

  it('legends are only of the coats drawn (not those outside their zoom range or at opacity 0)', () => {
    const { dc, registry, renderer } = setup();
    const a = registry.addAnalysisLayer({ analysis: 'elevation' });
    const b = registry.addAnalysisLayer({ analysis: 'slope', minZoom: 12 });
    renderer.drawnCoatIds.mockReturnValue([a.id]);
    expect(dc.getLegends().map((l) => l.id)).toEqual([a.id]);
    renderer.drawnCoatIds.mockReturnValue([a.id, b.id]);
    expect(dc.getLegends().map((l) => l.id)).toEqual([b.id, a.id]);
  });

  it('getAnalysisParams hands out a copy', () => {
    const { dc, registry } = setup();
    const h = registry.addAnalysisLayer({ analysis: 'slope' });
    const p = dc.getAnalysisParams(h) as { range: [number, number] };
    p.range[0] = 30;
    expect((dc.getAnalysisParams(h) as { range: [number, number] }).range).toEqual([0, 60]);
  });

  it('refuses a class preset made for another analysis', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { dc, registry } = setup();
    const elevation = registry.addAnalysisLayer({ analysis: 'elevation' });
    expect(dc.setAnalysisRamp(elevation, 'avalanche')).toBe(false);
    const slope = registry.addAnalysisLayer({ analysis: 'slope' });
    expect(dc.setAnalysisRamp(slope, 'avalanche')).toBe(true);
    // At creation the preset falls back to the kind's own ramp
    const other = registry.addAnalysisLayer({ analysis: 'elevation', ramp: 'aspect8' });
    expect(registry.getAnalysisLayer(other)!.ramp).toBe('hypsometric');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('an unknown blend mode from 0.3 (hillshade) is reported and drawn as normal', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { registry } = setup();
    const h = registry.addDrapeLayer({ ...drapeOptions(), layerDisplay: { blendMode: 'hillshade' as never } });
    expect(registry.getDrapeLayer(h)!.display.blendMode).toBe('normal');
    expect(warn.mock.calls[0][0]).toMatch(/hillshade coat/);
    warn.mockRestore();
  });

  it('the manual sun comes back after a date put the sun below the horizon', () => {
    const { dc } = setup();
    dc.setSunAzimuth(300);
    dc.setSunAltitude(35);
    dc.setSunPosition(120, -8); // from a date
    expect(dc.getSunAltitude()).toBe(-8);
    dc.restoreManualSun();
    expect([dc.getSunAzimuth(), dc.getSunAltitude()]).toEqual([300, 35]);
  });

  it('hands the renderer coats with zoom ranges, shadow flags and domains of the live range', () => {
    const { dc, registry, renderer } = setup();
    registry.addAnalysisLayer({ analysis: 'elevation', params: { range: 'auto' }, minZoom: 8, maxZoom: 14 });
    registry.addAnalysisLayer({ analysis: 'shadows' });
    dc.applyMaterialState();
    const coats = renderer.setCoats.mock.calls.at(-1)![0] as CoatInput[];
    const elevation = coats.find((c) => c.ramp !== null)!;
    expect([elevation.minZoom, elevation.maxZoom]).toEqual([8, 14]);
    expect(typeof elevation.domain).toBe('function');
    expect((elevation.domain as (v: [number, number]) => [number, number])([100, 900])).toEqual([100, 900]);
    expect(coats.some((c) => c.shadowMap)).toBe(true);
    // No drape: imagery isn't fetched
    expect(renderer.setDrapeShown).toHaveBeenLastCalledWith(false);
    // The legend domain uses the current visible range
    const legend = dc.getLegend(registry.getStack().find((l) => 'descriptor' in l && l.descriptor.id === 'elevation')!.id)!;
    expect(legend.domain).toEqual([500, 2500]);
  });
});

describe('DisplayController: coats owned by an overlay', () => {
  it('draw with their overlay: shown, in its zoom range, at its opacity', () => {
    const { dc, registry, renderer } = setup();
    const overlay = registry.addOverlayLayer({ layerName: 'Parcels', data: null, minZoom: 12, maxZoom: 16, layerDisplay: { opacity: 0.5 } } as never);
    const fill = registry.addAnalysisLayer({ analysis: 'image' } as never);
    registry.getAnalysisLayer(fill)!.owner = overlay.id;
    dc.applyMaterialState();
    let coat = (renderer.setCoats.mock.calls.at(-1)![0] as CoatInput[]).find((c) => c.id === fill.id)!;
    expect([coat.minZoom, coat.maxZoom, coat.opacity]).toEqual([12, 16, 0.5]);
    registry.getOverlayLayer(overlay)!.visible = false;
    dc.applyMaterialState();
    coat = (renderer.setCoats.mock.calls.at(-1)![0] as CoatInput[]).find((c) => c.id === fill.id)!;
    expect(coat).toBeUndefined();
  });
});
