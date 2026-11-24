// treelet.js - Curvature: how the slope changes, from the surface's second
// derivatives. Positive = convex (ridges, crests), negative = concave
// (valleys, hollows). Computed at the rendered tile's resolution, so values
// grow as finer tiles load; the unit is 1/km.

import type { AnalysisDescriptor, SurfaceSample } from '../types';

export type CurvatureMode = 'profile' | 'plan' | 'total';

export interface CurvatureParams extends Record<string, unknown> {
  /**
   * `profile`: along the slope (acceleration of flow); `plan`: across it
   * (convergence of flow); `total`: the mean of both directions (Laplacian).
   */
  mode: CurvatureMode;
  /** Ramp range in 1/km. */
  range: [number, number];
}

/** Flat ground: profile and plan curvature are undefined below this gradient². */
const FLAT = 1e-6;

/**
 * Curvature in 1/km from the gradient (p, q) and second derivatives
 * (r = hxx, t = hyy, s = hxy). Zevenbergen & Thorne / Evans forms, with
 * the sign flipped so convex is positive.
 */
export function curvatureOf(
  mode: CurvatureMode, p: number, q: number, r: number, t: number, s: number,
): number {
  const g2 = p * p + q * q;
  let k: number;
  if (mode === 'total') {
    k = -(r + t);
  } else if (g2 < FLAT) {
    k = 0;
  } else if (mode === 'profile') {
    k = -(p * p * r + 2 * p * q * s + q * q * t) / (g2 * Math.pow(1 + g2, 1.5));
  } else {
    k = -(q * q * r - 2 * p * q * s + p * p * t) / Math.pow(g2, 1.5);
  }
  return k * 1000;
}

export function curvatureValue(sample: SurfaceSample, params: CurvatureParams): number {
  if (!sample.g || !sample.c) return NaN;
  return curvatureOf(params.mode, sample.g[0], sample.g[1], sample.c[0], sample.c[1], sample.c[2]);
}

export const curvature: AnalysisDescriptor<CurvatureParams> = {
  id: 'curvature',
  label: 'Curvature',
  unit: '/km',
  glsl: /* glsl */ `
vec4 analysis_curvature(Surface s, vec4 p0, vec4 p1) {
  float p = s.g.x, q = s.g.y;
  float r = s.c.x, t = s.c.y, sx = s.c.z;
  float g2 = p * p + q * q;
  float k;
  if (p1.x > 1.5) {
    k = -(r + t);                                                        // total
  } else if (g2 < 1e-6) {
    k = 0.0;
  } else if (p1.x > 0.5) {
    k = -(q * q * r - 2.0 * p * q * sx + p * p * t) / pow(g2, 1.5);        // plan
  } else {
    k = -(p * p * r + 2.0 * p * q * sx + q * q * t) / (g2 * pow(1.0 + g2, 1.5)); // profile
  }
  k *= 1000.0;
  float v = (k - p0.x) / max(p0.y - p0.x, 1e-3);
  return vec4(v, 0.0, 0.0, 1.0);
}`,
  params: [
    { key: 'mode', label: 'Mode', type: 'select', options: [
      { value: 'total', label: 'Total' }, { value: 'profile', label: 'Profile' }, { value: 'plan', label: 'Plan' },
    ] },
    { key: 'range', label: 'Range', type: 'span', min: -200, max: 200, step: 1, unit: '/km', limits: [-Infinity, Infinity] },
  ],
  defaults: { mode: 'total', range: [-20, 20] },
  ramp: 'diverging',
  domain: (p) => p.range,
  pack: (p, domain) => ({
    p0: [domain[0], domain[1], 0, 0],
    p1: [p.mode === 'total' ? 2 : p.mode === 'plan' ? 1 : 0, 0, 0, 0],
  }),
  cpu: curvatureValue,
};
