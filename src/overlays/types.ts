// ============================================================================
// treelet.js - Overlay types
//
// GeoJSON input (RFC 7946, positions as [lng, lat] or [lng, lat, z]; z is
// ignored, features are clamped to the terrain) and overlay styles.
// ============================================================================

import type { RGB } from '../analysis/types';

export type Position = number[];

export interface PointGeometry { type: 'Point'; coordinates: Position }
export interface MultiPointGeometry { type: 'MultiPoint'; coordinates: Position[] }
export interface LineStringGeometry { type: 'LineString'; coordinates: Position[] }
export interface MultiLineStringGeometry { type: 'MultiLineString'; coordinates: Position[][] }
export interface PolygonGeometry { type: 'Polygon'; coordinates: Position[][] }
export interface MultiPolygonGeometry { type: 'MultiPolygon'; coordinates: Position[][][] }
export interface GeometryCollection { type: 'GeometryCollection'; geometries: Geometry[] }

export type Geometry =
  | PointGeometry | MultiPointGeometry
  | LineStringGeometry | MultiLineStringGeometry
  | PolygonGeometry | MultiPolygonGeometry
  | GeometryCollection;

export interface Feature {
  type: 'Feature';
  geometry: Geometry | null;
  properties?: Record<string, unknown> | null;
  id?: string | number;
}

export interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
}

export type GeoJSON = FeatureCollection | Feature | Geometry;

/** A CSS color ('#ff6a00', 'rgb(…)', 'teal') or [r, g, b] in 0–1. */
export type ColorValue = string | RGB;

/**
 * How an overlay's features are drawn. Every property is optional; `color`
 * is the default for lines, points and fills.
 */
export interface OverlayStyle {
  color?: ColorValue;
  /** Opacity of lines and points, 0–1 (default 1). */
  opacity?: number;
  /** Line width in CSS pixels (default 2.5). */
  lineWidth?: number;
  lineColor?: ColorValue;
  /** Polygon fill; null for none. Default: `color`. */
  fillColor?: ColorValue | null;
  /** Default 0.3. */
  fillOpacity?: number;
  /** Point radius in CSS pixels (default 5). */
  pointRadius?: number;
  pointColor?: ColorValue;
  /** Point outline (default white, 1.5 px). */
  pointStroke?: ColorValue;
  pointStrokeWidth?: number;
  /** A property name, or a function of the properties, giving the label text. */
  label?: string | ((properties: Record<string, unknown>) => string | number | null | undefined);
  /** Label text and halo colors (CSS) and size in pixels (default 12). */
  labelColor?: string;
  labelHalo?: string;
  labelSize?: number;
}

/** A style for all features, or a function of each feature. */
export type OverlayStyleSpec = OverlayStyle | ((feature: Feature) => OverlayStyle);

export interface ResolvedStyle {
  lineColor: RGB;
  lineWidth: number;
  lineOpacity: number;
  fillColor: RGB | null;
  fillOpacity: number;
  pointColor: RGB;
  pointRadius: number;
  pointStroke: RGB;
  pointStrokeWidth: number;
  pointOpacity: number;
  label: string | null;
  labelColor: string;
  labelHalo: string;
  labelSize: number;
}
