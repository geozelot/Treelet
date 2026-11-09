// ============================================================================
// Tests for src/analysis/registry.ts: registration rules, the generated
// shader dispatcher and parameter resolution against a schema.
// ============================================================================

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import {
  registerAnalysis,
  getAnalysis,
  listAnalyses,
  analysisKind,
  analysisVersion,
  analysisShaderSource,
  onAnalysisRegistered,
  resolveParams,
  IMAGERY_KIND,
} from '../../src/analysis/registry';
import { registerBuiltinAnalyses, slopeDegrees, aspectDegrees } from '../../src/analysis/builtins';
import type { AnalysisDescriptor } from '../../src/analysis/types';

beforeAll(() => registerBuiltinAnalyses());
afterEach(() => vi.restoreAllMocks());

const minimal = (id: string): AnalysisDescriptor<{ k: number }> => ({
  id,
  label: id,
  glsl: `vec4 analysis_${id}(Surface s, vec4 p0, vec4 p1) { return vec4(p0.x, 0.0, 0.0, 1.0); }`,
  params: [{ key: 'k', label: 'K', type: 'range', min: 0, max: 10, step: 1 }],
  defaults: { k: 1 },
  pack: (p) => ({ p0: [p.k, 0, 0, 0], p1: [0, 0, 0, 0] }),
});

describe('registerAnalysis', () => {
  it('registers the built-ins once, in panel order, with kinds after imagery', () => {
    const ids = listAnalyses().slice(0, 5).map((d) => d.id);
    expect(ids).toEqual(['elevation', 'slope', 'aspect', 'contours', 'hillshade']);
    expect(analysisKind('elevation')).toBe(IMAGERY_KIND + 1);
    expect(analysisKind('hillshade')).toBe(IMAGERY_KIND + 5);
    const before = analysisVersion();
    registerBuiltinAnalyses();
    expect(analysisVersion()).toBe(before);
  });

  it('rejects bad ids, duplicates and GLSL without the entry function', () => {
    expect(() => registerAnalysis({ ...minimal('ok_id'), id: 'Bad-Id' })).toThrow(/must match/);
    expect(() => registerAnalysis(minimal('slope'))).toThrow(/already registered/);
    expect(() => registerAnalysis({ ...minimal('nofn'), glsl: 'void nothing() {}' })).toThrow(/must define analysis_nofn/);
    expect(() => analysisKind('nofn')).toThrow(/unknown analysis/);
  });

  it('notifies listeners and bumps the version; the shader source gains a case', () => {
    const listener = vi.fn();
    const off = onAnalysisRegistered(listener);
    const before = analysisVersion();
    registerAnalysis(minimal('custom_one'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(analysisVersion()).toBe(before + 1);
    expect(getAnalysis('custom_one')?.label).toBe('custom_one');
    const src = analysisShaderSource();
    expect(src).toContain('vec4 analysis_custom_one(Surface s, vec4 p0, vec4 p1)');
    expect(src).toContain(`if (kind == ${analysisKind('custom_one')}) return analysis_custom_one(s, p0, p1);`);
    expect(src).toContain('vec4 evalAnalysis(int kind, Surface s, vec4 p0, vec4 p1)');
    off();
    registerAnalysis(minimal('custom_two'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('resolveParams', () => {
  it('starts from the defaults and clamps ranges', () => {
    const d = getAnalysis('contours')!;
    expect(resolveParams(d, undefined)).toEqual(d.defaults);
    expect(resolveParams(d, { interval: 5000 }).interval).toBe(500);
    expect(resolveParams(d, { thickness: -1 }).thickness).toBe(0.5);
  });

  it('merges over a base and leaves unknown keys alone', () => {
    const d = getAnalysis('contours')!;
    const base = resolveParams(d, { interval: 50 });
    const next = resolveParams(d, { thickness: 2, extra: 'kept' }, base);
    expect(next.interval).toBe(50);
    expect(next.thickness).toBe(2);
    expect(next.extra).toBe('kept');
  });

  it('spans: accept pairs, order them, allow auto only where the schema does', () => {
    const elevation = getAnalysis('elevation')!;
    expect(resolveParams(elevation, { range: 'auto' }).range).toBe('auto');
    expect(resolveParams(elevation, { range: [3000, 1000] }).range).toEqual([1000, 3000]);
    expect(resolveParams(elevation, { range: [100, 100] }).range).toEqual([100, 110]);
    const slope = getAnalysis('slope')!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveParams(slope, { range: 'auto' }).range).toEqual([0, 60]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('selects keep numbers numeric; colors and booleans are type-checked', () => {
    const d = getAnalysis('contours')!;
    expect(resolveParams(d, { index: 5 }).index).toBe(5);
    expect(resolveParams(d, { index: '10' }).index).toBe(10);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveParams(d, { index: 3 }).index).toBe(0);
    expect(resolveParams(d, { color: [1, 0, 0] }).color).toEqual([1, 0, 0]);
    expect(resolveParams(d, { color: 'red' }).color).toEqual([0.12, 0.08, 0.04]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('built-in CPU twins', () => {
  it('slope and aspect from a normal', () => {
    expect(slopeDegrees({ h: 0, n: [0, 0, 1] })).toBe(0);
    expect(slopeDegrees({ h: 0, n: [Math.SQRT1_2, 0, Math.SQRT1_2] })).toBeCloseTo(45, 6);
    // Normal tilting east → downslope east → aspect 90°
    expect(aspectDegrees({ h: 0, n: [Math.SQRT1_2, 0, Math.SQRT1_2] })).toBeCloseTo(90, 6);
    expect(aspectDegrees({ h: 0, n: [0, -0.5, 0.866] })).toBeCloseTo(180, 6);
    expect(aspectDegrees({ h: 0, n: [0, 0, 1] })).toBeNaN();
  });

  it('descriptor packing: elevation follows the auto domain, contours pack their color', () => {
    const elevation = getAnalysis('elevation')!;
    const auto: [number, number] = [500, 2500];
    expect(elevation.domain!({ range: 'auto' }, auto)).toBe(auto);
    expect(elevation.domain!({ range: [0, 100] }, auto)).toEqual([0, 100]);
    expect(elevation.pack({ range: 'auto' }, auto).p0).toEqual([500, 2500, 0, 0]);
    const contours = getAnalysis('contours')!;
    const packed = contours.pack({ interval: 50, thickness: 2, index: 5, color: [1, 0, 0] }, [0, 1]);
    expect(packed.p0).toEqual([50, 2, 5, 0]);
    expect(packed.p1).toEqual([1, 0, 0, 0]);
  });
});
