// treelet.js - Slope analysis: steepness in degrees mapped over a range.

import type { AnalysisDescriptor, SurfaceSample } from '../types';

export interface SlopeParams extends Record<string, unknown> {
  /** Ramp range in degrees. */
  range: [number, number];
}

export function slopeDegrees(s: SurfaceSample): number {
  return (Math.acos(Math.max(0, Math.min(1, s.n[2]))) * 180) / Math.PI;
}

export const slope: AnalysisDescriptor<SlopeParams> = {
  id: 'slope',
  label: 'Slope',
  unit: '°',
  glsl: /* glsl */ `
vec4 analysis_slope(Surface s, vec4 p0, vec4 p1) {
  float slopeDeg = degrees(acos(clamp(s.n.z, 0.0, 1.0)));
  float t = (slopeDeg - p0.x) / max(p0.y - p0.x, 1e-3);
  return vec4(t, 0.0, 0.0, 1.0);
}`,
  params: [
    { key: 'range', label: 'Range', type: 'span', min: 0, max: 90, step: 1, unit: '°' },
  ],
  defaults: { range: [0, 60] },
  ramp: 'viridis',
  domain: (p) => p.range,
  pack: (_p, domain) => ({ p0: [domain[0], domain[1], 0, 0], p1: [0, 0, 0, 0] }),
  cpu: slopeDegrees,
};
