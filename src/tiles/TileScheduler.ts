// ============================================================================
// treelet.js - Tile Scheduler
// Determines which tiles to load, keep, and unload based on the
// current visible extent and zoom level.
// ============================================================================

import type { TileCoord, WorldPoint, ScheduleResult, VisibleExtent } from '../core/types';
import { TileGrid } from './TileGrid';
import { tileKey } from './TileIndex';
import { FrustumCalculator } from '../scene/FrustumCalculator';
import type { TileCache } from './TileCache';

/**
 * Camera-derived LOD context for nadir-based tile scheduling.
 *
 * Instead of using the frustum center as the LOD origin, we use the camera
 * nadir (ground point directly below the camera) and scale LOD rings by
 * the top-down viewport footprint radius. This ensures that:
 * - In top-down view: all visible tiles are at full zoom (the visible extent
 *   roughly matches the top-down footprint).
 * - In tilted views: full-detail tiles cover the near/bottom portion of
 *   the viewport (≈ top-down footprint), then aggressively reduce LOD
 *   for distant tiles toward the horizon.
 */
export interface LODContext {
  /** Ground point directly below the camera (camera.position.x/y). */
  cameraNadir: WorldPoint;
  /** Half-diagonal of the top-down viewport footprint in world units. */
  topDownRadius: number;
}

export class TileScheduler {
  private readonly tileGrid: TileGrid;
  private readonly minZoom: number;
  private readonly maxZoom: number;
  private readonly lodEnabled: boolean;

  constructor(options: {
    tileGrid: TileGrid;
    minZoom: number;
    maxZoom: number;
    lodEnabled?: boolean;
  }) {
    this.tileGrid = options.tileGrid;
    this.minZoom = options.minZoom;
    this.maxZoom = options.maxZoom;
    this.lodEnabled = options.lodEnabled ?? true;
  }

  /**
   * Given the current visible extent and zoom, compute which tiles
   * to load, keep, and unload.
   *
   * @param extent - Visible world extent from FrustumCalculator
   * @param zoom - Current integer zoom level
   * @param cache - TileCache for O(1) membership checks via hasKey()
   * @param lodContext - Camera-derived LOD context for nadir-based scheduling
   */
  update(
    extent: VisibleExtent,
    zoom: number,
    cache: TileCache,
    lodContext?: LODContext,
  ): ScheduleResult {
    const needed = this.computeNeededTiles(extent, zoom, lodContext);

    // Compute keys once, zip with coords to avoid double tileKey() calls
    const neededWithKeys: Array<{ coord: TileCoord; key: string }> = needed.map(
      (coord) => ({ coord, key: tileKey(coord) }),
    );
    const neededKeys = new Set(neededWithKeys.map((item) => item.key));

    const load: TileCoord[] = [];
    const keep: TileCoord[] = [];
    const unload: TileCoord[] = [];

    // Tiles we need that aren't active → load
    for (const { coord, key } of neededWithKeys) {
      if (cache.hasKey(key)) {
        keep.push(coord);
      } else {
        load.push(coord);
      }
    }

    // Active tiles we no longer need → unload
    for (const entry of cache.iterateEntries()) {
      const key = `${entry.coord.z}/${entry.coord.x}/${entry.coord.y}`;
      if (!neededKeys.has(key)) {
        unload.push(entry.coord);
      }
    }

    return { load, keep, unload };
  }

  /**
   * Compute which tiles are needed for the current view.
   * Without LOD: all tiles at current zoom in extent.
   * With LOD: tiles at decreasing zoom based on distance from center.
   */
  private computeNeededTiles(extent: VisibleExtent, zoom: number, lodContext?: LODContext): TileCoord[] {
    const bounds = FrustumCalculator.getExtentBounds(extent);

    if (!this.lodEnabled) {
      return this.tileGrid.getTilesInExtent(bounds.min, bounds.max, zoom);
    }

    return this.computeLODTiles(extent, bounds, zoom, lodContext);
  }

  /**
   * Quadtree-based LOD computation.
   *
   * LOD origin = camera nadir (ground point directly below camera).
   *
   * Instead of gathering all full-zoom tiles and then trying to merge them
   * into lower-zoom parents (which causes overlap/conflict cascades), this
   * works top-down:
   *
   * 1. Start from the coarsest zoom level (zoom − maxDrop) covering the
   *    visible extent.
   * 2. For each tile, compute the distance from the camera nadir to the
   *    nearest edge of the tile's AABB.
   * 3. If the tile is close enough to warrant more detail, split it into
   *    4 children at the next zoom level and recurse.
   * 4. Otherwise, keep the tile as a leaf at its current zoom.
   *
   * Split threshold: a tile at zoom z is split when its nearest edge is
   * within topDownRadius × (targetZoom − z) of the camera nadir.
   *
   * This guarantees:
   * - Gap-free coverage (every base tile either stays or is fully replaced
   *   by 4 children, recursively).
   * - No overlaps (quadtree structure is inherently non-overlapping).
   * - Smooth LOD gradation (distance determines detail level).
   */
  private computeLODTiles(
    extent: VisibleExtent,
    bounds: { min: WorldPoint; max: WorldPoint },
    zoom: number,
    lodContext?: LODContext,
  ): TileCoord[] {
    const origin = lodContext?.cameraNadir ?? extent.center;
    const radius = lodContext?.topDownRadius ?? 0;

    // If no radius available, return all tiles at full zoom
    if (radius <= 0) {
      return this.tileGrid.getTilesInExtent(bounds.min, bounds.max, zoom);
    }

    const maxDrop = Math.min(3, zoom - this.minZoom);
    if (maxDrop <= 0) {
      return this.tileGrid.getTilesInExtent(bounds.min, bounds.max, zoom);
    }

    const baseZoom = zoom - maxDrop;

    // Get all tiles at the coarsest level covering the visible extent
    const baseTiles = this.tileGrid.getTilesInExtent(bounds.min, bounds.max, baseZoom);

    // Recursively split tiles that are close enough to warrant more detail
    const result: TileCoord[] = [];
    for (const tile of baseTiles) {
      this.splitOrKeep(tile, zoom, origin, radius, result);
    }

    return result;
  }

  /**
   * Recursively decide whether to split a tile into 4 children or keep it.
   *
   * A tile at zoom z is split if the nearest point on its AABB to the
   * camera nadir is within topDownRadius × (targetZoom − z).
   */
  private splitOrKeep(
    tile: TileCoord,
    targetZoom: number,
    origin: WorldPoint,
    radius: number,
    result: TileCoord[],
  ): void {
    // Already at target zoom - keep as leaf
    if (tile.z >= targetZoom) {
      result.push(tile);
      return;
    }

    // Split threshold: closer tiles get higher detail
    const zoomDiff = targetZoom - tile.z;
    const threshold = radius * zoomDiff;

    const dist = this.nearestDistToTile(tile, origin);

    if (dist < threshold) {
      // Split into 4 children at next zoom level
      const childZ = tile.z + 1;
      const cx = tile.x * 2;
      const cy = tile.y * 2;
      this.splitOrKeep({ z: childZ, x: cx,     y: cy     }, targetZoom, origin, radius, result);
      this.splitOrKeep({ z: childZ, x: cx + 1, y: cy     }, targetZoom, origin, radius, result);
      this.splitOrKeep({ z: childZ, x: cx,     y: cy + 1 }, targetZoom, origin, radius, result);
      this.splitOrKeep({ z: childZ, x: cx + 1, y: cy + 1 }, targetZoom, origin, radius, result);
    } else {
      // Far enough away - keep at current (lower) zoom
      result.push(tile);
    }
  }

  /**
   * Compute the distance from a world point to the nearest edge of a
   * tile's AABB. Returns 0 if the point is inside the tile.
   */
  private nearestDistToTile(tile: TileCoord, point: WorldPoint): number {
    const tileSize = this.tileGrid.getTileSize(tile.z);
    const halfScale = this.tileGrid.worldScale / 2;

    const minX = tile.x * tileSize - halfScale;
    const maxX = minX + tileSize;
    const maxY = halfScale - tile.y * tileSize;  // top edge (world Y up)
    const minY = maxY - tileSize;                 // bottom edge

    const dx = Math.max(minX - point.x, 0, point.x - maxX);
    const dy = Math.max(minY - point.y, 0, point.y - maxY);

    return Math.sqrt(dx * dx + dy * dy);
  }
}
