// ============================================================================
// treelet.js - Overlay styles
//
// Resolves a style (object or function of the feature) into concrete values
// for one feature, parsing CSS colors.
// ============================================================================

import { Color } from 'three';
import type { RGB } from '../analysis/types';
import type { ColorValue, Feature, OverlayStyleSpec, ResolvedStyle } from './types';

export const DEFAULT_OVERLAY_COLOR = '#ff6a00';

const scratch = new Color();
const warned = new Set<string>();

/** [r, g, b] in 0–1 (sRGB) of a CSS color or RGB triple; `fallback` when it can't be parsed. */
export function parseColor(value: ColorValue | null | undefined, fallback: RGB): RGB {
  if (Array.isArray(value)) {
    if (value.length >= 3 && value.slice(0, 3).every((v) => typeof v === 'number' && Number.isFinite(v))) {
      return [value[0], value[1], value[2]];
    }
  } else if (typeof value === 'string' && value.trim()) {
    const key = value.trim();
    const names = (Color as unknown as { NAMES: Record<string, number> }).NAMES;
    const isName = /^[a-z]+$/i.test(key);
    if (!isName || key.toLowerCase() in names) {
      // three leaves the color unchanged when it can't parse: start from NaN to tell.
      // CSS colors are kept as plain sRGB numbers (the coats work in sRGB too).
      scratch.setRGB(NaN, NaN, NaN);
      try {
        scratch.setStyle(key, 'srgb-linear' as never);
      } catch { /* not a color */ }
      if (Number.isFinite(scratch.r) && Number.isFinite(scratch.g) && Number.isFinite(scratch.b)) {
        return [scratch.r, scratch.g, scratch.b];
      }
    }
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`treelet: unknown color "${key}"`);
    }
  }
  return [fallback[0], fallback[1], fallback[2]];
}

/** CSS rgb() of a color value. */
export function cssOf(c: RGB): string {
  const v = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
  return `rgb(${v(c[0])}, ${v(c[1])}, ${v(c[2])})`;
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
}

/** Concrete style values for one feature. */
export function resolveStyle(spec: OverlayStyleSpec | undefined, feature: Feature): ResolvedStyle {
  let s = spec;
  if (typeof s === 'function') {
    try {
      s = s(feature);
    } catch (err) {
      console.warn('treelet: overlay style function failed:', err);
      s = {};
    }
  }
  const style = s ?? {};
  const base = parseColor(style.color, parseColor(DEFAULT_OVERLAY_COLOR, [1, 0.4, 0]));
  const opacity = num(style.opacity, 1, 0, 1);
  let label: string | null = null;
  const props = feature.properties ?? {};
  if (typeof style.label === 'function') {
    try {
      const v = style.label(props);
      if (v !== null && v !== undefined && String(v) !== '') label = String(v);
    } catch (err) {
      console.warn('treelet: overlay label function failed:', err);
    }
  } else if (typeof style.label === 'string') {
    const v = props[style.label];
    if (v !== null && v !== undefined && String(v) !== '') label = String(v);
  }
  return {
    lineColor: parseColor(style.lineColor, base),
    lineWidth: num(style.lineWidth, 2.5, 0.5, 64),
    lineOpacity: opacity,
    fillColor: style.fillColor === null ? null : parseColor(style.fillColor, base),
    fillOpacity: num(style.fillOpacity, 0.3, 0, 1),
    pointColor: parseColor(style.pointColor, base),
    pointRadius: num(style.pointRadius, 5, 0.5, 64),
    pointStroke: parseColor(style.pointStroke, [1, 1, 1]),
    pointStrokeWidth: num(style.pointStrokeWidth, 1.5, 0, 32),
    pointOpacity: opacity,
    label,
    labelColor: style.labelColor ?? '#1b1b1b',
    labelHalo: style.labelHalo ?? 'rgba(255, 255, 255, 0.9)',
    labelSize: num(style.labelSize, 12, 6, 48),
  };
}
