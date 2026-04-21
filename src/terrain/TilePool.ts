// ============================================================================
// treelet.js - Tile Pool
//
// Determines which tiles are visible, assigns LOD levels based on camera
// distance, and builds the per-instance attribute buffer for the single
// instanced draw call. Manages tile fetch prioritization.
//
// LOD selection is a pure function of camera distance - deterministic,
// no GPU feedback pass, no readback stalls.
// ============================================================================

import type { TileGrid } from '../tiles/TileGrid';
import type { UnifiedAtlas, AtlasCoords } from './UnifiedAtlas';
import type { TileCoord, WorldPoint } from '../core/types';
import { packTileKey, NO_TILE_KEY } from '../tiles/TileIndex';

/** A tile that should be visible this frame. */
export interface VisibleTile {
  key: number;
  coord: TileCoord;
  /** World-space center of the tile. */
  centerX: number;
  centerY: number;
  /** World-space size of the tile. */
  worldSize: number;
  /** Camera distance (for sorting). */
  distance: number;
  /** Atlas coordinates (null if tile data not yet loaded). */
  atlas: AtlasCoords | null;
  /** Parent tile key (z-1 level), or NO_TILE_KEY if no parent. */
  parentKey: number;
  /** Parent atlas coordinates (null if parent not loaded). */
  parentAtlas: AtlasCoords | null;
  /** Packed neighbor LOD differences for geomorphing (L + R*16 + B*256 + T*4096). */
  neighborLodPacked: number;
}

/** Default maximum number of tile instances to render per frame. */
export const MAX_INSTANCES = 512;

/**
 * Number of floats per instance in the attribute buffer.
 * Layout: worldX, worldY, worldScale, atlasU, atlasV, atlasScale,
 *         tileLod, parentAtlasU, parentAtlasV, parentAtlasScale,
 *         neighborLodPacked
 */
export const INSTANCE_FLOATS = 11;

/** Create a zeroed VisibleTile with embedded TileCoord for pool pre-allocation. */
function createPoolTile(): VisibleTile {
  return {
    key: 0,
    coord: { z: 0, x: 0, y: 0 },
    centerX: 0,
    centerY: 0,
    worldSize: 0,
    distance: 0,
    atlas: null,
    parentKey: NO_TILE_KEY,
    parentAtlas: null,
    neighborLodPacked: 0,
  };
}

export class TilePool {
  private readonly tileGrid: TileGrid;
  private readonly atlas: UnifiedAtlas;

  /** Maximum tile instances to render per frame (configurable). */
  private readonly maxInstances: number;
  /** Pool capacity: maxInstances * 2 for parent tiles headroom. */
  private readonly tilePoolSize: number;

  /** Visible tiles computed in the most recent update. */
  private _visibleTiles: VisibleTile[] = [];

  /** Tiles that are visible but not yet loaded in the atlas. */
  private _missingTiles: VisibleTile[] = [];

  /** Parent tiles needed for geomorphing but not yet in the atlas. */
  private _missingParentTiles: VisibleTile[] = [];

  /** Pre-allocated instance data buffer. */
  readonly instanceData: Float32Array;

  /** Number of active instances in the buffer (set each frame). */
  instanceCount = 0;

  /** Reusable map for quadtree LOD selection (cleared each frame). */
  private readonly _tilesByKey = new Map<number, VisibleTile>();

  /** Ancestor tile keys used as fallback this frame (for LRU touch). */
  private readonly _usedAncestorKeys = new Set<number>();

  /** Reusable set for deduplicating missing parent tiles (cleared each frame). */
  private readonly _seenParents = new Set<number>();

  /** Reusable WorldPoint for tile center calculations (avoids per-call allocation). */
  private readonly _centerOut: WorldPoint = { x: 0, y: 0 };

  /** Transient cache for neighbor LOD lookups (cleared each frame).
   *  Keyed by packed tile key of the neighbor position, value is the resolved LOD
   *  difference. Eliminates redundant ancestor walks for symmetric neighbors
   *  (A's right neighbor = B's left neighbor). */
  private readonly _neighborLodCache = new Map<number, number>();

  /** Pre-allocated VisibleTile object pool (avoids ~400+ allocations/frame).
   *  WARNING: Tile objects are reused each frame - do not retain references
   *  across frames. All consumers (instance buffer, missing lists) are rebuilt
   *  each frame before the pool index resets. */
  private readonly _tilePool: VisibleTile[];
  /** Current index into the tile pool. Reset to 0 each frame. */
  private _poolIdx = 0;

  /** Minimum zoom level for LOD selection (updated from active layer bounds). */
  private minZoom: number;
  /** Maximum zoom level for LOD selection (updated from active layer bounds). */
  private maxZoom: number;

  constructor(
    tileGrid: TileGrid,
    atlas: UnifiedAtlas,
    minZoom: number,
    maxZoom: number,
    maxInstances: number = MAX_INSTANCES,
  ) {
    this.tileGrid = tileGrid;
    this.atlas = atlas;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.maxInstances = maxInstances;
    this.tilePoolSize = maxInstances * 2;
    this.instanceData = new Float32Array(maxInstances * INSTANCE_FLOATS);

    // Pre-allocate tile object pool
    this._tilePool = new Array(this.tilePoolSize);
    for (let i = 0; i < this.tilePoolSize; i++) {
      this._tilePool[i] = createPoolTile();
    }
  }

  /**
   * Update the effective zoom range for LOD selection.
   * Called by TerrainRenderer when the active layer's data bounds change.
   * The caller computes the intersection of Treelet-level (camera) bounds
   * and per-layer (data) bounds.
   */
  setZoomRange(minZoom: number, maxZoom: number): void {
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
  }

  /**
   * Acquire a VisibleTile from the pre-allocated pool.
   * Falls back to fresh allocation if pool is exhausted (should not happen).
   */
  private _allocTile(): VisibleTile {
    if (this._poolIdx < this.tilePoolSize) {
      return this._tilePool[this._poolIdx++];
    }
    return createPoolTile();
  }

  /**
   * Compute visible tiles, LOD assignment, and build the instance buffer.
   *
   * @param cameraX - Camera world-space X (nadir)
   * @param cameraY - Camera world-space Y (nadir)
   * @param baseZoom - Current base zoom level from camera distance
   * @param extentMin - Visible extent bottom-left corner
   * @param extentMax - Visible extent top-right corner
   * @param frustumPlanes - Optional 2D frustum half-planes (Float32Array(12))
   *   for tight trapezoid culling at tilted views. null = AABB-only culling.
   */
  update(
    cameraX: number,
    cameraY: number,
    baseZoom: number,
    extentMin: WorldPoint,
    extentMax: WorldPoint,
    frustumPlanes: Float32Array | null = null,
  ): void {
    this._visibleTiles.length = 0;
    this._missingTiles.length = 0;
    this._missingParentTiles.length = 0;
    this._tilesByKey.clear();
    this._poolIdx = 0;

    // Quadtree LOD selection: start from coarsest tiles covering the visible
    // extent, recursively subdivide where camera distance warrants finer LOD.
    // Guarantees complete spatial coverage - every area is either a leaf tile
    // or subdivided into 4 children, so no LOD boundary gaps are possible.
    const floorZoom = Math.floor(baseZoom);
    const tilesByKey = this._tilesByKey;

    // Inner radius: distance threshold for the finest LOD level.
    const maxLod = Math.min(floorZoom + 1, this.maxZoom);
    const baseTileSize = this.tileGrid.getTileSize(maxLod);
    const innerRadius = baseTileSize * 2;

    // Start from coarsest level (up to 6 levels coarser than finest)
    const startZoom = Math.max(this.minZoom, maxLod - 6);
    const startTileSize = this.tileGrid.getTileSize(startZoom);

    const startTiles = this.tileGrid.getTilesInExtent(
      { x: extentMin.x - startTileSize, y: extentMin.y - startTileSize },
      { x: extentMax.x + startTileSize, y: extentMax.y + startTileSize },
      startZoom,
    );

    for (const coord of startTiles) {
      this.subdivideQuadtree(
        coord.z, coord.x, coord.y,
        maxLod, innerRadius, cameraX, cameraY,
        extentMin, extentMax, tilesByKey, frustumPlanes,
      );
    }

    // Collect and sort visible tiles by distance (nearest first)
    for (const tile of tilesByKey.values()) {
      this._visibleTiles.push(tile);
    }
    this._visibleTiles.sort((a, b) => a.distance - b.distance);

    // Cap to maxInstances
    if (this._visibleTiles.length > this.maxInstances) {
      this._visibleTiles.length = this.maxInstances;
    }

    // Identify missing tiles (visible but not in atlas)
    for (const tile of this._visibleTiles) {
      if (!tile.atlas) this._missingTiles.push(tile);
    }

    // Identify parent tiles needed for geomorphing but not yet in atlas.
    // Parent tiles near the camera aren't in the visible set (superseded by finer children)
    // but are needed so the geomorphing shader can sample coarser elevation at LOD edges.
    this._seenParents.clear();
    for (const tile of this._visibleTiles) {
      if (tile.parentKey === NO_TILE_KEY || tile.parentAtlas) continue; // Already loaded or no parent
      if (this._seenParents.has(tile.parentKey)) continue;
      if (this.atlas.hasTile(tile.parentKey)) {
        // Parent loaded since update started; refresh parentAtlas
        tile.parentAtlas = this.atlas.getCoords(tile.parentKey);
        continue;
      }
      this._seenParents.add(tile.parentKey);

      if (tile.coord.z <= 0) continue;

      const parent = this._allocTile();
      parent.key = tile.parentKey;
      parent.coord.z = tile.coord.z - 1;
      parent.coord.x = tile.coord.x >> 1;
      parent.coord.y = tile.coord.y >> 1;
      parent.centerX = tile.centerX; // approximate - only used for sort distance
      parent.centerY = tile.centerY;
      parent.worldSize = tile.worldSize * 2;
      parent.distance = tile.distance;
      parent.atlas = null;
      parent.parentKey = NO_TILE_KEY;
      parent.parentAtlas = null;
      parent.neighborLodPacked = 0;
      this._missingParentTiles.push(parent);
    }

    // Touch all visible tiles in the atlas (prevent LRU eviction)
    for (const tile of this._visibleTiles) {
      if (tile.atlas) {
        this.atlas.touch(tile.key);
      }
      // Also touch parent (needed for geomorphing fallback)
      if (tile.parentKey !== NO_TILE_KEY) {
        this.atlas.touch(tile.parentKey);
      }
    }

    // Compute neighbor LOD differences for geomorphing
    this.computeNeighborLod(tilesByKey);

    // Build instance buffer
    this.buildInstanceBuffer();

    // Touch ancestor tiles used as fallback (prevent LRU eviction of ancestors
    // that are actively providing elevation data for tiles still loading).
    // Must run after buildInstanceBuffer() which populates _usedAncestorKeys.
    for (const key of this._usedAncestorKeys) {
      this.atlas.touch(key);
    }
  }

  /** Tiles visible this frame. */
  get visibleTiles(): readonly VisibleTile[] {
    return this._visibleTiles;
  }

  /** Tiles visible but not yet loaded in the atlas, sorted by distance (nearest first). */
  get missingTiles(): readonly VisibleTile[] {
    return this._missingTiles;
  }

  /** Parent tiles needed for geomorphing but not yet in the atlas. */
  get missingParentTiles(): readonly VisibleTile[] {
    return this._missingParentTiles;
  }

  // ==== Private ====

  /**
   * Compute the target zoom level for a given distance from camera.
   * Uses a concentric-ring pattern at tile granularity.
   */
  private computeTargetZoom(dist: number, innerRadius: number, maxLod: number): number {
    if (dist <= 0 || innerRadius <= 0) return Math.min(maxLod, this.maxZoom);

    // Each LOD level doubles the distance threshold
    const lodOffset = Math.max(0, Math.floor(Math.log2(dist / innerRadius)));
    const zoom = Math.max(this.minZoom + 2, Math.min(maxLod - lodOffset, this.maxZoom));
    return zoom;
  }

  /**
   * Recursive quadtree LOD selection. Decides whether a tile should be a
   * leaf (included as visible) or subdivided into 4 finer children.
   * Guarantees complete spatial coverage: no area is ever skipped.
   *
   * Takes z/x/y as separate primitives (not a TileCoord object) to
   * eliminate ~400-800 per-frame object allocations from recursive calls.
   */
  private subdivideQuadtree(
    z: number, x: number, y: number,
    maxLod: number,
    innerRadius: number,
    cameraX: number,
    cameraY: number,
    extentMin: WorldPoint,
    extentMax: WorldPoint,
    tilesByKey: Map<number, VisibleTile>,
    frustumPlanes: Float32Array | null,
  ): void {
    // Compute tile center into reusable output object (avoids allocations)
    const center = this._centerOut;
    this.tileGrid.tileToWorldCenterOut(z, x, y, center);
    const tileSize = this.tileGrid.getTileSize(z);

    // AABB cull: skip tiles entirely outside the visible extent
    const halfTile = tileSize * 0.5;
    const margin = tileSize;
    if (center.x + halfTile < extentMin.x - margin ||
        center.x - halfTile > extentMax.x + margin ||
        center.y + halfTile < extentMin.y - margin ||
        center.y - halfTile > extentMax.y + margin) {
      return;
    }

    // Frustum plane cull: tight trapezoid rejection for tilted views.
    // Tests the tile AABB against each of the 4 inward-facing half-planes.
    // A tile is rejected if its "most-inside" corner is outside any plane.
    // Cost: ~2 dot products on average (early break on first failing plane).
    if (frustumPlanes !== null) {
      let outside = false;
      for (let p = 0; p < 4; p++) {
        const nx = frustumPlanes[p * 3];
        const ny = frustumPlanes[p * 3 + 1];
        const d  = frustumPlanes[p * 3 + 2];
        // Pick the AABB corner most in the direction of the plane normal
        const testX = center.x + (nx > 0 ? halfTile : -halfTile);
        const testY = center.y + (ny > 0 ? halfTile : -halfTile);
        if (nx * testX + ny * testY + d < 0) { outside = true; break; }
      }
      if (outside) return;
    }

    const dx = center.x - cameraX;
    const dy = center.y - cameraY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const targetZoom = this.computeTargetZoom(dist, innerRadius, maxLod);

    // Leaf: tile's zoom is at or finer than the target, or at max zoom.
    // The >= comparison is key: at LOD boundaries, a tile one level finer
    // than targetZoom is still included (not skipped), eliminating gaps.
    if (z >= targetZoom || z >= this.maxZoom) {
      const key = packTileKey(z, x, y);
      if (tilesByKey.has(key)) return;

      const atlas = this.atlas.getCoords(key);
      const pz = z - 1;
      const parentKey = pz >= 0
        ? packTileKey(pz, x >> 1, y >> 1)
        : NO_TILE_KEY;
      const parentAtlas = parentKey !== NO_TILE_KEY ? this.atlas.getCoords(parentKey) : null;

      const tile = this._allocTile();
      tile.key = key;
      tile.coord.z = z;
      tile.coord.x = x;
      tile.coord.y = y;
      tile.centerX = center.x;
      tile.centerY = center.y;
      tile.worldSize = tileSize;
      tile.distance = dist;
      tile.atlas = atlas;
      tile.parentKey = parentKey;
      tile.parentAtlas = parentAtlas;
      tile.neighborLodPacked = 0;
      tilesByKey.set(key, tile);

      return;
    }

    // Subdivide into 4 children at the next finer zoom level
    const cz = z + 1;
    const cx = x * 2;
    const cy = y * 2;
    this.subdivideQuadtree(cz, cx,     cy,     maxLod, innerRadius, cameraX, cameraY, extentMin, extentMax, tilesByKey, frustumPlanes);
    this.subdivideQuadtree(cz, cx + 1, cy,     maxLod, innerRadius, cameraX, cameraY, extentMin, extentMax, tilesByKey, frustumPlanes);
    this.subdivideQuadtree(cz, cx,     cy + 1, maxLod, innerRadius, cameraX, cameraY, extentMin, extentMax, tilesByKey, frustumPlanes);
    this.subdivideQuadtree(cz, cx + 1, cy + 1, maxLod, innerRadius, cameraX, cameraY, extentMin, extentMax, tilesByKey, frustumPlanes);
  }

  /** Reusable output for findAncestorAtlas (avoids per-call allocation).
   *  Coords is always set to a valid AtlasCoords before the object is returned. */
  private readonly _ancestorOut: { coords: AtlasCoords; ancestorZ: number; key: number } =
    { coords: { u: 0, v: 0, scale: 0 }, ancestorZ: 0, key: 0 };

  /**
   * Walk up the ancestor chain to find the nearest loaded tile in the atlas.
   * Returns atlas coords and the ancestor's zoom level, or null if none found.
   * Returns a reusable reference — consume immediately, do not retain.
   */
  private findAncestorAtlas(coord: TileCoord): { coords: AtlasCoords; ancestorZ: number; key: number } | null {
    let az = coord.z - 1;
    let ax = coord.x >> 1;
    let ay = coord.y >> 1;
    while (az >= this.minZoom) {
      const key = packTileKey(az, ax, ay);
      const coords = this.atlas.getCoords(key);
      if (coords) {
        const out = this._ancestorOut;
        out.coords = coords;
        out.ancestorZ = az;
        out.key = key;
        return out;
      }
      ax >>= 1;
      ay >>= 1;
      az--;
    }
    return null;
  }

  /**
   * Build the flat Float32Array instance buffer from visible tiles.
   */
  private buildInstanceBuffer(): void {
    const buf = this.instanceData;
    let count = 0;
    this._usedAncestorKeys.clear();

    for (const tile of this._visibleTiles) {
      // For tiles not yet loaded in the atlas, walk up the ancestor chain
      // to find the nearest loaded ancestor and map into its sub-region.
      let atlasU = 0, atlasV = 0, atlasScale = 0;
      let hasAtlasData = false;

      if (tile.atlas) {
        atlasU = tile.atlas.u;
        atlasV = tile.atlas.v;
        atlasScale = tile.atlas.scale;
        hasAtlasData = true;
      } else {
        // Multi-level ancestor fallback: walk z-1, z-2, ... until we find loaded data
        const ancestor = this.findAncestorAtlas(tile.coord);
        if (ancestor) {
          const n = tile.coord.z - ancestor.ancestorZ;
          const divisor = 1 << n;
          const relX = (tile.coord.x % divisor) / divisor;
          const relY = (tile.coord.y % divisor) / divisor;
          const subScale = 1 / divisor;

          atlasU = ancestor.coords.u + relX * ancestor.coords.scale;
          atlasV = ancestor.coords.v + relY * ancestor.coords.scale;
          atlasScale = ancestor.coords.scale * subScale;
          hasAtlasData = true;
          this._usedAncestorKeys.add(ancestor.key);
        }
      }

      // Skip tiles with no atlas data at all (not even ancestor fallback)
      if (!hasAtlasData) continue;

      const offset = count * INSTANCE_FLOATS;

      buf[offset + 0] = tile.centerX;                                        // worldX
      buf[offset + 1] = tile.centerY;                                        // worldY
      buf[offset + 2] = tile.worldSize;                                      // worldScale
      buf[offset + 3] = atlasU;                                              // atlasU
      buf[offset + 4] = atlasV;                                              // atlasV
      buf[offset + 5] = atlasScale;                                          // atlasScale
      buf[offset + 6] = tile.coord.z;                                        // tileLod

      // Parent atlas: quadrant-adjusted coords for geomorphing.
      // The child tile occupies one quadrant of the parent tile.
      if (tile.parentAtlas) {
        const qx = tile.coord.x % 2;
        const qy = tile.coord.y % 2;
        buf[offset + 7] = tile.parentAtlas.u + qx * tile.parentAtlas.scale * 0.5;
        buf[offset + 8] = tile.parentAtlas.v + qy * tile.parentAtlas.scale * 0.5;
        buf[offset + 9] = tile.parentAtlas.scale * 0.5;
      } else {
        buf[offset + 7] = 0;
        buf[offset + 8] = 0;
        buf[offset + 9] = 0;
      }

      buf[offset + 10] = tile.neighborLodPacked;                             // neighborLodPacked

      count++;
    }

    this.instanceCount = count;
  }

  /** Wrap an X tile coordinate for longitude wrapping. */
  private static wrapTileX(nx: number, numTiles: number): number {
    return ((nx % numTiles) + numTiles) % numTiles;
  }

  /**
   * Compute neighbor LOD differences for geomorphing.
   * For each visible tile, determine the LOD of the tile covering each
   * of its 4 edges. Pack differences into neighborLodPacked.
   *
   * Uses a transient cache to avoid redundant ancestor walks for symmetric
   * neighbors (e.g. tile A's right = tile B's left).
   */
  private computeNeighborLod(tilesByKey: Map<number, VisibleTile>): void {
    this._neighborLodCache.clear();

    for (const tile of this._visibleTiles) {
      const { z, x, y } = tile.coord;
      const numTiles = 1 << z;

      const dLeft = this.findNeighborLodDiff(z, TilePool.wrapTileX(x - 1, numTiles), y, numTiles, tilesByKey);
      const dRight = this.findNeighborLodDiff(z, TilePool.wrapTileX(x + 1, numTiles), y, numTiles, tilesByKey);
      const dBottom = this.findNeighborLodDiff(z, x, y + 1, numTiles, tilesByKey);
      const dTop = this.findNeighborLodDiff(z, x, y - 1, numTiles, tilesByKey);

      // Pack 4 values (4 bits each): L + R*16 + B*256 + T*4096
      tile.neighborLodPacked = dLeft + dRight * 16 + dBottom * 256 + dTop * 4096;
    }
  }

  /**
   * Find the LOD difference between a tile at `originZ` and the visible
   * tile covering the neighbor position (nz, nx, ny).
   * Walks from the same zoom level down to coarser levels until a visible tile is found.
   * Results are cached in _neighborLodCache to avoid redundant ancestor walks.
   */
  private findNeighborLodDiff(
    nz: number,
    nx: number,
    ny: number,
    numTilesAtZ: number,
    tilesByKey: Map<number, VisibleTile>,
  ): number {
    // Out of Y bounds - no neighbor, no morph
    if (ny < 0 || ny >= numTilesAtZ) return 0;

    // Check cache first (symmetric neighbors share the same lookup)
    const cacheKey = packTileKey(nz, nx, ny);
    const cached = this._neighborLodCache.get(cacheKey);
    if (cached !== undefined) return cached;

    let cx = nx, cy = ny;

    for (let z = nz; z >= this.minZoom; z--) {
      const key = packTileKey(z, cx, cy);
      if (tilesByKey.has(key)) {
        const diff = Math.max(0, nz - z);
        this._neighborLodCache.set(cacheKey, diff);
        return diff;
      }
      // Move to parent tile coordinates
      cx >>= 1;
      cy >>= 1;
    }

    this._neighborLodCache.set(cacheKey, 0);
    return 0; // No neighbor found
  }

}
