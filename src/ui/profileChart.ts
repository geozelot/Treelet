// ============================================================================
// treelet.js - Elevation profile chart (SVG markup)
//
// Dependency-free SVG for an elevation profile: the terrain as a filled
// area, an optional sight line and obstruction, axes with round ticks, and
// a hover marker. The same markup is shown in the panel (colors as CSS
// variables, the samples decimated to the pixel columns) and exported as PNG
// (colors resolved, every sample).
// ============================================================================

import type { LngLat } from '../core/types';
import { escapeHtml } from './dom';

export interface ProfilePoint {
  distance: number;
  elevation: number | null;
  lngLat: LngLat;
  /** Height of a sight line here (line of sight), meters. */
  sight?: number;
}

export interface ChartPalette {
  text: string;
  grid: string;
  fill: string;
  line: string;
  sight: string;
  blocked: string;
  hover: string;
  background: string;
}

export const CSS_PALETTE: ChartPalette = {
  text: 'var(--text-dim)',
  grid: 'var(--border)',
  fill: 'var(--chart-fill)',
  line: 'var(--chart-line)',
  sight: 'var(--chart-sight)',
  blocked: 'var(--chart-blocked)',
  hover: 'var(--text)',
  background: 'transparent',
};

export const MARGIN = { left: 46, right: 12, top: 10, bottom: 22 };

/** Round tick values covering [min, max] (about `count` of them). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  const out: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

export function formatAxisDistance(m: number, maxDistance: number): string {
  if (maxDistance >= 2000) {
    const km = m / 1000;
    return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
  }
  return `${Math.round(m)} m`;
}

export interface ChartScales {
  x: (d: number) => number;
  y: (h: number) => number;
  invertX: (px: number) => number;
  dMax: number;
  hMin: number;
  hMax: number;
}

export function chartScales(points: readonly ProfilePoint[], width: number, height: number): ChartScales {
  const dMax = Math.max(points[points.length - 1]?.distance ?? 0, 1e-6);
  let hMin = Infinity;
  let hMax = -Infinity;
  for (const p of points) {
    if (p.elevation !== null) { hMin = Math.min(hMin, p.elevation); hMax = Math.max(hMax, p.elevation); }
    if (p.sight !== undefined) { hMin = Math.min(hMin, p.sight); hMax = Math.max(hMax, p.sight); }
  }
  if (!(hMax >= hMin)) { hMin = 0; hMax = 1; }
  const pad = Math.max((hMax - hMin) * 0.08, 5);
  hMin -= pad;
  hMax += pad;
  const iw = Math.max(1, width - MARGIN.left - MARGIN.right);
  const ih = Math.max(1, height - MARGIN.top - MARGIN.bottom);
  return {
    x: (d) => MARGIN.left + (d / dMax) * iw,
    y: (h) => MARGIN.top + (1 - (h - hMin) / (hMax - hMin)) * ih,
    invertX: (px) => Math.max(0, Math.min(dMax, ((px - MARGIN.left) / iw) * dMax)),
    dMax,
    hMin,
    hMax,
  };
}

/** Index of the sample nearest to a distance. */
export function nearestIndex(points: readonly ProfilePoint[], distance: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].distance < distance) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(points[lo - 1].distance - distance) < Math.abs(points[lo].distance - distance)) lo--;
  return lo;
}

/**
 * The samples worth drawing at the chart's scale: per pixel column the
 * lowest and the highest (in their order along the path), so peaks and pits
 * survive; the first and the last sample; and a sample without data (once)
 * wherever the line breaks. Profiles with at most about two samples per
 * column are returned as they are.
 */
export function decimateProfile(points: readonly ProfilePoint[], scales: ChartScales): readonly ProfilePoint[] {
  const n = points.length;
  const columns = Math.max(1, Math.ceil(scales.x(scales.dMax) - scales.x(0)));
  if (n <= 2 * columns + 2) return points;
  const out: ProfilePoint[] = [points[0]];
  let column = Number.NaN;
  let lo = -1;
  let hi = -1;
  const flush = () => {
    if (lo < 0) return;
    out.push(points[Math.min(lo, hi)]);
    if (hi !== lo) out.push(points[Math.max(lo, hi)]);
    lo = hi = -1;
  };
  for (let i = 1; i < n - 1; i++) {
    const p = points[i];
    const c = Math.floor(scales.x(p.distance));
    if (c !== column) {
      flush();
      column = c;
    }
    if (p.elevation === null) {
      flush();
      if (out[out.length - 1].elevation !== null) out.push(p);
      continue;
    }
    if (lo < 0 || p.elevation < points[lo].elevation!) lo = i;
    if (hi < 0 || p.elevation > points[hi].elevation!) hi = i;
  }
  flush();
  out.push(points[n - 1]);
  return out;
}

/** The chart's SVG markup. */
export function chartSvg(
  points: readonly ProfilePoint[],
  width: number,
  height: number,
  palette: ChartPalette,
  options: {
    obstructionIndex?: number;
    fontFamily?: string;
    /** Draw the terrain and sight line from decimateProfile() (for the screen). */
    decimate?: boolean;
    /** Scales for these points and size, when already known. */
    scales?: ChartScales;
  } = {},
): string {
  const s = options.scales ?? chartScales(points, width, height);
  const drawn = options.decimate ? decimateProfile(points, s) : points;
  const font = options.fontFamily ?? 'system-ui, -apple-system, sans-serif';
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${escapeHtml(font)}" font-size="10">`);
  if (palette.background !== 'transparent') parts.push(`<rect width="${width}" height="${height}" fill="${palette.background}"/>`);

  // Grid and axes
  const bottom = height - MARGIN.bottom;
  for (const h of niceTicks(s.hMin, s.hMax, 4)) {
    const y = s.y(h).toFixed(1);
    parts.push(`<line x1="${MARGIN.left}" x2="${width - MARGIN.right}" y1="${y}" y2="${y}" stroke="${palette.grid}" stroke-width="1"/>`);
    parts.push(`<text x="${MARGIN.left - 6}" y="${y}" dy="3.5" text-anchor="end" fill="${palette.text}">${Math.round(h)} m</text>`);
  }
  const xTicks = niceTicks(0, s.dMax, Math.max(2, Math.floor((width - MARGIN.left) / 90)));
  for (const d of xTicks) {
    const x = s.x(d).toFixed(1);
    parts.push(`<text x="${x}" y="${bottom + 14}" text-anchor="middle" fill="${palette.text}">${formatAxisDistance(d, s.dMax)}</text>`);
  }

  // Terrain: filled area and line, broken where there is no data
  let path = '';
  let area = '';
  let run: string[] = [];
  const flush = () => {
    if (run.length > 1) {
      path += `M${run.join('L')}`;
      const first = run[0].split(',')[0];
      const last = run[run.length - 1].split(',')[0];
      area += `M${first},${bottom}L${run.join('L')}L${last},${bottom}Z`;
    }
    run = [];
  };
  for (const p of drawn) {
    if (p.elevation === null) { flush(); continue; }
    run.push(`${s.x(p.distance).toFixed(1)},${s.y(p.elevation).toFixed(1)}`);
  }
  flush();
  parts.push(`<path d="${area}" fill="${palette.fill}"/>`);
  parts.push(`<path d="${path}" fill="none" stroke="${palette.line}" stroke-width="1.6" stroke-linejoin="round"/>`);

  // Sight line
  if (points.some((p) => p.sight !== undefined)) {
    const blocked = options.obstructionIndex !== undefined && options.obstructionIndex >= 0 && options.obstructionIndex < points.length;
    const d = drawn.filter((p) => p.sight !== undefined).map((p) => `${s.x(p.distance).toFixed(1)},${s.y(p.sight!).toFixed(1)}`).join('L');
    parts.push(`<path d="M${d}" fill="none" stroke="${blocked ? palette.blocked : palette.sight}" stroke-width="1.4" stroke-dasharray="5 3"/>`);
    if (blocked) {
      const o = points[options.obstructionIndex!];
      if (o.elevation !== null) parts.push(`<circle cx="${s.x(o.distance).toFixed(1)}" cy="${s.y(o.elevation).toFixed(1)}" r="3.5" fill="${palette.blocked}"/>`);
    }
  }

  parts.push('</svg>');
  return parts.join('');
}

/** CSV of the profile: distance, position, elevation (and sight line height). */
export function profileCsv(points: readonly ProfilePoint[]): string {
  const sight = points.some((p) => p.sight !== undefined);
  const rows = [`distance_m,lng,lat,elevation_m${sight ? ',sight_m' : ''}`];
  for (const p of points) {
    const cells = [p.distance.toFixed(2), p.lngLat.lng.toFixed(7), p.lngLat.lat.toFixed(7), p.elevation === null ? '' : p.elevation.toFixed(2)];
    if (sight) cells.push(p.sight === undefined ? '' : p.sight.toFixed(2));
    rows.push(cells.join(','));
  }
  return rows.join('\n') + '\n';
}
