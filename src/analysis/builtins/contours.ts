// treelet.js - Contour lines from the per-fragment elevation.

import type { AnalysisDescriptor, RGB } from '../types';

export interface ContoursParams extends Record<string, unknown> {
  /** Line spacing in meters. */
  interval: number;
  /** Line width in pixels. */
  thickness: number;
  /** Every Nth line is drawn bolder (0 = off). */
  index: number;
  color: RGB;
}

export const CONTOUR_COLORS: Array<{ label: string; color: RGB }> = [
  { label: 'brown', color: [0.12, 0.08, 0.04] },
  { label: 'black', color: [0, 0, 0] },
  { label: 'white', color: [1, 1, 1] },
  { label: 'red', color: [0.8, 0.15, 0.1] },
  { label: 'blue', color: [0.1, 0.3, 0.7] },
  { label: 'gray', color: [0.45, 0.45, 0.45] },
];

export const contours: AnalysisDescriptor<ContoursParams> = {
  id: 'contours',
  label: 'Contours',
  glsl: /* glsl */ `
vec4 analysis_contours(Surface s, vec4 p0, vec4 p1) {
  float interval = max(p0.x, 1e-3);
  float scaled = s.h / interval;
  float d = fract(scaled);
  float dist = min(d, 1.0 - d);
  float thick = p0.y;
  if (p0.z >= 2.0) {
    // Index contours: every Nth line bolder. Line k is an index line when it
    // lies within half a line of a multiple of N; unlike mod(k, N), whose
    // k / N may round one ulp low on some GPUs and give N instead of 0, this
    // holds for any rounding of the division.
    float k = floor(scaled + 0.5);
    float rest = k - p0.z * floor(k / p0.z + 0.5);
    thick *= abs(rest) < 0.5 ? 1.8 : 1.0;
  }
  // Guard a zero derivative on perfectly flat terrain (edge0 == edge1 is undefined).
  float line = 1.0 - smoothstep(0.0, max(thick * s.fw / interval, 1e-5), dist);
  return vec4(p1.rgb, line);
}`,
  params: [
    { key: 'interval', label: 'Interval', type: 'range', min: 10, max: 500, step: 10, unit: 'm', limits: [0.01, Infinity] },
    { key: 'thickness', label: 'Thickness', type: 'range', min: 0.5, max: 4, step: 0.1, limits: [0, 20] },
    { key: 'index', label: 'Index lines', type: 'select', options: [
      { value: '0', label: 'Off' }, { value: '2', label: '2nd' }, { value: '4', label: '4th' },
      { value: '5', label: '5th' }, { value: '10', label: '10th' },
    ] },
    { key: 'color', label: 'Line color', type: 'color', presets: CONTOUR_COLORS },
  ],
  defaults: { interval: 100, thickness: 1.5, index: 0, color: [0.12, 0.08, 0.04] },
  opacity: 0.75,
  pack: (p) => ({ p0: [p.interval, p.thickness, Number(p.index), 0], p1: [p.color[0], p.color[1], p.color[2], 0] }),
};
