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
    const ids = listAnalyses().slice(0, 7).map((d) => d.id);
    expect(ids).toEqual(['elevation', 'slope', 'aspect', 'contours', 'hillshade', 'curvature', 'water']);
    expect(analysisKind('elevation')).toBe(IMAGERY_KIND + 1);
    expect(analysisKind('hillshade')).toBe(IMAGERY_KIND + 5);
    expect(analysisKind('water')).toBe(IMAGERY_KIND + 7);
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
    // Limits, not the slider range: a 5 km or 5 m interval is fine, a negative thickness is not
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveParams(d, { interval: 5000 }).interval).toBe(5000);
    expect(resolveParams(d, { interval: 5 }).interval).toBe(5);
    expect(resolveParams(d, { thickness: -1 }).thickness).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
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

describe('resolveParams: optional and wrapping spans', () => {
  let slope: AnalysisDescriptor<object>;
  beforeAll(() => { slope = getAnalysis('slope')!; });

  it('accepts null for an optional span and rejects it elsewhere', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveParams(slope, { aspectMask: null }).aspectMask).toBeNull();
    expect(resolveParams(slope, { range: null as never }).range).toEqual([0, 60]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps the order of a wrapping span (clockwise through north) and reduces it into one turn', () => {
    expect(resolveParams(slope, { aspectMask: [315, 45] }).aspectMask).toEqual([315, 45]);
    // Clockwise from 40° to 350° (not clamped to an empty sector)
    expect(resolveParams(slope, { aspectMask: [400, -10] }).aspectMask).toEqual([40, 350]);
    // North-west through north-east keeps both halves
    expect(resolveParams(slope, { aspectMask: [-45, 45] }).aspectMask).toEqual([315, 45]);
    // A whole turn or more is every bearing
    expect(resolveParams(slope, { aspectMask: [0, 360] }).aspectMask).toEqual([0, 360]);
    expect(resolveParams(slope, { aspectMask: [-180, 200] }).aspectMask).toEqual([0, 360]);
    expect(resolveParams(slope, { range: [50, 10] }).range).toEqual([10, 50]);
  });

  it('clamps to the limits, not to the slider range, and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const contours = getAnalysis('contours')!;
    const elevation = getAnalysis('elevation')!;
    // Bathymetry beyond the slider range is kept
    expect(resolveParams(elevation, { range: [-11000, 0] }).range).toEqual([-11000, 0]);
    expect(warn).not.toHaveBeenCalled();
    // Slope stays within 0–90°
    expect(resolveParams(slope, { range: [-5, 120] }).range).toEqual([0, 90]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(contours).toBeDefined();
    warn.mockRestore();
  });

  it('copies array defaults, so no layer shares (or can change) them', () => {
    const a = resolveParams(slope, {}) as { range: [number, number] };
    a.range[0] = 30;
    const b = resolveParams(slope, {}) as { range: [number, number] };
    expect(b.range).toEqual([0, 60]);
    expect((slope.defaults as { range: [number, number] }).range).toEqual([0, 60]);
  });

  it('slope packs the aspect mask into p0.zw with a flag in p1.x', () => {
    const params = resolveParams(slope, { aspectMask: [315, 45] }) as { range: [number, number]; aspectMask: [number, number] | null };
    expect(slope.pack(params, [0, 60])).toEqual({ p0: [0, 60, 315, 45], p1: [1, 0, 0, 0] });
    expect(slope.pack(resolveParams(slope, {}) as never, [0, 60])).toEqual({ p0: [0, 60, 0, 360], p1: [0, 0, 0, 0] });
  });

  it('water packs level, depth fade, shoreline and color; curvature its mode', () => {
    const water = getAnalysis('water')!;
    expect(water.pack(water.defaults, [0, 1]).p0).toEqual([500, 100, 2, 0]);
    expect(water.initialParams!([1000, 2000])).toEqual({ level: 1300 });
    const curvature = getAnalysis('curvature')!;
    expect(curvature.pack(resolveParams(curvature, { mode: 'plan' }), [-20, 20])).toEqual({ p0: [-20, 20, 0, 0], p1: [1, 0, 0, 0] });
    expect(curvature.pack(curvature.defaults, [-20, 20]).p1[0]).toBe(2);
    const src = analysisShaderSource();
    expect(src).toContain('analysis_water(Surface s');
    expect(src).toContain('analysis_curvature(Surface s');
  });
});
