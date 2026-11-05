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

/** Default number of tiles held in GPU memory (~0.5 MB each for elevation, +0.35 MB with a drape). */
export const DEFAULT_TILE_CACHE_SIZE = 256;

/** Tile cache limits: enough for a view plus loading headroom; the texture array layer limit. */
export const MIN_TILE_CACHE_SIZE = 64;
export const MAX_TILE_CACHE_SIZE = 2048;

/** Default visible range, as a multiple of the camera's height above the orbit target. */
export const DEFAULT_HORIZON_DISTANCE = 16;

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
 * Tile capacity of the deprecated `atlasSize` option: an atlasSize² texture
 * cut into slotSize² slots.
 */
export function tilesForAtlasSize(atlasSize: number, slotSize: number): number {
  const hint = `atlasSize is deprecated: set mapDisplay.tileCacheSize (number of tiles, default ${DEFAULT_TILE_CACHE_SIZE}) instead`;
  if (!isPowerOfTwo(atlasSize) || atlasSize < slotSize) {
    throw new Error(`treelet: atlasSize must be a power-of-two >= slotSize (${slotSize}), got ${atlasSize}. ${hint}`);
  }
  const tiles = (atlasSize / slotSize) ** 2;
  if (tiles < MIN_TILE_CACHE_SIZE || tiles > MAX_TILE_CACHE_SIZE) {
    throw new Error(
      `treelet: atlasSize ${atlasSize} with slotSize ${slotSize} holds ${tiles} tiles; ` +
      `${MIN_TILE_CACHE_SIZE}–${MAX_TILE_CACHE_SIZE} are supported. ${hint}`,
    );
  }
  return tiles;
}

/**
 * Validate tile cache and geometry parameters.
 * Throws descriptive errors for invalid combinations.
 */
export function validateTileConfig(
  tileCacheSize: number,
  slotSize: number,
  maxInstances: number,
  maxConcurrentFetches: number,
  segments: number = DEFAULT_ATLAS_SEGMENTS,
  drapeSlotSize: number = slotSize,
): void {
  if (!Number.isInteger(tileCacheSize) || tileCacheSize < MIN_TILE_CACHE_SIZE || tileCacheSize > MAX_TILE_CACHE_SIZE) {
    throw new Error(
      `treelet: tileCacheSize must be an integer in [${MIN_TILE_CACHE_SIZE}, ${MAX_TILE_CACHE_SIZE}] tiles, got ${tileCacheSize}`,
    );
  }
  if (!isPowerOfTwo(slotSize) || slotSize < 2) {
    throw new Error(`treelet: slotSize must be a power-of-two >= 2, got ${slotSize}`);
  }
  if (!isPowerOfTwo(drapeSlotSize) || drapeSlotSize < 2) {
    throw new Error(`treelet: drapeSlotSize must be a power-of-two >= 2, got ${drapeSlotSize}`);
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
    tileCacheSize: DEFAULT_TILE_CACHE_SIZE,
    slotSize: DEFAULT_SLOT_SIZE,
    drapeSlotSize: DEFAULT_SLOT_SIZE,
    maxInstances: DEFAULT_MAX_INSTANCES,
    maxConcurrentFetches: DEFAULT_MAX_CONCURRENT_FETCHES,
    maxPixelRatio: 2,
    lodQuality: 1,
    morphWidth: 0.3,
    horizonDistance: DEFAULT_HORIZON_DISTANCE,
    fog: true,
    renderOnDemand: true,
  },
  workerCount: defaultWorkerCount(),
  workerUrl: null,
};
