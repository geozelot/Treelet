// treelet.js - Aspect analysis: compass bearing of the downslope direction.

import type { AnalysisDescriptor, SurfaceSample } from '../types';

export type AspectParams = Record<string, never>;

/** Downslope bearing in degrees, clockwise from north; NaN on flat ground. */
export function aspectDegrees(s: SurfaceSample): number {
  const [x, y, z] = s.n;
  if (z >= 1 - 1e-9) return NaN;
  const deg = (Math.atan2(x, y) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

export const aspect: AnalysisDescriptor<AspectParams> = {
  id: 'aspect',
  label: 'Aspect',
  unit: '°',
  glsl: /* glsl */ `
vec4 analysis_aspect(Surface s, vec4 p0, vec4 p1) {
  float angle = atan(s.n.x, s.n.y);
  float t = fract(angle / 6.283185307179586 + 1.0);
  // Flat terrain has no aspect: fade the coat out there.
  float a = smoothstep(0.0, 0.15, 1.0 - clamp(s.n.z, 0.0, 1.0));
  return vec4(t, 0.0, 0.0, a);
}`,
  params: [],
  defaults: {},
  ramp: 'cyclic',
  domain: () => [0, 360],
  pack: () => ({ p0: [0, 360, 0, 0], p1: [0, 0, 0, 0] }),
  cpu: aspectDegrees,
};
