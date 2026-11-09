// ============================================================================
// treelet.js - Line of sight
//
// Whether a target can be seen from an observer along a terrain profile.
// Distant terrain drops below the observer's horizon by the Earth's
// curvature, less refraction: drop(d) = d² (1 − k) / 2R. The sight line runs
// straight from the observer's eye to the target; it is blocked where the
// (dropped) terrain rises above it.
// ============================================================================

import { EARTH_RADIUS_M, REFRACTION_K } from './compute/viewshed';

export interface SightSample {
  /** Ground distance from the observer in meters. */
  distance: number;
  /** Terrain elevation in meters, or null without data. */
  elevation: number | null;
}

export interface LineOfSightOptions {
  /** Observer's eye above the ground in meters (default 1.7). */
  fromHeight?: number;
  /** Target above the ground in meters (default 0). */
  toHeight?: number;
  /** Earth curvature correction (default true). */
  curvature?: boolean;
  /** Refraction coefficient (default 0.13). */
  refraction?: number;
}

export interface LineOfSightProfile {
  visible: boolean;
  /** Index of the first sample where terrain rises above the sight line, or −1. */
  obstructionIndex: number;
  /**
   * Smallest gap between the sight line and the terrain in meters (negative
   * where the terrain rises above it). Infinity without samples between.
   */
  clearance: number;
  /** Height of the sight line above the datum at each sample, as drawn over the terrain profile. */
  sight: Float64Array;
  /** Eye and target elevations (terrain plus height) in meters. */
  eyeElevation: number;
  targetElevation: number;
}

/**
 * Line of sight over a sampled profile from the observer (first sample) to
 * the target (last sample). Samples without data are skipped. Throws when
 * the end points have no data.
 */
export function lineOfSightProfile(samples: readonly SightSample[], options: LineOfSightOptions = {}): LineOfSightProfile {
  const n = samples.length;
  if (n < 2) throw new Error('treelet: a line of sight needs at least two samples');
  const first = samples[0];
  const last = samples[n - 1];
  if (first.elevation === null || last.elevation === null) {
    throw new Error('treelet: no elevation data at the ends of the line of sight');
  }
  const k = options.refraction ?? REFRACTION_K;
  const curve = options.curvature !== false ? (1 - k) / (2 * EARTH_RADIUS_M) : 0;
  const drop = (d: number) => d * d * curve;

  const eye = first.elevation + (options.fromHeight ?? 1.7);
  const target = last.elevation + (options.toHeight ?? 0);
  const D = last.distance - first.distance;
  // In the frame where the terrain is lowered by drop(d), the sight line is straight
  const targetLowered = target - drop(D);
  const sight = new Float64Array(n);
  let obstructionIndex = -1;
  let clearance = Infinity;
  for (let i = 0; i < n; i++) {
    const d = samples[i].distance - first.distance;
    const t = D > 0 ? d / D : 0;
    const line = eye + (targetLowered - eye) * t;
    sight[i] = line + drop(d);
    if (i === 0 || i === n - 1) continue;
    const e = samples[i].elevation;
    if (e === null) continue;
    const gap = line - (e - drop(d));
    if (gap < clearance) clearance = gap;
    if (gap < 0 && obstructionIndex < 0) obstructionIndex = i;
  }
  return { visible: obstructionIndex < 0, obstructionIndex, clearance, sight, eyeElevation: eye, targetElevation: target };
}
