// treelet.js - Hillshade: terrain lit from the map's sun, multiplied over the coats below.
//
// `single`: one light from the sun. `multi`: multidirectional oblique
// weighting (MDOW, Mark 1992): four lights at the sun's altitude, at the sun
// azimuth −90°, −45°, 0° and +45° (Mark's 225°, 270°, 315° and 360° for the
// sun at 315°), each weighted by cos² of the angle between the light's
// azimuth and the slope's aspect (the compass bearing it faces downhill),
// plus a small floor so that no weight is zero. The light in line with a
// slope, from in front of it or behind it, counts most: it crosses the
// ridge or valley the slope belongs to and shows its form with the most
// contrast, so ridges and valleys running toward the sun, whose flanks one
// sun lights alike, keep their relief. Flat ground gets sin(altitude), as
// from one sun.

import type { AnalysisDescriptor, SurfaceSample } from '../types';

export type HillshadeMode = 'single' | 'multi';

export interface HillshadeParams extends Record<string, unknown> {
  /** Light on slopes facing away from the sun (0 = black, 1 = unlit). */
  ambient: number;
  mode: HillshadeMode;
}

/** Azimuth offsets (degrees) of the four MDOW lights from the sun azimuth. */
export const MDOW_OFFSETS = [-90, -45, 0, 45] as const;

/** Floor added to every MDOW weight, so that no light drops out. */
const MDOW_FLOOR = 0.05;

/**
 * Direct light (0–1) on a surface with unit normal `n` from the sun at
 * `azimuth` / `altitude` (degrees), in either mode.
 */
export function hillshadeLight(s: SurfaceSample, azimuth: number, altitude: number, mode: HillshadeMode): number {
  const alt = (altitude * Math.PI) / 180;
  const lightAt = (az: number) => {
    const a = (az * Math.PI) / 180;
    return Math.max(0, s.n[0] * Math.sin(a) * Math.cos(alt) + s.n[1] * Math.cos(a) * Math.cos(alt) + s.n[2] * Math.sin(alt));
  };
  if (mode === 'single') return lightAt(azimuth);
  // Aspect as a compass bearing (radians); flat ground has none and takes 0,
  // where every light gives the same sin(altitude) anyway (as in the shader)
  const aspect = Math.hypot(s.n[0], s.n[1]) > 1e-6 ? Math.atan2(s.n[0], s.n[1]) : 0;
  let sum = 0;
  let wsum = 0;
  for (const o of MDOW_OFFSETS) {
    const az = azimuth + o;
    const w = Math.cos(aspect - (az * Math.PI) / 180) ** 2 + MDOW_FLOOR;
    sum += w * lightAt(az);
    wsum += w;
  }
  return sum / wsum;
}

export const hillshade: AnalysisDescriptor<HillshadeParams> = {
  id: 'hillshade',
  label: 'Hillshade',
  glsl: /* glsl */ `
vec4 analysis_hillshade(Surface s, vec4 p0, vec4 p1) {
  float light;
  if (p0.y > 0.5) {
    // MDOW: four lights around the sun azimuth, each weighted by cos² of its
    // angle to the slope's aspect (+ 0.05), as in hillshadeLight.
    // atan(0, 0) is undefined: a sun straight overhead and flat ground take
    // azimuth / aspect 0, where every light gives the same anyway.
    float cosAlt = length(uSunDirection.xy);
    float az0 = cosAlt > 1e-6 ? atan(uSunDirection.x, uSunDirection.y) : 0.0;
    float aspect = length(s.n.xy) > 1e-6 ? atan(s.n.x, s.n.y) : 0.0;
    float sum = 0.0;
    float wsum = 0.0;
    for (int i = 0; i < 4; i++) {
      float az = az0 + (float(i) - 2.0) * 0.7853981633974483;
      vec3 l = vec3(sin(az) * cosAlt, cos(az) * cosAlt, uSunDirection.z);
      float ca = cos(aspect - az);
      float w = ca * ca + 0.05;
      sum += w * max(dot(s.n, l), 0.0);
      wsum += w;
    }
    light = sum / wsum;
  } else {
    light = max(dot(s.n, uSunDirection), 0.0);
  }
  return vec4(vec3(p0.x + (1.0 - p0.x) * light), 1.0);
}`,
  params: [
    { key: 'mode', label: 'Light', type: 'select', options: [
      { value: 'single', label: 'Sun' }, { value: 'multi', label: 'Multi' },
    ] },
    { key: 'ambient', label: 'Ambient', type: 'range', min: 0, max: 1, step: 0.05 },
  ],
  defaults: { ambient: 0.45, mode: 'single' },
  blendMode: 'multiply',
  opacity: 0.6,
  pack: (p) => ({ p0: [p.ambient, p.mode === 'multi' ? 1 : 0, 0, 0], p1: [0, 0, 0, 0] }),
};
