// treelet.js - Slope analysis: steepness in degrees mapped over a range,
// optionally only on slopes facing a sector of the compass.

import type { AnalysisDescriptor, SurfaceSample } from '../types';

export interface SlopeParams extends Record<string, unknown> {
  /** Ramp range in degrees. */
  range: [number, number];
  /**
   * Draw only slopes whose aspect lies in [from, to] degrees clockwise from
   * north (from > to passes through north, e.g. [315, 45]); null = all.
   */
  aspectMask: [number, number] | null;
}

export function slopeDegrees(s: SurfaceSample): number {
  return (Math.acos(Math.max(0, Math.min(1, s.n[2]))) * 180) / Math.PI;
}

/** Whether a bearing lies in the clockwise sector [from, to] (degrees). */
export function inSector(bearing: number, from: number, to: number): boolean {
  const b = ((bearing % 360) + 360) % 360;
  const f = ((from % 360) + 360) % 360;
  const t = ((to % 360) + 360) % 360;
  return f <= t ? b >= f && b <= t : b >= f || b <= t;
}

export const slope: AnalysisDescriptor<SlopeParams> = {
  id: 'slope',
  label: 'Slope',
  unit: '°',
  glsl: /* glsl */ `
vec4 analysis_slope(Surface s, vec4 p0, vec4 p1) {
  float slopeDeg = degrees(acos(clamp(s.n.z, 0.0, 1.0)));
  float t = (slopeDeg - p0.x) / max(p0.y - p0.x, 1e-3);
  float a = 1.0;
  if (p1.x > 0.5) {
    // Aspect mask: bearing of the downslope direction, clockwise from north
    float bearing = mod(degrees(atan(s.n.x, s.n.y)) + 360.0, 360.0);
    float from = mod(p0.z, 360.0);
    float to = mod(p0.w, 360.0);
    bool inside = from <= to ? (bearing >= from && bearing <= to) : (bearing >= from || bearing <= to);
    // Flat ground has no aspect
    a = inside && s.n.z < 0.99998 ? 1.0 : 0.0;
  }
  return vec4(t, 0.0, 0.0, a);
}`,
  params: [
    { key: 'range', label: 'Range', type: 'span', min: 0, max: 90, step: 1, unit: '°' },
    { key: 'aspectMask', label: 'Aspect', type: 'span', min: 0, max: 360, step: 5, unit: '°', optional: true, wrap: true },
  ],
  defaults: { range: [0, 60], aspectMask: null },
  ramp: 'viridis',
  domain: (p) => p.range,
  pack: (p, domain) => ({
    p0: [domain[0], domain[1], p.aspectMask?.[0] ?? 0, p.aspectMask?.[1] ?? 360],
    p1: [p.aspectMask ? 1 : 0, 0, 0, 0],
  }),
  cpu: slopeDegrees,
};
