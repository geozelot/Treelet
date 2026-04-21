// ============================================================================
// treelet.js - Tile Index Utilities
// ============================================================================

import type { TileCoord } from '../core/types';

/**
 * Pack z/x/y into a single safe integer key.
 * Layout: (z * 2^22 + x) * 2^22 + y
 * Supports z up to 22 (max safe integer headroom verified).
 */
const TILE_KEY_SHIFT = 4194304; // 2^22

/**
 * Pack z, x, y into a numeric key.
 */
export function packTileKey(z: number, x: number, y: number): number {
  return (z * TILE_KEY_SHIFT + x) * TILE_KEY_SHIFT + y;
}

/**
 * Parse a numeric tile key back into a TileCoord.
 */
export function parseTileKey(key: number): TileCoord {
  const y = key % TILE_KEY_SHIFT;
  const rem = (key - y) / TILE_KEY_SHIFT;
  const x = rem % TILE_KEY_SHIFT;
  const z = (rem - x) / TILE_KEY_SHIFT;
  return { z, x, y };
}

/**
 * Format a numeric tile key as a debug-friendly string "z/x/y".
 */
export function tileKeyStr(key: number): string {
  const { z, x, y } = parseTileKey(key);
  return `${z}/${x}/${y}`;
}

/** Sentinel value: no tile key (used for "no parent"). */
export const NO_TILE_KEY = -1;

/**
 * Get the parent tile at zoom - 1.
 */
export function parentTile(coord: TileCoord): TileCoord {
  if (coord.z === 0) return { z: 0, x: 0, y: 0 };
  return {
    z: coord.z - 1,
    x: Math.floor(coord.x / 2),
    y: Math.floor(coord.y / 2),
  };
}

/**
 * Get the 4 child tiles at zoom + 1.
 */
export function childTiles(coord: TileCoord): TileCoord[] {
  const x2 = coord.x * 2;
  const y2 = coord.y * 2;
  const z1 = coord.z + 1;
  return [
    { z: z1, x: x2, y: y2 },
    { z: z1, x: x2 + 1, y: y2 },
    { z: z1, x: x2, y: y2 + 1 },
    { z: z1, x: x2 + 1, y: y2 + 1 },
  ];
}

/**
 * Get the 4 direct neighbor tiles (N, S, E, W).
 * Wraps horizontally; clamps vertically to valid tile range.
 */
export function neighborTiles(coord: TileCoord): {
  north: TileCoord | null;
  south: TileCoord | null;
  east: TileCoord;
  west: TileCoord;
} {
  const max = 1 << coord.z;
  return {
    north: coord.y > 0 ? { z: coord.z, x: coord.x, y: coord.y - 1 } : null,
    south: coord.y < max - 1 ? { z: coord.z, x: coord.x, y: coord.y + 1 } : null,
    east: { z: coord.z, x: (coord.x + 1) % max, y: coord.y },
    west: { z: coord.z, x: (coord.x - 1 + max) % max, y: coord.y },
  };
}

/**
 * Check if a tile coordinate is within valid bounds.
 */
export function isValidTile(coord: TileCoord): boolean {
  const max = 1 << coord.z;
  return (
    coord.z >= 0 &&
    coord.x >= 0 &&
    coord.x < max &&
    coord.y >= 0 &&
    coord.y < max
  );
}
