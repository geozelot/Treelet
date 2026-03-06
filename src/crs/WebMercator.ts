// ============================================================================
// treelet.js - Web Mercator (EPSG:3857) Projection
// ============================================================================

import { WEB_MERCATOR_EXTENT, WEB_MERCATOR_MAX_LAT } from '../core/constants';
import type { LngLat, WorldPoint, TileCoord, TileBounds } from '../core/types';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Web Mercator projection utilities.
 *
 * Handles conversions between:
 *   - LngLat (EPSG:4326, degrees)
 *   - Mercator meters (EPSG:3857)
 *   - World-plane units (scaled scene coordinates)
 */
export const WebMercator = {

  /** Half-circumference in meters. */
  EXTENT: WEB_MERCATOR_EXTENT,

  /**
   * Project LngLat (EPSG:4326) to Web Mercator meters (EPSG:3857).
   */
  project(lngLat: LngLat): WorldPoint {
    const lat = Math.max(Math.min(lngLat.lat, WEB_MERCATOR_MAX_LAT), -WEB_MERCATOR_MAX_LAT);
    const x = lngLat.lng * DEG2RAD * 6378137;
    const y = Math.log(Math.tan(Math.PI / 4 + (lat * DEG2RAD) / 2)) * 6378137;
    return { x, y };
  },

  /**
   * Unproject Web Mercator meters (EPSG:3857) to LngLat (EPSG:4326).
   */
  unproject(point: WorldPoint): LngLat {
    const lng = (point.x / 6378137) * RAD2DEG;
    const lat = (2 * Math.atan(Math.exp(point.y / 6378137)) - Math.PI / 2) * RAD2DEG;
    return { lng, lat };
  },

  /**
   * Convert Web Mercator meters to world-plane units.
   * The world plane is scaled so the full extent maps to `worldScale` units.
   */
  toWorldPlane(point: WorldPoint, worldScale: number): WorldPoint {
    const scale = worldScale / (WEB_MERCATOR_EXTENT * 2);
    return {
      x: point.x * scale,
      y: point.y * scale,
    };
  },

  /**
   * Convert world-plane units back to Web Mercator meters.
   */
  fromWorldPlane(point: WorldPoint, worldScale: number): WorldPoint {
    const scale = (WEB_MERCATOR_EXTENT * 2) / worldScale;
    return {
      x: point.x * scale,
      y: point.y * scale,
    };
  },

  /**
   * Get bounding box of a tile in Web Mercator meters.
   */
  tileBounds(coord: TileCoord): TileBounds {
    const tileCount = Math.pow(2, coord.z);
    const tileSize = (WEB_MERCATOR_EXTENT * 2) / tileCount;
    const west = coord.x * tileSize - WEB_MERCATOR_EXTENT;
    const east = (coord.x + 1) * tileSize - WEB_MERCATOR_EXTENT;
    // Y is flipped: tile y=0 is at north
    const north = WEB_MERCATOR_EXTENT - coord.y * tileSize;
    const south = WEB_MERCATOR_EXTENT - (coord.y + 1) * tileSize;
    return { west, south, east, north };
  },

  /**
   * Get center of a tile in world-plane units.
   */
  tileCenter(coord: TileCoord, worldScale: number): WorldPoint {
    const bounds = WebMercator.tileBounds(coord);
    const centerMercator: WorldPoint = {
      x: (bounds.west + bounds.east) / 2,
      y: (bounds.south + bounds.north) / 2,
    };
    return WebMercator.toWorldPlane(centerMercator, worldScale);
  },

  /**
   * Get the size of a single tile in world-plane units at a given zoom.
   */
  tileWorldSize(zoom: number, worldScale: number): number {
    const tileCount = Math.pow(2, zoom);
    return worldScale / tileCount;
  },
} as const;
