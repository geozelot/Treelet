// ============================================================================
// treelet.js - GeoJSON normalization
//
// Flattens any GeoJSON object into the parts the overlay renderer draws:
// points, lines (line strings and polygon outlines) and polygons, each
// pointing back at its feature. Invalid positions are dropped with one
// warning per call; z values are ignored (features follow the terrain).
// ============================================================================

import type { LngLat } from '../core/types';
import type { Feature, GeoJSON, Geometry, Position } from './types';

export interface NormalizedOverlay {
  features: Feature[];
  points: Array<{ feature: number; lngLat: LngLat }>;
  /** Line strings, and the rings of polygons (`outline`). */
  lines: Array<{ feature: number; coords: LngLat[]; outline: boolean }>;
  polygons: Array<{ feature: number; rings: LngLat[][] }>;
}

function toLngLat(p: Position, bad: { count: number }): LngLat | null {
  if (!Array.isArray(p) || p.length < 2) { bad.count++; return null; }
  const lng = Number(p[0]);
  const lat = Number(p[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lat < -90 || lat > 90) { bad.count++; return null; }
  return { lng, lat };
}

function line(coords: Position[] | undefined, bad: { count: number }): LngLat[] {
  if (!Array.isArray(coords)) { bad.count++; return []; }
  const out: LngLat[] = [];
  for (const c of coords) {
    const p = toLngLat(c, bad);
    if (p) out.push(p);
  }
  return out;
}

/** The features of any GeoJSON object (a bare geometry becomes one feature). */
export function featuresOf(data: GeoJSON | null | undefined): Feature[] {
  if (!data || typeof data !== 'object') return [];
  if (data.type === 'FeatureCollection') return Array.isArray(data.features) ? data.features.filter(Boolean) : [];
  if (data.type === 'Feature') return [data];
  return [{ type: 'Feature', geometry: data as Geometry, properties: {} }];
}

export function normalizeGeoJSON(data: GeoJSON | null | undefined): NormalizedOverlay {
  const out: NormalizedOverlay = { features: featuresOf(data), points: [], lines: [], polygons: [] };
  const bad = { count: 0 };

  const addPolygon = (feature: number, rings: Position[][] | undefined) => {
    if (!Array.isArray(rings)) { bad.count++; return; }
    const parsed = rings.map((r) => line(r, bad)).filter((r) => r.length >= 3);
    if (parsed.length === 0) return;
    out.polygons.push({ feature, rings: parsed });
    for (const r of parsed) {
      const closed = r[0].lng === r[r.length - 1].lng && r[0].lat === r[r.length - 1].lat ? r : [...r, r[0]];
      out.lines.push({ feature, coords: closed, outline: true });
    }
  };

  const visit = (g: Geometry | null | undefined, feature: number, depth: number) => {
    if (!g || typeof g !== 'object') return;
    switch (g.type) {
      case 'Point': {
        const p = toLngLat(g.coordinates, bad);
        if (p) out.points.push({ feature, lngLat: p });
        break;
      }
      case 'MultiPoint':
        for (const c of g.coordinates ?? []) {
          const p = toLngLat(c, bad);
          if (p) out.points.push({ feature, lngLat: p });
        }
        break;
      case 'LineString': {
        const l = line(g.coordinates, bad);
        if (l.length >= 2) out.lines.push({ feature, coords: l, outline: false });
        break;
      }
      case 'MultiLineString':
        for (const c of g.coordinates ?? []) {
          const l = line(c, bad);
          if (l.length >= 2) out.lines.push({ feature, coords: l, outline: false });
        }
        break;
      case 'Polygon':
        addPolygon(feature, g.coordinates);
        break;
      case 'MultiPolygon':
        for (const c of g.coordinates ?? []) addPolygon(feature, c);
        break;
      case 'GeometryCollection':
        if (depth < 8) for (const sub of g.geometries ?? []) visit(sub, feature, depth + 1);
        break;
      default:
        bad.count++;
    }
  };

  out.features.forEach((f, i) => visit(f?.geometry, i, 0));
  if (bad.count > 0) console.warn(`treelet: skipped ${bad.count} invalid GeoJSON position(s) or geometr${bad.count === 1 ? 'y' : 'ies'}`);
  return out;
}

/** Bounds of everything in a normalized overlay, or null when it is empty. */
export function overlayBounds(o: NormalizedOverlay): { west: number; south: number; east: number; north: number } | null {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  const add = (p: LngLat) => {
    if (p.lng < west) west = p.lng; if (p.lng > east) east = p.lng;
    if (p.lat < south) south = p.lat; if (p.lat > north) north = p.lat;
  };
  for (const p of o.points) add(p.lngLat);
  for (const l of o.lines) for (const p of l.coords) add(p);
  return west <= east ? { west, south, east, north } : null;
}
