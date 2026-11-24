// treelet.js - Shadows: terrain-cast shadows of the map's sun, multiplied
// over the coats below. Needs the shadow map (drawn while a shadows coat is
// visible); reaches over the near part of the view and fades out beyond.

import type { AnalysisDescriptor } from '../types';

export interface ShadowsParams extends Record<string, unknown> {
  /** How dark shadowed ground gets (0 = not at all, 1 = black). */
  darkness: number;
}

export const shadows: AnalysisDescriptor<ShadowsParams> = {
  id: 'shadows',
  label: 'Shadows',
  shadowMap: true,
  glsl: /* glsl */ `
vec4 analysis_shadows(Surface s, vec4 p0, vec4 p1) {
  return vec4(vec3(1.0 - p0.x * (1.0 - gShadowLit)), 1.0);
}`,
  params: [
    { key: 'darkness', label: 'Darkness', type: 'range', min: 0, max: 1, step: 0.05 },
  ],
  defaults: { darkness: 0.5 },
  blendMode: 'multiply',
  pack: (p) => ({ p0: [p.darkness, 0, 0, 0], p1: [0, 0, 0, 0] }),
};
