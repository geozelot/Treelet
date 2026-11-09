// ============================================================================
// Tests for src/layers/AnalysisLayer.ts
// ============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { AnalysisLayer } from '../../src/layers/AnalysisLayer';
import { registerBuiltinAnalyses } from '../../src/analysis/builtins';

beforeAll(() => registerBuiltinAnalyses());

describe('AnalysisLayer', () => {
  it('takes its name, params, ramp and display defaults from the descriptor', () => {
    const layer = new AnalysisLayer({ analysis: 'hillshade' });
    expect(layer.id).toMatch(/^analysis-\d+$/);
    expect(layer.layerName).toBe('Hillshade');
    expect(layer.params).toEqual({ ambient: 0.45, mode: 'single' });
    expect(layer.ramp).toBeUndefined();
    expect(layer.isValueKind).toBe(false);
    expect(layer.display).toEqual({ visible: true, opacity: 0.6, blendMode: 'multiply' });
    expect(layer.visible).toBe(true);
  });

  it('honors options and validates params and ramps', () => {
    const layer = new AnalysisLayer({
      analysis: 'slope',
      layerName: 'Steepness',
      params: { range: [10, 50] },
      ramp: 'inferno',
      layerDisplay: { visible: false, opacity: 2, blendMode: 'screen' },
    });
    expect(layer.layerName).toBe('Steepness');
    expect(layer.params.range).toEqual([10, 50]);
    expect(layer.ramp).toBe('inferno');
    expect(layer.isValueKind).toBe(true);
    expect(layer.display).toEqual({ visible: false, opacity: 1, blendMode: 'screen' });
    expect(layer.visible).toBe(false);
    expect(() => new AnalysisLayer({ analysis: 'slope', ramp: 'nope' as never })).toThrow(/unknown color ramp/);
  });

  it('setParams merges over the current values', () => {
    const layer = new AnalysisLayer({ analysis: 'contours', params: { interval: 20 } });
    layer.setParams({ thickness: 3 });
    expect(layer.params).toMatchObject({ interval: 20, thickness: 3, index: 0 });
  });

  it('rejects unknown analyses', () => {
    expect(() => new AnalysisLayer({ analysis: 'no_such_kind' })).toThrow(/unknown analysis "no_such_kind"/);
  });
});
