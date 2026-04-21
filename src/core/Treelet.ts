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

import { EventEmitter } from './EventEmitter';
import { DEFAULT_OPTIONS, WEB_MERCATOR_FULL_EXTENT, validateAtlasConfig } from './constants';
import { version as packageVersion } from '../../package.json';
import type {
  TreeletOptions,
  ResolvedTreeletOptions,
  TreeletEventMap,
  LngLat,
  BaseDrapeMode,
  BlendMode,
  ColorRamp,
  VisibleExtent,
} from './types';
import { SceneManager } from '../scene/SceneManager';
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
import { TreeletCompass } from '../ui/TreeletCompass';
import { TreeletAttribution } from '../ui/TreeletAttribution';

/** @deprecated Import from DisplayController instead. */
export { BASE_DRAPE_ID } from './DisplayController';

/** Exponential smoothing alpha for orbit-target elevation tracking.
 *  0.08 ≈ 13 frames at 60fps to reach ~63% of the target - fast enough
 *  to follow terrain, slow enough to avoid per-frame jitter. */
const ELEVATION_SMOOTH_ALPHA = 0.08;

/**
 * Resolve user-provided TreeletOptions into fully-resolved form.
 */
function resolveOptions(user: TreeletOptions): ResolvedTreeletOptions {
  const gui = user.guiDisplay ?? {};
  const map = user.mapDisplay ?? {};

  const atlasSize = map.atlasSize ?? DEFAULT_OPTIONS.mapDisplay.atlasSize;
  const slotSize = map.slotSize ?? DEFAULT_OPTIONS.mapDisplay.slotSize;
  const maxInstances = map.maxInstances ?? DEFAULT_OPTIONS.mapDisplay.maxInstances;
  const maxConcurrentFetches = map.maxConcurrentFetches ?? DEFAULT_OPTIONS.mapDisplay.maxConcurrentFetches;
  validateAtlasConfig(atlasSize, slotSize, maxInstances, maxConcurrentFetches);

  return {
    initCenter: user.initCenter,
    initZoom: user.initZoom,
    minZoom: user.minZoom ?? DEFAULT_OPTIONS.minZoom,
    maxZoom: user.maxZoom ?? DEFAULT_OPTIONS.maxZoom,
    guiDisplay: {
      enabled: gui.enabled ?? DEFAULT_OPTIONS.guiDisplay.enabled,
      compassPosition: gui.compassPosition ?? DEFAULT_OPTIONS.guiDisplay.compassPosition,
      layerPosition: gui.layerPosition ?? DEFAULT_OPTIONS.guiDisplay.layerPosition,
    },
    mapDisplay: {
      atlasSegments: map.atlasSegments ?? DEFAULT_OPTIONS.mapDisplay.atlasSegments,
      antialias: map.antialias ?? DEFAULT_OPTIONS.mapDisplay.antialias,
      worldScale: map.worldScale ?? DEFAULT_OPTIONS.mapDisplay.worldScale,
      minPitch: map.minPitch ?? DEFAULT_OPTIONS.mapDisplay.minPitch,
      maxPitch: map.maxPitch ?? DEFAULT_OPTIONS.mapDisplay.maxPitch,
      atlasSize,
      slotSize,
      maxInstances,
      maxConcurrentFetches,
    },
    workerCount: user.workerCount ?? DEFAULT_OPTIONS.workerCount,
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

  /** Meters → scene-units conversion factor. */
  private readonly metersToScene: number;

  /** Smoothed terrain elevation at the orbit target, in scene units. */
  private _smoothedTargetZ = 0;

  private isRunning = false;
  private resizeObserver: ResizeObserver | null = null;
  private compass: TreeletCompass | null = null;
  private attribution: TreeletAttribution | null = null;

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

    // Resolve options with defaults
    this.options = resolveOptions(userOptions);
    const md = this.options.mapDisplay;
    const gd = this.options.guiDisplay;

    // Compute meters → scene conversion factor
    this.metersToScene = md.worldScale / WEB_MERCATOR_FULL_EXTENT;

    // Initialize subsystems
    this.tileGrid = new TileGrid(md.worldScale, 30);
    this.sceneManager = new SceneManager(this.container, this.options);
    this.workerPool = new WorkerPool(this.options.workerCount);
    this.layerRegistry = new LayerRegistry();

    // Terrain renderer: instanced single draw call with quadtree LOD + geomorphing
    this.terrainRenderer = new TerrainRenderer(
      this.tileGrid,
      this.workerPool,
      this.sceneManager,
      this.layerRegistry,
      this.metersToScene,
      this.options.minZoom,
      this.options.maxZoom,
      md.atlasSegments,
      md.atlasSize,
      md.slotSize,
      md.maxInstances,
      md.maxConcurrentFetches,
    );

    // Controllers: delegate display mutations and layer lifecycle
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
      () => this.scheduleTiles(),
      () => this.isRunning,
    );

    // Per-frame render callback
    this.sceneManager.onRender(() => {
      if (!this.isRunning) return;
      const cc = this.sceneManager.cameraController;
      const target = cc.controls.target;
      const zoom = cc.deriveZoom();
      const baseLayer = this.layerRegistry.getActiveBaseLayer();
      const combinedExag = baseLayer?.display.exaggeration ?? 1.0;

      // Shift LOD anchor toward camera footprint when tilted past 20° polar
      const polarDeg = cc.controls.getPolarAngle() * (180 / Math.PI);
      const t = Math.min(Math.max((polarDeg - 20) / 10, 0), 1);
      const cam = cc.camera.position;
      const lodX = target.x + t * (cam.x - target.x);
      const lodY = target.y + t * (cam.y - target.y);

      this.terrainRenderer.updateFrame(lodX, lodY, zoom, combinedExag);

      // ==== Camera target elevation tracking ====
      const rawElev = this.terrainRenderer.sampleElevationAtWorld(target.x, target.y, zoom);
      if (rawElev !== null) {
        const targetZ = rawElev * combinedExag * this.metersToScene;
        this._smoothedTargetZ += (targetZ - this._smoothedTargetZ) * ELEVATION_SMOOTH_ALPHA;
      }
      const deltaZ = this._smoothedTargetZ - target.z;
      if (Math.abs(deltaZ) > 0.0001) {
        target.z = this._smoothedTargetZ;
        cam.z += deltaZ;
      }
    });

    // Debounced camera change → tile fetching + event emission
    this.sceneManager.cameraController.onChange(() => {
      this.scheduleTiles();
    });

    // Set initial view
    const centerMerc = WebMercator.project(this.options.initCenter);
    const centerWorld = WebMercator.toWorldPlane(centerMerc, md.worldScale);
    this.sceneManager.cameraController.setView(
      centerWorld.x,
      centerWorld.y,
      this.options.initZoom,
    );

    // Watch for container resize
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          this.sceneManager.resize(width, height);
        }
      }
    });
    this.resizeObserver.observe(this.container);

    // Create UI compass + panel if gui is enabled
    if (gd.enabled) {
      this.compass = document.createElement('treelet-compass') as TreeletCompass;
      this.container.style.position = this.container.style.position || 'relative';
      this.container.appendChild(this.compass);
      this.compass.attach(this, {
        compassPosition: gd.compassPosition,
        layerPosition: gd.layerPosition,
      });

      this.sceneManager.cameraController.onRawChange((state) => {
        this.compass?.updateCamera(state);
      });

      this.compass.updateCamera(this.sceneManager.cameraController.getState());
    }

    // Attribution bar
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
      this.container.style.position = this.container.style.position || 'relative';
      this.container.appendChild(this.attribution);
      this.attribution.attach(this, attrSide);
    }
  }

  // =========================================================================
  // View API
  // =========================================================================

  setView(center: LngLat, zoom: number): this {
    this._smoothedTargetZ = 0;
    const merc = WebMercator.project(center);
    const world = WebMercator.toWorldPlane(merc, this.options.mapDisplay.worldScale);
    this.sceneManager.cameraController.setView(world.x, world.y, zoom);
    this.scheduleTiles();
    return this;
  }

  getCenter(): LngLat {
    const extent = this.sceneManager.getVisibleExtent();
    if (!extent) return this.options.initCenter;
    const merc = WebMercator.fromWorldPlane(extent.center, this.options.mapDisplay.worldScale);
    return WebMercator.unproject(merc);
  }

  private getCenterFromExtent(extent: VisibleExtent): LngLat {
    const merc = WebMercator.fromWorldPlane(extent.center, this.options.mapDisplay.worldScale);
    return WebMercator.unproject(merc);
  }

  getZoom(): number { return this.sceneManager.cameraController.deriveZoom(); }
  getTileCount(): number { return this.terrainRenderer.getDrawCallCount(); }

  getBounds(): { sw: LngLat; ne: LngLat } | null {
    const extent = this.sceneManager.getVisibleExtent();
    if (!extent) return null;
    const bounds = this.sceneManager.getExtentBounds(extent);
    const sw = WebMercator.unproject(
      WebMercator.fromWorldPlane(bounds.min, this.options.mapDisplay.worldScale),
    );
    const ne = WebMercator.unproject(
      WebMercator.fromWorldPlane(bounds.max, this.options.mapDisplay.worldScale),
    );
    return { sw, ne };
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

  setSunAzimuth(degrees: number): this { this.displayController.setSunAzimuth(degrees); return this; }
  getSunAzimuth(): number { return this.displayController.getSunAzimuth(); }
  setSunAltitude(degrees: number): this { this.displayController.setSunAltitude(degrees); return this; }
  getSunAltitude(): number { return this.displayController.getSunAltitude(); }

  setColorRamp(ramp: ColorRamp): this { this.displayController.setColorRamp(ramp); return this; }
  getColorRamp(): ColorRamp { return this.displayController.getColorRamp(); }
  setWireframeWhite(white: boolean): this { this.displayController.setWireframeWhite(white); return this; }
  getWireframeWhite(): boolean { return this.displayController.getWireframeWhite(); }

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
    if (this.isRunning) return this;
    this.isRunning = true;

    this.displayController.applyMaterialState();
    this.displayController.updateSunDirection();

    this.sceneManager.startRenderLoop();
    this.sceneManager.cameraController.enable();

    setTimeout(() => {
      this.scheduleTiles();
      this.emit('ready', {});
    }, 0);

    return this;
  }

  stop(): this {
    this.isRunning = false;
    this.sceneManager.stopRenderLoop();
    this.sceneManager.cameraController.disable();
    return this;
  }

  destroy(): void {
    this.stop();
    this.terrainRenderer.dispose();
    this.workerPool.dispose();
    this.sceneManager.dispose();
    this.resizeObserver?.disconnect();
    this.removeAllListeners();

    if (this.compass) { this.compass.remove(); this.compass = null; }
    if (this.attribution) { this.attribution.remove(); this.attribution = null; }
  }

  // =========================================================================
  // Internal: Tile Scheduling
  // =========================================================================

  private scheduleTiles(): void {
    if (!this.isRunning) return;

    const extent = this.sceneManager.getVisibleExtent();
    if (!extent) return;

    const zoom = this.sceneManager.cameraController.deriveZoom();
    this.terrainRenderer.fetchTiles();

    const center = this.getCenterFromExtent(extent);
    this.emit('move', { center });
    this.emit('moveend', { center, zoom });
  }
}
