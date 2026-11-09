// ============================================================================
// treelet.js - Measurements (pure)
//
// Path and area measurements over the terrain. Paths are sampled along the
// straight map (Mercator) line between their vertices, as they are drawn,
// at a spacing tied to the loaded terrain's resolution; their geodesic
// length uses the WGS84 ellipsoid. Surface areas integrate 1 / cos(slope)
// over a grid of cells inside the polygon.
// ============================================================================

import type { LngLat, ProfileSample } from '../core/types';
import { geodesicDistance, haversineDistance, pathLength, polygonArea } from '../analysis/geodesy';
import { mercatorY, latitudeOfMercatorY } from '../analysis/grid';

export interface PathMeasure {
  /** Geodesic length in meters (sum of the segments on the ellipsoid). */
  distance: number;
  /** Length along the terrain in meters (rises and falls included). */
  surfaceDistance: number;
  /** Total ascent and descent in meters. */
  gain: number;
  loss: number;
  /** Lowest and highest elevation along the path (null without data). */
  minElevation: number | null;
  maxElevation: number | null;
  /** Distance along the path (geodesic) at each vertex. */
  vertexDistances: number[];
  /** Elevation samples along the path. */
  profile: ProfileSample[];
}

export interface AreaMeasure {
  /** Geodesic area in square meters. */
  area: number;
  /** Area of the terrain surface inside the polygon (slopes count fully). */
  surfaceArea: number;
  /** Geodesic perimeter in meters. */
  perimeter: number;
  minElevation: number | null;
  maxElevation: number | null;
}

/** Points along the straight Mercator line from a to b (a included, b not), `n` of them. */
function interpolate(a: LngLat, b: LngLat, n: number, out: LngLat[]): void {
  const ya = mercatorY(a.lat);
  const yb = mercatorY(b.lat);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out.push({ lng: a.lng + (b.lng - a.lng) * t, lat: latitudeOfMercatorY(ya + (yb - ya) * t) });
  }
}

/**
 * Measure a path. `elevationAt` samples the terrain; `spacing` is the
 * sampling step in meters (grown so that no more than `maxSamples` are taken).
 */
export function measurePath(
  points: readonly LngLat[],
  elevationAt: (lngLat: LngLat) => number | null,
  spacing: number,
  maxSamples = 20000,
): PathMeasure {
  const vertexDistances: number[] = [0];
  const segs: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const d = geodesicDistance(points[i - 1], points[i]);
    segs.push(d);
    vertexDistances.push(vertexDistances[i - 1] + d);
  }
  const distance = vertexDistances[vertexDistances.length - 1] ?? 0;
  let step = Math.max(spacing, 1e-3);
  if (distance / step > maxSamples) step = distance / maxSamples;

  const positions: LngLat[] = [];
  for (let i = 1; i < points.length; i++) {
    interpolate(points[i - 1], points[i], Math.max(1, Math.ceil(segs[i - 1] / step)), positions);
  }
  if (points.length > 0) positions.push(points[points.length - 1]);

  const profile: ProfileSample[] = [];
  let along = 0;
  let surfaceDistance = 0;
  let gain = 0;
  let loss = 0;
  let min = Infinity;
  let max = -Infinity;
  let prevElev: number | null = null;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    let ds = 0;
    if (i > 0) {
      ds = haversineDistance(positions[i - 1], p);
      along += ds;
    }
    const e = elevationAt(p);
    if (e !== null) {
      if (prevElev !== null) {
        const dh = e - prevElev;
        if (dh > 0) gain += dh; else loss -= dh;
        surfaceDistance += Math.sqrt(ds * ds + dh * dh);
      } else {
        surfaceDistance += ds;
      }
      if (e < min) min = e;
      if (e > max) max = e;
      prevElev = e;
    } else {
      surfaceDistance += ds;
    }
    profile.push({ lngLat: p, distance: along, elevation: e });
  }
  // The sampled (spherical) length differs slightly from the ellipsoidal one: rescale
  if (along > 0 && distance > 0) {
    const scale = distance / along;
    for (const s of profile) s.distance *= scale;
    surfaceDistance *= scale;
  }
  return {
    distance,
    surfaceDistance,
    gain,
    loss,
    minElevation: min <= max ? min : null,
    maxElevation: min <= max ? max : null,
    vertexDistances,
    profile,
  };
}

/** Whether (x, y) lies inside a ring (even-odd rule). */
export function pointInRing(x: number, y: number, ring: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface SurfaceAreaOptions {
  /** Cells along the longer side of the polygon's bounds (default 256). */
  cells?: number;
  /** Ground meters per world unit at world y (Mercator scale). */
  metersPerUnit: (worldY: number) => number;
  /** Terrain at a world point: elevation and the normal's vertical component, or null. */
  surfaceAt: (worldX: number, worldY: number) => { h: number; nz: number } | null;
}

/**
 * Surface area in square meters of the terrain inside a polygon given in
 * world-plane coordinates (outer ring first, then holes): the ground area of
 * every grid cell whose center lies inside, divided by cos(slope). Cells
 * without terrain data count flat.
 */
export function measureSurfaceArea(
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  options: SurfaceAreaOptions,
): { surfaceArea: number; planarArea: number; minElevation: number | null; maxElevation: number | null } {
  const outer = rings[0];
  if (!outer || outer.length < 3) return { surfaceArea: 0, planarArea: 0, minElevation: null, maxElevation: null };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of outer) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const n = Math.max(8, Math.round(options.cells ?? 256));
  const cell = Math.max(x1 - x0, y1 - y0) / n;
  if (!(cell > 0)) return { surfaceArea: 0, planarArea: 0, minElevation: null, maxElevation: null };
  const nx = Math.ceil((x1 - x0) / cell);
  const ny = Math.ceil((y1 - y0) / cell);
  let surface = 0;
  let planar = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < ny; j++) {
    const y = y0 + (j + 0.5) * cell;
    const m = options.metersPerUnit(y);
    const cellArea = (cell * m) * (cell * m);
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * cell;
      if (!pointInRing(x, y, outer)) continue;
      let hole = false;
      for (let r = 1; r < rings.length && !hole; r++) hole = pointInRing(x, y, rings[r]);
      if (hole) continue;
      planar += cellArea;
      const s = options.surfaceAt(x, y);
      if (s && s.nz > 1e-3) {
        surface += cellArea / s.nz;
        if (s.h < min) min = s.h;
        if (s.h > max) max = s.h;
      } else {
        surface += cellArea;
      }
    }
  }
  return { surfaceArea: surface, planarArea: planar, minElevation: min <= max ? min : null, maxElevation: min <= max ? max : null };
}

/** Geodesic area and perimeter of a ring of positions. */
export function geodesicAreaOf(ring: readonly LngLat[]): { area: number; perimeter: number } {
  const closed = ring.length > 2 ? [...ring, ring[0]] : [...ring];
  return { area: polygonArea([ring]), perimeter: pathLength(closed) };
}
