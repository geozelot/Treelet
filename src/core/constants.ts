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

/** Deepest zoom level the tile key packing supports (x, y < 2^22). */
export const MAX_TILE_ZOOM = 22;

/** Default camera zoom bounds. */
export const MIN_ZOOM = 0;
export const MAX_ZOOM = 20;

/** Debounce interval (ms) for camera change events. */
export const CAMERA_DEBOUNCE_MS = 150;

/** Minimum CDLOD range factor. Below ~2.83 neighbouring tiles may differ by
 *  more than one level and LOD boundaries can fall inside a coarse tile's
 *  morph zone, so selection never goes below this. */
export const MIN_LOD_RANGE_FACTOR = 3.2;

/** Fraction of atlas slots the visible set may occupy. The rest is headroom
 *  for geomorph parents and ancestor fallbacks, which are pinned as well. */
export const ATLAS_VISIBLE_FRACTION = 0.6;

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/**
 * Validate atlas configuration parameters.
 * Throws descriptive errors for invalid combinations.
 */
export function validateAtlasConfig(
  atlasSize: number,
  slotSize: number,
  maxInstances: number,
  maxConcurrentFetches: number,
  segments: number = DEFAULT_ATLAS_SEGMENTS,
  drapeSlotSize: number = slotSize,
): void {
  if (!isPowerOfTwo(atlasSize)) {
    throw new Error(`treelet: atlasSize must be a positive power-of-two, got ${atlasSize}`);
  }
  if (!isPowerOfTwo(slotSize) || slotSize < 2) {
    throw new Error(`treelet: slotSize must be a power-of-two >= 2, got ${slotSize}`);
  }
  if (!isPowerOfTwo(drapeSlotSize) || drapeSlotSize < 2) {
    throw new Error(`treelet: drapeSlotSize must be a power-of-two >= 2, got ${drapeSlotSize}`);
  }
  if (atlasSize < slotSize) {
    throw new Error(`treelet: atlasSize (${atlasSize}) must be >= slotSize (${slotSize})`);
  }
  if (atlasSize % slotSize !== 0) {
    throw new Error(`treelet: atlasSize (${atlasSize}) must be divisible by slotSize (${slotSize})`);
  }
  const slots = (atlasSize / slotSize) ** 2;
  if (slots < 64) {
    throw new Error(`treelet: atlas holds only ${slots} tiles; use a larger atlasSize or smaller slotSize (>= 64 slots)`);
  }
  if (slots > 2048) {
    throw new Error(`treelet: atlas would hold ${slots} tiles; at most 2048 are supported (texture array layer limit)`);
  }
  if (!Number.isInteger(maxInstances) || maxInstances < 16) {
    throw new Error(`treelet: maxInstances must be an integer >= 16, got ${maxInstances}`);
  }
  if (!Number.isInteger(maxConcurrentFetches) || maxConcurrentFetches < 1) {
    throw new Error(`treelet: maxConcurrentFetches must be an integer >= 1, got ${maxConcurrentFetches}`);
  }
  if (!Number.isInteger(segments) || segments < 2 || segments % 2 !== 0 || segments > slotSize) {
    throw new Error(`treelet: atlasSegments must be an even integer in [2, slotSize], got ${segments}`);
  }
}

/** Default worker count: leave one core for the main thread, cap at 4. */
function defaultWorkerCount(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(4, cores - 1));
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
    drapeSlotSize: DEFAULT_SLOT_SIZE,
    maxInstances: DEFAULT_MAX_INSTANCES,
    maxConcurrentFetches: DEFAULT_MAX_CONCURRENT_FETCHES,
    maxPixelRatio: 2,
    lodQuality: 1,
    morphWidth: 0.3,
    renderOnDemand: true,
  },
  workerCount: defaultWorkerCount(),
  workerUrl: null,
};
