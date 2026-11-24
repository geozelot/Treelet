// treelet.js - Slope analysis: steepness in degrees mapped over a range,
// optionally only on slopes facing a sector of the compass.

import type { AnalysisDescriptor, SurfaceSample } from '../types';

export interface SlopeParams extends Record<string, unknown> {
  /** Ramp range in degrees. */
  range: [number, number];
  /**
   * Draw only slopes whose aspect lies in [from, to] degrees clockwise from
   * north (from > to passes through north, e.g. [315, 45]; a span of 360°
   * or more, e.g. [0, 360], is every bearing); null = all.
   */
  aspectMask: [number, number] | null;
}

export function slopeDegrees(s: SurfaceSample): number {
  return (Math.acos(Math.max(0, Math.min(1, s.n[2]))) * 180) / Math.PI;
}

/** An angle in degrees reduced to [0, 360). */
function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * The clockwise sector [from, to] (degrees) with both ends reduced to
 * [0, 360) (from > to then passes through north), or null when it covers
 * every bearing: a clockwise span of a whole turn or more (to − from ≥ 360,
 * e.g. [0, 360]), the rule the parameter resolver applies too. A span that
 * is not finite also reads as every bearing, so a bad value never hides the
 * coat.
 */
function normalizeSector(from: number, to: number): [number, number] | null {
  if (!(Number.isFinite(from) && Number.isFinite(to)) || to - from >= 360) return null;
  return [wrap360(from), wrap360(to)];
}

/** Whether a bearing lies in the clockwise sector [from, to] (degrees). */
export function inSector(bearing: number, from: number, to: number): boolean {
  const sector = normalizeSector(from, to);
  if (!sector) return true;
  const [f, t] = sector;
  const b = wrap360(bearing);
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
    // Aspect mask: the clockwise sector [p0.z, p0.w], both ends in [0, 360)
    // (packed by normalizeSector; a full circle turns the mask off), as in
    // inSector. Flat ground has no aspect and is left out (this also keeps
    // atan(0, 0), which is undefined, from being evaluated).
    a = 0.0;
    if (s.n.z < 0.99998) {
      // Bearing of the downslope direction, clockwise from north, in [0, 360)
      float bearing = degrees(atan(s.n.x, s.n.y));
      if (bearing < 0.0) bearing += 360.0;
      if (bearing >= 360.0) bearing -= 360.0;
      bool inside = p0.z <= p0.w ? (bearing >= p0.z && bearing <= p0.w) : (bearing >= p0.z || bearing <= p0.w);
      a = inside ? 1.0 : 0.0;
    }
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
  pack: (p, domain) => {
    // No mask, or one covering every bearing: the flag stays off
    const sector = p.aspectMask ? normalizeSector(p.aspectMask[0], p.aspectMask[1]) : null;
    return {
      p0: [domain[0], domain[1], sector ? sector[0] : 0, sector ? sector[1] : 360],
      p1: [sector ? 1 : 0, 0, 0, 0],
    };
  },
  cpu: slopeDegrees,
};
