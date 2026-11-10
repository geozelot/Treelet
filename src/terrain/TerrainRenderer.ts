// ============================================================================
// treelet.js - Instanced Terrain Renderer
//
// Orchestrates the terrain pipeline and renders ALL visible tiles in a single
// instanced draw call.
//
// Per frame (update):
//   GPU flush   → uploads elevation layers / stitched edges / drape mip chains
//                 that arrived since the last frame
//   TilePool    → CDLOD selection (screen-space error, budget-fitted)
//   Instances   → own data, ancestor fallback, geomorph parent and drape refs,
//                 relative to a floating render origin (float32-safe)
//   Pump        → launch / cancel fetches by priority, respecting backoff
//
// Fetching (FetchChannel + WorkerPool):
//   Elevation: worker fetch → decode → resample → ElevationAtlas.write (+stitch)
//   Drape:     worker fetch → composite → mips → DrapeAtlas.write
// Completions only mark state dirty and request a render; they never re-enter
// the scheduler synchronously, so failures can't spin.
// ============================================================================

import {
  Mesh,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  DynamicDrawUsage,
  type ShaderMaterial,
  type WebGLRenderer,
  type Vector3,
} from 'three';
import type { TileCoord, TreeletStats } from '../core/types';
import type { TileGrid } from '../tiles/TileGrid';
import type { WorkerPool } from '../workers/WorkerPool';
import type { LayerRegistry } from '../layers/LayerRegistry';
import type { BaseLayer } from '../layers/BaseLayer';
import type { DrapeLayer } from '../layers/DrapeLayer';
import type { DrapePart } from '../workers/protocol';
import { packTileKey, tileKeyStr, parseTileKey, NO_TILE_KEY } from '../tiles/TileIndex';
import { MAX_TILE_ZOOM, ATLAS_VISIBLE_FRACTION } from '../core/constants';
import { buildTileGrid } from './TileGeometry';
import { ElevationAtlas, type SlotInfo } from './ElevationAtlas';
import { DrapeAtlas } from './DrapeAtlas';
import { ArrayTextureWriter } from './ArrayTextureWriter';
import { TilePool, type SelectedTile, type CullRegion, type HeightBounds } from './TilePool';
import { FetchChannel } from './FetchChannel';
import {
  createTerrainMaterial,
  setTerrainAnalysisSource,
  setTerrainCoats,
  setTerrainRampTexture,
  setTerrainWireframe,
  setTerrainBaseWhite,
  setTerrainExaggeration,
  setTerrainSunDirection,
  setTerrainAtlas,
  setTerrainSkirtRelief,
  setTerrainDrape,
  setTerrainDrapePlaceholder,
  setTerrainView,
  setTerrainFog,
  setTerrainRasters,
  setTerrainShadows,
} from '../shaders/TerrainMaterial';
import { CoatStack, type CoatInput } from './CoatStack';
import { RasterSet, MAX_RASTERS, type RasterEntry, type RasterInput } from './RasterSet';
import { ShadowMap, shadowReach, SHADOW_NIGHT_SUN_Z, SHADOW_DETAIL_INTERVAL_MS } from './ShadowMap';
import { analysisShaderSource, onAnalysisRegistered } from '../analysis/registry';
import type { SurfaceSample } from '../analysis/types';
import { WebMercator } from '../crs/WebMercator';
import type { PerspectiveCamera } from 'three';

/** Floats per instance: world(2) size(1) elev(4) parent(4) drape(4) morph(2). */
export const INSTANCE_STRIDE = 17;

/** Preferred minimum CDLOD range factor (wider, smoother morph zones). */
const PREFERRED_RANGE_FACTOR = 4;

/**
 * Drape tiles uploaded per frame at 256² slots (each a full mip chain,
 * ~350 KB); fewer for larger slots, so a frame uploads about as many bytes.
 */
const DRAPE_UPLOADS_PER_FRAME = 8;

/** In-flight requests no longer needed for this long are cancelled. */
const STALE_REQUEST_GRACE_MS = 400;

/** Minimum interval between aggregated fetch-error log lines per pipeline. */
const ERROR_LOG_INTERVAL_MS = 5000;

/** Prefetch lookahead: camera motion is extrapolated this many frames ahead. */
const PREFETCH_LOOKAHEAD_FRAMES = 10;

/** Uncovered tiles first load their ancestor this many levels up: one
 *  request then fills a whole region (e.g. the horizon after a fast pan). */
const COARSE_FALLBACK_LEVELS = 3;

/** Assumed elevation range (meters) of tiles with no loaded data or ancestor. */
const UNKNOWN_MIN_ELEVATION_M = -500;
const UNKNOWN_MAX_ELEVATION_M = 9000;

export interface TerrainRendererOptions {
  tileGrid: TileGrid;
  workerPool: WorkerPool;
  renderer: WebGLRenderer;
  layerRegistry: LayerRegistry;
  metersToScene: number;
  segments: number;
  /** Tiles held in GPU memory (elevation, and drape imagery when active). */
  tileCacheSize: number;
  slotSize: number;
  drapeSlotSize: number;
  maxInstances: number;
  maxConcurrentFetches: number;
  lodQuality: number;
  morphWidth: number;
  /** Ask the host to render (and call update) on the next animation frame. */
  requestRender: () => void;
  onTileLoad?: (coord: TileCoord) => void;
  onTileUnload?: (coord: TileCoord) => void;
  onTileError?: (coord: TileCoord, layer: 'elevation' | 'drape', error: string) => void;
  /** The visible elevation range (for 'auto' ramp domains) changed. */
  onRangeChange?: (min: number, max: number) => void;
}

/** Camera state for one frame (world units). */
export interface FrameView {
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  /** Camera zoom (layer visibility bounds). */
  zoom: number;
  /** Vertical focal length in CSS pixels: (viewport height / 2) / tan(fov / 2). */
  focalLength: number;
  exaggeration: number;
  /** Visible range: ground distance from the camera where terrain ends (fully hazed). */
  horizon: number;
  /** The camera's four side planes in world space, inward: (nx, ny, nz, d) × 4. */
  frustum: Float64Array;
  /** The view jumped (setView): don't extrapolate motion. */
  teleported: boolean;
}

interface ErrorLog {
  count: number;
  lastLogged: number;
  latest: string;
}

export class TerrainRenderer {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;

  private readonly opts: TerrainRendererOptions;
  private readonly tileGrid: TileGrid;
  private readonly workerPool: WorkerPool;
  private readonly renderer: WebGLRenderer;
  private readonly layerRegistry: LayerRegistry;

  private readonly geometry: InstancedBufferGeometry;
  private readonly instanceBuffer: InstancedInterleavedBuffer;
  private readonly instanceData: Float32Array;
  private readonly prevInstanceData: Float32Array;
  private instanceCount = 0;
  private prevInstanceCount = -1;

  private readonly atlas: ElevationAtlas;
  private readonly elevWriter: ArrayTextureWriter;
  private readonly haloWriter: ArrayTextureWriter;
  private drapeAtlas: DrapeAtlas | null = null;
  private drapeWriter: ArrayTextureWriter | null = null;
  private readonly slotSize: number;
  private readonly drapeSlotSize: number;
  private readonly drapeUploadsPerFrame: number;
  private readonly budget: number;
  private budgetWarned = false;
  private exaggeration = 1;
  /** Levels beyond the source's max zoom that still add geometric detail. */
  private readonly overzoomLevels: number;

  private readonly tilePool: TilePool;
  private readonly elevChannel: FetchChannel;
  private readonly drapeChannel: FetchChannel;
  private elevEpoch = 0;
  private drapeEpoch = 0;

  private activeDrapeLayer: DrapeLayer | null = null;
  private drapeVisible = false;
  private readonly coatStack = new CoatStack();
  private readonly rasters: RasterSet;
  /** Terrain-cast shadows (created while a shadows coat is visible). */
  private shadowMap: ShadowMap | null = null;
  private shadowsEnabled = false;
  /** Bumps whenever the instance buffer changes (what the shadow pass draws). */
  private instanceVersion = 0;
  private readonly unsubscribeAnalyses: () => void;

  /** Floating render origin (world units, float64). */
  private originX = 0;
  private originY = 0;

  private lodQuality: number;
  private morphWidth: number;
  /** Whether the active drape's coat is drawn (visible, opacity above 0); otherwise its imagery isn't fetched. */
  private drapeShown = true;
  /** Finest tile level among the tiles drawn in the last frame. */
  private lastViewLevel = 0;
  /**
   * Elevation range (m) of the data drawn while any tile uses stand-in data
   * (see buildInstances); 0 once every tile has its own data and parent.
   */
  private skirtRelief = 0;
  /** A frame requested for terrain detail the shadow map is waiting to draw. */
  private shadowWake: ReturnType<typeof setTimeout> | null = null;

  /** Something changed that requires a render (uniforms, uploads, instances). */
  private renderDirty = true;
  /** Last selection's level bounds (for CPU elevation sampling). */
  private lastMaxLevel = 0;
  private prevCamX = NaN;
  private prevCamY = NaN;

  /** Missing tiles, nearest first; tiles with nothing to draw (no ancestor) come first. */
  private readonly missingElev: SelectedTile[] = [];
  private readonly missingElevCovered: SelectedTile[] = [];
  private readonly missingParents: number[] = [];
  private readonly missingFallback = new Set<number>();
  /** Missing drapes; tiles showing the bare placeholder come before those with a coarse fallback. */
  private readonly missingDrape: Array<{ tile: SelectedTile; slot: SlotInfo }> = [];
  private readonly missingDrapeCovered: Array<{ tile: SelectedTile; slot: SlotInfo }> = [];
  private readonly neededElev = new Set<number>();
  private readonly neededDrape = new Set<number>();
  private readonly cull: CullRegion = {
    minX: 0, minY: 0, maxX: 0, maxY: 0, radius: Infinity, planes: null, prefetch: null,
  };
  private readonly planes = new Float64Array(16);
  private readonly prefetch = new Float64Array(5);

  /** Tile events waiting to be delivered outside of atlas/scheduler code. */
  private readonly tileEvents: Array<{ type: 'load' | 'unload'; coord: TileCoord }> = [];
  private tileEventsQueued = false;

  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeAt = Infinity;
  private readonly errorLogs: Record<'elevation' | 'drape', ErrorLog> = {
    elevation: { count: 0, lastLogged: -Infinity, latest: '' },
    drape: { count: 0, lastLogged: -Infinity, latest: '' },
  };

  private readonly themeCleanup: () => void;
  private disposed = false;

  constructor(options: TerrainRendererOptions) {
    this.opts = options;
    this.tileGrid = options.tileGrid;
    this.workerPool = options.workerPool;
    this.renderer = options.renderer;
    this.rasters = new RasterSet(options.renderer.capabilities?.maxTextureSize ?? 4096);
    this.layerRegistry = options.layerRegistry;
    this.slotSize = options.slotSize;
    this.drapeSlotSize = options.drapeSlotSize;
    this.drapeUploadsPerFrame = Math.max(1, Math.round(DRAPE_UPLOADS_PER_FRAME * (256 / options.drapeSlotSize) ** 2));
    this.lodQuality = options.lodQuality;
    this.morphWidth = Math.max(0.05, Math.min(0.5, options.morphWidth));
    this.overzoomLevels = Math.max(0, Math.round(Math.log2(options.slotSize / options.segments)));

    // ==== Atlas ====
    let capacity = options.tileCacheSize;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number | null;
    if (maxLayers && capacity > maxLayers) {
      console.warn(`treelet: atlas capacity ${capacity} exceeds MAX_ARRAY_TEXTURE_LAYERS (${maxLayers}); clamping`);
      capacity = maxLayers;
    }
    this.atlas = new ElevationAtlas(options.slotSize, capacity);
    this.elevWriter = new ArrayTextureWriter(this.renderer, this.atlas.texture);
    this.haloWriter = new ArrayTextureWriter(this.renderer, this.atlas.haloTexture);
    this.atlas.onEvict = (slot) => {
      this.drapeAtlas?.evict(slot.key);
      // Never call user code from inside an allocation: a handler that
      // reloads or switches layers would corrupt the slot being assigned.
      this.queueTileEvent('unload', slot.z, slot.x, slot.y);
    };

    this.budget = Math.max(16, Math.min(options.maxInstances, Math.floor(capacity * ATLAS_VISIBLE_FRACTION)));

    this.tilePool = new TilePool(this.tileGrid);
    const settled = () => this.markDirty();
    this.elevChannel = new FetchChannel({
      onSettled: settled,
      onError: (key, err) => this.reportError('elevation', key, err),
    });
    this.drapeChannel = new FetchChannel({
      onSettled: settled,
      onError: (key, err) => this.reportError('drape', key, err),
    });

    // ==== Instanced geometry ====
    const baseGeo = buildTileGrid(options.segments);
    this.geometry = new InstancedBufferGeometry();
    this.geometry.index = baseGeo.index;
    this.geometry.setAttribute('position', baseGeo.getAttribute('position'));
    this.geometry.setAttribute('uv', baseGeo.getAttribute('uv'));

    this.instanceData = new Float32Array(this.budget * INSTANCE_STRIDE);
    this.prevInstanceData = new Float32Array(this.budget * INSTANCE_STRIDE);
    this.instanceBuffer = new InstancedInterleavedBuffer(this.instanceData, INSTANCE_STRIDE, 1);
    this.instanceBuffer.setUsage(DynamicDrawUsage);
    const buf = this.instanceBuffer;
    this.geometry.setAttribute('iTileWorld', new InterleavedBufferAttribute(buf, 2, 0));
    this.geometry.setAttribute('iTileScale', new InterleavedBufferAttribute(buf, 1, 2));
    this.geometry.setAttribute('iElev', new InterleavedBufferAttribute(buf, 4, 3));
    this.geometry.setAttribute('iParent', new InterleavedBufferAttribute(buf, 4, 7));
    this.geometry.setAttribute('iDrape', new InterleavedBufferAttribute(buf, 4, 11));
    this.geometry.setAttribute('iMorph', new InterleavedBufferAttribute(buf, 2, 15));
    this.geometry.instanceCount = 0;

    // ==== Material ====
    this.material = createTerrainMaterial({
      metersToScene: options.metersToScene,
      worldScale: this.tileGrid.worldScale,
      slotSize: options.slotSize,
      gridSize: options.segments,
      analysisGlsl: analysisShaderSource(),
    });
    setTerrainAtlas(this.material, this.atlas.texture, this.atlas.haloTexture);
    setTerrainRampTexture(this.material, this.coatStack.texture, this.coatStack.width, this.coatStack.height);
    // A newly registered analysis needs its function compiled in.
    this.unsubscribeAnalyses = onAnalysisRegistered(() => {
      if (this.disposed) return;
      setTerrainAnalysisSource(this.material, analysisShaderSource());
      this.markRender();
    });

    // Theme-aware drape placeholder: white (light) / dark grey (dark)
    const darkMq = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    const applyPlaceholder = () => {
      const c = darkMq?.matches ? 0.18 : 1.0;
      if (setTerrainDrapePlaceholder(this.material, c, c, c)) this.markRender();
    };
    applyPlaceholder();
    darkMq?.addEventListener('change', applyPlaceholder);
    this.themeCleanup = () => darkMq?.removeEventListener('change', applyPlaceholder);

    // ==== Mesh ====
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false; // LOD selection does the culling
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();

    baseGeo.dispose();
  }

  // =========================================================================
  // Per-frame update
  // =========================================================================

  /**
   * Run LOD selection, GPU uploads and fetch scheduling for one frame.
   * Returns true when the frame needs to be rendered.
   */
  update(view: FrameView): boolean {
    if (this.disposed) return false;

    const base = this.layerRegistry.getActiveBaseLayer();
    if (!base || view.zoom < base.minZoom || view.zoom > base.maxZoom) {
      if (this.geometry.instanceCount !== 0) {
        this.geometry.instanceCount = 0;
        this.instanceCount = 0;
        this.prevInstanceCount = -1;
        this.renderDirty = true;
      }
      return this.consumeRenderDirty();
    }

    this.exaggeration = view.exaggeration;
    if (setTerrainExaggeration(this.material, view.exaggeration)) this.renderDirty = true;
    this.updateDrapeVisibility(view.zoom);
    if (this.coatStack.setZoom(view.zoom)) this.syncCoats();
    const now = performance.now();

    // ==== GPU uploads (data that arrived since the last frame) ====
    if (this.atlas.flush(this.elevWriter, this.haloWriter)) this.renderDirty = true;
    if (this.drapeAtlas && this.drapeWriter &&
        this.drapeAtlas.flush(this.drapeWriter, this.drapeUploadsPerFrame, (key, gen) => this.atlas.gen(key) === gen)) {
      this.renderDirty = true;
    }

    // ==== Floating origin ====
    const dx = view.cameraX - view.targetX;
    const dy = view.cameraY - view.targetY;
    const dz = view.cameraZ - view.targetZ;
    const orbitDist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1e-9);
    if (Math.abs(view.targetX - this.originX) > orbitDist * 2 ||
        Math.abs(view.targetY - this.originY) > orbitDist * 2) {
      this.originX = view.targetX;
      this.originY = view.targetY;
      this.mesh.position.set(this.originX, this.originY, 0);
      this.mesh.updateMatrix();
      // The shadow pass reads matrixWorld before the main render refreshes it
      this.mesh.updateMatrixWorld();
      this.syncRasters();
    }
    setTerrainView(
      this.material,
      this.originY,
      view.cameraX - this.originX,
      view.cameraY - this.originY,
      view.cameraZ,
      view.targetZ,
    );

    // ==== LOD selection ====
    const src = base.source;
    const minLevel = Math.max(0, Math.min(src.minZoom, MAX_TILE_ZOOM));
    let maxLevel = Math.min(base.maxZoom, MAX_TILE_ZOOM, src.maxZoom + this.overzoomLevels);
    if (this.activeDrapeLayer && this.drapeVisible) {
      // Tiles fine enough to show the drape's finest imagery (a slot holding
      // finer source tiles needs correspondingly coarser terrain tiles).
      const d = this.activeDrapeLayer;
      maxLevel = Math.max(maxLevel, Math.min(d.finestTileZoom(this.drapeSlotSize), d.maxZoom, base.maxZoom, MAX_TILE_ZOOM));
    }
    maxLevel = Math.max(minLevel, Math.floor(maxLevel));
    this.lastMaxLevel = maxLevel;

    this.computeCullRegion(view, orbitDist);
    const rangeFactor = Math.max(PREFERRED_RANGE_FACTOR, (view.focalLength * this.lodQuality) / this.slotSize);
    const tiles = this.tilePool.select({
      cameraX: view.cameraX,
      cameraY: view.cameraY,
      cameraZ: view.cameraZ,
      refZ: view.targetZ,
      rangeFactor,
      minLevel,
      maxLevel,
      morphWidth: this.morphWidth,
      budget: this.budget,
      cull: this.cull,
      heightBounds: this.heightBounds,
    });
    if (!this.budgetWarned && (this.tilePool.truncated || this.tilePool.rangeFactor < rangeFactor * 0.999)) {
      this.budgetWarned = true;
      const limit = this.budget < this.opts.maxInstances
        ? `mapDisplay.tileCacheSize (now ${this.atlas.capacity}; ${ATLAS_VISIBLE_FRACTION * 100}% of it can be on screen)`
        : `mapDisplay.maxInstances (now ${this.opts.maxInstances})`;
      console.info(`treelet: this view needs more than ${this.budget} tiles, so distant detail was reduced. Raise ${limit} for full detail.`);
    }

    let viewLevel = minLevel;
    for (const t of tiles) if (t.z > viewLevel) viewLevel = t.z;
    this.lastViewLevel = viewLevel;

    // ==== Instances ====
    this.buildInstances(tiles, base);
    if (setTerrainSkirtRelief(this.material, this.skirtRelief)) this.renderDirty = true;
    if (this.uploadInstances()) {
      this.renderDirty = true;
      this.updateAutoRange(tiles);
    }

    // ==== Fetch scheduling ====
    this.pump(base, now);

    return this.consumeRenderDirty() ||
      this.atlas.hasPendingUploads ||
      (this.drapeAtlas?.hasPendingUploads ?? false);
  }

  /** Deliver tile load/unload events asynchronously (after the current operation). */
  private queueTileEvent(type: 'load' | 'unload', z: number, x: number, y: number): void {
    if (type === 'load' ? !this.opts.onTileLoad : !this.opts.onTileUnload) return;
    this.tileEvents.push({ type, coord: { z, x, y } });
    if (this.tileEventsQueued) return;
    this.tileEventsQueued = true;
    queueMicrotask(() => {
      this.tileEventsQueued = false;
      const events = this.tileEvents.splice(0);
      if (this.disposed) return;
      for (const e of events) {
        if (e.type === 'load') this.opts.onTileLoad?.(e.coord);
        else this.opts.onTileUnload?.(e.coord);
      }
    });
  }

  private consumeRenderDirty(): boolean {
    const d = this.renderDirty;
    this.renderDirty = false;
    return d;
  }

  /** Mark state changed by async work and ask for a frame. */
  private markDirty(): void {
    if (this.disposed) return;
    this.renderDirty = true;
    this.opts.requestRender();
  }

  /** Mark a render-only change (uniform) and ask for a frame. */
  private markRender(): void {
    this.markDirty();
  }

  private updateDrapeVisibility(zoom: number): void {
    const d = this.activeDrapeLayer;
    const visible = d !== null && this.drapeAtlas !== null && this.drapeShown && zoom >= d.minZoom && zoom <= d.maxZoom;
    if (visible !== this.drapeVisible) {
      this.drapeVisible = visible;
      if (setTerrainDrape(this.material, visible ? this.drapeAtlas!.texture : null)) {
        this.renderDirty = true;
      }
    }
  }

  /**
   * Horizon circle + camera side planes, plus a lookahead that widens only
   * the planes the camera is moving toward, so tiles about to come into view
   * are already loading.
   */
  private computeCullRegion(view: FrameView, orbitDist: number): void {
    const c = this.cull;
    let vx = 0;
    let vy = 0;
    if (!view.teleported && Number.isFinite(this.prevCamX)) {
      vx = (view.cameraX - this.prevCamX) * PREFETCH_LOOKAHEAD_FRAMES;
      vy = (view.cameraY - this.prevCamY) * PREFETCH_LOOKAHEAD_FRAMES;
      const limit = orbitDist * 0.5;
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed > limit * 8) { vx = 0; vy = 0; } // jump, not motion
      else if (speed > limit) { vx *= limit / speed; vy *= limit / speed; }
    }
    this.prevCamX = view.cameraX;
    this.prevCamY = view.cameraY;

    // Small fixed margin against tiles flickering at the screen edges.
    const margin = orbitDist * 0.01;
    const r = view.horizon + margin;
    c.radius = r;
    this.planes.set(view.frustum);
    for (let i = 3; i < 16; i += 4) this.planes[i] += margin;
    c.planes = this.planes;

    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > 0) {
      // Where the frustum will be: n·(p − v) + d ≥ 0, i.e. d grows by −n·v.
      const f = this.planes;
      for (let i = 0; i < 4; i++) this.prefetch[i] = Math.max(0, -(f[i * 4] * vx + f[i * 4 + 1] * vy));
      this.prefetch[4] = speed;
      c.prefetch = this.prefetch;
    } else {
      c.prefetch = null;
    }
    const rr = r + speed;
    c.minX = view.cameraX - rr;
    c.maxX = view.cameraX + rr;
    c.minY = view.cameraY - rr;
    c.maxY = view.cameraY + rr;
  }

  /**
   * Height range of a tile in scene units for frustum culling: from its own
   * data, else its nearest loaded ancestor (padded: coarse data flattens
   * peaks), else a range that covers any terrain on Earth.
   */
  private readonly heightBounds: HeightBounds = (z, x, y, south, north, out) => {
    let lo = UNKNOWN_MIN_ELEVATION_M;
    let hi = UNKNOWN_MAX_ELEVATION_M;
    for (let az = z, ax = x, ay = y; az >= 0; az--, ax >>= 1, ay >>= 1) {
      const slot = this.atlas.get(packTileKey(az, ax, ay));
      if (!slot) continue;
      lo = slot.min;
      hi = slot.max;
      if (az < z) {
        const pad = (hi - lo) * 0.25 + 100;
        lo -= pad;
        hi += pad;
      }
      break;
    }
    // Mercator scales heights by cosh(y·2π/W), growing away from the equator.
    const w = (2 * Math.PI) / this.tileGrid.worldScale;
    const kFar = Math.cosh(Math.max(Math.abs(south), Math.abs(north)) * w);
    const kNear = south < 0 && north > 0 ? 1 : Math.cosh(Math.min(Math.abs(south), Math.abs(north)) * w);
    const s = this.opts.metersToScene * this.exaggeration;
    out[0] = lo * (lo < 0 ? kFar : kNear) * s;
    out[1] = hi * (hi > 0 ? kFar : kNear) * s;
  };

  // =========================================================================
  // Instance buffer
  // =========================================================================

  private buildInstances(tiles: readonly SelectedTile[], base: BaseLayer): void {
    const atlas = this.atlas;
    const drape = this.drapeVisible ? this.drapeAtlas : null;
    atlas.clearPins();
    this.missingElev.length = 0;
    this.missingElevCovered.length = 0;
    this.missingParents.length = 0;
    this.missingFallback.clear();
    this.missingDrape.length = 0;
    this.missingDrapeCovered.length = 0;
    this.neededElev.clear();
    this.neededDrape.clear();

    const buf = this.instanceData;
    const minLevel = Math.max(0, base.source.minZoom);
    let n = 0;
    // Elevation range of the data the instances draw, and whether any of it
    // is a stand-in (an ancestor's data, or a morph without its parent)
    let low = Infinity;
    let high = -Infinity;
    let inexact = false;
    const span = (slot: SlotInfo) => {
      if (slot.low < low) low = slot.low;
      if (slot.high > high) high = slot.high;
    };

    for (const t of tiles) {
      this.neededElev.add(t.key);

      // ---- Elevation: own data or nearest loaded ancestor ----
      let eLayer: number, eOx: number, eOy: number, eScale: number;
      const own = atlas.get(t.key);
      if (own) {
        atlas.pin(t.key);
        atlas.touch(t.key);
        span(own);
        eLayer = own.layer; eOx = 0; eOy = 0; eScale = 1;
      } else {
        const anc = this.findAncestor(t.z, t.x, t.y, minLevel);
        // Nothing loaded within COARSE_FALLBACK_LEVELS: one coarser tile fills
        // the region first (a much coarser ancestor is a poor stand-in: blurry,
        // and far off the neighbouring tiles' heights). A level the source is
        // known not to have is skipped while an ancestor has real data.
        const fz = Math.max(minLevel, t.z - COARSE_FALLBACK_LEVELS);
        if (fz < t.z && (!anc || anc.z < fz)) {
          const fallback = packTileKey(fz, t.x >> (t.z - fz), t.y >> (t.z - fz));
          if (!anc || !this.elevChannel.failures.isEmpty(fallback)) {
            this.missingFallback.add(fallback);
            this.neededElev.add(fallback);
          }
        }
        if (!anc) {
          this.missingElev.push(t);
          continue; // nothing to draw yet
        }
        this.missingElevCovered.push(t);
        inexact = true;
        span(anc);
        const div = 2 ** (t.z - anc.z);
        eLayer = anc.layer;
        eOx = (t.x % div) / div;
        eOy = (t.y % div) / div;
        eScale = 1 / div;
      }

      // ---- Geomorph parent ----
      // Only the parent itself is a morph target. Until it has loaded the tile
      // keeps its own heights (a coarser ancestor standing in would pull the
      // morph zone far off the neighbouring tiles and blur it); the edge to a
      // coarser neighbour then differs by a little, which the skirts cover.
      let pLayer = 0, pOx = 0, pOy = 0, pScale = 0;
      if (t.needsParent && t.parentKey !== NO_TILE_KEY) {
        this.neededElev.add(t.parentKey);
        const parent = atlas.get(t.parentKey);
        if (parent) {
          atlas.pin(t.parentKey);
          atlas.touch(t.parentKey);
          span(parent);
          pLayer = parent.layer;
          pOx = (t.x & 1) * 0.5;
          pOy = (t.y & 1) * 0.5;
          pScale = 0.5;
        } else {
          this.missingParents.push(t.parentKey);
          inexact = true;
        }
      }

      // ---- Drape: own imagery or nearest ancestor with imagery ----
      let dLayer = 0, dOx = 0, dOy = 0, dScale = 0;
      if (drape) {
        if (own && drape.has(t.key, own.gen)) {
          dLayer = own.layer; dScale = 1;
        } else {
          const anc = this.findDrapeAncestor(t.z, t.x, t.y, minLevel);
          if (anc) {
            const div = 2 ** (t.z - anc.z);
            dLayer = anc.layer;
            dOx = (t.x % div) / div;
            dOy = (t.y % div) / div;
            dScale = 1 / div;
          }
        }
        if (own) {
          const ez = this.drapeZoomFor(t.z);
          if (ez >= 0 && drape.loadedZoom(t.key, own.gen) < ez) {
            this.neededDrape.add(t.key);
            (dScale > 0 ? this.missingDrapeCovered : this.missingDrape).push({ tile: t, slot: own });
          }
        }
      }

      const o = n * INSTANCE_STRIDE;
      buf[o] = t.centerX - this.originX;
      buf[o + 1] = t.centerY - this.originY;
      buf[o + 2] = t.size;
      buf[o + 3] = eLayer; buf[o + 4] = eOx; buf[o + 5] = eOy; buf[o + 6] = eScale;
      buf[o + 7] = pLayer; buf[o + 8] = pOx; buf[o + 9] = pOy; buf[o + 10] = pScale;
      buf[o + 11] = dLayer; buf[o + 12] = dOx; buf[o + 13] = dOy; buf[o + 14] = dScale;
      buf[o + 15] = t.morphStart;
      buf[o + 16] = t.morphEnd;
      n++;
    }
    this.instanceCount = n;
    this.skirtRelief = inexact && high > low ? high - low : 0;
    // Fetch order: uncovered first, then covered (each list is nearest first).
    for (const t of this.missingElevCovered) this.missingElev.push(t);
    for (const d of this.missingDrapeCovered) this.missingDrape.push(d);
  }

  /** Nearest loaded ancestor (z−1, z−2, …) with elevation data; pins it. */
  private findAncestor(z: number, x: number, y: number, minLevel: number): SlotInfo | null {
    let az = z - 1, ax = x >> 1, ay = y >> 1;
    while (az >= minLevel && az >= 0) {
      const key = packTileKey(az, ax, ay);
      const slot = this.atlas.get(key);
      if (slot) {
        this.atlas.pin(key);
        this.atlas.touch(key);
        return slot;
      }
      ax >>= 1; ay >>= 1; az--;
    }
    return null;
  }

  /** Nearest ancestor with resident drape imagery; pins its slot. */
  private findDrapeAncestor(z: number, x: number, y: number, minLevel: number): SlotInfo | null {
    const drape = this.drapeAtlas;
    if (!drape) return null;
    let az = z - 1, ax = x >> 1, ay = y >> 1;
    while (az >= minLevel && az >= 0) {
      const key = packTileKey(az, ax, ay);
      const slot = this.atlas.get(key);
      if (slot && drape.has(key, slot.gen)) {
        this.atlas.pin(key);
        this.atlas.touch(key);
        return slot;
      }
      ax >>= 1; ay >>= 1; az--;
    }
    return null;
  }

  /** Upload the instance buffer if it changed. Returns true when it did. */
  private uploadInstances(): boolean {
    const n = this.instanceCount;
    const len = n * INSTANCE_STRIDE;
    const cur = this.instanceData;
    const prev = this.prevInstanceData;
    let changed = n !== this.prevInstanceCount;
    if (!changed) {
      for (let i = 0; i < len; i++) {
        if (cur[i] !== prev[i]) { changed = true; break; }
      }
    }
    if (!changed) return false;

    prev.set(cur.subarray(0, len));
    this.prevInstanceCount = n;
    this.instanceBuffer.clearUpdateRanges();
    if (len > 0) this.instanceBuffer.addUpdateRange(0, len);
    this.instanceBuffer.needsUpdate = true;
    this.geometry.instanceCount = n;
    this.instanceVersion++;
    return true;
  }

  private updateAutoRange(tiles: readonly SelectedTile[]): void {
    let min = Infinity;
    let max = -Infinity;
    for (const t of tiles) {
      const slot = this.atlas.get(t.key);
      if (!slot || slot.empty) continue;
      // Robust per-tile range: a few spikes in the source data don't stretch it
      if (slot.low < min) min = slot.low;
      if (slot.high > max) max = slot.high;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    if (max - min < 1) max = min + 1;
    const [lo, hi] = this.coatStack.autoDomain;
    if (min === lo && max === hi) return;
    if (this.coatStack.setAutoRange(min, max)) {
      setTerrainCoats(this.material, this.coatStack.packed);
      this.renderDirty = true;
    }
    this.opts.onRangeChange?.(min, max);
  }

  // =========================================================================
  // Fetch scheduling
  // =========================================================================

  private pump(base: BaseLayer, now: number): void {
    if (this.disposed) return;

    // ---- Elevation ----
    for (const key of this.neededElev) this.elevChannel.touch(key);
    this.elevChannel.cancelStale(STALE_REQUEST_GRACE_MS);

    const elevLimit = Math.max(1, Math.min(
      this.opts.maxConcurrentFetches,
      base.source.getSchedulingHints().maxConcurrentFetches,
    ));

    const tryElevation = (z: number, x: number, y: number, key: number): boolean => {
      if (this.atlas.has(key)) return true;
      if (this.elevChannel.failures.isEmpty(key)) {
        // Known nonexistent: synthesize the flat tile without a request.
        if (this.atlas.writeEmpty(z, x, y)) this.renderDirty = true;
        return true;
      }
      if (this.elevChannel.load >= elevLimit) return false;
      if (this.atlas.available <= this.elevChannel.size) return false;
      if (!this.elevChannel.canLaunch(key)) return true;
      this.launchElevation(base, z, x, y, key);
      return true;
    };

    let open = true;
    for (const key of this.missingFallback) {
      const { z, x, y } = parseTileKey(key);
      if (!(open = tryElevation(z, x, y, key))) break;
    }
    if (open) {
      for (const t of this.missingElev) {
        if (!(open = tryElevation(t.z, t.x, t.y, t.key))) break;
      }
    }
    if (open) {
      for (const key of this.missingParents) {
        const { z, x, y } = parseTileKey(key);
        if (!tryElevation(z, x, y, key)) break;
      }
    }

    // ---- Drape ----
    const drapeLayer = this.activeDrapeLayer;
    if (drapeLayer && this.drapeAtlas && this.drapeVisible) {
      for (const key of this.neededDrape) this.drapeChannel.touch(key);
      this.drapeChannel.cancelStale(STALE_REQUEST_GRACE_MS);
      const drapeLimit = Math.max(1, Math.min(this.opts.maxConcurrentFetches, drapeLayer.source.maxConcurrency));
      for (const { tile, slot } of this.missingDrape) {
        if (!this.drapeChannel.canLaunch(tile.key)) continue;
        const parts = drapeLayer.drapeParts(tile.z, tile.x, tile.y, this.drapeSlotSize);
        if (!parts) continue;
        const load = this.drapeChannel.load;
        if (load > 0 && load + parts.parts.length > drapeLimit) break;
        this.launchDrape(drapeLayer, tile.key, slot, parts.z, parts.parts);
      }
    }

    this.scheduleWake(now);
  }

  /** Wake up when the earliest backed-off tile becomes eligible again. */
  private scheduleWake(now: number): void {
    const next = Math.min(
      this.elevChannel.failures.nextRetryAt(now) ?? Infinity,
      this.drapeChannel.failures.nextRetryAt(now) ?? Infinity,
    );
    if (!Number.isFinite(next) || next >= this.wakeAt) return;
    if (this.wakeTimer !== null) clearTimeout(this.wakeTimer);
    this.wakeAt = next;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      this.wakeAt = Infinity;
      this.markDirty();
    }, Math.max(0, next - now) + 5);
  }

  private launchElevation(base: BaseLayer, z: number, x: number, y: number, key: number): void {
    const epoch = this.elevEpoch;
    const coord: TileCoord = { z, x, y };
    const size = this.slotSize;
    this.elevChannel.launch(key, async (id) => {
      await base.source.ensureReady();
      if (this.disposed || epoch !== this.elevEpoch) return 'stale';
      const url = base.getTileUrl(coord);
      const oz = base.getOverzoomRegion(coord);
      const region = oz
        ? { x: oz.relX / 2 ** oz.dz, y: oz.relY / 2 ** oz.dz, w: 1 / 2 ** oz.dz, h: 1 / 2 ** oz.dz }
        : null;
      const res = await this.workerPool.loadElevation({
        id,
        url,
        decoderType: base.decoderType,
        decoderSource: base.decoderSource ?? undefined,
        region,
        size,
        init: base.source.getRequestInit?.(),
      });
      if (this.disposed || epoch !== this.elevEpoch) return 'stale';
      if (res.status === 'empty') {
        if (!this.atlas.writeEmpty(z, x, y)) return 'stale';
        return 'empty';
      }
      if (!this.atlas.write(z, x, y, res.data, res.min, res.max, res.texelsPerPixel, res.low, res.high)) return 'stale';
      this.queueTileEvent('load', z, x, y);
      return 'ok';
    }, (id) => this.workerPool.cancel(id));
  }

  /** Source zoom for a tile's drape (−1 when the drape can't cover it). */
  private drapeZoomFor(z: number): number {
    return this.activeDrapeLayer?.sourceZoomFor(z, this.drapeSlotSize) ?? -1;
  }

  private launchDrape(d: DrapeLayer, key: number, slot: SlotInfo, ez: number, parts: DrapePart[]): void {
    const epoch = this.drapeEpoch;
    const gen = slot.gen;
    const layer = slot.layer;
    const size = this.drapeSlotSize;
    this.drapeChannel.launch(key, async (id) => {
      await d.source.ensureReady();
      if (this.disposed || epoch !== this.drapeEpoch) return 'stale';
      const res = await this.workerPool.loadDrape({ id, parts, size, init: d.source.getRequestInit?.() });
      if (res.status === 'ok') d.observeTileSize(res.imageSize);
      const drape = this.drapeAtlas;
      if (this.disposed || epoch !== this.drapeEpoch || !drape) return 'stale';
      // The elevation slot (and with it this drape layer) may have been reassigned.
      if (this.atlas.gen(key) !== gen) return 'stale';
      if (res.status === 'empty') {
        drape.writeEmpty(key, gen, ez);
        return 'empty';
      }
      drape.write(key, layer, gen, ez, res.levels);
      return 'ok';
    }, (id) => this.workerPool.cancel(id), parts.length);
  }

  private reportError(layer: 'elevation' | 'drape', key: number, err: unknown): void {
    if (this.disposed) return;
    const msg = err instanceof Error ? err.message : String(err);
    const coord = parseTileKey(key);
    this.opts.onTileError?.(coord, layer, msg);
    const log = this.errorLogs[layer];
    log.count++;
    log.latest = `${tileKeyStr(key)}: ${msg}`;
    const now = performance.now();
    if (now - log.lastLogged >= ERROR_LOG_INTERVAL_MS) {
      console.warn(
        `treelet: ${log.count} ${layer} tile request(s) failed (latest ${log.latest}); retrying with backoff`,
      );
      log.lastLogged = now;
      log.count = 0;
    }
  }

  // =========================================================================
  // Layer lifecycle
  // =========================================================================

  /** Drop all terrain data and refetch (base layer changed). */
  reload(): void {
    if (this.disposed) return;
    this.elevEpoch++;
    this.elevChannel.clear();
    for (const slot of this.atlas.slots()) this.queueTileEvent('unload', slot.z, slot.x, slot.y);
    this.atlas.clear();
    this.resetDrapeState();
    this.prevInstanceCount = -1;
    this.markDirty();
  }

  setActiveDrape(drapeLayer: DrapeLayer | null): void {
    if (this.disposed) return;
    if (!drapeLayer) {
      this.clearDrapes();
      return;
    }
    this.activeDrapeLayer = drapeLayer;
    if (!this.drapeAtlas) {
      // Anisotropic filtering keeps imagery sharp on ground seen at a low angle.
      const anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
      this.drapeAtlas = new DrapeAtlas(this.drapeSlotSize, this.atlas.capacity, anisotropy);
      this.drapeWriter = new ArrayTextureWriter(this.renderer, this.drapeAtlas.texture);
    }
    this.resetDrapeState();
    // Unbind until the next frame re-evaluates visibility for the new layer;
    // otherwise a layer hidden at the current zoom would keep the old binding
    // and draw every tile in the placeholder color.
    this.drapeVisible = false;
    setTerrainDrape(this.material, null);
    this.markDirty();
  }

  clearDrapes(): void {
    this.activeDrapeLayer = null;
    this.resetDrapeState();
    if (this.drapeAtlas) {
      this.drapeAtlas.dispose();
      this.drapeAtlas = null;
      this.drapeWriter = null;
    }
    this.drapeVisible = false;
    setTerrainDrape(this.material, null);
    this.markDirty();
  }

  private resetDrapeState(): void {
    this.drapeEpoch++;
    this.drapeChannel.clear();
    this.drapeAtlas?.clear();
  }

  /** Re-upload GPU state after a WebGL context restore. */
  onContextRestored(): void {
    if (this.disposed) return;
    this.atlas.markAllDirty();
    // Drape imagery has no CPU copy: refetch it.
    this.resetDrapeState();
    this.prevInstanceCount = -1;
    this.shadowMap?.invalidate();
    this.markDirty();
  }

  // =========================================================================
  // Material State Delegation
  // =========================================================================

  private apply(changed: boolean): void {
    if (changed) this.markRender();
  }

  /**
   * Replace the coat stack (visible coats, bottom first). Domains that
   * depend on the visible elevation range are resolved with the current one
   * and follow it as it changes; coats outside their zoom range or at
   * opacity 0 are not drawn.
   */
  setCoats(coats: readonly CoatInput[]): void {
    if (this.disposed) return;
    this.coatStack.set(coats);
    this.syncCoats();
  }

  /** Whether the active drape's coat is drawn; imagery that isn't is neither fetched nor sampled. */
  setDrapeShown(shown: boolean): void {
    if (this.disposed || shown === this.drapeShown) return;
    this.drapeShown = shown;
    this.markDirty(); // drape visibility is re-evaluated on the next frame
  }

  /** Upload the drawn coats and keep a shadow map exactly while one of them reads it. */
  private syncCoats(): void {
    setTerrainCoats(this.material, this.coatStack.packed);
    this.setShadowsEnabled(this.coatStack.needsShadows);
    this.markRender(); // ramp rows may have changed without a uniform change
  }

  // =========================================================================
  // Rasters
  // =========================================================================

  /** Bind a raster for the coat of layer `id` (throws when no slot is free). */
  bindRaster(id: string, input: RasterInput): RasterEntry {
    const entry = this.rasters.bind(id, input);
    this.syncRasters();
    this.markRender();
    return entry;
  }

  releaseRaster(id: string): boolean {
    if (!this.rasters.release(id)) return false;
    this.syncRasters();
    this.markRender();
    return true;
  }

  // =========================================================================
  // Shadows
  // =========================================================================

  /** Keep a shadow map (while a drawn coat reads it). */
  private setShadowsEnabled(enabled: boolean): void {
    if (this.disposed || enabled === this.shadowsEnabled) return;
    this.shadowsEnabled = enabled;
    if (enabled) {
      const max = this.renderer.capabilities?.maxTextureSize ?? 4096;
      this.shadowMap ??= new ShadowMap(this.geometry, this.material, Math.min(2048, max));
      this.shadowMap.invalidate();
    } else {
      setTerrainShadows(this.material, null);
      this.shadowMap?.dispose();
      this.shadowMap = null;
    }
    this.markRender();
  }

  get shadowsActive(): boolean {
    return this.shadowsEnabled;
  }

  /**
   * Draw the shadow map for this frame's view if the sun, the view or the
   * terrain changed. Call after update() and before the frame is rendered;
   * returns whether the frame must be drawn again.
   * @param maxDistance - farthest camera distance (world units) shadows may reach
   */
  renderShadows(camera: PerspectiveCamera, maxDistance: number): boolean {
    const map = this.shadowMap;
    if (!this.shadowsEnabled || !map || this.disposed || this.geometry.instanceCount === 0) return false;
    const sun = this.material.uniforms.uSunDirection.value as Vector3;
    if (sun.z <= SHADOW_NIGHT_SUN_Z) {
      // Night: the shader shades everything without reading the map (same threshold)
      const was = this.material.uniforms.uShadowOn.value;
      setTerrainShadows(this.material, { texture: map.target.depthTexture!, matrix: map.matrix, params: map.params });
      return was !== 1;
    }
    const [lo, hi] = this.coatStack.autoDomain;
    const k = WebMercator.scaleFactorAtWorldY(this.originY, this.tileGrid.worldScale);
    const heightSpan = Math.max(hi - lo, 0) * this.opts.metersToScene * k * this.exaggeration;
    // Only as far as the view can see terrain: where the corner rays meet the lowest of it
    const reach = shadowReach(camera, lo * this.opts.metersToScene * k * this.exaggeration, maxDistance);
    const drawn = map.update(this.renderer, {
      camera,
      terrain: this.mesh,
      range: reach.depth,
      fadeDistance: reach.distance,
      heightSpan,
      sun,
      version: String(this.exaggeration),
      detail: `${this.atlas.version}|${this.instanceVersion}`,
    });
    if (map.pending && !this.shadowWake) {
      // Finer terrain waits a moment to be drawn into the map: come back for it
      this.shadowWake = setTimeout(() => { this.shadowWake = null; this.opts.requestRender(); }, SHADOW_DETAIL_INTERVAL_MS);
    }
    if (!drawn) return false;
    setTerrainShadows(this.material, { texture: map.target.depthTexture!, matrix: map.matrix, params: map.params });
    return true;
  }

  /** World size of a texel of the finest terrain level in view (draping and sampling step). */
  finestTexelWorld(): number {
    return this.texelWorld(this.lastViewLevel);
  }

  /** World size of a terrain texel at tile level `z`. */
  private texelWorld(z: number): number {
    return this.tileGrid.worldScale / 2 ** z / Math.max(this.atlas.slotSize - 1, 1);
  }

  /** Raster slots not in use. */
  freeRasterSlots(): number {
    return MAX_RASTERS - this.rasters.size;
  }

  /** Shader slot of layer `id`'s raster, or -1. */
  rasterSlot(id: string): number {
    return this.rasters.slotOf(id);
  }

  getRaster(id: string): RasterEntry | undefined {
    return this.rasters.get(id);
  }

  /** Value of layer `id`'s raster at a world point (the shader's filter), or null. */
  sampleRaster(id: string, worldX: number, worldY: number): number | null {
    return this.rasters.sample(id, worldX, worldY);
  }

  private syncRasters(): void {
    if (setTerrainRasters(this.material, this.rasters.uniforms(this.originX, this.originY))) this.markRender();
  }

  /** The visible elevation range (min, max of the drawn tiles), as used by 'auto' ramp domains. */
  get autoElevationRange(): [number, number] {
    return this.coatStack.autoDomain;
  }

  setWireframe(enabled: boolean): void { this.apply(setTerrainWireframe(this.material, enabled)); }
  setBaseWhite(enabled: boolean): void { this.apply(setTerrainBaseWhite(this.material, enabled)); }
  setSunDirection(dir: Vector3): void { this.apply(setTerrainSunDirection(this.material, dir)); }

  setMorphWidth(width: number): void {
    this.morphWidth = Math.max(0.05, Math.min(0.5, width));
    this.markRender();
  }

  setLodQuality(quality: number): void {
    this.lodQuality = Math.max(0.25, Math.min(4, quality));
    this.markRender();
  }

  /** Haze toward the horizon (sRGB color, camera distances). */
  setFog(color: readonly number[], start: number, end: number): void {
    if (setTerrainFog(this.material, color, start, end)) this.renderDirty = true;
  }

  // =========================================================================
  // Queries
  // =========================================================================

  /** Changes whenever loaded elevation data changes (sampled heights may differ). */
  get elevationVersion(): number {
    return this.atlas.version;
  }

  /**
   * World rectangles (with a margin for stitched tile edges) where sampled
   * elevations may differ since `version`, or null when that isn't known
   * (everything may have changed).
   */
  elevationChangesSince(version: number): Array<{ west: number; south: number; east: number; north: number }> | null {
    const keys = this.atlas.changedSince(version);
    if (keys === null) return null;
    const W = this.tileGrid.worldScale;
    const seen = new Set<number>();
    const out: Array<{ west: number; south: number; east: number; north: number }> = [];
    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      const { z, x, y } = parseTileKey(key);
      const size = W / 2 ** z;
      const margin = size / 16;
      const west = -W / 2 + x * size;
      const north = W / 2 - y * size;
      out.push({ west: west - margin, south: north - size - margin, east: west + size + margin, north: north + margin });
    }
    return out;
  }

  /** Number of tile instances drawn in the last frame. */
  getInstanceCount(): number {
    return this.geometry.instanceCount;
  }

  getStats(): TreeletStats {
    return {
      tiles: this.geometry.instanceCount,
      drawCalls: this.geometry.instanceCount > 0 ? 1 : 0,
      coats: this.coatStack.packed.length,
      rasters: this.rasters.size,
      overlays: 0,
      shadows: this.shadowsEnabled,
      frameTime: 0,
      atlasUsed: this.atlas.size,
      atlasCapacity: this.atlas.capacity,
      drapeTiles: this.drapeAtlas?.size ?? 0,
      pendingElevation: this.elevChannel.size,
      pendingDrape: this.drapeChannel.size,
      failedTiles: this.elevChannel.failures.erroredCount + this.drapeChannel.failures.erroredCount,
    };
  }

  /**
   * Read the finest loaded tile at a world-plane point: `read` gets its key,
   * the point's fraction within it and its level, and may return null to
   * fall back to coarser tiles. Null where no tile answers.
   */
  private readFinestTile<T>(worldX: number, worldY: number, read: (key: number, fu: number, fv: number, z: number) => T | null): T | null {
    if (this.disposed) return null;
    const W = this.tileGrid.worldScale;
    const u = (worldX + W / 2) / W;
    const v = (W / 2 - worldY) / W;
    if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return null;
    for (let z = this.lastMaxLevel; z >= 0; z--) {
      const n = 2 ** z;
      const tx = Math.floor(u * n);
      const ty = Math.floor(v * n);
      const key = packTileKey(z, tx, ty);
      if (!this.atlas.has(key)) continue;
      const result = read(key, u * n - tx, v * n - ty, z);
      if (result !== null) return result;
    }
    return null;
  }

  /**
   * Elevation in meters at a world-plane point from the CPU atlas copy,
   * using the finest loaded tile. Returns null where no data is loaded.
   */
  sampleElevationAtWorld(worldX: number, worldY: number): number | null {
    return this.readFinestTile(worldX, worldY, (key, fu, fv) => this.atlas.sample(key, fu, fv));
  }

  /**
   * Surface (elevation, true-scale normal, gradient, second derivatives) at
   * a world-plane point from the finest loaded tile, or null where no data
   * is loaded. Same stencil as the fragment shader.
   */
  sampleSurfaceAtWorld(worldX: number, worldY: number): SurfaceSample | null {
    // Ground meters per world unit at this latitude
    const metersPerWorld = 1 / (this.opts.metersToScene * WebMercator.scaleFactorAtWorldY(worldY, this.tileGrid.worldScale));
    return this.readFinestTile(worldX, worldY, (key, fu, fv, z) =>
      this.atlas.sampleSurface(key, fu, fv, this.texelWorld(z) * metersPerWorld));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.elevEpoch++;
    this.drapeEpoch++;
    this.elevChannel.clear();
    this.drapeChannel.clear();
    if (this.wakeTimer !== null) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    if (this.shadowWake !== null) clearTimeout(this.shadowWake);
    this.shadowWake = null;
    this.themeCleanup();
    this.unsubscribeAnalyses();
    this.coatStack.dispose();
    this.rasters.dispose();
    this.shadowMap?.dispose();
    this.shadowMap = null;
    this.atlas.dispose();
    this.drapeAtlas?.dispose();
    this.drapeAtlas = null;
    this.drapeWriter = null;
    this.activeDrapeLayer = null;
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
