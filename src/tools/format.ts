// ============================================================================
// treelet.js - Measurement formatting
// ============================================================================

import type { PathMeasure } from './measure';
import type { LineOfSightResult } from '../core/types';

const thin = ' ';

function group(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, thin);
}

/** 850 m, 2.41 km, 12.4 km, 156 km. */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '–';
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(2) : km < 100 ? km.toFixed(1) : group(km)} km`;
}

/** 850 m², 2.4 ha, 3.21 km². */
export function formatArea(m2: number): string {
  if (!Number.isFinite(m2)) return '–';
  if (m2 < 10_000) return `${group(m2)} m²`;
  if (m2 < 1_000_000) return `${(m2 / 10_000).toFixed(m2 < 100_000 ? 2 : 1)} ha`;
  const km2 = m2 / 1_000_000;
  return `${km2 < 10 ? km2.toFixed(2) : km2 < 100 ? km2.toFixed(1) : group(km2)} km²`;
}

/** 1 234 m. */
export function formatElevation(m: number | null): string {
  return m === null || !Number.isFinite(m) ? '–' : `${group(m)} m`;
}

/** A measured path as label / value pairs (the Measure page and the profile show the same ones). */
export function pathStats(p: PathMeasure): Array<[label: string, value: string]> {
  const pairs: Array<[string, string]> = [
    ['Length', formatDistance(p.distance)],
    ['Terrain', formatDistance(p.surfaceDistance)],
    ['Ascent', formatElevation(p.gain)],
    ['Descent', formatElevation(p.loss)],
  ];
  if (p.minElevation !== null) pairs.push(['Lowest', formatElevation(p.minElevation)], ['Highest', formatElevation(p.maxElevation)]);
  return pairs;
}

/** A line of sight as label / value pairs, the result first (the Measure page shows the first three). */
export function sightStats(s: LineOfSightResult): Array<[label: string, value: string]> {
  const pairs: Array<[string, string]> = [['Result', s.visible ? 'Visible' : 'Hidden']];
  if (!s.visible && s.obstruction) pairs.push(['Blocked at', formatDistance(s.obstruction.distance)]);
  pairs.push(
    ['Distance', formatDistance(s.distance)],
    ['Clearance', formatElevation(s.clearance)],
    ['Eye', formatElevation(s.eyeElevation)],
    ['Target', formatElevation(s.targetElevation)],
  );
  return pairs;
}
