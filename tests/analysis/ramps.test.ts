// ============================================================================
// Tests for src/analysis/ramps.ts: ramp resolution, sampling, texture rows,
// legends and CSS previews. The built-in stops must reproduce the colors the
// 0.3 GLSL ramps produced.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  BUILTIN_RAMPS,
  resolveRamp,
  validateRamp,
  continuousColorAt,
  classIndexOf,
  rampColorAt,
  writeRampRow,
  rampGradientCss,
  legendFor,
  cssColor,
  rampNamesFor,
  RAMP_WIDTH,
} from '../../src/analysis/ramps';
import type { ClassRamp, ContinuousRamp } from '../../src/analysis/types';

const close = (a: number[], b: number[], eps = 0.01) => b.every((v, i) => Math.abs(v - a[i]) < eps);

describe('built-in ramps', () => {
  it('match the former GLSL ramps at their stops', () => {
    expect(close(continuousColorAt(BUILTIN_RAMPS.viridis, 0.5), [0.127, 0.566, 0.551])).toBe(true);
    expect(close(continuousColorAt(BUILTIN_RAMPS.inferno, 1), [0.988, 0.998, 0.645])).toBe(true);
    expect(close(continuousColorAt(BUILTIN_RAMPS.hypsometric, 0.2), [0.62, 0.72, 0.32])).toBe(true);
    expect(close(continuousColorAt(BUILTIN_RAMPS.grayscale, 0.25), [0.25, 0.25, 0.25])).toBe(true);
  });

  it('interpolate linearly between stops and clamp outside [0, 1]', () => {
    expect(close(continuousColorAt(BUILTIN_RAMPS.viridis, 0.125), [0.2745, 0.072, 0.3935])).toBe(true);
    expect(continuousColorAt(BUILTIN_RAMPS.grayscale, -1)).toEqual([0, 0, 0, 1]);
    expect(continuousColorAt(BUILTIN_RAMPS.grayscale, 2)).toEqual([1, 1, 1, 1]);
  });

  it('cyclic has no seam: t = 0 and t = 1 give the same color', () => {
    expect(close(continuousColorAt(BUILTIN_RAMPS.cyclic, 0), continuousColorAt(BUILTIN_RAMPS.cyclic, 1))).toBe(true);
    // 0.55 + 0.4·cos(2π·t + phase) at t = 0
    expect(close(continuousColorAt(BUILTIN_RAMPS.cyclic, 0), [0.95, 0.35, 0.35])).toBe(true);
  });

  it('resolveRamp accepts names and specs, rejects unknown names and bad specs', () => {
    expect(resolveRamp('viridis')).toBe(BUILTIN_RAMPS.viridis);
    const spec: ContinuousRamp = { type: 'continuous', stops: [[0, [0, 0, 0]], [1, [1, 1, 1]]] };
    expect(resolveRamp(spec)).toBe(spec);
    expect(() => resolveRamp('plasma' as never)).toThrow(/unknown color ramp/);
    expect(() => validateRamp({ type: 'continuous', stops: [] })).toThrow(/at least one stop/);
    expect(() => validateRamp({ type: 'continuous', stops: [[1, [0, 0, 0]], [0, [1, 1, 1]]] })).toThrow(/ascending/);
    expect(() => validateRamp({ type: 'classes', breaks: [30, 35], colors: [[0, 0, 0]] })).toThrow(/breaks.length \+ 1/);
    expect(() => validateRamp({ type: 'classes', breaks: [35, 30], colors: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] })).toThrow(/ascending/);
  });
});

const avalanche: ClassRamp = {
  type: 'classes',
  breaks: [30, 35, 40, 45],
  colors: [[0.9, 0.9, 0.9], [1, 1, 0], [1, 0.6, 0], [1, 0, 0], [0.5, 0, 0.5]],
};

describe('class ramps', () => {
  it('classIndexOf puts values at a break into the upper class', () => {
    expect(classIndexOf(avalanche, 10)).toBe(0);
    expect(classIndexOf(avalanche, 30)).toBe(1);
    expect(classIndexOf(avalanche, 34.9)).toBe(1);
    expect(classIndexOf(avalanche, 45)).toBe(4);
    expect(classIndexOf(avalanche, 80)).toBe(4);
  });

  it('rampColorAt places the breaks on the domain', () => {
    // t = 0.5 over [0, 60] is 30°: the second class
    expect(rampColorAt(avalanche, 0.5, [0, 60])).toEqual([1, 1, 0, 1]);
    expect(rampColorAt(avalanche, 0.49, [0, 60])).toEqual([0.9, 0.9, 0.9, 1]);
    expect(rampColorAt(avalanche, 1, [0, 60])).toEqual([0.5, 0, 0.5, 1]);
  });

  it('legendFor labels classes with their bounds and the unit, or custom labels', () => {
    const legend = legendFor('x', 'Slope', avalanche, [0, 60], '°');
    expect(legend.type).toBe('classes');
    expect(legend.classes!.map((c) => c.label)).toEqual(['< 30°', '30–35°', '35–40°', '40–45°', '≥ 45°']);
    const labelled = legendFor('x', 'Slope', { ...avalanche, labels: ['flat', 'a', 'b', 'c', 'extreme'] }, [0, 60]);
    expect(labelled.classes![0].label).toBe('flat');
    expect(labelled.classes![4].label).toBe('extreme');
  });

  it('legendFor returns stops and the domain for continuous ramps', () => {
    const legend = legendFor('x', 'Elevation', BUILTIN_RAMPS.grayscale, [100, 3000], 'm');
    expect(legend.type).toBe('continuous');
    expect(legend.domain).toEqual([100, 3000]);
    expect(legend.stops).toEqual([[0, [0, 0, 0, 1]], [1, [1, 1, 1, 1]]]);
    expect(legend.unit).toBe('m');
  });
});

describe('ramp texture rows', () => {
  it('writeRampRow fills RGBA8 texels from the domain low (x = 0) to high', () => {
    const out = new Uint8Array(RAMP_WIDTH * 4 * 2);
    writeRampRow(out, RAMP_WIDTH * 4, RAMP_WIDTH, BUILTIN_RAMPS.grayscale, [0, 1]);
    // Row 0 untouched
    expect(out[0]).toBe(0);
    expect(out[3]).toBe(0);
    // Row 1: black → white, opaque
    const row = RAMP_WIDTH * 4;
    expect([out[row], out[row + 3]]).toEqual([0, 255]);
    const last = row + (RAMP_WIDTH - 1) * 4;
    expect([out[last], out[last + 1], out[last + 2], out[last + 3]]).toEqual([255, 255, 255, 255]);
    const mid = row + Math.floor(RAMP_WIDTH / 2) * 4;
    expect(Math.abs(out[mid] - 128)).toBeLessThanOrEqual(1);
  });

  it('class rows step at the breaks', () => {
    const out = new Uint8Array(RAMP_WIDTH * 4);
    writeRampRow(out, 0, RAMP_WIDTH, avalanche, [0, 60]);
    const texel = (deg: number) => Math.round((deg / 60) * (RAMP_WIDTH - 1)) * 4;
    expect(out[texel(20)]).toBe(Math.round(0.9 * 255));
    expect([out[texel(31)], out[texel(31) + 1], out[texel(31) + 2]]).toEqual([255, 255, 0]);
    expect([out[texel(59)], out[texel(59) + 1], out[texel(59) + 2]]).toEqual([128, 0, 128]);
  });
});

describe('rampGradientCss', () => {
  it('renders continuous stops as a gradient and classes as hard stops', () => {
    expect(rampGradientCss(BUILTIN_RAMPS.grayscale, [0, 1])).toBe('linear-gradient(to right, #000000 0.0%, #ffffff 100.0%)');
    const css = rampGradientCss(avalanche, [0, 60]);
    expect(css.startsWith('linear-gradient(to right, #e6e6e6 0.0% 50.0%, #ffff00 50.0% 58.3%')).toBe(true);
    expect(css.endsWith('#800080 75.0% 100.0%)')).toBe(true);
  });
});

describe('alpha and presets', () => {
  it('ramp colors may carry alpha: rows, sampling and CSS follow it', () => {
    const spec: ClassRamp = { type: 'classes', breaks: [30], colors: [[0, 0, 0, 0], [1, 0, 0]] };
    expect(rampColorAt(spec, 0.2, [0, 60])).toEqual([0, 0, 0, 0]);
    expect(rampColorAt(spec, 0.8, [0, 60])).toEqual([1, 0, 0, 1]);
    const out = new Uint8Array(RAMP_WIDTH * 4);
    writeRampRow(out, 0, RAMP_WIDTH, spec, [0, 60]);
    expect(out[3]).toBe(0);
    expect(out[(RAMP_WIDTH - 1) * 4 + 3]).toBe(255);
    expect(cssColor([1, 0, 0, 0.5])).toBe('rgba(255, 0, 0, 0.5)');
    expect(cssColor([1, 0, 0])).toBe('#ff0000');
    const fade: ContinuousRamp = { type: 'continuous', stops: [[0, [0, 0, 0, 0]], [1, [0, 0, 0, 1]]] };
    expect(continuousColorAt(fade, 0.25)[3]).toBeCloseTo(0.25, 9);
  });

  it('the avalanche preset draws nothing below 30° and its legend lists the four classes', () => {
    const ramp = resolveRamp('avalanche') as ClassRamp;
    expect(ramp.breaks).toEqual([30, 35, 40, 45]);
    expect(rampColorAt(ramp, 20 / 60, [0, 60])[3]).toBe(0);
    expect(rampColorAt(ramp, 50 / 60, [0, 60])[3]).toBe(1);
    const legend = legendFor('s', 'Slope', ramp, [0, 60], '°');
    expect(legend.classes!.map((c) => c.label)).toEqual(['30–35°', '35–40°', '40–45°', '≥ 45°']);
  });

  it('the aspect8 preset wraps north around 0°/360° and lists it once', () => {
    const ramp = resolveRamp('aspect8') as ClassRamp;
    expect(rampColorAt(ramp, 5 / 360, [0, 360])).toEqual(rampColorAt(ramp, 355 / 360, [0, 360]));
    const legend = legendFor('a', 'Aspect', ramp, [0, 360], '°');
    expect(legend.classes!.map((c) => c.label)).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
  });

  it('rampNamesFor offers class presets only to their analysis', () => {
    expect(rampNamesFor('slope')).toContain('avalanche');
    expect(rampNamesFor('slope')).not.toContain('aspect8');
    expect(rampNamesFor('aspect')).toContain('aspect8');
    expect(rampNamesFor('elevation')).toEqual(['hypsometric', 'viridis', 'inferno', 'grayscale', 'cyclic', 'diverging']);
  });
});
