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
import type { TileCoord, ShaderMode, BlendMode, ColorRamp, VisibleExtent, TreeletStats } from '../core/types';
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
import { TilePool, type SelectedTile, type CullRegion } from './TilePool';
import { FetchChannel } from './FetchChannel';
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
  setTerrainSlopeRange,
  setTerrainExaggeration,
  setTerrainSunDirection,
  setTerrainAtlas,
  setTerrainDrape,
  setTerrainDrapeBlendMode,
  setTerrainHillshadeStrength,
  setTerrainDrapePlaceholder,
  setTerrainView,
} from '../shaders/TerrainMaterial';

/** Floats per instance: world(2) size(1) elev(4) parent(4) drape(4) morph(2). */
export const INSTANCE_STRIDE = 17;

/** Preferred minimum CDLOD range factor (wider, smoother morph zones). */
const PREFERRED_RANGE_FACTOR = 4;

/** Drape tiles uploaded per frame (each is a full mip chain, ~350 KB at 256²). */
const DRAPE_UPLOADS_PER_FRAME = 8;

/** In-flight requests no longer needed for this long are cancelled. */
const STALE_REQUEST_GRACE_MS = 400;

/** Minimum interval between aggregated fetch-error log lines per pipeline. */
const ERROR_LOG_INTERVAL_MS = 5000;

/** Prefetch lookahead: camera motion is extrapolated this many frames ahead. */
const PREFETCH_LOOKAHEAD_FRAMES = 10;

export interface TerrainRendererOptions {
  tileGrid: TileGrid;
  workerPool: WorkerPool;
  renderer: WebGLRenderer;
  layerRegistry: LayerRegistry;
  metersToScene: number;
  segments: number;
  atlasSize: number;
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
  /** Ground footprint of the view on the plane z = targetZ, or null. */
  extent: VisibleExtent | null;
  /** 2D frustum half-planes for the footprint, or null (near top-down). */
  planes: Float32Array | null;
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
  private drapeAtlas: DrapeAtlas | null = null;
  private drapeWriter: ArrayTextureWriter | null = null;
  private readonly slotSize: number;
  private readonly drapeSlotSize: number;
  private readonly budget: number;
  /** Levels beyond the source's max zoom that still add geometric detail. */
  private readonly overzoomLevels: number;

  private readonly tilePool: TilePool;
  private readonly elevChannel: FetchChannel;
  private readonly drapeChannel: FetchChannel;
  private elevEpoch = 0;
  private drapeEpoch = 0;

  private activeDrapeLayer: DrapeLayer | null = null;
  private drapeOpacity = 1;
  private drapeVisible = false;

  /** Floating render origin (world units, float64). */
  private originX = 0;
  private originY = 0;

  private lodQuality: number;
  private morphWidth: number;
  private autoRange = false;
  private lastAutoMin = NaN;
  private lastAutoMax = NaN;

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
  /** Missing drapes; tiles showing the bare placeholder come before those with a coarse fallback. */
  private readonly missingDrape: Array<{ tile: SelectedTile; slot: SlotInfo }> = [];
  private readonly missingDrapeCovered: Array<{ tile: SelectedTile; slot: SlotInfo }> = [];
  private readonly neededElev = new Set<number>();
  private readonly neededDrape = new Set<number>();
  private readonly cull: CullRegion = { minX: 0, minY: 0, maxX: 0, maxY: 0, planes: null };
  private readonly planes = new Float32Array(12);

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
    this.layerRegistry = options.layerRegistry;
    this.slotSize = options.slotSize;
    this.drapeSlotSize = options.drapeSlotSize;
    this.lodQuality = options.lodQuality;
    this.morphWidth = Math.max(0.05, Math.min(0.5, options.morphWidth));
    this.overzoomLevels = Math.max(0, Math.round(Math.log2(options.slotSize / options.segments)));

    // ==== Atlas ====
    let capacity = (options.atlasSize / options.slotSize) ** 2;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number | null;
    if (maxLayers && capacity > maxLayers) {
      console.warn(`treelet: atlas capacity ${capacity} exceeds MAX_ARRAY_TEXTURE_LAYERS (${maxLayers}); clamping`);
      capacity = maxLayers;
    }
    this.atlas = new ElevationAtlas(options.slotSize, capacity);
    this.elevWriter = new ArrayTextureWriter(this.renderer, this.atlas.texture);
    this.atlas.onEvict = (slot) => {
      this.drapeAtlas?.evict(slot.key);
      // Never call user code from inside an allocation: a handler that
      // reloads or switches layers would corrupt the slot being assigned.
      this.queueTileEvent('unload', slot.z, slot.x, slot.y);
    };

    this.budget = Math.max(16, Math.min(options.maxInstances, Math.floor(capacity * ATLAS_VISIBLE_FRACTION)));
    if (this.budget < options.maxInstances) {
      console.info(
        `treelet: rendering at most ${this.budget} tiles per frame (atlas holds ${capacity}; ` +
        `increase mapDisplay.atlasSize to raise this)`,
      );
    }

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
    });
    setTerrainAtlas(this.material, this.atlas.texture);

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

    if (setTerrainExaggeration(this.material, view.exaggeration)) this.renderDirty = true;
    this.updateDrapeVisibility(view.zoom);
    const now = performance.now();

    // ==== GPU uploads (data that arrived since the last frame) ====
    if (this.atlas.flush(this.elevWriter)) this.renderDirty = true;
    if (this.drapeAtlas && this.drapeWriter &&
        this.drapeAtlas.flush(this.drapeWriter, DRAPE_UPLOADS_PER_FRAME, (key, gen) => this.atlas.gen(key) === gen)) {
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
      const d = this.activeDrapeLayer;
      maxLevel = Math.max(maxLevel, Math.min(d.source.maxZoom, d.maxZoom, base.maxZoom, MAX_TILE_ZOOM));
    }
    maxLevel = Math.max(minLevel, Math.floor(maxLevel));
    this.lastMaxLevel = maxLevel;

    this.computeCullRegion(view, orbitDist);
    const tiles = this.tilePool.select({
      cameraX: view.cameraX,
      cameraY: view.cameraY,
      cameraZ: view.cameraZ,
      refZ: view.targetZ,
      rangeFactor: Math.max(PREFERRED_RANGE_FACTOR, (view.focalLength * this.lodQuality) / this.slotSize),
      minLevel,
      maxLevel,
      morphWidth: this.morphWidth,
      budget: this.budget,
      cull: this.cull,
    });

    // ==== Instances ====
    this.buildInstances(tiles, base);
    if (this.uploadInstances()) {
      this.renderDirty = true;
      if (this.autoRange) this.updateAutoRange(tiles);
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
    const visible = d !== null && this.drapeAtlas !== null && zoom >= d.minZoom && zoom <= d.maxZoom;
    if (visible !== this.drapeVisible) {
      this.drapeVisible = visible;
      if (setTerrainDrape(this.material, visible ? this.drapeAtlas!.texture : null, this.drapeOpacity)) {
        this.renderDirty = true;
      }
    }
  }

  /** Footprint AABB + padded frustum planes, extended along camera motion. */
  private computeCullRegion(view: FrameView, orbitDist: number): void {
    const c = this.cull;
    const height = Math.max(view.cameraZ - view.targetZ, orbitDist * 0.05);
    if (view.extent) {
      let minX = view.cameraX, maxX = view.cameraX, minY = view.cameraY, maxY = view.cameraY;
      for (const p of view.extent.corners) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      c.minX = minX; c.maxX = maxX; c.minY = minY; c.maxY = maxY;
    } else {
      const r = height * 8 + orbitDist;
      c.minX = view.cameraX - r; c.maxX = view.cameraX + r;
      c.minY = view.cameraY - r; c.maxY = view.cameraY + r;
    }

    // Pad for terrain relief above/below the reference plane and for the
    // horizon clamp; extrapolate motion (clamped, and never across jumps).
    const pad = Math.max(c.maxX - c.minX, c.maxY - c.minY) * 0.08 + orbitDist * 0.1;
    let vx = 0;
    let vy = 0;
    if (!view.teleported && Number.isFinite(this.prevCamX)) {
      vx = (view.cameraX - this.prevCamX) * PREFETCH_LOOKAHEAD_FRAMES;
      vy = (view.cameraY - this.prevCamY) * PREFETCH_LOOKAHEAD_FRAMES;
      const limit = orbitDist * 2;
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed > limit * 4) { vx = 0; vy = 0; } // jump, not motion
      else if (speed > limit) { vx *= limit / speed; vy *= limit / speed; }
    }
    this.prevCamX = view.cameraX;
    this.prevCamY = view.cameraY;

    c.minX -= pad - Math.min(vx, 0);
    c.maxX += pad + Math.max(vx, 0);
    c.minY -= pad - Math.min(vy, 0);
    c.maxY += pad + Math.max(vy, 0);

    if (view.planes) {
      const margin = pad + Math.sqrt(vx * vx + vy * vy);
      this.planes.set(view.planes);
      for (let i = 0; i < 4; i++) this.planes[i * 3 + 2] += margin;
      c.planes = this.planes;
    } else {
      c.planes = null;
    }
  }

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
    this.missingDrape.length = 0;
    this.missingDrapeCovered.length = 0;
    this.neededElev.clear();
    this.neededDrape.clear();

    const buf = this.instanceData;
    const minLevel = Math.max(0, base.source.minZoom);
    let n = 0;

    for (const t of tiles) {
      this.neededElev.add(t.key);

      // ---- Elevation: own data or nearest loaded ancestor ----
      let eLayer: number, eOx: number, eOy: number, eScale: number;
      const own = atlas.get(t.key);
      if (own) {
        atlas.pin(t.key);
        atlas.touch(t.key);
        eLayer = own.layer; eOx = 0; eOy = 0; eScale = 1;
      } else {
        const anc = this.findAncestor(t.z, t.x, t.y, minLevel);
        if (!anc) {
          this.missingElev.push(t);
          continue; // nothing to draw yet
        }
        this.missingElevCovered.push(t);
        const div = 2 ** (t.z - anc.z);
        eLayer = anc.layer;
        eOx = (t.x % div) / div;
        eOy = (t.y % div) / div;
        eScale = 1 / div;
      }

      // ---- Geomorph parent ----
      let pLayer = 0, pOx = 0, pOy = 0, pScale = 0;
      if (t.needsParent && t.parentKey !== NO_TILE_KEY) {
        this.neededElev.add(t.parentKey);
        const parent = atlas.get(t.parentKey);
        if (parent) {
          atlas.pin(t.parentKey);
          atlas.touch(t.parentKey);
          pLayer = parent.layer;
          pOx = (t.x & 1) * 0.5;
          pOy = (t.y & 1) * 0.5;
          pScale = 0.5;
        } else {
          this.missingParents.push(t.parentKey);
          const anc = this.findAncestor(t.z - 1, t.x >> 1, t.y >> 1, minLevel);
          if (anc) {
            const div = 2 ** (t.z - anc.z);
            pLayer = anc.layer;
            pOx = (t.x % div) / div;
            pOy = (t.y % div) / div;
            pScale = 1 / div;
          }
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
    return true;
  }

  private updateAutoRange(tiles: readonly SelectedTile[]): void {
    let min = Infinity;
    let max = -Infinity;
    for (const t of tiles) {
      const slot = this.atlas.get(t.key);
      if (!slot || slot.empty) continue;
      if (slot.min < min) min = slot.min;
      if (slot.max > max) max = slot.max;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    if (max - min < 1) max = min + 1;
    if (min !== this.lastAutoMin || max !== this.lastAutoMax) {
      this.lastAutoMin = min;
      this.lastAutoMax = max;
      if (setTerrainElevationRange(this.material, min, max)) this.renderDirty = true;
    }
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
    for (const t of this.missingElev) {
      if (!(open = tryElevation(t.z, t.x, t.y, t.key))) break;
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
        const parts = this.buildDrapeParts(drapeLayer, tile.z, tile.x, tile.y);
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
      if (!this.atlas.write(z, x, y, res.data, res.min, res.max, res.texelsPerPixel)) return 'stale';
      this.queueTileEvent('load', z, x, y);
      return 'ok';
    }, (id) => this.workerPool.cancel(id));
  }

  /** Source zoom for a tile's drape (−1 when the drape can't cover it). */
  private drapeZoomFor(z: number): number {
    const d = this.activeDrapeLayer;
    if (!d) return -1;
    const src = d.source;
    let ez = Math.min(z + d.lodOffset - 1, Math.max(z, src.maxZoom));
    if (ez < src.minZoom) {
      // Underzoom: composite finer source tiles, up to 4×4.
      if (src.minZoom - z > 2) return -1;
      ez = src.minZoom;
    }
    return ez;
  }

  /** Source images composited into one drape slot (sub-tiles and/or overzoom crop). */
  private buildDrapeParts(d: DrapeLayer, z: number, x: number, y: number): { z: number; parts: DrapePart[] } | null {
    const ez = this.drapeZoomFor(z);
    if (ez < 0) return null;
    const src = d.source;
    const size = this.drapeSlotSize;
    const parts: DrapePart[] = [];

    if (ez <= z) {
      // Same zoom, or overzoom: crop the sub-region from a coarser source tile.
      const fz = Math.min(z, src.maxZoom);
      const dz = z - fz;
      const div = 2 ** dz;
      parts.push({
        url: src.getTileUrl({ z: fz, x: x >> dz, y: y >> dz }),
        dx: 0, dy: 0, dSize: size,
        crop: dz > 0 ? { x: (x % div) / div, y: (y % div) / div, w: 1 / div, h: 1 / div } : null,
      });
      return { z, parts };
    }

    // Finer source zoom: composite div×div sub-tiles.
    const div = 2 ** (ez - z);
    const sub = size / div;
    for (let sy = 0; sy < div; sy++) {
      for (let sx = 0; sx < div; sx++) {
        parts.push({
          url: src.getTileUrl({ z: ez, x: x * div + sx, y: y * div + sy }),
          dx: sx * sub, dy: sy * sub, dSize: sub,
          crop: null,
        });
      }
    }
    return { z: ez, parts };
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
    this.lastAutoMin = NaN;
    this.lastAutoMax = NaN;
    this.markDirty();
  }

  setActiveDrape(drapeLayer: DrapeLayer | null, opacity: number = 1.0): void {
    if (this.disposed) return;
    if (!drapeLayer) {
      this.clearDrapes();
      return;
    }
    this.activeDrapeLayer = drapeLayer;
    this.drapeOpacity = opacity;
    if (!this.drapeAtlas) {
      const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
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

  setDrapeOpacity(opacity: number): void {
    this.drapeOpacity = opacity;
    if (this.drapeVisible && this.drapeAtlas &&
        setTerrainDrape(this.material, this.drapeAtlas.texture, opacity)) {
      this.markRender();
    }
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
    this.markDirty();
  }

  // =========================================================================
  // Material State Delegation
  // =========================================================================

  private apply(changed: boolean): void {
    if (changed) this.markRender();
  }

  setMode(mode: ShaderMode): void { this.apply(setTerrainMode(this.material, mode)); }
  setColorRamp(ramp: ColorRamp): void { this.apply(setTerrainColorRamp(this.material, ramp)); }
  setWireframe(enabled: boolean): void { this.apply(setTerrainWireframe(this.material, enabled)); }
  setIsolineEnabled(enabled: boolean): void { this.apply(setTerrainIsolineEnabled(this.material, enabled)); }
  setIsolineSettings(interval: number, thickness?: number): void {
    this.apply(setTerrainIsolineSettings(this.material, interval, thickness));
  }
  setIsolineColor(r: number, g: number, b: number): void { this.apply(setTerrainIsolineColor(this.material, r, g, b)); }
  setBaseWhite(enabled: boolean): void { this.apply(setTerrainBaseWhite(this.material, enabled)); }
  setSunDirection(dir: Vector3): void { this.apply(setTerrainSunDirection(this.material, dir)); }
  setDrapeBlendMode(mode: BlendMode): void { this.apply(setTerrainDrapeBlendMode(this.material, mode)); }
  setHillshadeStrength(strength: number): void { this.apply(setTerrainHillshadeStrength(this.material, strength)); }
  setSlopeRange(min: number, max: number): void { this.apply(setTerrainSlopeRange(this.material, min, max)); }

  setElevationRange(min: number, max: number): void {
    this.autoRange = false;
    this.apply(setTerrainElevationRange(this.material, min, max));
  }

  /** Derive the color-ramp range from the visible tiles' data. */
  setAutoElevationRange(): void {
    this.autoRange = true;
    this.lastAutoMin = NaN;
    this.lastAutoMax = NaN;
    this.prevInstanceCount = -1; // force a refresh on the next frame
    this.markRender();
  }

  setMorphWidth(width: number): void {
    this.morphWidth = Math.max(0.05, Math.min(0.5, width));
    this.markRender();
  }

  setLodQuality(quality: number): void {
    this.lodQuality = Math.max(0.25, Math.min(4, quality));
    this.markRender();
  }

  // =========================================================================
  // Queries
  // =========================================================================

  /** Number of tile instances drawn in the last frame. */
  getInstanceCount(): number {
    return this.geometry.instanceCount;
  }

  getStats(): TreeletStats {
    return {
      tiles: this.geometry.instanceCount,
      drawCalls: this.geometry.instanceCount > 0 ? 1 : 0,
      atlasUsed: this.atlas.size,
      atlasCapacity: this.atlas.capacity,
      drapeTiles: this.drapeAtlas?.size ?? 0,
      pendingElevation: this.elevChannel.size,
      pendingDrape: this.drapeChannel.size,
      failedTiles: this.elevChannel.failures.erroredCount + this.drapeChannel.failures.erroredCount,
    };
  }

  /**
   * Elevation in meters at a world-plane point from the CPU atlas copy,
   * using the finest loaded tile. Returns null where no data is loaded.
   */
  sampleElevationAtWorld(worldX: number, worldY: number): number | null {
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
      const h = this.atlas.sample(key, u * n - tx, v * n - ty);
      if (h !== null) return h;
    }
    return null;
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
    this.themeCleanup();
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
