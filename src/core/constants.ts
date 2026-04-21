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

/** Default atlas segments per edge (quads). Max useful = atlas slot size (256). */
export const DEFAULT_ATLAS_SEGMENTS = 64;

/** Default atlas texture resolution in pixels. */
export const DEFAULT_ATLAS_SIZE = 4096;

/** Default individual tile slot resolution in pixels. */
export const DEFAULT_SLOT_SIZE = 256;

/** Default maximum tile instances per frame. */
export const DEFAULT_MAX_INSTANCES = 512;

/** Default maximum concurrent tile fetch requests. */
export const DEFAULT_MAX_CONCURRENT_FETCHES = 12;

/** Default number of zoom levels. */
export const MIN_ZOOM = 0;
export const MAX_ZOOM = 20;

/** Debounce interval (ms) for camera change events. */
export const CAMERA_DEBOUNCE_MS = 150;

/** Default tile cache size (number of tiles). */
export const DEFAULT_CACHE_SIZE = 512;

/**
 * Validate atlas configuration parameters.
 * Throws descriptive errors for invalid combinations.
 */
export function validateAtlasConfig(
  atlasSize: number,
  slotSize: number,
  maxInstances: number,
  maxConcurrentFetches: number,
): void {
  if (atlasSize <= 0 || (atlasSize & (atlasSize - 1)) !== 0) {
    throw new Error(`treelet: atlasSize must be a positive power-of-two, got ${atlasSize}`);
  }
  if (slotSize <= 0 || (slotSize & (slotSize - 1)) !== 0) {
    throw new Error(`treelet: slotSize must be a positive power-of-two, got ${slotSize}`);
  }
  if (atlasSize < slotSize) {
    throw new Error(`treelet: atlasSize (${atlasSize}) must be >= slotSize (${slotSize})`);
  }
  if (atlasSize % slotSize !== 0) {
    throw new Error(`treelet: atlasSize (${atlasSize}) must be divisible by slotSize (${slotSize})`);
  }
  if (maxInstances < 64) {
    throw new Error(`treelet: maxInstances must be >= 64, got ${maxInstances}`);
  }
  if (maxConcurrentFetches < 1) {
    throw new Error(`treelet: maxConcurrentFetches must be >= 1, got ${maxConcurrentFetches}`);
  }
}

/** Default options with all fields resolved. */
export const DEFAULT_OPTIONS: ResolvedTreeletOptions = {
  initCenter: { lng: 0, lat: 0 },
  initZoom: 2,
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
  guiDisplay: {
    enabled: true,
    compassPosition: 'top-right',
    layerPosition: 'bottom-right',
  },
  mapDisplay: {
    atlasSegments: DEFAULT_ATLAS_SEGMENTS,
    antialias: true,
    worldScale: DEFAULT_WORLD_SCALE,
    minPitch: 25,
    maxPitch: 90,
    atlasSize: DEFAULT_ATLAS_SIZE,
    slotSize: DEFAULT_SLOT_SIZE,
    maxInstances: DEFAULT_MAX_INSTANCES,
    maxConcurrentFetches: DEFAULT_MAX_CONCURRENT_FETCHES,
  },
  workerCount: typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4,
};
