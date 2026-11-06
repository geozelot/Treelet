// ============================================================================
// treelet.js - Main Orchestrator
// The central class that wires together scene, tiles, layers, workers, UI,
// and rendering. Delegates display mutations to DisplayController and layer
// lifecycle to LayerController.
//
// Layer architecture:
//   Base layer  = geometry source (elevation data)
//   Drape layer = visualization (BaseDrape: wireframe/elevation/slope/aspect/contours,
//                                or external texture like OSM/satellite)
//   Only one drape active at a time (no blending).
// ============================================================================

import { Vector3 } from 'three';
import { EventEmitter } from './EventEmitter';
import {
  DEFAULT_OPTIONS,
  MAX_TILE_ZOOM,
  WEB_MERCATOR_FULL_EXTENT,
  WEB_MERCATOR_MAX_LAT,
  tilesForAtlasSize,
  validateTileConfig,
} from './constants';
import { version as packageVersion } from '../../package.json';
import type {
  TreeletOptions,
  ResolvedTreeletOptions,
  TreeletEventMap,
  LngLat,
  BaseDrapeMode,
  BlendMode,
  ColorRamp,
  TerrainPick,
  ProfileSample,
  TreeletStats,
} from './types';
import { SceneManager } from '../scene/SceneManager';
import { CameraTerrain, marchToTerrain, type GroundSampler } from '../scene/CameraTerrain';
import type { CameraController } from '../scene/CameraController';
import type { BaseLayer } from '../layers/BaseLayer';
import type { DrapeLayer } from '../layers/DrapeLayer';
import type {
  BaseLayerOptions,
  DrapeLayerOptions,
  OverlayLayerOptions,
  LayerHandle,
} from '../layers/types';
import { TileGrid } from '../tiles/TileGrid';
import { WebMercator } from '../crs/WebMercator';
import { WorkerPool } from '../workers/WorkerPool';
import { LayerRegistry } from '../layers/LayerRegistry';
import { TerrainRenderer } from '../terrain/TerrainRenderer';
import { DisplayController } from './DisplayController';
import { LayerController } from './LayerController';
import { defineTreeletElements } from '../ui/elements';
import type { TreeletCompass } from '../ui/TreeletCompass';
import type { TreeletAttribution } from '../ui/TreeletAttribution';

/** @deprecated Import from DisplayController instead. */
export { BASE_DRAPE_ID } from './DisplayController';

/** Minimum camera clearance above the terrain, in meters. */
const CAMERA_MIN_CLEARANCE_M = 2;

/** Time constant (seconds) at which the visible range shrinks (it grows at once). */
const HORIZON_EASE_S = 0.4;

/** The visible range never ends closer than this many orbit distances (low-pitch views). */
const MIN_HORIZON_ORBITS = 3;

/** Where haze starts, as a fraction of the visible range (fog on / off). */
const FOG_START = 0.35;
const HORIZON_BLEND_START = 0.8;

function requireFinite(value: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`treelet: ${name} must be a finite number, got ${value}`);
  }
  return value;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Resolve and validate user-provided TreeletOptions.
 * Throws descriptive errors for invalid values; clamps soft limits.
 */
export function resolveOptions(user: TreeletOptions): ResolvedTreeletOptions {
  if (!user || typeof user !== 'object') throw new Error('treelet: options object is required');
  if (!user.initCenter) throw new Error('treelet: initCenter is required');
  const gui = user.guiDisplay ?? {};
  const map = user.mapDisplay ?? {};
  const dm = DEFAULT_OPTIONS.mapDisplay;

  const lng = requireFinite(user.initCenter.lng, 'initCenter.lng');
  const lat = requireFinite(user.initCenter.lat, 'initCenter.lat');

  const minZoom = clamp(requireFinite(user.minZoom ?? DEFAULT_OPTIONS.minZoom, 'minZoom'), 0, MAX_TILE_ZOOM);
  const maxZoom = clamp(requireFinite(user.maxZoom ?? DEFAULT_OPTIONS.maxZoom, 'maxZoom'), 0, MAX_TILE_ZOOM);
  if (minZoom > maxZoom) throw new Error(`treelet: minZoom (${minZoom}) must be <= maxZoom (${maxZoom})`);
  const initZoom = clamp(requireFinite(user.initZoom ?? DEFAULT_OPTIONS.initZoom, 'initZoom'), minZoom, maxZoom);

  const slotSize = map.slotSize ?? dm.slotSize;
  const drapeSlotSize = map.drapeSlotSize ?? map.slotSize ?? dm.drapeSlotSize;
  const maxInstances = map.maxInstances ?? dm.maxInstances;
  const maxConcurrentFetches = map.maxConcurrentFetches ?? dm.maxConcurrentFetches;
  const atlasSegments = map.atlasSegments ?? dm.atlasSegments;
  let tileCacheSize = map.tileCacheSize ?? dm.tileCacheSize;
  if (map.tileCacheSize === undefined && map.atlasSize !== undefined) {
    tileCacheSize = tilesForAtlasSize(map.atlasSize, slotSize);
    console.warn(
      `treelet: mapDisplay.atlasSize is deprecated; atlasSize ${map.atlasSize} with slotSize ${slotSize} ` +
      `holds ${tileCacheSize} tiles. Use mapDisplay.tileCacheSize instead (default ${dm.tileCacheSize}).`,
    );
  }
  validateTileConfig(tileCacheSize, slotSize, maxInstances, maxConcurrentFetches, atlasSegments, drapeSlotSize);

  const worldScale = requireFinite(map.worldScale ?? dm.worldScale, 'mapDisplay.worldScale');
  if (worldScale <= 0) throw new Error('treelet: mapDisplay.worldScale must be > 0');
  const minPitch = clamp(requireFinite(map.minPitch ?? dm.minPitch, 'mapDisplay.minPitch'), 0, 90);
  const maxPitch = clamp(requireFinite(map.maxPitch ?? dm.maxPitch, 'mapDisplay.maxPitch'), 0, 90);
  if (minPitch > maxPitch) throw new Error(`treelet: minPitch (${minPitch}) must be <= maxPitch (${maxPitch})`);
  const maxPixelRatio = requireFinite(map.maxPixelRatio ?? dm.maxPixelRatio, 'mapDisplay.maxPixelRatio');
  if (maxPixelRatio <= 0) throw new Error('treelet: mapDisplay.maxPixelRatio must be > 0');

  const workerCount = Math.round(requireFinite(user.workerCount ?? DEFAULT_OPTIONS.workerCount, 'workerCount'));

  return {
    initCenter: { lng: clamp(lng, -180, 180), lat: clamp(lat, -WEB_MERCATOR_MAX_LAT, WEB_MERCATOR_MAX_LAT) },
    initZoom,
    minZoom,
    maxZoom,
    guiDisplay: {
      enabled: gui.enabled ?? DEFAULT_OPTIONS.guiDisplay.enabled,
      compassPosition: gui.compassPosition ?? DEFAULT_OPTIONS.guiDisplay.compassPosition,
      layerPosition: gui.layerPosition ?? DEFAULT_OPTIONS.guiDisplay.layerPosition,
      glass: gui.glass ?? DEFAULT_OPTIONS.guiDisplay.glass,
    },
    mapDisplay: {
      atlasSegments,
      antialias: map.antialias ?? dm.antialias,
      worldScale,
      minPitch,
      maxPitch,
      tileCacheSize,
      slotSize,
      drapeSlotSize,
      maxInstances,
      maxConcurrentFetches,
      maxPixelRatio,
      lodQuality: clamp(requireFinite(map.lodQuality ?? dm.lodQuality, 'mapDisplay.lodQuality'), 0.25, 4),
      morphWidth: clamp(requireFinite(map.morphWidth ?? dm.morphWidth, 'mapDisplay.morphWidth'), 0.05, 0.5),
      horizonDistance: clamp(
        requireFinite(map.horizonDistance ?? dm.horizonDistance, 'mapDisplay.horizonDistance'), 4, 64,
      ),
      fog: map.fog ?? dm.fog,
      renderOnDemand: map.renderOnDemand ?? dm.renderOnDemand,
    },
    workerCount: clamp(workerCount, 1, 16),
    workerUrl: user.workerUrl ?? null,
  };
}

export class Treelet extends EventEmitter<TreeletEventMap> {
  /** Library version, sourced from package.json at build time. */
  static readonly version: string = packageVersion;

  /**
   * Factory: create a new Treelet map instance.
   *
   * @param container - DOM element or element ID
   * @param options - Map configuration
   */
  static map(container: string | HTMLElement, options: TreeletOptions): Treelet {
    return new Treelet(container, options);
  }

  private readonly container: HTMLElement;
  private readonly options: ResolvedTreeletOptions;
  private readonly sceneManager: SceneManager;
  private readonly tileGrid: TileGrid;
  private readonly workerPool: WorkerPool;
  private readonly layerRegistry: LayerRegistry;
  private readonly terrainRenderer: TerrainRenderer;
  private readonly displayController: DisplayController;
  private readonly layerController: LayerController;

  /** Meters → scene-units conversion factor (at the equator). */
  private readonly metersToScene: number;

  /** Keeps the orbit target on the terrain and the camera above it. */
  private readonly cameraTerrain: CameraTerrain;
  /** Exaggeration the ground sampler applies (refreshed each frame and before picking). */
  private exag = 1;
  /** Elevation data version and exaggeration seen last frame. */
  private terrainVersion = -1;
  private terrainExag = NaN;
  /** The view jumped: don't extrapolate motion for prefetching. */
  private teleported = true;
  private lastZoom = NaN;
  /** Visible range (multiple of camera height), haze on/off, and the last frame's range in world units. */
  private horizonDistance: number;
  private fogEnabled: boolean;
  private horizon = Infinity;
  /** Camera height above the terrain it passes over or looks at, eased (scales the visible range). */
  private terrainHeight = NaN;
  private readonly sidePlanes = new Float64Array(16);

  private isRunning = false;
  private destroyed = false;
  private resizeObserver: ResizeObserver | null = null;
  private compass: TreeletCompass | null = null;
  private attribution: TreeletAttribution | null = null;
  private readonly scratch = new Vector3();
  private readonly scratchDir = new Vector3();

  constructor(container: string | HTMLElement, userOptions: TreeletOptions) {
    super();

    // Resolve container
    if (typeof container === 'string') {
      const el = document.getElementById(container);
      if (!el) throw new Error(`treelet: container element "${container}" not found`);
      this.container = el;
    } else {
      this.container = container;
    }

    this.options = resolveOptions(userOptions);
    const md = this.options.mapDisplay;
    const gd = this.options.guiDisplay;

    this.metersToScene = md.worldScale / WEB_MERCATOR_FULL_EXTENT;
    this.horizonDistance = md.horizonDistance;
    this.fogEnabled = md.fog;

    // Initialize subsystems
    this.tileGrid = new TileGrid(md.worldScale, MAX_TILE_ZOOM);
    this.sceneManager = new SceneManager(this.container, this.options);
    this.workerPool = new WorkerPool(this.options.workerCount, this.options.workerUrl);
    this.layerRegistry = new LayerRegistry();

    this.terrainRenderer = new TerrainRenderer({
      tileGrid: this.tileGrid,
      workerPool: this.workerPool,
      renderer: this.sceneManager.renderer,
      layerRegistry: this.layerRegistry,
      metersToScene: this.metersToScene,
      segments: md.atlasSegments,
      tileCacheSize: md.tileCacheSize,
      slotSize: md.slotSize,
      drapeSlotSize: md.drapeSlotSize,
      maxInstances: md.maxInstances,
      maxConcurrentFetches: md.maxConcurrentFetches,
      lodQuality: md.lodQuality,
      morphWidth: md.morphWidth,
      requestRender: () => this.sceneManager.requestRender(),
      onTileLoad: (coord) => this.emit('tileload', { coord }),
      onTileUnload: (coord) => this.emit('tileunload', { coord }),
      onTileError: (coord, layer, error) => this.emit('tileerror', { coord, layer, error }),
    });
    this.sceneManager.addTileMesh(this.terrainRenderer.mesh);
    this.sceneManager.onContextRestore(() => this.terrainRenderer.onContextRestored());

    this.displayController = new DisplayController(
      this.terrainRenderer,
      this.layerRegistry,
      this.sceneManager,
      this.options,
    );

    this.layerController = new LayerController(
      this.layerRegistry,
      this.terrainRenderer,
      this.displayController,
      (event, data) => this.emit(event, data),
      () => this.sceneManager.requestRender(),
      () => this.isRunning,
    );

    this.cameraTerrain = new CameraTerrain(this.sceneManager.cameraController, CAMERA_MIN_CLEARANCE_M * this.metersToScene);
    this.sceneManager.onFrame((dt, moved) => this.onFrame(dt, moved));
    this.sceneManager.cameraController.onChange(() => this.onCameraSettled());

    // Initial view
    const centerWorld = this.lngLatToWorld(this.options.initCenter);
    this.sceneManager.cameraController.setView(centerWorld.x, centerWorld.y, this.options.initZoom);

    // Watch for container resize
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          this.sceneManager.resize(width, height);
        }
      });
      this.resizeObserver.observe(this.container);
    }

    defineTreeletElements();
    if (!this.container.style.position) this.container.style.position = 'relative';

    // Compass + layer panel
    if (gd.enabled) {
      this.compass = document.createElement('treelet-compass') as TreeletCompass;
      this.container.appendChild(this.compass);
      this.compass.attach(this, {
        compassPosition: gd.compassPosition,
        layerPosition: gd.layerPosition,
        glass: gd.glass,
      });
      this.sceneManager.cameraController.onRawChange((state) => this.compass?.updateCamera(state));
      this.compass.updateCamera(this.sceneManager.cameraController.getState());
    }

    // Attribution bar at the bottom corner not used by the layer panel
    {
      const lp = gd.layerPosition;
      const cp = gd.compassPosition;
      let attrSide: 'left' | 'right' = 'right';
      if (lp.startsWith('bottom-')) {
        attrSide = lp.endsWith('left') ? 'right' : 'left';
      } else if (cp.startsWith('bottom-')) {
        attrSide = cp.endsWith('left') ? 'right' : 'left';
      }
      this.attribution = document.createElement('treelet-attribution') as TreeletAttribution;
      this.container.appendChild(this.attribution);
      this.attribution.attach(this, attrSide);
    }
  }

  // =========================================================================
  // Per-frame orchestration
  // =========================================================================

  /** Scene-space height of a terrain elevation (Mercator scale × exaggeration). */
  private elevationToScene(meters: number, worldY: number, exaggeration: number): number {
    return meters * this.metersToScene * WebMercator.scaleFactorAtWorldY(worldY, this.options.mapDisplay.worldScale) * exaggeration;
  }

  /** Terrain height in scene units at a world-plane point, or null where nothing is loaded. */
  private readonly groundZ: GroundSampler = (x, y) => {
    const meters = this.terrainRenderer.sampleElevationAtWorld(x, y);
    return meters === null ? null : this.elevationToScene(meters, y, this.exag);
  };

  private onFrame(dt: number, cameraMoved: boolean): boolean {
    if (!this.isRunning || this.destroyed) return false;
    const cc = this.sceneManager.cameraController;
    const cam = cc.camera;
    const target = cc.controls.target;
    const exag = this.layerRegistry.getActiveBaseLayer()?.display.exaggeration ?? 1;
    this.exag = exag;

    // ==== Camera and terrain ====
    // The target sits on the terrain at the screen center; the camera keeps
    // its height unless it would touch the terrain.
    const version = this.terrainRenderer.elevationVersion;
    const terrainChanged = version !== this.terrainVersion || exag !== this.terrainExag;
    this.terrainVersion = version;
    this.terrainExag = exag;
    const adjusted = this.cameraTerrain.update(this.groundZ, terrainChanged, this.horizon, dt);

    // ==== Visible range, clip planes and haze ====
    // Terrain dissolves into the horizon color at `horizon` (camera distance)
    // and is culled beyond it; past that range the sky shows the same color,
    // so the far clip plane can sit right there. The range scales with the
    // camera's height: the height the zoom and tilt give it (so terrain
    // passing below never shortens the view), or more where the camera is
    // actually higher above the terrain (lifted over a ridge, or looking down
    // into a valley). That actual height is eased both ways, as the
    // screen-center terrain jumps whenever a ridge passes it. The range
    // always reaches well past the screen center, grows at once and shrinks
    // eased, so distant terrain doesn't pop.
    const dist = cam.position.distanceTo(target);
    const clearance = this.cameraTerrain.clearance;
    const groundBelow = this.cameraTerrain.cameraGround ?? target.z;
    const heightAboveGround = Math.max(cam.position.z - groundBelow, clearance * 0.5);
    const zoomDist = this.cameraTerrain.zoomDistance;
    const terrainHeight = cam.position.z - Math.min(target.z, groundBelow);
    if (this.teleported || !Number.isFinite(this.terrainHeight)) {
      this.terrainHeight = terrainHeight;
    } else {
      this.terrainHeight += (terrainHeight - this.terrainHeight) * (1 - Math.exp(-dt / HORIZON_EASE_S));
      if (Math.abs(terrainHeight - this.terrainHeight) <= Math.abs(terrainHeight) * 0.01) this.terrainHeight = terrainHeight;
    }
    // Pitch from the camera itself: the controls' angle predates this frame's terrain adjustments.
    const cosPitch = dist > 0 ? (cam.position.z - target.z) / dist : 1;
    const height = Math.max(zoomDist * cosPitch, this.terrainHeight, zoomDist * 0.05);
    const range = Math.max(height * this.horizonDistance, dist * MIN_HORIZON_ORBITS);
    let horizon = range;
    if (range < this.horizon && !this.teleported) {
      horizon = this.horizon + (range - this.horizon) * (1 - Math.exp(-dt / HORIZON_EASE_S));
      if (horizon < range * 1.01) horizon = range;
    }
    this.horizon = horizon;
    // The near plane stays inside the clearance sphere, so terrain never cuts into it.
    const near = Math.max(
      Math.min(Math.min(dist, heightAboveGround) * 0.02, clearance * 0.5),
      this.options.mapDisplay.worldScale * 1e-10,
    );
    this.sceneManager.setClipPlanes(near, horizon * 1.02);
    this.terrainRenderer.setFog(
      this.sceneManager.horizonColor,
      horizon * (this.fogEnabled ? FOG_START : HORIZON_BLEND_START),
      horizon,
    );

    // ==== Terrain ====
    const zoom = cc.deriveZoom();
    const needsRender = this.terrainRenderer.update({
      cameraX: cam.position.x,
      cameraY: cam.position.y,
      cameraZ: cam.position.z,
      targetX: target.x,
      targetY: target.y,
      targetZ: target.z,
      zoom,
      focalLength: cc.focalLength,
      exaggeration: exag,
      horizon,
      frustum: this.sceneManager.getSidePlanes(this.sidePlanes),
      teleported: this.teleported,
    });
    this.teleported = false;
    this.compass?.updateTileCount(this.terrainRenderer.getInstanceCount());

    // ==== Events ====
    if (cameraMoved || adjusted) this.emit('move', { center: this.getCenter() });
    if (!(Math.abs(zoom - this.lastZoom) < 1e-3)) {
      this.lastZoom = zoom;
      this.emit('zoom', { zoom });
    }

    return needsRender || adjusted || horizon !== range || this.terrainHeight !== terrainHeight;
  }

  /** Debounced end of a camera interaction. */
  private onCameraSettled(): void {
    if (!this.isRunning || this.destroyed) return;
    this.sceneManager.requestRender();
    this.emit('moveend', { center: this.getCenter(), zoom: this.getZoom() });
  }

  private lngLatToWorld(lngLat: LngLat): { x: number; y: number } {
    return WebMercator.toWorldPlane(WebMercator.project(lngLat), this.options.mapDisplay.worldScale);
  }

  private worldToLngLat(x: number, y: number): LngLat {
    return WebMercator.unproject(WebMercator.fromWorldPlane({ x, y }, this.options.mapDisplay.worldScale));
  }

  // =========================================================================
  // View API
  // =========================================================================

  /** Center the map on `center` at `zoom`, keeping the current pitch and bearing. */
  setView(center: LngLat, zoom: number): this {
    if (this.destroyed) return this;
    const world = this.lngLatToWorld({
      lng: clamp(requireFinite(center.lng, 'center.lng'), -180, 180),
      lat: clamp(requireFinite(center.lat, 'center.lat'), -WEB_MERCATOR_MAX_LAT, WEB_MERCATOR_MAX_LAT),
    });
    const cc = this.sceneManager.cameraController;
    cc.setView(world.x, world.y, requireFinite(zoom, 'zoom'), cc.controls.target.z);
    this.cameraTerrain.snapToTerrain();
    this.teleported = true;
    this.sceneManager.requestRender();
    return this;
  }

  /** Geographic position of the orbit target (the point the camera looks at). */
  getCenter(): LngLat {
    const t = this.sceneManager.cameraController.controls.target;
    return this.worldToLngLat(t.x, t.y);
  }

  /** Current fractional zoom. */
  getZoom(): number { return this.sceneManager.cameraController.deriveZoom(); }

  /** Number of terrain tiles drawn in the last frame. */
  getTileCount(): number { return this.terrainRenderer.getInstanceCount(); }

  /** Runtime statistics (tiles, atlas use, pending and failed requests). */
  getStats(): TreeletStats { return this.terrainRenderer.getStats(); }

  /** Visible ground footprint (on the target's height) as a lng/lat box, or null. */
  getBounds(): { sw: LngLat; ne: LngLat } | null {
    const target = this.sceneManager.cameraController.controls.target;
    const extent = this.sceneManager.getVisibleExtent(target.z, this.horizon);
    if (!extent) return null;
    const bounds = this.sceneManager.getExtentBounds(extent);
    return {
      sw: this.worldToLngLat(bounds.min.x, bounds.min.y),
      ne: this.worldToLngLat(bounds.max.x, bounds.max.y),
    };
  }

  /**
   * Visible range as a multiple of the camera's height: the height the zoom
   * and tilt give it above the terrain it looks at, or its actual height
   * where that is more (clamped to [4, 64]). Larger values show more distant
   * terrain and use more tiles.
   */
  setHorizonDistance(factor: number): this {
    this.horizonDistance = clamp(requireFinite(factor, 'horizonDistance'), 4, 64);
    this.sceneManager.requestRender();
    return this;
  }

  /** Visible range as a multiple of the camera's height (see setHorizonDistance). */
  getHorizonDistance(): number { return this.horizonDistance; }

  /** Turn the atmospheric haze over distant terrain on or off. */
  setFog(enabled: boolean): this {
    this.fogEnabled = !!enabled;
    this.sceneManager.requestRender();
    return this;
  }

  /** Request a redraw on the next animation frame (renderOnDemand mode). */
  requestRender(): this {
    this.sceneManager.requestRender();
    return this;
  }

  // =========================================================================
  // Inspection API
  // =========================================================================

  /**
   * Elevation in meters at a geographic position from the finest loaded
   * tile, or null when no data covering it is loaded.
   */
  getElevation(lngLat: LngLat): number | null {
    if (this.destroyed) return null;
    const w = this.lngLatToWorld(lngLat);
    return this.terrainRenderer.sampleElevationAtWorld(w.x, w.y);
  }

  /**
   * Pick the terrain under a point in container-relative CSS pixels.
   * Ray-marches the loaded elevation data (exaggeration-aware).
   */
  pick(x: number, y: number): TerrainPick | null {
    if (this.destroyed) return null;
    const cam = this.sceneManager.camera;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    cam.updateMatrixWorld();
    const origin = this.scratch.setFromMatrixPosition(cam.matrixWorld);
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const dir = this.scratchDir.set((x / w) * 2 - 1, -(y / h) * 2 + 1, 0.5).unproject(cam).sub(origin).normalize();
    this.exag = this.layerRegistry.getActiveBaseLayer()?.display.exaggeration ?? 1;

    // March until the ray drops below the surface, then bisect. Samples
    // without data count as above it (the bracket then ends at the first
    // loaded point below the surface).
    const g0 = this.groundZ(ox + dir.x * cam.near, oy + dir.y * cam.near);
    if (g0 !== null && oz + dir.z * cam.near <= g0) return null; // camera inside terrain
    const t = marchToTerrain(this.groundZ, origin, dir, cam.near, cam.far, 1.004, cam.near, 4000);
    if (t === null) return null;
    const px = ox + dir.x * t;
    const py = oy + dir.y * t;
    const elevation = this.terrainRenderer.sampleElevationAtWorld(px, py);
    if (elevation === null) return null;
    return { lngLat: this.worldToLngLat(px, py), elevation };
  }

  /**
   * Elevation profile along the straight (Mercator) line from `from` to `to`.
   * Distances are great-circle ground distances in meters.
   */
  getElevationProfile(from: LngLat, to: LngLat, samples = 256): ProfileSample[] {
    const n = Math.max(2, Math.floor(samples));
    const a = this.lngLatToWorld(from);
    const b = this.lngLatToWorld(to);
    const out: ProfileSample[] = [];
    let distance = 0;
    let prev: LngLat | null = null;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const x = a.x + (b.x - a.x) * f;
      const y = a.y + (b.y - a.y) * f;
      const lngLat = this.worldToLngLat(x, y);
      if (prev) distance += WebMercator.groundDistance(prev, lngLat);
      prev = lngLat;
      out.push({ lngLat, distance, elevation: this.terrainRenderer.sampleElevationAtWorld(x, y) });
    }
    return out;
  }

  // =========================================================================
  // Base Layer API (→ LayerController)
  // =========================================================================

  addBaseLayer(options: BaseLayerOptions): LayerHandle { return this.layerController.addBaseLayer(options); }
  removeBaseLayer(handle: LayerHandle | string): this { this.layerController.removeBaseLayer(handle); return this; }
  setActiveBaseLayer(handle: LayerHandle | string): this { this.layerController.setActiveBaseLayer(handle); return this; }

  // =========================================================================
  // Drape API (→ LayerController)
  // =========================================================================

  addDrapeLayer(options: DrapeLayerOptions): LayerHandle { return this.layerController.addDrapeLayer(options); }
  removeDrapeLayer(handle: LayerHandle | string): this { this.layerController.removeDrapeLayer(handle); return this; }
  activateDrapeLayer(handle: LayerHandle | string): this { this.layerController.activateDrapeLayer(handle); return this; }
  activateBaseDrape(mode?: BaseDrapeMode): this { this.layerController.activateBaseDrape(mode); return this; }

  // =========================================================================
  // Overlay Layer API (→ LayerController)
  // =========================================================================

  addOverlayLayer(options: OverlayLayerOptions): LayerHandle { return this.layerController.addOverlayLayer(options); }
  removeOverlayLayer(handle: LayerHandle | string): this { this.layerController.removeOverlayLayer(handle); return this; }

  // =========================================================================
  // Display API (→ DisplayController)
  // =========================================================================

  setBaseDrapeMode(mode: BaseDrapeMode): this {
    this.displayController.setBaseDrapeMode(mode, () => this.layerController.deactivateAllDrapes());
    this.emit('layerchange', {});
    return this;
  }

  getBaseDrapeMode(): BaseDrapeMode { return this.displayController.getBaseDrapeMode(); }
  getActiveDrapeId(): string | null { return this.displayController.getActiveDrapeId(); }
  isBaseDrapeActive(): boolean { return this.displayController.isBaseDrapeActive(); }

  setDrapeOpacity(handle: LayerHandle | string, opacity: number): this { this.displayController.setDrapeOpacity(handle, opacity); return this; }
  getDrapeOpacity(handle: LayerHandle | string): number { return this.displayController.getDrapeOpacity(handle); }
  setDrapeBlendMode(mode: BlendMode): this { this.displayController.setDrapeBlendMode(mode); return this; }
  getDrapeBlendMode(): BlendMode { return this.displayController.getDrapeBlendMode(); }
  setHillshadeStrength(strength: number): this { this.displayController.setHillshadeStrength(strength); return this; }
  getHillshadeStrength(): number { return this.displayController.getHillshadeStrength(); }

  setExaggeration(handleOrValue: LayerHandle | string | number, value?: number): this { this.displayController.setExaggeration(handleOrValue, value); return this; }
  getExaggeration(): number { return this.displayController.getExaggeration(); }

  setIsolineInterval(interval: number): this { this.displayController.setIsolineInterval(interval); return this; }
  getIsolineInterval(): number { return this.displayController.getIsolineInterval(); }
  setIsolineThickness(thickness: number): this { this.displayController.setIsolineThickness(thickness); return this; }
  getIsolineThickness(): number { return this.displayController.getIsolineThickness(); }
  setIsolineColor(r: number, g: number, b: number): this { this.displayController.setIsolineColor(r, g, b); return this; }
  getIsolineColor(): [number, number, number] { return this.displayController.getIsolineColor(); }

  /** Elevation color-ramp range in meters, or 'auto' to fit the visible data. */
  setElevationRange(range: [number, number] | 'auto'): this { this.displayController.setElevationRange(range); return this; }
  getElevationRange(): [number, number] | 'auto' { return this.displayController.getElevationRange(); }
  /** Slope color-ramp range in degrees. */
  setSlopeRange(min: number, max: number): this { this.displayController.setSlopeRange(min, max); return this; }
  getSlopeRange(): [number, number] { return this.displayController.getSlopeRange(); }

  setSunAzimuth(degrees: number): this { this.displayController.setSunAzimuth(degrees); return this; }
  getSunAzimuth(): number { return this.displayController.getSunAzimuth(); }
  setSunAltitude(degrees: number): this { this.displayController.setSunAltitude(degrees); return this; }
  getSunAltitude(): number { return this.displayController.getSunAltitude(); }

  setColorRamp(ramp: ColorRamp): this { this.displayController.setColorRamp(ramp); return this; }
  getColorRamp(): ColorRamp { return this.displayController.getColorRamp(); }
  setWireframeWhite(white: boolean): this { this.displayController.setWireframeWhite(white); return this; }
  getWireframeWhite(): boolean { return this.displayController.getWireframeWhite(); }

  /** Level-of-detail quality: > 1 finer tiles, < 1 coarser. */
  setLodQuality(quality: number): this { this.terrainRenderer.setLodQuality(requireFinite(quality, 'quality')); return this; }

  // =========================================================================
  // UI accessor methods
  // =========================================================================

  getBaseLayers(): BaseLayer[] { return this.layerController.getBaseLayers(); }
  getDrapeLayers(): DrapeLayer[] { return this.layerController.getDrapeLayers(); }
  getCameraController(): CameraController { return this.sceneManager.cameraController; }

  setMinPitch(degrees: number): this { this.displayController.setMinPitch(degrees); return this; }
  getMinPitch(): number { return this.displayController.getMinPitch(); }
  setMaxPitch(degrees: number): this { this.displayController.setMaxPitch(degrees); return this; }
  getMaxPitch(): number { return this.displayController.getMaxPitch(); }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  start(): this {
    if (this.isRunning || this.destroyed) return this;
    this.isRunning = true;

    this.displayController.applyMaterialState();
    this.displayController.updateSunDirection();

    this.sceneManager.startRenderLoop();
    this.sceneManager.cameraController.enable();

    setTimeout(() => {
      if (this.destroyed) return;
      this.emit('ready', {});
    }, 0);

    return this;
  }

  stop(): this {
    this.isRunning = false;
    if (!this.destroyed) {
      this.sceneManager.stopRenderLoop();
      this.sceneManager.cameraController.disable();
    }
    return this;
  }

  /** Release all resources. The instance cannot be used afterwards. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.terrainRenderer.dispose();
    this.workerPool.dispose();
    this.sceneManager.dispose();
    this.removeAllListeners();

    if (this.compass) { this.compass.remove(); this.compass = null; }
    if (this.attribution) { this.attribution.remove(); this.attribution = null; }
  }
}
