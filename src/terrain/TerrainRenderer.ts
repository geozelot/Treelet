// ============================================================================
// treelet.js - Instanced Terrain Renderer
//
// Main orchestrator for the instanced terrain system.
// Renders ALL visible tiles in a single instanced draw call
// from a unified hierarchical atlas.
//
// Architecture:
//   Camera move → update(nadir, zoom)
//     → TilePool: LOD selection, instance buffer build
//     → UnifiedAtlas: touch visible tiles (LRU), advance frame
//     → InstancedBufferGeometry: upload per-instance attributes
//     → GPU: single drawArraysInstanced → VTF displacement, per-pixel normals
//
// Tile fetching:
//   fetchTiles() → TilePool.missingTiles (sorted by distance)
//     → WorkerPool: fetch + decode → Float32Array
//     → UnifiedAtlas: allocate slot, write elevation data
// ============================================================================

import {
  Mesh,
  InstancedBufferGeometry,
  InstancedBufferAttribute,
  DynamicDrawUsage,
  Vector3,
  type ShaderMaterial,
  type WebGLRenderer,
} from 'three';
import type { TileCoord, ShaderMode, BlendMode, ColorRamp, WorldPoint } from '../core/types';
import type { TileGrid } from '../tiles/TileGrid';
import type { WorkerPool } from '../workers/WorkerPool';
import type { SceneManager } from '../scene/SceneManager';
import type { LayerRegistry } from '../layers/LayerRegistry';
import type { DrapeLayer } from '../layers/DrapeLayer';
import { packTileKey, parseTileKey, tileKeyStr, NO_TILE_KEY } from '../tiles/TileIndex';
import { buildTileGrid, TILE_GRID_RESOLUTION } from './TileGeometry';
import { UnifiedAtlas, type SourceRegion } from './UnifiedAtlas';
import { UnifiedDrapeAtlas } from './UnifiedDrapeAtlas';
import { TilePool, INSTANCE_FLOATS } from './TilePool';
import {
  DEFAULT_ATLAS_SIZE,
  DEFAULT_SLOT_SIZE,
  DEFAULT_MAX_INSTANCES,
  DEFAULT_MAX_CONCURRENT_FETCHES,
} from '../core/constants';
import {
  createTerrainMaterial,
  setTerrainMode,
  setTerrainColorRamp,
  setTerrainWireframe,
  setTerrainIsolineEnabled,
  setTerrainIsolineSettings,
  setTerrainIsolineColor,
  setTerrainBaseWhite,
  setTerrainElevationRange,
  setTerrainElevationScale,
  setTerrainSunDirection,
  setTerrainAtlas,
  setTerrainDrape,
  setTerrainDrapeBlendMode,
  setTerrainHillshadeStrength,
  setTerrainDrapePlaceholder,
  setTerrainMorphWidth,
} from '../shaders/TerrainMaterial';

/** Time budget (ms) for deferred elevation tile writes per animation frame.
 *  Used for sources where fetches burst-complete simultaneously.
 *  Each write involves a ~5-15ms bilinear resample; 8ms leaves headroom
 *  for rendering within a 16.67ms frame budget at 60 FPS. */
const WRITE_BUDGET_MS = 8;

/** Prefetch lookahead multiplier: extend extent by velocity × this many frames. */
const PREFETCH_LOOKAHEAD_FRAMES = 10;

/** Base margin (in tile widths) added to frustum planes to compensate for
 *  terrain elevation displacement and far-corner horizon-clamping jitter.
 *  ~10% of the visible extent at typical views. */
const FRUSTUM_BASE_MARGIN_TILES = 3;

/** A sub-tile that hasn't been launched yet (stored in CompositeTracker). */
interface PendingSubTile {
  subKey: number;
  regionX: number;
  regionY: number;
  subSize: number;
  fetchFn: () => Promise<ImageBitmap | null>;
}

/** Tracks in-flight sub-tile composites for a single elevation slot (lodOffset > 1). */
interface CompositeTracker {
  /** Sub-tiles currently in-flight. */
  inflight: number;
  /** Sub-tiles that have completed (success or failure). */
  completed: number;
  /** Total sub-tiles needed for this slot (divisor²). */
  total: number;
  /** Sub-tiles not yet launched (waiting for concurrency slots). */
  pending: PendingSubTile[];
  /** Atlas slot pixel coordinates (shared with elevation). */
  atlasX: number;
  atlasY: number;
  tilePixels: number;
  /** The target drape zoom level for this composite. */
  effectiveZ: number;
}

export class TerrainRenderer {
  private readonly tileGrid: TileGrid;
  private readonly workerPool: WorkerPool;
  private readonly layerRegistry: LayerRegistry;
  private readonly sceneManager: SceneManager;
  private readonly glRenderer: WebGLRenderer;
  private readonly metersToScene: number;

  /** Configurable atlas and performance parameters. */
  private readonly atlasSize: number;
  private readonly slotSize: number;
  private readonly maxInstances: number;
  private readonly maxConcurrentFetches: number;

  /** Unified elevation atlas. */
  private readonly atlas: UnifiedAtlas;

  /** Tile LOD selection and instance buffer manager. */
  private readonly tilePool: TilePool;

  /** The single instanced mesh containing all visible terrain tiles. */
  readonly mesh: Mesh;

  /** Material for the instanced mesh. */
  readonly material: ShaderMaterial;

  /** Instanced geometry with per-instance attributes. */
  private readonly instancedGeo: InstancedBufferGeometry;

  // Per-instance attribute buffers (flat Float32Arrays)
  private readonly aTileWorld: InstancedBufferAttribute;
  private readonly aTileScale: InstancedBufferAttribute;
  private readonly aAtlasCoord: InstancedBufferAttribute;
  private readonly aTileLod: InstancedBufferAttribute;
  private readonly aParentAtlas: InstancedBufferAttribute;
  private readonly aNeighborLod: InstancedBufferAttribute;

  /** Previous base zoom for detecting zoom level changes. */
  private lastBaseZoom = -1;

  /**
   * Monotonic epoch for stale fetch detection.
   * Incremented on reload() (base layer change).
   */
  private fetchEpoch = 0;

  /** Pending tile fetches (by numeric tile key). */
  private readonly pendingTiles = new Set<number>();

  /** Write queue: fetched elevation data waiting to be written to the atlas.
   *  Drained up to MAX_WRITES_PER_FRAME per animation frame to spread
   *  the cost of bilinear resampling across frames.
   *  Uses index-based drain (_writeHead) to avoid O(n) Array.shift(). */
  private readonly pendingWrites: Array<{
    key: number;
    elevations: Float32Array;
    width: number;
    height: number;
    epoch: number;
    overzoom: { dz: number; relX: number; relY: number } | null;
  }> = [];

  /** Read cursor into pendingWrites (entries before this index are consumed). */
  private _writeHead = 0;

  /** Keys of tiles in the write queue (prevents re-fetching tiles that
   *  have been fetched but not yet written to the atlas). */
  private readonly queuedWriteKeys = new Set<number>();

  /** Currently active drape layer. */
  private activeDrapeLayer: DrapeLayer | null = null;

  /** Unified drape atlas (created lazily when a drape layer is activated). */
  private drapeAtlas: UnifiedDrapeAtlas | null = null;

  /** Pending drape tile fetches (by numeric tile key).
   *  For lodOffset > 1, individual sub-tile keys are added (not the parent key). */
  private readonly pendingDrapeTiles = new Set<number>();

  /** In-flight composite drape slots (lodOffset > 1).
   *  Keyed by elevation tile key → tracker with remaining sub-tile count. */
  private readonly _compositeParents = new Map<number, CompositeTracker>();

  /** Effective drape zoom at which each tile's drape was loaded.
   *  Used to detect when a zoom transition makes the existing drape stale
   *  (e.g. a former center-ring tile needs composite at finer resolution).
   *  The old canvas data stays visible until the new composite overwrites it. */
  private readonly _drapeEffectiveZ = new Map<number, number>();

  /** Microtask-coalesced fetchDrapeTiles re-trigger flag.
   *  When multiple fetch completions fire in the same microtask,
   *  only the first schedules a fetchDrapeTiles() call — the rest are no-ops.
   *  This collapses N completion callbacks into a single O(visibleTiles) scan. */
  private _drapeFetchQueued = false;

  /** Previous camera position for velocity-based prefetch. */
  private prevNadirX = 0;
  private prevNadirY = 0;

  /** Reusable extent objects to avoid per-frame allocation. */
  private readonly _extentMin: WorldPoint = { x: 0, y: 0 };
  private readonly _extentMax: WorldPoint = { x: 0, y: 0 };

  /** Pre-allocated frustum planes for per-frame trapezoid culling.
   *  Copied from FrustumCalculator output so the margin adjustment
   *  doesn't mutate the calculator's internal buffer. */
  private readonly _frustumPlanes = new Float32Array(12);

  /** Fingerprint of the last instance buffer uploaded to the GPU.
   *  Used to skip redundant per-attribute scatter + upload when neither
   *  the visible tile set nor any atlas coordinates have changed. */
  private _lastInstanceHash = 0;
  /** Uint32 view over TilePool.instanceData for fast integer hashing.
   *  Allocated lazily in uploadInstanceData() (TilePool's Float32Array
   *  isn't available at construction). */
  private _instanceU32: Uint32Array | null = null;

  /** Reusable point for elevation sampling (avoids per-frame allocation). */
  private readonly _samplePoint: WorldPoint = { x: 0, y: 0 };

  /** Cleanup handle for the OS theme listener (drape placeholder color). */
  private readonly _themeCleanup: () => void;

  /** Treelet-level zoom bounds: hard camera clamp (outer envelope).
   *  Nothing exceeds this range - the camera cannot zoom outside these bounds.
   *  Set once at construction from the Treelet init options. */
  private readonly baseMinZoom: number;
  private readonly baseMaxZoom: number;

  /** Effective zoom bounds (intersection of map + active layer visibility bounds).
   *  Controls how far the quadtree subdivides for LOD selection. */
  private effectiveMinZoom: number;
  private effectiveMaxZoom: number;

  constructor(
    tileGrid: TileGrid,
    workerPool: WorkerPool,
    sceneManager: SceneManager,
    layerRegistry: LayerRegistry,
    metersToScene: number,
    minZoom: number = 2,
    maxZoom: number = 15,
    tileSegments: number = TILE_GRID_RESOLUTION,
    atlasSize: number = DEFAULT_ATLAS_SIZE,
    slotSize: number = DEFAULT_SLOT_SIZE,
    maxInstances: number = DEFAULT_MAX_INSTANCES,
    maxConcurrentFetches: number = DEFAULT_MAX_CONCURRENT_FETCHES,
  ) {
    this.tileGrid = tileGrid;
    this.workerPool = workerPool;
    this.sceneManager = sceneManager;
    this.layerRegistry = layerRegistry;
    this.glRenderer = sceneManager.renderer;
    this.metersToScene = metersToScene;
    this.atlasSize = atlasSize;
    this.slotSize = slotSize;
    this.maxInstances = maxInstances;
    this.maxConcurrentFetches = maxConcurrentFetches;
    this.baseMinZoom = minZoom;
    this.baseMaxZoom = maxZoom;
    this.effectiveMinZoom = minZoom;
    this.effectiveMaxZoom = maxZoom;

    // ==== Atlas ====
    this.atlas = new UnifiedAtlas(atlasSize, slotSize);

    // Wire eviction callback: always clear stale drape pixels and tracking.
    // The slot will be immediately filled with ancestor drape data (correct
    // sub-region blit) in fetchAndWriteElevation after the elevation write.
    this.atlas.onSlotEvicted = (evictedKey) => {
      if (this.drapeAtlas) {
        const coords = this.atlas.getCoordsPixels(evictedKey);
        if (coords) {
          this.drapeAtlas.clearSlot(coords.atlasX, coords.atlasY, coords.tilePixels);
        }
        this.drapeAtlas.evictTile(evictedKey);
      }
      // Cancel any in-flight composite for this slot (sub-tile results would
      // write into the now-reallocated slot belonging to a different tile).
      this._compositeParents.delete(evictedKey);
      this._drapeEffectiveZ.delete(evictedKey);
    };

    // ==== Tile Pool ====
    this.tilePool = new TilePool(tileGrid, this.atlas, minZoom, maxZoom, maxInstances);

    // ==== Shared tile geometry ====
    // Clamp to atlas slot size - more segments than texels is wasted geometry
    const clampedSegments = Math.min(tileSegments, slotSize);
    const baseGeo = buildTileGrid(clampedSegments);

    // ==== Instanced geometry ====
    this.instancedGeo = new InstancedBufferGeometry();
    this.instancedGeo.index = baseGeo.index;
    this.instancedGeo.setAttribute('position', baseGeo.getAttribute('position'));
    this.instancedGeo.setAttribute('uv', baseGeo.getAttribute('uv'));

    // Allocate per-instance attribute buffers
    const worldBuf = new Float32Array(maxInstances * 2);
    const scaleBuf = new Float32Array(maxInstances);
    const atlasBuf = new Float32Array(maxInstances * 3);
    const lodBuf = new Float32Array(maxInstances);
    const parentBuf = new Float32Array(maxInstances * 3);
    const neighborBuf = new Float32Array(maxInstances);

    this.aTileWorld = new InstancedBufferAttribute(worldBuf, 2);
    this.aTileScale = new InstancedBufferAttribute(scaleBuf, 1);
    this.aAtlasCoord = new InstancedBufferAttribute(atlasBuf, 3);
    this.aTileLod = new InstancedBufferAttribute(lodBuf, 1);
    this.aParentAtlas = new InstancedBufferAttribute(parentBuf, 3);
    this.aNeighborLod = new InstancedBufferAttribute(neighborBuf, 1);

    // Dynamic: updated every frame
    this.aTileWorld.setUsage(DynamicDrawUsage);
    this.aTileScale.setUsage(DynamicDrawUsage);
    this.aAtlasCoord.setUsage(DynamicDrawUsage);
    this.aTileLod.setUsage(DynamicDrawUsage);
    this.aParentAtlas.setUsage(DynamicDrawUsage);
    this.aNeighborLod.setUsage(DynamicDrawUsage);

    this.instancedGeo.setAttribute('iTileWorld', this.aTileWorld);
    this.instancedGeo.setAttribute('iTileScale', this.aTileScale);
    this.instancedGeo.setAttribute('iAtlasCoord', this.aAtlasCoord);
    this.instancedGeo.setAttribute('iTileLod', this.aTileLod);
    this.instancedGeo.setAttribute('iParentAtlas', this.aParentAtlas);
    this.instancedGeo.setAttribute('iNeighborLod', this.aNeighborLod);

    // Start with zero instances
    this.instancedGeo.instanceCount = 0;

    // ==== Material ====
    this.material = createTerrainMaterial({
      metersToScene,
      atlasSize,
    });
    setTerrainAtlas(this.material, this.atlas.texture);

    // Theme-aware drape placeholder: white (light) / dark grey (dark)
    const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
    const applyPlaceholder = (dark: boolean) => {
      const c = dark ? 0.18 : 1.0;
      setTerrainDrapePlaceholder(this.material, c, c, c);
    };
    applyPlaceholder(darkMq.matches);
    const themeHandler = () => applyPlaceholder(darkMq.matches);
    darkMq.addEventListener('change', themeHandler);
    this._themeCleanup = () => darkMq.removeEventListener('change', themeHandler);

    // ==== Mesh ====
    this.mesh = new Mesh(this.instancedGeo, this.material);
    this.mesh.frustumCulled = false; // We do our own LOD / frustum logic
    sceneManager.addTileMesh(this.mesh);

    // Clean up template geometry (data is copied into instancedGeo)
    baseGeo.dispose();
  }

  // =========================================================================
  // Per-frame update
  // =========================================================================

  /**
   * Recompute effective zoom bounds for the TilePool quadtree.
   *
   * The map-level baseMinZoom/baseMaxZoom is the hard camera clamp - enforced
   * by the camera controller so zoom never leaves that range. It is NOT used
   * as a TilePool ceiling because TilePool.update() computes
   * `maxLod = floor(zoom) + 1`, which is one level finer than the camera zoom.
   * Capping at baseMaxZoom would prevent that +1 from ever exceeding the
   * source's data range, blocking overzoom entirely.
   *
   * Instead the TilePool ceiling comes from the layer visibility bounds
   * (layer.maxZoom, default 22). The camera clamp naturally limits how far
   * the quadtree subdivides - zoom ≤ baseMaxZoom → maxLod ≤ baseMaxZoom + 1.
   *
   * Source data availability beyond the upper end (overzoom) is handled by
   * BaseLayer.getOverzoomRegion — finer tiles get URLs clamped to the
   * source's maxZoom and extract sub-regions from the parent image.
   *
   * Underzoom has no analogous mechanism: there is no way to synthesize a
   * coarser tile when the source only publishes fine zooms. To prevent
   * tiles being requested below `source.minZoom` (which would 404), the
   * floor takes the maximum of the map clamp, the layer visibility bound,
   * and the source's own minZoom.
   */
  private updateEffectiveZoomBounds(): void {
    const baseLayer = this.layerRegistry.getActiveBaseLayer();
    if (baseLayer) {
      this.effectiveMinZoom = Math.max(
        this.baseMinZoom,
        baseLayer.minZoom,
        baseLayer.source.minZoom,
      );
      this.effectiveMaxZoom = baseLayer.maxZoom;
    } else {
      this.effectiveMinZoom = this.baseMinZoom;
      this.effectiveMaxZoom = this.baseMaxZoom;
    }
    this.tilePool.setZoomRange(this.effectiveMinZoom, this.effectiveMaxZoom);
  }

  /**
   * Per-frame update: LOD selection, instance buffer build, transitions.
   * Lightweight - safe to call every animation frame.
   */
  updateFrame(
    nadirX: number,
    nadirY: number,
    zoom: number,
    exaggeration: number,
  ): void {
    // Sync LOD bounds from map clamp ∩ active layer visibility
    this.updateEffectiveZoomBounds();

    // Layer visibility: hide terrain when camera zoom is outside the layer's bounds
    const baseLayer = this.layerRegistry.getActiveBaseLayer();
    if (baseLayer && (zoom < baseLayer.minZoom || zoom > baseLayer.maxZoom)) {
      this.instancedGeo.instanceCount = 0;
      return;
    }

    const baseZoom = Math.floor(zoom) + 1;
    const zoomChanged = baseZoom !== this.lastBaseZoom;

    // Advance atlas LRU frame counter
    this.atlas.advanceFrame();

    // ==== Drain pending elevation writes (budget-limited) ====
    this.drainPendingWrites();

    // ==== Zoom change: keep both atlas data (ancestor fallback handles continuity) ====
    if (zoomChanged) {
      this.lastBaseZoom = baseZoom;
      // Old drape data persists - ancestor UV fallback samples it naturally.
      // Eviction callback handles slot cleanup when elevation reallocates.
      // Clear stale pending keys so they don't block maxConcurrentFetches.
      // The per-frame stall recovery below restarts the fetch chain.
      this.pendingDrapeTiles.clear();
      this._compositeParents.clear();
      // Don't clear _drapeEffectiveZ here: the per-tile zoom records let
      // fetchDrapeTiles() detect stale-resolution drape and seamlessly
      // re-fetch at the new neededZ without clearing loadedTiles (which
      // would break fillDrapeFromAncestor and cause placeholder flashes).
    }

    // ==== Visible extent + prefetch ====
    const tileSize = this.tileGrid.getTileSize(Math.max(2, baseZoom));
    const extentHalf = tileSize * 16;
    const extentMin = this._extentMin;
    const extentMax = this._extentMax;
    extentMin.x = nadirX - extentHalf;
    extentMin.y = nadirY - extentHalf;
    extentMax.x = nadirX + extentHalf;
    extentMax.y = nadirY + extentHalf;

    // Extend extent in camera movement direction for prefetch
    const velX = nadirX - this.prevNadirX;
    const velY = nadirY - this.prevNadirY;
    if (velX !== 0 || velY !== 0) {
      const lookX = velX * PREFETCH_LOOKAHEAD_FRAMES;
      const lookY = velY * PREFETCH_LOOKAHEAD_FRAMES;
      if (lookX > 0) extentMax.x += lookX; else extentMin.x += lookX;
      if (lookY > 0) extentMax.y += lookY; else extentMin.y += lookY;
    }
    this.prevNadirX = nadirX;
    this.prevNadirY = nadirY;

    // ==== Frustum plane culling (tight trapezoid for tilted views) ====
    // Compute 2D half-planes from the ground-plane frustum trapezoid.
    // At top-down view, returns null → TilePool uses AABB-only culling.
    const extent = this.sceneManager.getVisibleExtent();
    let frustumPlanes: Float32Array | null = null;
    if (extent) {
      const srcPlanes = this.sceneManager.getVisibleFrustumPlanes(extent);
      if (srcPlanes) {
        // Copy into our buffer so we can adjust margins without mutating
        // the FrustumCalculator's reusable array.
        this._frustumPlanes.set(srcPlanes);
        frustumPlanes = this._frustumPlanes;

        // Base margin: pad the frustum outward by a few tile widths to
        // compensate for two effects the flat ground-plane model misses:
        //  1. Terrain elevation displacement — tiles whose 2D AABB lies
        //     just outside the frustum can have geometry displaced upward
        //     into the viewport by the VTF shader (especially near edge).
        //  2. Far-corner instability — the artificial horizon clamp makes
        //     the far frustum plane jitter when the camera angle changes
        //     slightly. A buffer absorbs these small shifts.
        // 3 tile widths ≈ 10% of the ~32-tile-wide extent, preserving
        // the majority of the culling benefit at steep tilt.
        const baseMargin = tileSize * FRUSTUM_BASE_MARGIN_TILES;
        for (let p = 0; p < 4; p++) {
          frustumPlanes[p * 3 + 2] += baseMargin;
        }

        // Widen further by the prefetch lookahead distance.
        // This keeps tiles slightly outside the current frustum (in the
        // direction of camera motion) in the quadtree so they get fetched,
        // while still culling tiles far outside on the perpendicular axis.
        const speed = Math.sqrt(velX * velX + velY * velY);
        if (speed > 0) {
          const planeMargin = speed * PREFETCH_LOOKAHEAD_FRAMES;
          for (let p = 0; p < 4; p++) {
            frustumPlanes[p * 3 + 2] += planeMargin;
          }
        }
      }
    }

    // ==== TilePool: LOD selection + instance buffer ====
    this.tilePool.update(nadirX, nadirY, zoom, extentMin, extentMax, frustumPlanes);

    // ==== Pin all visible tiles to protect from LRU eviction ====
    // Without this, atlas-saturated views cause evict→re-fetch flicker.
    // When all slots are pinned, new tile allocations gracefully return
    // null and retry when view changes free up slots.
    this.atlas.clearPins();
    const visibleTiles = this.tilePool.visibleTiles;
    for (const tile of visibleTiles) {
      if (tile.atlas) this.atlas.pin(tile.key);
      // Also pin parents (needed for geomorphing blend)
      if (tile.parentKey !== NO_TILE_KEY) this.atlas.pin(tile.parentKey);
    }

    // ==== Upload instance data to GPU attributes ====
    this.uploadInstanceData();

    // ==== Elevation atlas: GPU upload ====
    // Sub-region upload via raw gl.texSubImage2D (~256KB per dirty slot).
    this.atlas.uploadDirtySlots(this.glRenderer);

    // ==== Elevation stall recovery ====
    // If no elevation fetches are in-flight but tiles still need loading,
    // restart the fetch chain. This handles the initial load (scheduleTiles
    // fires via setTimeout before the first updateFrame populates missingTiles)
    // and rapid zoom transitions that clear pending state.
    if (this.pendingTiles.size === 0 && this.tilePool.missingTiles.length > 0) {
      this.fetchElevationTiles();
    }

    // ==== Drape atlas: sub-region GPU upload ====
    // Upload only the changed 256×256 slots (~256KB each) instead of the
    // full 4096² canvas (~64MB). Eliminates frame stalls during tile loading.
    if (this.drapeAtlas) {
      this.drapeAtlas.uploadDirtySlots(this.glRenderer);

      // Stall recovery: if drape is active but fetch pipeline has stalled
      // (0 pending, yet tiles still need drape), restart the chain.
      // This handles rapid zoom transitions where pendingDrapeTiles.clear()
      // kills the re-triggering chain before all tiles are covered.
      // Quick check: only invoke fetchDrapeTiles if at least one visible
      // tile with atlas data is missing drape - avoids redundant work
      // every frame when all tiles are already draped.
      if (this.activeDrapeLayer && this.drapeAtlas && this.pendingDrapeTiles.size === 0) {
        let hasMissingDrape = false;
        const dLayer = this.activeDrapeLayer;
        const dOffset = dLayer.lodOffset - 1;
        const dMaxZ = dLayer.source?.maxZoom ?? Infinity;
        for (const tile of visibleTiles) {
          if (!tile.atlas || this._compositeParents.has(tile.key) ||
              tile.coord.z < dLayer.minZoom || tile.coord.z > dLayer.maxZoom) continue;
          if (!this.drapeAtlas.hasTile(tile.key)) {
            hasMissingDrape = true;
            break;
          }
          // Also detect stale-resolution drape that needs composite upgrade
          if (dOffset > 0 && tile.coord.z < this.lastBaseZoom) {
            const needed = Math.min(tile.coord.z + dOffset, this.lastBaseZoom, dMaxZ);
            if ((this._drapeEffectiveZ.get(tile.key) ?? 0) < needed) {
              hasMissingDrape = true;
              break;
            }
          }
        }
        if (hasMissingDrape) {
          this.fetchDrapeTiles();
        }
      }
    }

    // ==== Exaggeration ====
    this.setExaggeration(exaggeration);
  }

  // =========================================================================
  // Tile fetching
  // =========================================================================

  /**
   * Fetch missing elevation tiles. Called from debounced camera callback.
   */
  fetchTiles(): void {
    this.fetchElevationTiles();
    this.fetchDrapeTiles();
  }

  /**
   * Fetch missing elevation tiles. Called from debounced camera callback.
   */
  private fetchElevationTiles(): void {
    const baseLayer = this.layerRegistry.getActiveBaseLayer();
    if (!baseLayer) return;

    const hints = baseLayer.source.getSchedulingHints();

    // Fetch visible tiles first (sorted by distance), then parent tiles for geomorphing
    const queues = [this.tilePool.missingTiles, this.tilePool.missingParentTiles];

    for (const queue of queues) {
      for (const tile of queue) {
        if (this.pendingTiles.size >= hints.maxConcurrentFetches) return;
        if (this.pendingTiles.has(tile.key)) continue;
        if (this.atlas.hasTile(tile.key)) continue;
        if (this.queuedWriteKeys.has(tile.key)) continue;

        this.pendingTiles.add(tile.key);

        // Snapshot coord values: pool tiles are reused each frame, so async
        // closures must capture primitives (not the mutable coord object).
        const coord: TileCoord = { z: tile.coord.z, x: tile.coord.x, y: tile.coord.y };
        const key = tile.key;

        // Capture overzoom info: if this tile is beyond the source's max zoom,
        // the fetch URL will be clamped to source max but we need to extract
        // only the sub-region that corresponds to this child tile.
        const overzoom = baseLayer.getOverzoomRegion(coord);

        this.fetchAndWriteElevation(key, hints.deferWrites, overzoom, async () => {
          await baseLayer.source.ensureReady();
          const url = baseLayer.getTileUrl(coord);
          const proxy = this.workerPool.getProxy();
          // decoderSource is null for built-ins (terrain-rgb/mapbox/terrarium)
          // and the function source for anything else, so workers can compile
          // + cache custom/registered decoders they don't know natively.
          return proxy.fetchDecodeElevation(
            url,
            baseLayer.decoderType,
            baseLayer.decoderSource ?? undefined,
          );
        });
      }
    }
  }

  /**
   * Fetch missing drape imagery tiles. Mirrors elevation fetching but
   * writes ImageBitmaps into the unified drape atlas via canvas blitting.
   *
   * When the active drape layer has lodOffset > 1, non-center LOD rings
   * fetch finer sub-tiles and composite them into each atlas slot. The
   * center ring (already at finest zoom) uses the standard single-tile path.
   */
  private fetchDrapeTiles(): void {
    if (!this.activeDrapeLayer || !this.drapeAtlas) return;

    const drapeLayer = this.activeDrapeLayer;
    const drapeSource = drapeLayer.source;
    const offset = drapeLayer.lodOffset - 1; // 0 = no composite, 1 = 4 sub-tiles, 2 = 16

    // Priority 1: drain pending sub-tiles from existing composites.
    // Sub-tiles that couldn't be launched due to concurrency limits are
    // queued in the tracker and launched here as slots free up.
    this.drainPendingSubTiles();
    if (this.pendingDrapeTiles.size >= this.maxConcurrentFetches) return;

    // Priority 2: iterate visible tiles for new fetches
    for (const tile of this.tilePool.visibleTiles) {
      if (!tile.atlas) continue; // No elevation data → skip drape too

      // Skip tiles outside the drape layer's visibility bounds
      if (tile.coord.z < drapeLayer.minZoom || tile.coord.z > drapeLayer.maxZoom) continue;

      // lodOffset controls how many rings match center resolution:
      //   lodOffset=2 → ring 2 matches center, rings 3+ each get +1 boost
      //   lodOffset=3 → rings 2+3 match center, ring 4 gets +2 boost
      // Cap at lastBaseZoom so no ring fetches finer than center (wasteful).
      const useComposite = offset > 0
        && tile.coord.z < this.lastBaseZoom; // not center ring
      const neededZ = useComposite
        ? Math.min(tile.coord.z + offset, this.lastBaseZoom, drapeSource.maxZoom)
        : tile.coord.z;

      if (this.drapeAtlas.hasTile(tile.key)) {
        // Already loaded: skip unless composite resolution is stale.
        // On zoom-in, tiles that were center ring (single-tile drape at z=N)
        // become ring 2+ and need composite at z=N+1. Using >= avoids
        // downgrading tiles that already have finer-than-needed drape.
        if (this._drapeEffectiveZ.get(tile.key)! >= neededZ) continue;
        // Stale: effective zoom needs upgrading → fall through to re-fetch.
        // Old canvas data stays on GPU until new composite is fully complete.
      }
      if (this._compositeParents.has(tile.key)) continue; // composite in progress
      if (this.pendingDrapeTiles.size >= this.maxConcurrentFetches) break;

      // Get the elevation atlas slot pixel coords for this tile (drape mirrors them)
      const slotPixels = this.atlas.getCoordsPixels(tile.key);
      if (!slotPixels) continue;

      const { atlasX, atlasY, tilePixels } = slotPixels;

      // Snapshot coord: pool tiles are reused each frame.
      const coord: TileCoord = { z: tile.coord.z, x: tile.coord.x, y: tile.coord.y };
      const key = tile.key;

      if (useComposite) {
        // Composite path: fetch finer sub-tiles, capped at center zoom
        const actualOffset = neededZ - coord.z;

        if (actualOffset > 0) {
          this.fetchCompositeSubTiles(
            key, coord, atlasX, atlasY, tilePixels, actualOffset, neededZ, drapeSource,
          );
          continue;
        }
        // actualOffset === 0 → source maxZoom reached, fall through to single-tile
      }

      // Single-tile path (standard): one fetch per elevation slot
      if (this.pendingDrapeTiles.has(key)) continue;

      this.pendingDrapeTiles.add(key);

      // Clamp to source maxZoom for drape overzoom (mirrors BaseLayer.getTileUrl)
      const srcMaxZ = drapeSource.maxZoom;
      const clampedZ = Math.min(coord.z, srcMaxZ);
      const dz = coord.z - clampedZ;
      const fetchCoord: TileCoord = {
        z: clampedZ,
        x: coord.x >> dz,
        y: coord.y >> dz,
      };

      this.fetchAndWriteDrape(key, atlasX, atlasY, tilePixels, neededZ, async () => {
        const url = drapeSource.getTileUrl(fetchCoord);
        const response = await fetch(url);
        if (!response.ok) return null;
        const blob = await response.blob();

        // Overzoom: extract sub-region from the parent tile image
        if (dz > 0) {
          const fullImage = await createImageBitmap(blob);
          const divisor = 1 << dz;
          const subW = fullImage.width / divisor;
          const subH = fullImage.height / divisor;
          const relX = coord.x % divisor;
          const relY = coord.y % divisor;
          const cropped = await createImageBitmap(fullImage,
            relX * subW, relY * subH, subW, subH);
          fullImage.close();
          return cropped;
        }

        return createImageBitmap(blob);
      });
    }
  }

  /**
   * Schedule a fetchDrapeTiles() call via microtask coalescing.
   * Multiple calls within the same event task (e.g. several fetch completions
   * resolving simultaneously) collapse into a single fetchDrapeTiles()
   * invocation, avoiding redundant O(visibleTiles) scans.
   *
   * Used by async completion callbacks (finally blocks) instead of calling
   * fetchDrapeTiles() directly. Synchronous entry points (stall recovery,
   * public API, drainPendingWrites) still call fetchDrapeTiles() directly
   * for immediate response.
   */
  private scheduleDrapeFetch(): void {
    if (this._drapeFetchQueued) return;
    this._drapeFetchQueued = true;
    queueMicrotask(() => {
      this._drapeFetchQueued = false;
      this.fetchDrapeTiles();
    });
  }

  /**
   * Prepare a composite drape slot (lodOffset > 1): build the list of
   * sub-tiles, create a tracker, and launch as many as concurrency allows.
   * Remaining sub-tiles are stored in the tracker's `pending` array and
   * drained incrementally by `drainPendingSubTiles()`.
   */
  private fetchCompositeSubTiles(
    parentKey: number,
    parentCoord: TileCoord,
    atlasX: number,
    atlasY: number,
    tilePixels: number,
    actualOffset: number,
    effectiveZ: number,
    drapeSource: { getTileUrl(coord: TileCoord): string; maxZoom: number },
  ): void {
    const divisor = 1 << actualOffset;
    const subCount = divisor * divisor;
    const subSize = tilePixels / divisor;
    const fineZ = parentCoord.z + actualOffset;

    // Build all sub-tile descriptors
    const allSubTiles: PendingSubTile[] = [];
    for (let sy = 0; sy < divisor; sy++) {
      for (let sx = 0; sx < divisor; sx++) {
        const subCoord: TileCoord = {
          z: fineZ,
          x: parentCoord.x * divisor + sx,
          y: parentCoord.y * divisor + sy,
        };

        // Apply drape overzoom clamping to sub-tile
        const srcMaxZ = drapeSource.maxZoom;
        const clampedSubZ = Math.min(subCoord.z, srcMaxZ);
        const subDz = subCoord.z - clampedSubZ;
        const fetchSubCoord: TileCoord = {
          z: clampedSubZ,
          x: subCoord.x >> subDz,
          y: subCoord.y >> subDz,
        };

        const regionX = sx * subSize;
        const regionY = sy * subSize;
        const subKey = packTileKey(subCoord.z, subCoord.x, subCoord.y);

        // Capture overzoom state for the fetch closure
        const capturedDz = subDz;
        const capturedSubCoord = subCoord;

        allSubTiles.push({
          subKey,
          regionX,
          regionY,
          subSize,
          fetchFn: async () => {
            const url = drapeSource.getTileUrl(fetchSubCoord);
            const response = await fetch(url);
            if (!response.ok) return null;
            const blob = await response.blob();

            if (capturedDz > 0) {
              const fullImage = await createImageBitmap(blob);
              const ozDivisor = 1 << capturedDz;
              const subW = fullImage.width / ozDivisor;
              const subH = fullImage.height / ozDivisor;
              const relX = capturedSubCoord.x % ozDivisor;
              const relY = capturedSubCoord.y % ozDivisor;
              const cropped = await createImageBitmap(fullImage,
                relX * subW, relY * subH, subW, subH);
              fullImage.close();
              return cropped;
            }

            return createImageBitmap(blob);
          },
        });
      }
    }

    // Create tracker with all sub-tiles pending
    const tracker: CompositeTracker = {
      inflight: 0,
      completed: 0,
      total: subCount,
      pending: allSubTiles,
      atlasX,
      atlasY,
      tilePixels,
      effectiveZ,
    };
    this._compositeParents.set(parentKey, tracker);

    // Launch as many sub-tiles as concurrency allows
    this.launchPendingSubTiles(parentKey, tracker);
  }

  /**
   * Launch pending sub-tiles from a single composite tracker,
   * up to the concurrency limit.
   */
  private launchPendingSubTiles(parentKey: number, tracker: CompositeTracker): void {
    while (tracker.pending.length > 0 && this.pendingDrapeTiles.size < this.maxConcurrentFetches) {
      const sub = tracker.pending.shift()!;
      tracker.inflight++;
      this.pendingDrapeTiles.add(sub.subKey);
      this.fetchAndWriteDrapeSubTile(
        parentKey, sub.subKey,
        tracker.atlasX, tracker.atlasY,
        sub.regionX, sub.regionY, sub.subSize,
        sub.fetchFn,
      );
    }
  }

  /**
   * Drain pending (un-launched) sub-tiles from all active composite trackers.
   * Called at the start of fetchDrapeTiles() to resume partially-launched
   * composites as concurrency slots free up.
   */
  private drainPendingSubTiles(): void {
    for (const [parentKey, tracker] of this._compositeParents) {
      if (tracker.pending.length === 0) continue;
      this.launchPendingSubTiles(parentKey, tracker);
      if (this.pendingDrapeTiles.size >= this.maxConcurrentFetches) return;
    }
  }

  /**
   * Fetch drape imagery and write into the unified drape atlas.
   */
  private async fetchAndWriteDrape(
    key: number,
    atlasX: number,
    atlasY: number,
    tilePixels: number,
    effectiveZ: number,
    fetchFn: () => Promise<ImageBitmap | null>,
  ): Promise<void> {
    const epoch = this.fetchEpoch;
    try {
      const image = await fetchFn();
      if (!image) return;

      if (epoch !== this.fetchEpoch) { image.close(); return; }
      if (!this.pendingDrapeTiles.has(key)) { image.close(); return; }
      if (!this.drapeAtlas) { image.close(); return; }

      // Verify elevation slot still belongs to this tile (may have been evicted
      // and reallocated to a different tile during the async fetch).
      if (!this.atlas.hasTile(key)) { image.close(); return; }

      this.drapeAtlas.writeTile(key, image, atlasX, atlasY, tilePixels);
      this._drapeEffectiveZ.set(key, effectiveZ);
      image.close();
    } catch (e) {
      console.warn(`treelet: drape tile fetch failed [${tileKeyStr(key)}]`, e);
    } finally {
      if (epoch === this.fetchEpoch) {
        this.pendingDrapeTiles.delete(key);
        // Re-trigger to start next batch of drape fetches (coalesced
        // via microtask to avoid redundant scans during burst completions).
        this.scheduleDrapeFetch();
      }
    }
  }

  /**
   * Fetch a single drape sub-tile and write it into a sub-region of the
   * parent's atlas slot. Used by the lodOffset composite path.
   *
   * When all sub-tiles for a parent slot complete (success or failure),
   * the composite tracker marks the slot as loaded and queues one GPU upload.
   */
  private async fetchAndWriteDrapeSubTile(
    parentKey: number,
    subKey: number,
    atlasX: number, atlasY: number,
    subX: number, subY: number,
    subSize: number,
    fetchFn: () => Promise<ImageBitmap | null>,
  ): Promise<void> {
    const epoch = this.fetchEpoch;
    try {
      const image = await fetchFn();
      if (!image) return;

      if (epoch !== this.fetchEpoch) { image.close(); return; }
      if (!this.drapeAtlas) { image.close(); return; }
      if (!this.atlas.hasTile(parentKey)) { image.close(); return; }

      this.drapeAtlas.writeSubRegion(image, atlasX, atlasY, subX, subY, subSize);
      image.close();
    } catch (e) {
      console.warn(`treelet: drape sub-tile fetch failed [${tileKeyStr(subKey)}]`, e);
    } finally {
      if (epoch === this.fetchEpoch) {
        this.pendingDrapeTiles.delete(subKey);

        // Update composite tracker (success or failure path)
        const tracker = this._compositeParents.get(parentKey);
        if (tracker) {
          tracker.inflight--;
          tracker.completed++;

          if (tracker.completed >= tracker.total) {
            // All sub-tiles done → mark loaded + queue single GPU upload
            this._compositeParents.delete(parentKey);
            if (this.drapeAtlas && this.atlas.hasTile(parentKey)) {
              this.drapeAtlas.markLoadedAndDirty(
                parentKey, tracker.atlasX, tracker.atlasY, tracker.tilePixels);
              this._drapeEffectiveZ.set(parentKey, tracker.effectiveZ);
            }
          }
          // Remaining pending sub-tiles (if any) will be launched
          // by drainPendingSubTiles() in the next fetchDrapeTiles() call.
        }

        // Re-trigger to start next batch of drape fetches (coalesced
        // via microtask to avoid redundant scans during burst completions).
        this.scheduleDrapeFetch();
      }
    }
  }

  /**
   * Combined update + fetch for initial load, layer change, forced refresh.
   */
  update(nadirX: number, nadirY: number, zoom: number, exaggeration: number): void {
    this.updateFrame(nadirX, nadirY, zoom, exaggeration);
    this.fetchTiles();
  }

  /**
   * Fetch elevation data and write into the atlas.
   *
   * @param deferWrite  When true (COG sources), the write is queued and
   *   drained by drainPendingWrites() at a capped rate per frame to avoid
   *   burst-completing fetches from blocking the main thread. When false
   *   (URL-based sources), the write happens immediately in the callback
   *   for maximum throughput - URL fetches naturally stagger across CDN
   *   servers and don't create problematic bursts.
   */
  private async fetchAndWriteElevation(
    key: number,
    deferWrite: boolean,
    overzoom: { dz: number; relX: number; relY: number } | null,
    fetchFn: () => Promise<{ elevations: Float32Array; width: number; height: number } | null>,
  ): Promise<void> {
    const epoch = this.fetchEpoch;
    try {
      const result = await fetchFn();
      if (!result) return;

      // Discard if epoch changed (reload/zoom change)
      if (epoch !== this.fetchEpoch) return;
      if (!this.pendingTiles.has(key)) return;

      if (deferWrite) {
        // COG: queue for budget-limited per-frame drain
        this.queuedWriteKeys.add(key);
        this.pendingWrites.push({
          key,
          elevations: result.elevations,
          width: result.width,
          height: result.height,
          epoch,
          overzoom,
        });
      } else {
        // URL-based: write immediately (original behavior)
        this.writeElevationToAtlas(key, result.elevations, result.width, result.height, overzoom);
      }
    } catch (e) {
      console.warn(`treelet: elevation tile fetch failed [${tileKeyStr(key)}]`, e);
    } finally {
      if (epoch === this.fetchEpoch) {
        this.pendingTiles.delete(key);
        // Re-trigger to start next batch of fetches.
        // For immediate writes, also trigger drape fetching - this tile
        // now has elevation data and can accept drape imagery.
        this.fetchElevationTiles();
        if (!deferWrite) this.scheduleDrapeFetch();
      }
    }
  }

  /**
   * Write fetched elevation data into the atlas and fill ancestor drape.
   * Shared by both the immediate (URL) and deferred (COG) write paths.
   */
  private writeElevationToAtlas(
    key: number,
    elevations: Float32Array,
    width: number,
    height: number,
    overzoom?: { dz: number; relX: number; relY: number } | null,
  ): void {
    // Compute source sub-region for overzoom tiles: extract only the
    // portion of the parent tile that covers this child tile's extent.
    let region: SourceRegion | undefined;
    if (overzoom) {
      const divisor = 1 << overzoom.dz;
      const subW = width / divisor;
      const subH = height / divisor;
      region = {
        x: overzoom.relX * subW,
        y: overzoom.relY * subH,
        w: subW,
        h: subH,
      };
    }

    const coords = this.atlas.allocateAndWrite(key, elevations, width, height, region);
    if (!coords) return; // Atlas saturated - tile stays in missing list, retries later

    // Fill the drape slot with the ancestor's correct sub-region so it shows
    // a low-res but geographically correct drape while the actual tile loads.
    if (this.drapeAtlas && !this.drapeAtlas.hasTile(key)) {
      this.fillDrapeFromAncestor(key, coords.atlasX, coords.atlasY, coords.tilePixels);
    }
  }

  /**
   * Drain the pending write queue: process up to MAX_WRITES_PER_FRAME entries.
   * Each write involves a ~5-15ms bilinear resample, so we cap per-frame cost
   * to keep the frame budget under control during COG tile bursts.
   *
   * Called once per frame from updateFrame(), after atlas.advanceFrame().
   */
  private drainPendingWrites(): void {
    if (this._writeHead >= this.pendingWrites.length) return;

    const start = performance.now();
    let wroteAny = false;

    while (this._writeHead < this.pendingWrites.length) {
      const entry = this.pendingWrites[this._writeHead++];
      this.queuedWriteKeys.delete(entry.key);

      // Skip stale entries (epoch changed since fetch completed)
      if (entry.epoch !== this.fetchEpoch) continue;

      this.writeElevationToAtlas(entry.key, entry.elevations, entry.width, entry.height, entry.overzoom);
      wroteAny = true;

      // Check time budget after each write - stop if we'd risk exceeding it
      if (performance.now() - start >= WRITE_BUDGET_MS) break;
    }

    // Compact: once fully drained, reset to avoid unbounded growth
    if (this._writeHead >= this.pendingWrites.length) {
      this.pendingWrites.length = 0;
      this._writeHead = 0;
    }

    // Trigger drape fetch once after the drain batch - these tiles now have
    // elevation data and can accept drape imagery. Avoids calling
    // fetchDrapeTiles() after every single write (was O(writes × visibleTiles)).
    if (wroteAny) this.fetchDrapeTiles();
  }

  /**
   * Force re-fetch all tiles (e.g., after base layer change).
   */
  reload(): void {
    this.fetchEpoch++;
    this.atlas.clear();
    this.pendingTiles.clear();
    this.pendingWrites.length = 0;
    this._writeHead = 0;
    this.queuedWriteKeys.clear();
    if (this.drapeAtlas) this.drapeAtlas.clear();
    this.pendingDrapeTiles.clear();
    this._compositeParents.clear();
    this._drapeEffectiveZ.clear();
    this.lastBaseZoom = -1;
    // Force the next frame to re-upload the instance buffer even if the
    // tile set happens to hash to the same value as before the reload.
    this._lastInstanceHash = 0;

    // Recompute zoom bounds for the (potentially new) active layer
    this.updateEffectiveZoomBounds();
  }

  // =========================================================================
  // Drape layer management
  // =========================================================================

  setActiveDrape(drapeLayer: DrapeLayer | null, opacity: number = 1.0): void {
    if (!drapeLayer) {
      this.clearDrapes();
      return;
    }

    this.activeDrapeLayer = drapeLayer;

    // Create drape atlas lazily
    if (!this.drapeAtlas) {
      this.drapeAtlas = new UnifiedDrapeAtlas(this.atlasSize, this.slotSize);
    } else {
      this.drapeAtlas.clear();
    }
    this.pendingDrapeTiles.clear();
    this._compositeParents.clear();
    this._drapeEffectiveZ.clear();
    setTerrainDrape(this.material, this.drapeAtlas.texture, opacity);
  }

  setDrapeOpacity(opacity: number): void {
    if (this.activeDrapeLayer && this.drapeAtlas) {
      setTerrainDrape(this.material, this.drapeAtlas.texture, opacity);
    }
  }

  clearDrapes(): void {
    this.activeDrapeLayer = null;
    this.pendingDrapeTiles.clear();
    this._compositeParents.clear();
    this._drapeEffectiveZ.clear();
    if (this.drapeAtlas) {
      this.drapeAtlas.dispose();
      this.drapeAtlas = null;
    }
    setTerrainDrape(this.material, null);
  }

  // =========================================================================
  // Material State Delegation
  // =========================================================================

  setMode(mode: ShaderMode): void {
    setTerrainMode(this.material, mode);
  }

  setColorRamp(ramp: ColorRamp): void {
    setTerrainColorRamp(this.material, ramp);
  }

  setWireframe(enabled: boolean): void {
    setTerrainWireframe(this.material, enabled);
  }

  setIsolineEnabled(enabled: boolean): void {
    setTerrainIsolineEnabled(this.material, enabled);
  }

  setIsolineSettings(interval: number, thickness?: number): void {
    setTerrainIsolineSettings(this.material, interval, thickness);
  }

  setIsolineColor(r: number, g: number, b: number): void {
    setTerrainIsolineColor(this.material, r, g, b);
  }

  setBaseWhite(enabled: boolean): void {
    setTerrainBaseWhite(this.material, enabled);
  }

  setElevationRange(min: number, max: number): void {
    setTerrainElevationRange(this.material, min, max);
  }

  setElevationScale(metersToScene: number): void {
    setTerrainElevationScale(this.material, metersToScene);
  }

  setExaggeration(exaggeration: number): void {
    this.mesh.scale.z = exaggeration;
  }

  setSunDirection(dir: Vector3): void {
    setTerrainSunDirection(this.material, dir);
  }

  setMorphWidth(width: number): void {
    setTerrainMorphWidth(this.material, width);
  }

  setDrapeBlendMode(mode: BlendMode): void {
    setTerrainDrapeBlendMode(this.material, mode);
  }

  setHillshadeStrength(strength: number): void {
    setTerrainHillshadeStrength(this.material, strength);
  }

  /** Get the number of draw calls (always 1 for instanced rendering). */
  getDrawCallCount(): number {
    return 1;
  }

  /** Get the current number of visible tile instances. */
  getInstanceCount(): number {
    return this.tilePool.instanceCount;
  }

  /**
   * Sample elevation at a world-plane coordinate from the CPU-side atlas.
   * Walks zoom levels downward from the finest loaded to find available data.
   * @returns Elevation in meters, or null if no tile data covers this point.
   */
  sampleElevationAtWorld(worldX: number, worldY: number, zoom: number): number | null {
    const startZ = Math.min(Math.floor(zoom) + 1, this.effectiveMaxZoom);
    const point = this._samplePoint;
    point.x = worldX;
    point.y = worldY;

    for (let z = startZ; z >= this.effectiveMinZoom; z--) {
      const coord = this.tileGrid.worldToTile(point, z);
      const key = packTileKey(z, coord.x, coord.y);
      if (!this.atlas.hasTile(key)) continue;

      // Compute local UV within this tile
      const tl = this.tileGrid.tileToWorldTL(coord);
      const tileSize = this.tileGrid.getTileSize(z);
      const u = (worldX - tl.x) / tileSize;
      const v = (tl.y - worldY) / tileSize;

      const elev = this.atlas.sampleElevation(key, u, v);
      if (elev !== null) return elev;
    }

    return null;
  }

  dispose(): void {
    this._themeCleanup();
    this.atlas.dispose();
    if (this.drapeAtlas) this.drapeAtlas.dispose();
    this.instancedGeo.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }

  // =========================================================================
  // Private: Drape ancestor fallback
  // =========================================================================

  /**
   * Fill a drape slot with the correct sub-region of the nearest ancestor's
   * drape imagery. Walks z-1, z-2, ... until an ancestor with drape data is
   * found, then blits its sub-quadrant (upscaled) into the destination slot.
   *
   * This mirrors the elevation ancestor fallback in TilePool.buildInstanceBuffer
   * and provides a low-res but geographically correct drape while the tile's
   * actual drape loads asynchronously.
   */
  private fillDrapeFromAncestor(
    key: number,
    atlasX: number,
    atlasY: number,
    tilePixels: number,
  ): void {
    if (!this.drapeAtlas) return;

    const { z, x, y } = parseTileKey(key);

    // Walk up the ancestor chain to find the nearest tile with drape data
    let az = z - 1, ax = x >> 1, ay = y >> 1;
    while (az >= 0) {
      const ancestorKey = packTileKey(az, ax, ay);

      if (this.drapeAtlas.hasTile(ancestorKey)) {
        const ancestorSlot = this.atlas.getCoordsPixels(ancestorKey);
        if (ancestorSlot) {
          // Compute the sub-region within the ancestor that covers this tile
          const zDiff = z - az;
          const divisor = 1 << zDiff;
          const subSize = ancestorSlot.tilePixels / divisor;
          const relX = x % divisor;
          const relY = y % divisor;
          const srcX = ancestorSlot.atlasX + relX * subSize;
          const srcY = ancestorSlot.atlasY + relY * subSize;

          // Blit the ancestor's sub-region (upscaled) into the new slot
          this.drapeAtlas.blitRegion(srcX, srcY, subSize, atlasX, atlasY, tilePixels);
          return;
        }
      }

      ax = ax >> 1;
      ay = ay >> 1;
      az--;
    }
    // No ancestor with drape found - slot stays transparent (placeholder)
  }

  // =========================================================================
  // Private: Instance buffer upload
  // =========================================================================

  /**
   * Fingerprint the first `count` instances of TilePool.instanceData using
   * FNV-1a-style mixing over the uint32 bit-patterns of the Float32 values.
   *
   * Cheap enough to run every frame (O(count * INSTANCE_FLOATS) = ~5000 ops
   * at max capacity) and exact enough to catch any float change — no false
   * collisions within a single render session.
   */
  private computeInstanceHash(count: number): number {
    if (count === 0) return 0;
    if (!this._instanceU32) {
      this._instanceU32 = new Uint32Array(this.tilePool.instanceData.buffer);
    }
    const u32 = this._instanceU32;
    const n = count * INSTANCE_FLOATS;
    // Seed with count so 0-instance and N-instance never collide
    let h = (2166136261 ^ count) | 0;
    for (let i = 0; i < n; i++) {
      h = Math.imul(h ^ u32[i], 16777619);
    }
    return h | 0;
  }

  /**
   * Scatter TilePool's flat instance buffer into per-attribute
   * InstancedBufferAttributes and flag them for GPU upload.
   *
   * Skips the scatter + upload entirely if the instance data hasn't changed
   * since the previous upload (stationary camera, stable atlas state).
   * For a 60 FPS idle scene this eliminates ~22KB of vertex attribute traffic
   * and six dirty-flag checks per frame.
   */
  private uploadInstanceData(): void {
    const count = this.tilePool.instanceCount;

    // Fast path: if neither the instance set nor any of its attributes
    // changed, the previous upload is still correct on the GPU.
    const hash = this.computeInstanceHash(count);
    if (hash === this._lastInstanceHash && this.instancedGeo.instanceCount === count) {
      return;
    }
    this._lastInstanceHash = hash;

    const src = this.tilePool.instanceData;

    const worldArr = this.aTileWorld.array as Float32Array;
    const scaleArr = this.aTileScale.array as Float32Array;
    const atlasArr = this.aAtlasCoord.array as Float32Array;
    const lodArr = this.aTileLod.array as Float32Array;
    const parentArr = this.aParentAtlas.array as Float32Array;
    const neighborArr = this.aNeighborLod.array as Float32Array;

    // Scatter interleaved instance data into per-attribute buffers.
    // Layout: [worldXY(2), scale(1), atlasUVS(3), lod(1), parentUVS(3), neighborLod(1)]
    for (let i = 0; i < count; i++) {
      const off = i * INSTANCE_FLOATS;
      const i2 = i * 2;
      const i3 = i * 3;

      worldArr[i2]     = src[off];
      worldArr[i2 + 1] = src[off + 1];
      scaleArr[i]      = src[off + 2];
      atlasArr[i3]     = src[off + 3];
      atlasArr[i3 + 1] = src[off + 4];
      atlasArr[i3 + 2] = src[off + 5];
      lodArr[i]        = src[off + 6];
      parentArr[i3]     = src[off + 7];
      parentArr[i3 + 1] = src[off + 8];
      parentArr[i3 + 2] = src[off + 9];
      neighborArr[i]   = src[off + 10];
    }

    // Flag all attributes for GPU upload
    this.aTileWorld.needsUpdate = true;
    this.aTileScale.needsUpdate = true;
    this.aAtlasCoord.needsUpdate = true;
    this.aTileLod.needsUpdate = true;
    this.aParentAtlas.needsUpdate = true;
    this.aNeighborLod.needsUpdate = true;

    this.instancedGeo.instanceCount = count;
  }
}
