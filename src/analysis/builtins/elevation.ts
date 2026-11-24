// treelet.js - Elevation analysis: height mapped over a range (or the visible data's range).

import type { AnalysisDescriptor } from '../types';

export interface ElevationParams extends Record<string, unknown> {
  /** Ramp range in meters, or 'auto' to fit the visible tiles' data. */
  range: [number, number] | 'auto';
}

export const elevation: AnalysisDescriptor<ElevationParams> = {
  id: 'elevation',
  label: 'Elevation',
  unit: 'm',
  glsl: /* glsl */ `
vec4 analysis_elevation(Surface s, vec4 p0, vec4 p1) {
  float t = (s.h - p0.x) / max(p0.y - p0.x, 1e-3);
  return vec4(t, 0.0, 0.0, 1.0);
}`,
  params: [
    { key: 'range', label: 'Range', type: 'span', min: -500, max: 9000, step: 10, unit: 'm', auto: true, limits: [-Infinity, Infinity] },
  ],
  defaults: { range: [0, 4000] },
  ramp: 'hypsometric',
  domain: (p, auto) => (p.range === 'auto' ? auto : p.range),
  pack: (_p, domain) => ({ p0: [domain[0], domain[1], 0, 0], p1: [0, 0, 0, 0] }),
  cpu: (s) => s.h,
};
