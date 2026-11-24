// ============================================================================
// Tests for src/core/LayerController.ts: analysis layers get their
// view-dependent defaults from the visible elevation range.
// ============================================================================

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { LayerController } from '../../src/core/LayerController';
import { LayerRegistry } from '../../src/layers/LayerRegistry';
import { registerBuiltinAnalyses } from '../../src/analysis/builtins';
import type { TerrainRenderer } from '../../src/terrain/TerrainRenderer';
import type { DisplayController } from '../../src/core/DisplayController';

beforeAll(() => registerBuiltinAnalyses());

function controller(visible: [number, number]) {
  const registry = new LayerRegistry();
  const display = { applyMaterialState: vi.fn() };
  const emit = vi.fn();
  const lc = new LayerController(
    registry, {} as TerrainRenderer, display as unknown as DisplayController, emit, vi.fn(), () => visible,
  );
  return { lc, registry, display, emit };
}

describe('LayerController.addAnalysisLayer', () => {
  it('starts a water level a third of the way up the visible range, on a 10 m step', () => {
    const { lc, registry, display, emit } = controller([1004, 2504]);
    const handle = lc.addAnalysisLayer({ analysis: 'water' });
    expect(registry.getAnalysisLayer(handle)!.params.level).toBe(1450);
    expect(display.applyMaterialState).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('layeradd', { id: handle.id });
    expect(emit).toHaveBeenCalledWith('layerchange', {});
  });

  it("the caller's parameters win over the derived defaults", () => {
    const { lc, registry } = controller([1000, 2500]);
    const handle = lc.addAnalysisLayer({ analysis: 'water', params: { level: 1800, shoreline: 5 } });
    expect(registry.getAnalysisLayer(handle)!.params).toMatchObject({ level: 1800, shoreline: 5 });
  });

  it('kinds without view-dependent defaults are untouched', () => {
    const { lc, registry } = controller([1000, 2500]);
    const handle = lc.addAnalysisLayer({ analysis: 'slope' });
    expect(registry.getAnalysisLayer(handle)!.params).toEqual({ range: [0, 60], aspectMask: null });
  });
});

describe('LayerController.addRasterLayer', () => {
  it("an overlay's fill coat has its owner before it is drawn or announced", () => {
    const registry = new LayerRegistry();
    const owners: Array<string | null> = [];
    const ownerOf = (id: string) => registry.getAnalysisLayer(id)?.owner ?? null;
    const display = { applyMaterialState: vi.fn(() => { for (const l of registry.getAllAnalysisLayers()) owners.push(l.owner); }) };
    const emit = vi.fn((event: string, data: { id?: string }) => { if (event === 'layeradd') owners.push(ownerOf(data.id!)); });
    const terrain = { bindRaster: vi.fn(() => ({ range: null })), releaseRaster: vi.fn() };
    const lc = new LayerController(registry, terrain as unknown as TerrainRenderer, display as unknown as DisplayController, emit, vi.fn(), () => [0, 1]);
    const raster = { width: 1, height: 1, data: new Uint8Array(4), bounds: { west: 0, south: 0, east: 1, north: 1 } };
    lc.addRasterLayer({ analysis: 'image', layerName: 'Fills' }, raster as never, false, 'overlay-1');
    expect(owners.length).toBeGreaterThanOrEqual(2);
    expect(owners.every((o) => o === 'overlay-1')).toBe(true);
  });
});

describe('LayerController: failures leave the stack as it was', () => {
  it('an analysis layer whose material state fails is taken out again', () => {
    const { lc, registry, display, emit } = controller([0, 1000]);
    display.applyMaterialState.mockImplementationOnce(() => { throw new Error('treelet: unknown color ramp "nope"'); });
    expect(() => lc.addAnalysisLayer({ analysis: 'slope' })).toThrow(/unknown color ramp/);
    expect(registry.getStack()).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
    // The next layer works
    lc.addAnalysisLayer({ analysis: 'slope' });
    expect(registry.getStack()).toHaveLength(1);
  });

  it('activating the active drape after hiding it shows it again and reports the change', () => {
    const registry = new LayerRegistry();
    const emit = vi.fn();
    const renderer = { setActiveDrape: vi.fn() } as unknown as TerrainRenderer;
    const display = {
      applyMaterialState: vi.fn(),
      setLayerVisible: vi.fn((id: string, visible: boolean) => {
        const l = registry.getStackLayer(id)!;
        if (l.visible === visible) return false;
        l.visible = visible;
        return true;
      }),
    };
    const lc = new LayerController(registry, renderer, display as unknown as DisplayController, emit, vi.fn());
    const drape = lc.addDrapeLayer({ layerName: 'Ortho', layerSource: { attribution: '' } as never });
    lc.activateDrapeLayer(drape);
    display.setLayerVisible(drape.id, false);
    emit.mockClear();
    lc.activateDrapeLayer(drape);
    expect(registry.getDrapeLayer(drape)!.visible).toBe(true);
    expect(emit).toHaveBeenCalledWith('layerchange', {});
  });
});
