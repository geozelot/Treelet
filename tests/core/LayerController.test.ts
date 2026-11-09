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
