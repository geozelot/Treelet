// ============================================================================
// treelet.js - Tile Grid Math
// Ported from TLet.js ___Calc.js, adapted to standard XYZ tile coordinates.
// ============================================================================

import { WEB_MERCATOR_EXTENT } from '../core/constants';
import type { TileCoord, WorldPoint } from '../core/types';

/**
 * Pre-computed lookup tables for tile math at each zoom level.
 * Standard XYZ tile coordinates: origin at top-left, x right, y down.
 */
export class TileGrid {
  /** Pre-computed tile counts per zoom level. */
  private readonly tileCount: number[];
  /** Pre-computed tile sizes in world-plane units per zoom level. */
  private readonly tileSizes: number[];
  /** Pre-computed meters per pixel per zoom level (at equator, 256px tiles). */
  private readonly metersPerPixel: number[];

  readonly worldScale: number;
  readonly maxZoomLevels: number;

  constructor(worldScale: number, maxZoomLevels: number = 30) {
    this.worldScale = worldScale;
    this.maxZoomLevels = maxZoomLevels;

    this.tileCount = [];
    this.tileSizes = [];
    this.metersPerPixel = [];

    for (let z = 0; z <= maxZoomLevels; z++) {
      const count = 1 << z;
      this.tileCount.push(count);
      this.tileSizes.push(worldScale / count);
      this.metersPerPixel.push((WEB_MERCATOR_EXTENT * 2) / (count * 256));
    }
  }

  /**
   * Get the number of tiles along one axis at a zoom level.
   */
  getTileCount(zoom: number): number {
    return this.tileCount[zoom];
  }

  /**
   * Get tile size in world-plane units at a zoom level.
   */
  getTileSize(zoom: number): number {
    return this.tileSizes[zoom];
  }

  /**
   * Get meters per pixel at equator for a given zoom level (256px tiles).
   */
  getMetersPerPixel(zoom: number): number {
    return this.metersPerPixel[zoom];
  }

  /**
   * Convert a world-plane point to the tile coordinate containing it.
   *
   * World-plane origin is at the center (0, 0), matching Web Mercator.
   * Tile coordinates use standard XYZ: origin top-left, y increases downward.
   */
  worldToTile(point: WorldPoint, zoom: number): TileCoord {
    const halfScale = this.worldScale / 2;
    const tileSize = this.tileSizes[zoom];

    // Map from world-plane [-halfScale, halfScale] to [0, worldScale]
    const px = point.x + halfScale;
    const py = halfScale - point.y; // flip Y: world Y up → tile Y down

    const x = Math.floor(px / tileSize);
    const y = Math.floor(py / tileSize);

    // Clamp to valid range
    const max = this.tileCount[zoom];
    return {
      z: zoom,
      x: Math.max(0, Math.min(x, max - 1)),
      y: Math.max(0, Math.min(y, max - 1)),
    };
  }

  /**
   * Get the world-plane position of a tile's top-left corner.
   */
  tileToWorldTL(coord: TileCoord): WorldPoint {
    const halfScale = this.worldScale / 2;
    const tileSize = this.tileSizes[coord.z];
    return {
      x: coord.x * tileSize - halfScale,
      y: halfScale - coord.y * tileSize,
    };
  }

  /**
   * Get the world-plane position of a tile's center.
   */
  tileToWorldCenter(coord: TileCoord): WorldPoint {
    const halfScale = this.worldScale / 2;
    const tileSize = this.tileSizes[coord.z];
    const halfTile = tileSize / 2;
    return {
      x: coord.x * tileSize - halfScale + halfTile,
      y: halfScale - coord.y * tileSize - halfTile,
    };
  }

  /**
   * Write the world-plane center of a tile into an output object.
   * Avoids allocating a new WorldPoint on every call - critical for
   * per-frame quadtree traversal (~400+ calls/frame).
   */
  tileToWorldCenterOut(z: number, x: number, y: number, out: WorldPoint): void {
    const halfScale = this.worldScale / 2;
    const tileSize = this.tileSizes[z];
    const halfTile = tileSize / 2;
    out.x = x * tileSize - halfScale + halfTile;
    out.y = halfScale - y * tileSize - halfTile;
  }

  /**
   * Get all tile coordinates within a bounding box defined by two world-plane corners.
   *
   * @param min - Bottom-left world-plane point (smallest x, smallest y)
   * @param max - Top-right world-plane point (largest x, largest y)
   * @param zoom - Zoom level
   * @returns Array of tile coordinates covering the extent
   */
  getTilesInExtent(min: WorldPoint, max: WorldPoint, zoom: number): TileCoord[] {
    const tl = this.worldToTile({ x: min.x, y: max.y }, zoom); // top-left
    const br = this.worldToTile({ x: max.x, y: min.y }, zoom); // bottom-right

    const tiles: TileCoord[] = [];
    for (let x = tl.x; x <= br.x; x++) {
      for (let y = tl.y; y <= br.y; y++) {
        tiles.push({ z: zoom, x, y });
      }
    }

    return tiles;
  }
}
