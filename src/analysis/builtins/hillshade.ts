// treelet.js - Hillshade: terrain lit from the map's sun, multiplied over the coats below.

import type { AnalysisDescriptor } from '../types';

export interface HillshadeParams extends Record<string, unknown> {
  /** Light on slopes facing away from the sun (0 = black, 1 = unlit). */
  ambient: number;
}

export const hillshade: AnalysisDescriptor<HillshadeParams> = {
  id: 'hillshade',
  label: 'Hillshade',
  glsl: /* glsl */ `
vec4 analysis_hillshade(Surface s, vec4 p0, vec4 p1) {
  float light = max(dot(s.n, uSunDirection), 0.0);
  return vec4(vec3(p0.x + (1.0 - p0.x) * light), 1.0);
}`,
  params: [
    { key: 'ambient', label: 'Ambient', type: 'range', min: 0, max: 1, step: 0.05 },
  ],
  defaults: { ambient: 0.45 },
  blendMode: 'multiply',
  opacity: 0.6,
  pack: (p) => ({ p0: [p.ambient, 0, 0, 0], p1: [0, 0, 0, 0] }),
};
