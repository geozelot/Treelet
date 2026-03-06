// ============================================================================
// treelet.js - Tile Index Utilities
// ============================================================================

import type { TileCoord } from '../core/types';

/**
 * Create a unique string key for a tile coordinate.
 */
export function tileKey(coord: TileCoord): string {
  return `${coord.z}/${coord.x}/${coord.y}`;
}

/**
 * Parse a tile key back into a TileCoord.
 */
export function parseTileKey(key: string): TileCoord {
  const [z, x, y] = key.split('/').map(Number);
  return { z, x, y };
}

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
  const max = Math.pow(2, coord.z);
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
  const max = Math.pow(2, coord.z);
  return (
    coord.z >= 0 &&
    coord.x >= 0 &&
    coord.x < max &&
    coord.y >= 0 &&
    coord.y < max
  );
}
