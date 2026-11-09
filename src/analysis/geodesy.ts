// ============================================================================
// treelet.js - Geodesy
//
// Distances on the WGS84 ellipsoid (Vincenty's inverse formula, accurate to
// millimetres) and polygon areas on the authalic sphere (the sphere with
// the ellipsoid's surface area; within about 0.5 % of the ellipsoidal area
// for regional polygons).
// ============================================================================

import type { LngLat } from '../core/types';

const RAD = Math.PI / 180;

/** WGS84 semi-major axis and flattening. */
export const WGS84_A = 6378137;
export const WGS84_F = 1 / 298.257223563;
/** Radius of the sphere with the WGS84 ellipsoid's surface area. */
export const AUTHALIC_RADIUS = 6371007.181;

/**
 * Great-circle distance in meters on a sphere of `radius` (default: the
 * authalic sphere; also the fallback for near-antipodal points).
 */
export function haversineDistance(a: LngLat, b: LngLat, radius = AUTHALIC_RADIUS): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Shortest distance in meters on the WGS84 ellipsoid (Vincenty inverse). */
export function geodesicDistance(p1: LngLat, p2: LngLat): number {
  const a = WGS84_A;
  const f = WGS84_F;
  const b = a * (1 - f);
  const L = (p2.lng - p1.lng) * RAD;
  const U1 = Math.atan((1 - f) * Math.tan(p1.lat * RAD));
  const U2 = Math.atan((1 - f) * Math.tan(p2.lat * RAD));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);

  let lambda = L;
  let sinSigma = 0, cosSigma = 0, sigma = 0, cos2Alpha = 0, cos2SigmaM = 0;
  for (let iter = 0; iter < 200; iter++) {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt((cosU2 * sinLambda) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2);
    if (sinSigma === 0) return 0; // coincident points
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cos2Alpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cos2Alpha : 0; // equatorial line
    const C = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
    const prev = lambda;
    lambda = L + (1 - C) * f * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(lambda - prev) < 1e-12) {
      const uSq = (cos2Alpha * (a * a - b * b)) / (b * b);
      const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
      const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
      const deltaSigma = B * sinSigma * (cos2SigmaM + (B / 4) * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
        (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
      return b * A * (sigma - deltaSigma);
    }
  }
  // No convergence (nearly antipodal): the sphere is close enough there
  return haversineDistance(p1, p2);
}

/** Length of a path in meters (sum of geodesic segment lengths). */
export function pathLength(points: readonly LngLat[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += geodesicDistance(points[i - 1], points[i]);
  return d;
}

/**
 * Area in square meters enclosed by a ring of positions (closed or not), on
 * the authalic sphere (Chamberlain & Duquette, "Some algorithms for polygons
 * on a sphere", 2007).
 */
export function ringArea(ring: readonly LngLat[]): number {
  let pts = ring;
  if (pts.length > 1 && pts[0].lng === pts[pts.length - 1].lng && pts[0].lat === pts[pts.length - 1].lat) {
    pts = pts.slice(0, -1);
  }
  const n = pts.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const lower = pts[i];
    const middle = pts[(i + 1) % n];
    const upper = pts[(i + 2) % n];
    total += (upper.lng - lower.lng) * RAD * Math.sin(middle.lat * RAD);
  }
  return Math.abs((total * AUTHALIC_RADIUS * AUTHALIC_RADIUS) / 2);
}

/** Area of a polygon with holes: the outer ring minus the inner rings. */
export function polygonArea(rings: ReadonlyArray<readonly LngLat[]>): number {
  if (rings.length === 0) return 0;
  let area = ringArea(rings[0]);
  for (let i = 1; i < rings.length; i++) area -= ringArea(rings[i]);
  return Math.max(0, area);
}
