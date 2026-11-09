// treelet.js - Water level: fills the terrain below a level with water that
// darkens with depth and fades out along the shoreline.

import type { AnalysisDescriptor, RGB } from '../types';

export interface WaterParams extends Record<string, unknown> {
  /** Water surface elevation in meters. */
  level: number;
  color: RGB;
  /** Depth in meters over which the water darkens to its deep tone (0 = flat color). */
  depthFade: number;
  /** Width in meters of the fade along the shoreline. */
  shoreline: number;
}

export const WATER_COLORS: Array<{ label: string; color: RGB }> = [
  { label: 'lake', color: [0.14, 0.44, 0.70] },
  { label: 'sea', color: [0.06, 0.26, 0.52] },
  { label: 'teal', color: [0.10, 0.56, 0.60] },
  { label: 'ice', color: [0.62, 0.80, 0.94] },
];

/** Depth below the level in meters (negative above it). */
export function waterDepth(h: number, p: WaterParams): number {
  return p.level - h;
}

export const water: AnalysisDescriptor<WaterParams> = {
  id: 'water',
  label: 'Water level',
  glsl: /* glsl */ `
vec4 analysis_water(Surface s, vec4 p0, vec4 p1) {
  float depth = p0.x - s.h;
  float shore = max(p0.z, 1e-3);
  float a = smoothstep(0.0, shore, depth);
  float deep = p0.y > 0.0 ? clamp(depth / p0.y, 0.0, 1.0) : 0.0;
  vec3 color = p1.rgb * (1.0 - 0.55 * deep);
  return vec4(color, a);
}`,
  params: [
    { key: 'level', label: 'Level', type: 'range', min: -500, max: 9000, step: 1, unit: 'm', bounds: 'elevation', limits: [-Infinity, Infinity] },
    { key: 'depthFade', label: 'Depth shading', type: 'range', min: 0, max: 500, step: 5, unit: 'm', limits: [0, Infinity] },
    { key: 'shoreline', label: 'Shore fade', type: 'range', min: 0, max: 50, step: 0.5, unit: 'm', limits: [0, Infinity] },
    { key: 'color', label: 'Color', type: 'color', presets: WATER_COLORS },
  ],
  defaults: { level: 500, color: [0.14, 0.44, 0.70], depthFade: 100, shoreline: 2 },
  opacity: 0.85,
  pack: (p) => ({ p0: [p.level, p.depthFade, p.shoreline, 0], p1: [p.color[0], p.color[1], p.color[2], 0] }),
  // Start inside the view: a third of the way up the visible range, on a 10 m step
  initialParams: ([lo, hi]) => ({ level: Math.round((lo + 0.3 * (hi - lo)) / 10) * 10 }),
};
