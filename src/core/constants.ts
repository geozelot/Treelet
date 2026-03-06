// ============================================================================
// treelet.js - Constants
// ============================================================================

import type { ResolvedTreeletOptions } from './types';

/** Web Mercator half-circumference in meters. */
export const WEB_MERCATOR_EXTENT = 20037508.342789244;

/** Full Web Mercator extent in meters (2 * half). */
export const WEB_MERCATOR_FULL_EXTENT = WEB_MERCATOR_EXTENT * 2;

/** Maximum latitude supported by Web Mercator. */
export const WEB_MERCATOR_MAX_LAT = 85.06;

/** Default world scale factor: CRS meters → scene units. */
export const DEFAULT_WORLD_SCALE = 40075.016686;

/** Default tile segments per edge. */
export const DEFAULT_TILE_SEGMENTS = 128;

/** Default number of zoom levels. */
export const MIN_ZOOM = 0;
export const MAX_ZOOM = 20;

/** Debounce interval (ms) for camera change events. */
export const CAMERA_DEBOUNCE_MS = 150;

/** Default tile cache size (number of tiles). */
export const DEFAULT_CACHE_SIZE = 512;

/** Default options with all fields resolved. */
export const DEFAULT_OPTIONS: ResolvedTreeletOptions = {
  center: { lng: 0, lat: 0 },
  zoom: 2,
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
  tileSegments: DEFAULT_TILE_SEGMENTS,
  worldScale: DEFAULT_WORLD_SCALE,
  exaggeration: 1.0,
  elevationRange: [0, 4000] as [number, number],
  contourInterval: 100,
  minPitch: 25,
  maxPitch: 90,
  antialias: true,
  gui: true,
  compassPosition: 'top-right',
  layerPosition: 'bottom-right',
  workerCount: typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4,
};
