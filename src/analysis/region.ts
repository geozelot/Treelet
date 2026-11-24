// ============================================================================
// treelet.js - Region planning
//
// Which elevation tiles a region analysis loads: the tiles at one zoom
// covering a lng/lat box, at the finest zoom whose tile count stays within
// a budget. The worker assembles them into one grid (compute/region.ts).
// Pure (main thread and tests).
// ============================================================================

import type { TileBounds } from '../core/types';
import { mercatorY } from './grid';

export interface RegionWindow {
  /** Region edges in tile units at the plan's zoom (x east, y south; fractional). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RegionPlan {
  zoom: number;
  /** Tiles to load (x, y at `zoom`), row by row from the north-west. */
  tiles: Array<{ x: number; y: number }>;
  window: RegionWindow;
}

export interface RegionPlanOptions {
  /** Finest zoom wanted (default: maxZoom). */
  zoom?: number;
  /** Zoom range of the elevation source. */
  minZoom: number;
  maxZoom: number;
  /** Most tiles to load (default 64). */
  maxTiles?: number;
}

export const DEFAULT_REGION_TILES = 64;

/** Tile-space x of a longitude at zoom z. */
export function tileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}

/** Tile-space y of a latitude at zoom z (0 at the north edge of the world). */
export function tileY(lat: number, z: number): number {
  return ((1 - mercatorY(lat) / Math.PI) / 2) * 2 ** z;
}

/** Longitude of a tile-space x at zoom z. */
export function lngOfTileX(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

/** Latitude of a tile-space y at zoom z. */
export function latOfTileY(y: number, z: number): number {
  const n = Math.PI * (1 - (2 * y) / 2 ** z);
  return ((2 * Math.atan(Math.exp(n)) - Math.PI / 2) * 180) / Math.PI;
}

function windowAt(b: TileBounds, z: number): RegionWindow {
  return { x0: tileX(b.west, z), x1: tileX(b.east, z), y0: tileY(b.north, z), y1: tileY(b.south, z) };
}

function tilesOf(w: RegionWindow, z: number): Array<{ x: number; y: number }> {
  const n = 2 ** z;
  const tx0 = Math.max(0, Math.floor(w.x0));
  const tx1 = Math.min(n - 1, Math.ceil(w.x1) - 1);
  const ty0 = Math.max(0, Math.floor(w.y0));
  const ty1 = Math.min(n - 1, Math.ceil(w.y1) - 1);
  const tiles: Array<{ x: number; y: number }> = [];
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) tiles.push({ x, y });
  return tiles;
}

/**
 * Plan the tiles for a region: the finest zoom (from `zoom`, at most the
 * source's maxZoom) at which the box needs no more than `maxTiles` tiles.
 * Throws when the box is empty or doesn't fit even at the source's minZoom.
 */
export function planRegion(bounds: TileBounds, options: RegionPlanOptions): RegionPlan {
  const b: TileBounds = {
    west: Math.max(-180, bounds.west),
    east: Math.min(180, bounds.east),
    south: Math.max(-85.05112878, bounds.south),
    north: Math.min(85.05112878, bounds.north),
  };
  if (!(b.east > b.west && b.north > b.south)) {
    throw new Error('treelet: the region is empty (west < east and south < north are required)');
  }
  const maxTiles = Math.max(1, Math.floor(options.maxTiles ?? DEFAULT_REGION_TILES));
  const top = Math.max(options.minZoom, Math.min(options.maxZoom, Math.floor(options.zoom ?? options.maxZoom)));
  for (let z = top; z >= options.minZoom; z--) {
    const window = windowAt(b, z);
    const count = (Math.min(2 ** z, Math.ceil(window.x1)) - Math.max(0, Math.floor(window.x0))) *
      (Math.min(2 ** z, Math.ceil(window.y1)) - Math.max(0, Math.floor(window.y0)));
    if (count <= maxTiles) return { zoom: z, tiles: tilesOf(window, z), window };
  }
  throw new Error(`treelet: the region needs more than ${maxTiles} tiles even at zoom ${options.minZoom}; choose a smaller area or raise maxTiles`);
}

/** Ground meters per cell at a latitude for tiles of `tileSize` pixels at zoom z. */
export function cellSizeAt(lat: number, z: number, tileSize: number): number {
  return (2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180)) / (2 ** z * tileSize);
}

/** A lng/lat box around a point extending `meters` in every direction. */
export function boundsAround(lng: number, lat: number, meters: number): TileBounds {
  const dLat = (meters / 6378137) * (180 / Math.PI);
  const dLng = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
  return { west: lng - dLng, east: lng + dLng, south: lat - dLat, north: lat + dLat };
}
