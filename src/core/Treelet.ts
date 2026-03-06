// ============================================================================
// treelet.js - Main Orchestrator
// The central class that wires together scene, tiles, layers, workers, UI,
// shaders, seam resolution, and drape compositing.
//
// Layer architecture:
//   Base layer  = geometry source (elevation data)
//   Drape layer = visualization (BaseDrape: wireframe/elevation/slope/aspect/contours,
//                                or external texture like OSM/satellite)
//   Only one drape active at a time (no blending).
// ============================================================================

import type { ShaderMaterial } from 'three';
import { EventEmitter } from './EventEmitter';
import { DEFAULT_OPTIONS, WEB_MERCATOR_FULL_EXTENT } from './constants';
import type {
  TreeletOptions,
  ResolvedTreeletOptions,
  TreeletEventMap,
  BaseLayerOptions,
  DrapeLayerOptions,
  LngLat,
  TileCoord,
  BaseDrapeMode,
  ShaderMode,
  ColorRamp,
  VisibleExtent,
} from './types';
import { SceneManager } from '../scene/SceneManager';
import type { CameraController } from '../scene/CameraController';
import type { BaseLayer } from '../layers/base/BaseLayer';
import type { DrapeLayer } from '../layers/drape/DrapeLayer';
import { TileGrid } from '../tiles/TileGrid';
import { TileScheduler, type LODContext } from '../tiles/TileScheduler';
import { TileCache, type CacheEntry } from '../tiles/TileCache';
import { tileKey } from '../tiles/TileIndex';
import { createTileMesh, createElevationMesh } from '../tiles/TileMesh';
import { WebMercator } from '../crs/WebMercator';
import { WorkerPool } from '../workers/WorkerPool';
import { LayerRegistry } from '../layers/LayerRegistry';
import { SeamResolver } from '../layers/base/SeamResolver';
import { DrapeCompositor } from '../layers/drape/DrapeCompositor';
import {
  createTerrainMaterial,
  setMaterialMode,
  setMaterialColorRamp,
  setMaterialContourEnabled,
  setMaterialContourSettings,
  setMaterialWireframe,
  setMaterialBaseWhite,
  setMaterialContourColor,
  setMaterialDrape,
  isTerrainMaterial,
} from '../shaders/TerrainMaterial';
import { TreeletCompass } from '../ui/TreeletCompass';
import { TreeletAttribution } from '../ui/TreeletAttribution';

/** Special ID for the virtual BaseDrape layer. */
const BASE_DRAPE_ID = '__base_drape__';

export class Treelet extends EventEmitter<TreeletEventMap> {
  /** Library version. */
  static readonly version = '0.1.0';

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
  private readonly scheduler: TileScheduler;
  private readonly cache: TileCache;
  private readonly workerPool: WorkerPool;
  private readonly layerRegistry: LayerRegistry;
  private readonly seamResolver: SeamResolver;
  private readonly drapeCompositor: DrapeCompositor;

  /** Meters → scene-units conversion factor. */
  private readonly metersToScene: number;

  /** Track in-flight tile loads to prevent duplicates. */
  private readonly loadingTiles = new Set<string>();

  /** Currently active drape: BASE_DRAPE_ID=BaseDrape, or external drape ID. */
  private activeDrapeId: string | null = BASE_DRAPE_ID;

  /** BaseDrape sub-mode: wireframe, elevation, slope, aspect, or contours. */
  private baseDrapeMode: BaseDrapeMode = 'elevation';

  /** Color ramp saved per BaseDrape mode. */
  private colorRampByMode: Record<BaseDrapeMode, ColorRamp> = {
    wireframe: 'hypsometric',
    elevation: 'hypsometric',
    slope: 'viridis',
    aspect: 'inferno',
    contours: 'hypsometric',
  };

  /** Whether wireframe renders flat white (true) or normals coloring (false). */
  private wireframeWhite = false;

  /** Contour line color as [r, g, b] in 0–1 range. */
  private contourColorRGB: [number, number, number] = [0.12, 0.08, 0.04];

  /** Contour line thickness (shader-space). */
  private contourThickness = 1.5;

  /** Current derived camera zoom (updated each scheduleTiles cycle). */
  private currentZoom = 0;

  /** Prototype material for cloning - shares compiled shader program across tiles. */
  private prototypeMaterial: ShaderMaterial | null = null;

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

    // Merge options with defaults
    this.options = { ...DEFAULT_OPTIONS, ...userOptions };

    // Compute meters → scene conversion factor
    this.metersToScene = this.options.worldScale / WEB_MERCATOR_FULL_EXTENT;

    // Initialize subsystems
    this.tileGrid = new TileGrid(this.options.worldScale, 30);

    this.sceneManager = new SceneManager(this.container, this.options);

    this.scheduler = new TileScheduler({
      tileGrid: this.tileGrid,
      minZoom: this.options.minZoom,
      maxZoom: this.options.maxZoom,
      lodEnabled: true,
    });

    this.cache = new TileCache();
    this.cache.onEvict = (entry: CacheEntry) => {
      this.sceneManager.removeTileMesh(entry.mesh);
      this.emit('tileunload', { coord: entry.coord });
    };

    // Worker pool for off-thread tile processing
    this.workerPool = new WorkerPool(this.options.workerCount);

    // Layer registry
    this.layerRegistry = new LayerRegistry();

    // Seam resolver for gapless tile edges
    this.seamResolver = new SeamResolver(this.options.tileSegments);

    // Drape compositor for imagery overlay
    this.drapeCompositor = new DrapeCompositor();

    // Wire camera change → tile scheduling
    this.sceneManager.cameraController.onChange(() => {
      this.scheduleTiles();
    });

    // Set initial view
    const centerMerc = WebMercator.project(this.options.center);
    const centerWorld = WebMercator.toWorldPlane(centerMerc, this.options.worldScale);
    this.sceneManager.cameraController.setView(
      centerWorld.x,
      centerWorld.y,
      this.options.zoom,
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
    if (this.options.gui) {
      this.compass = document.createElement('treelet-compass') as TreeletCompass;
      this.container.style.position = this.container.style.position || 'relative';
      this.container.appendChild(this.compass);
      this.compass.attach(this, {
        compassPosition: this.options.compassPosition,
        layerPosition: this.options.layerPosition,
      });

      // Wire raw camera updates for smooth compass rotation
      this.sceneManager.cameraController.onRawChange((state) => {
        this.compass?.updateCamera(state);
      });

      // Push initial camera state so info panel is populated from the start
      this.compass.updateCamera(this.sceneManager.cameraController.getState());
    }

    // Attribution bar — always shown (legal requirement from tile providers).
    // Placed at the opposite bottom corner to the layer panel so they never overlap.
    {
      const lp = this.options.layerPosition;
      const cp = this.options.compassPosition;
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
    const merc = WebMercator.project(center);
    const world = WebMercator.toWorldPlane(merc, this.options.worldScale);
    this.sceneManager.cameraController.setView(world.x, world.y, zoom);
    this.scheduleTiles();
    return this;
  }

  getCenter(): LngLat {
    const extent = this.sceneManager.getVisibleExtent();
    if (!extent) return this.options.center;
    const merc = WebMercator.fromWorldPlane(extent.center, this.options.worldScale);
    return WebMercator.unproject(merc);
  }

  /**
   * Compute center from a pre-computed extent (avoids redundant raycasting).
   */
  private getCenterFromExtent(extent: VisibleExtent): LngLat {
    const merc = WebMercator.fromWorldPlane(extent.center, this.options.worldScale);
    return WebMercator.unproject(merc);
  }

  getZoom(): number {
    return this.sceneManager.cameraController.deriveZoom();
  }

  getTileCount(): number {
    return this.cache.size;
  }

  getBounds(): { sw: LngLat; ne: LngLat } | null {
    const extent = this.sceneManager.getVisibleExtent();
    if (!extent) return null;
    const bounds = this.sceneManager.getExtentBounds(extent);
    const sw = WebMercator.unproject(
      WebMercator.fromWorldPlane(bounds.min, this.options.worldScale),
    );
    const ne = WebMercator.unproject(
      WebMercator.fromWorldPlane(bounds.max, this.options.worldScale),
    );
    return { sw, ne };
  }

  // =========================================================================
  // Base Layer API
  // =========================================================================

  addBaseLayer(options: BaseLayerOptions): this {
    this.layerRegistry.addBaseLayer(options);
    this.emit('layeradd', { id: options.id });

    if (this.isRunning) {
      this.reloadAllTiles();
    }

    this.emit('layerchange', {});
    return this;
  }

  removeBaseLayer(id: string): this {
    if (this.layerRegistry.removeBaseLayer(id)) {
      this.emit('layerremove', { id });

      if (this.isRunning) {
        this.reloadAllTiles();
      }

      this.emit('layerchange', {});
    }
    return this;
  }

  setActiveBaseLayer(id: string): this {
    this.layerRegistry.setActiveBaseLayer(id);

    if (this.isRunning) {
      this.reloadAllTiles();
    }

    this.emit('layerchange', {});
    return this;
  }

  // =========================================================================
  // Drape API (single-drape exclusivity)
  // =========================================================================

  /**
   * Add a drape layer (imagery overlay).
   */
  addDrapeLayer(options: DrapeLayerOptions): this {
    this.layerRegistry.addDrapeLayer({ ...options, active: false });
    this.emit('layeradd', { id: options.id });
    this.emit('layerchange', {});
    return this;
  }

  /**
   * Remove a drape layer.
   */
  removeDrapeLayer(id: string): this {
    if (this.layerRegistry.removeDrapeLayer(id)) {
      if (this.activeDrapeId === id) {
        this.activeDrapeId = null;
        this.clearAllDrapeTextures();
        this.applyMaterialState();
      }
      this.emit('layerremove', { id });
      this.emit('layerchange', {});
    }
    return this;
  }

  /**
   * Activate a specific external drape layer (deactivates all others including BaseDrape).
   */
  activateDrapeLayer(id: string): this {
    // Deactivate all external drapes first
    for (const drape of this.layerRegistry.getAllDrapeLayers()) {
      drape.active = false;
    }

    // Activate the requested one
    this.layerRegistry.setDrapeLayerActive(id, true);
    this.activeDrapeId = id;

    // Sync compositor and apply drape textures
    this.syncDrapes();
    this.applyMaterialState();
    this.emit('layerchange', {});
    return this;
  }

  /**
   * Activate the virtual BaseDrape (elevation/slope/aspect coloring).
   */
  activateBaseDrape(mode?: BaseDrapeMode): this {
    if (mode) this.baseDrapeMode = mode;

    // Deactivate all external drapes
    for (const drape of this.layerRegistry.getAllDrapeLayers()) {
      drape.active = false;
    }

    this.activeDrapeId = BASE_DRAPE_ID;

    // Clear external drape textures
    this.clearAllDrapeTextures();
    this.drapeCompositor.setActiveDrapes([]);
    this.applyMaterialState();
    this.emit('layerchange', {});
    return this;
  }

  /**
   * Set the BaseDrape sub-mode (wireframe, elevation, slope, aspect, contours).
   * If an external drape is active, switches back to BaseDrape first.
   */
  setBaseDrapeMode(mode: BaseDrapeMode): this {
    this.baseDrapeMode = mode;

    // If an external drape was active, switch to BaseDrape
    if (this.activeDrapeId !== BASE_DRAPE_ID) {
      for (const drape of this.layerRegistry.getAllDrapeLayers()) {
        drape.active = false;
      }
      this.activeDrapeId = BASE_DRAPE_ID;
      this.clearAllDrapeTextures();
      this.drapeCompositor.setActiveDrapes([]);
    }

    this.applyMaterialState();
    this.emit('layerchange', {});
    return this;
  }

  /**
   * Get the current BaseDrape mode.
   */
  getBaseDrapeMode(): BaseDrapeMode {
    return this.baseDrapeMode;
  }

  /**
   * Get the currently active drape ID (null = none, '__base_drape__' = BaseDrape).
   */
  getActiveDrapeId(): string | null {
    return this.activeDrapeId;
  }

  /**
   * Check if the BaseDrape is the active drape.
   */
  isBaseDrapeActive(): boolean {
    return this.activeDrapeId === BASE_DRAPE_ID;
  }

  /**
   * Set the opacity for an external drape layer.
   * Triggers recomposite so the change is immediately visible.
   */
  setDrapeOpacity(id: string, opacity: number): this {
    const drape = this.layerRegistry.getDrapeLayer(id);
    if (drape) {
      drape.opacity = Math.max(0, Math.min(1, opacity));
      if (this.activeDrapeId === id) {
        this.syncDrapes();
      }
    }
    return this;
  }

  /**
   * Get the opacity for a drape layer.
   */
  getDrapeOpacity(id: string): number {
    const drape = this.layerRegistry.getDrapeLayer(id);
    return drape?.opacity ?? 1.0;
  }

  // =========================================================================
  // Color Ramp + Exaggeration
  // =========================================================================

  /**
   * Set the color ramp for the current BaseDrape mode.
   * Saved per-mode so switching modes restores the previous selection.
   */
  setColorRamp(ramp: ColorRamp): this {
    this.colorRampByMode[this.baseDrapeMode] = ramp;

    // Invalidate prototype so new tiles pick up the change
    this.prototypeMaterial?.dispose();
    this.prototypeMaterial = null;

    for (const entry of this.cache.iterateEntries()) {
      const mat = entry.mesh.material;
      if (isTerrainMaterial(mat)) {
        setMaterialColorRamp(mat as ShaderMaterial, ramp);
      }
    }
    return this;
  }

  /**
   * Get the color ramp for the current BaseDrape mode.
   */
  getColorRamp(): ColorRamp {
    return this.colorRampByMode[this.baseDrapeMode];
  }

  /**
   * Set the contour interval in meters for the contour line overlay.
   */
  setContourInterval(interval: number): this {
    this.options.contourInterval = interval;

    for (const entry of this.cache.iterateEntries()) {
      const mat = entry.mesh.material;
      if (isTerrainMaterial(mat)) {
        setMaterialContourSettings(mat as ShaderMaterial, interval);
      }
    }

    return this;
  }

  /**
   * Get the current contour interval in meters.
   */
  getContourInterval(): number {
    return this.options.contourInterval;
  }

  /**
   * Set contour line thickness.
   */
  setContourThickness(thickness: number): this {
    this.contourThickness = thickness;
    for (const entry of this.cache.iterateEntries()) {
      const mat = entry.mesh.material;
      if (isTerrainMaterial(mat)) {
        setMaterialContourSettings(
          mat as ShaderMaterial,
          this.options.contourInterval,
          thickness,
        );
      }
    }
    return this;
  }

  /**
   * Get the current contour line thickness.
   */
  getContourThickness(): number {
    return this.contourThickness;
  }

  /**
   * Set contour line color (RGB, each 0–1).
   */
  setContourColor(r: number, g: number, b: number): this {
    this.contourColorRGB = [r, g, b];
    for (const entry of this.cache.iterateEntries()) {
      const mat = entry.mesh.material;
      if (isTerrainMaterial(mat)) {
        setMaterialContourColor(mat as ShaderMaterial, r, g, b);
      }
    }
    return this;
  }

  /**
   * Get the current contour line color as [r, g, b].
   */
  getContourColor(): [number, number, number] {
    return [...this.contourColorRGB] as [number, number, number];
  }

  /**
   * Set wireframe base-white mode (flat white vs normals coloring).
   */
  setWireframeWhite(white: boolean): this {
    this.wireframeWhite = white;
    for (const entry of this.cache.iterateEntries()) {
      const mat = entry.mesh.material;
      if (isTerrainMaterial(mat)) {
        setMaterialBaseWhite(mat as ShaderMaterial, white);
      }
    }
    return this;
  }

  /**
   * Get whether wireframe renders flat white.
   */
  getWireframeWhite(): boolean {
    return this.wireframeWhite;
  }

  /**
   * Set the global exaggeration factor.
   * Updates mesh.scale.z on all cached tiles for real vertex displacement.
   */
  setExaggeration(value: number): this {
    this.options.exaggeration = value;

    const baseLayer = this.layerRegistry.getActiveBaseLayer();
    const combinedExag = value * (baseLayer?.exaggeration ?? 1.0);

    for (const entry of this.cache.iterateEntries()) {
      entry.mesh.scale.z = combinedExag;
    }

    return this;
  }

  // =========================================================================
  // UI accessor methods (clean public API for UI components)
  // =========================================================================

  /** Get all registered base layers. */
  getBaseLayers(): BaseLayer[] {
    return this.layerRegistry.getAllBaseLayers();
  }

  /** Get all registered drape layers. */
  getDrapeLayers(): DrapeLayer[] {
    return this.layerRegistry.getAllDrapeLayers();
  }

  /** Get the current elevation exaggeration factor. */
  getExaggeration(): number {
    return this.options.exaggeration;
  }

  /** Get the camera controller for navigation controls. */
  getCameraController(): CameraController {
    return this.sceneManager.cameraController;
  }

  /**
   * Set the minimum pitch (most tilted allowed) in elevation degrees.
   * 0 = horizontal, 90 = top-down.
   */
  setMinPitch(degrees: number): this {
    this.options.minPitch = degrees;
    this.sceneManager.cameraController.setMinPitch(degrees);
    return this;
  }

  /** Get the minimum pitch in elevation degrees. */
  getMinPitch(): number {
    return this.options.minPitch;
  }

  /**
   * Set the maximum pitch (least tilted / top-down) in elevation degrees.
   * 0 = horizontal, 90 = top-down.
   */
  setMaxPitch(degrees: number): this {
    this.options.maxPitch = degrees;
    this.sceneManager.cameraController.setMaxPitch(degrees);
    return this;
  }

  /** Get the maximum pitch in elevation degrees. */
  getMaxPitch(): number {
    return this.options.maxPitch;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  start(): this {
    if (this.isRunning) return this;
    this.isRunning = true;
    this.sceneManager.startRenderLoop();
    this.sceneManager.cameraController.enable();

    // Initial tile load
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
    this.loadingTiles.clear();
    this.cache.clear();
    this.workerPool.dispose();

    // Dispose prototype material to avoid GPU shader program leak
    this.prototypeMaterial?.dispose();
    this.prototypeMaterial = null;

    this.sceneManager.dispose();
    this.resizeObserver?.disconnect();
    this.removeAllListeners();

    // Dispose drape layers
    for (const drape of this.layerRegistry.getAllDrapeLayers()) {
      drape.dispose();
    }

    // Remove UI elements
    if (this.compass) {
      this.compass.remove();
      this.compass = null;
    }
    if (this.attribution) {
      this.attribution.remove();
      this.attribution = null;
    }
  }

  // =========================================================================
  // Internal: Material State Management
  // =========================================================================

  /**
   * Resolve material configuration from the current drape state.
   *
   * State table:
   *   BaseDrape 'wireframe'  → shaderMode='base', wireframe=true, contour=off
   *   BaseDrape 'elevation'  → shaderMode='elevation', wireframe=false, contour=off
   *   BaseDrape 'slope'      → shaderMode='slope', wireframe=false, contour=off
   *   BaseDrape 'aspect'     → shaderMode='aspect', wireframe=false, contour=off
   *   BaseDrape 'contours'   → shaderMode='elevation', wireframe=false, contour=on
   *   External drape          → shaderMode='texture', wireframe=false, contour=off
   */
  private resolveMaterialConfig(): { shaderMode: ShaderMode; wireframe: boolean; contourEnabled: boolean } {
    if (this.activeDrapeId === BASE_DRAPE_ID || this.activeDrapeId === null) {
      const mode = this.baseDrapeMode;
      if (mode === 'wireframe') {
        return { shaderMode: 'base', wireframe: true, contourEnabled: false };
      } else if (mode === 'contours') {
        return { shaderMode: 'elevation', wireframe: false, contourEnabled: true };
      } else {
        return { shaderMode: mode, wireframe: false, contourEnabled: false };
      }
    } else {
      return { shaderMode: 'texture', wireframe: false, contourEnabled: false };
    }
  }

  /**
   * Apply the correct material state to all cached tiles based on
   * the active drape mode.
   */
  private applyMaterialState(): void {
    // Dispose old prototype material to avoid GPU shader program leak
    this.prototypeMaterial?.dispose();
    this.prototypeMaterial = null;

    const { shaderMode, wireframe, contourEnabled } = this.resolveMaterialConfig();

    for (const entry of this.cache.iterateEntries()) {
      const mat = entry.mesh.material;
      if (isTerrainMaterial(mat)) {
        const sm = mat as ShaderMaterial;
        setMaterialMode(sm, shaderMode);
        setMaterialWireframe(sm, wireframe);
        setMaterialContourEnabled(sm, contourEnabled);
        setMaterialColorRamp(sm, this.colorRampByMode[this.baseDrapeMode]);
        setMaterialBaseWhite(sm, this.wireframeWhite);
        setMaterialContourColor(sm, ...this.contourColorRGB);
        setMaterialContourSettings(sm, this.options.contourInterval, this.contourThickness);
      }
    }
  }

  /**
   * Clear drape textures from all cached tile materials.
   */
  private clearAllDrapeTextures(): void {
    for (const entry of this.cache.iterateEntries()) {
      const mat = entry.mesh.material;
      if (isTerrainMaterial(mat)) {
        setMaterialDrape(mat as ShaderMaterial, null);
      }
    }
  }

  // =========================================================================
  // Internal: Tile Scheduling
  // =========================================================================

  private scheduleTiles(): void {
    if (!this.isRunning) return;

    const extent = this.sceneManager.getVisibleExtent();
    if (!extent) return;

    const zoom = this.sceneManager.cameraController.deriveZoom();
    this.currentZoom = zoom;

    // Compute nadir-based LOD context:
    // - cameraNadir: ground point directly below the camera
    // - topDownRadius: half-diagonal of the area a top-down view would cover
    const camera = this.sceneManager.cameraController.camera;
    const h = camera.position.z;
    const fovRad = (camera.fov * Math.PI) / 360; // half-fov
    const halfHeight = h * Math.tan(fovRad);
    const halfWidth = halfHeight * camera.aspect;
    const lodContext: LODContext = {
      cameraNadir: { x: camera.position.x, y: camera.position.y },
      topDownRadius: Math.sqrt(halfWidth * halfWidth + halfHeight * halfHeight),
    };

    const result = this.scheduler.update(extent, zoom, this.cache, lodContext);

    // Unload tiles no longer needed
    for (const coord of result.unload) {
      const key = tileKey(coord);
      this.loadingTiles.delete(key);
      const entry = this.cache.delete(coord);
      if (entry) {
        this.sceneManager.removeTileMesh(entry.mesh);
        this.drapeCompositor.evictCompositesForTile(coord);
        this.emit('tileunload', { coord });
      }
    }

    // Cancel in-flight loads that are no longer needed.
    // Build a set of all keys that are still relevant (keep + load).
    const neededKeys = new Set<string>();
    for (const coord of result.keep) {
      neededKeys.add(tileKey(coord));
    }
    for (const coord of result.load) {
      neededKeys.add(tileKey(coord));
    }
    for (const key of this.loadingTiles) {
      if (!neededKeys.has(key)) {
        this.loadingTiles.delete(key);
      }
    }

    // Load new tiles
    for (const coord of result.load) {
      this.loadTile(coord);
    }

    // Emit move event - reuse the already-computed extent instead of re-raycasting
    const center = this.getCenterFromExtent(extent);
    this.emit('move', { center });
    this.emit('moveend', { center, zoom });
  }

  /**
   * Create a TerrainMaterial configured with the current state.
   *
   * Uses material cloning: the first call creates a prototype material
   * (which triggers shader compilation), subsequent calls clone it
   * (sharing the compiled GPU program, deep-copying only uniforms).
   */
  private createTileMaterial(): ShaderMaterial {
    if (this.prototypeMaterial) {
      return this.prototypeMaterial.clone();
    }

    const { shaderMode, wireframe, contourEnabled } = this.resolveMaterialConfig();

    const mat = createTerrainMaterial({
      mode: shaderMode,
      colorRamp: this.colorRampByMode[this.baseDrapeMode],
      minElevation: this.options.elevationRange[0],
      maxElevation: this.options.elevationRange[1],
      metersToScene: this.metersToScene,
      contourEnabled,
      contourInterval: this.options.contourInterval,
      contourThickness: this.contourThickness,
      baseWhite: this.wireframeWhite,
      wireframe,
    });

    // Apply contour color (avoids importing Vector3 just for construction)
    setMaterialContourColor(mat, ...this.contourColorRGB);

    this.prototypeMaterial = mat;
    return mat.clone();
  }

  /**
   * Load a single tile.
   */
  private loadTile(coord: TileCoord): void {
    const key = tileKey(coord);
    if (this.cache.has(coord) || this.loadingTiles.has(key)) return;

    const center = this.tileGrid.tileToWorldCenter(coord);
    const tileWorldSize = this.tileGrid.getTileSize(coord.z);
    const baseLayer = this.layerRegistry.getActiveBaseLayer();

    if (!baseLayer) {
      const mesh = createTileMesh(coord, center, tileWorldSize, key);
      this.sceneManager.addTileMesh(mesh);
      this.cache.set(coord, { coord, mesh });
      this.emit('tileload', { coord });
      return;
    }

    this.loadingTiles.add(key);

    const url = baseLayer.getTileUrl(coord);
    const proxy = this.workerPool.getProxy();

    // Build mesh at exaggeration=1.0; actual exaggeration applied via mesh.scale.z
    proxy
      .fetchDecodeAndBuild(
        url,
        baseLayer.decoderType,
        this.options.tileSegments,
        tileWorldSize,
        1.0,
        this.metersToScene,
      )
      .then((result) => {
        // If this tile was cancelled by a subsequent scheduleTiles() call
        // (viewport changed while loading), skip adding it to the scene.
        if (!this.loadingTiles.has(key)) return;
        this.loadingTiles.delete(key);

        if (!this.isRunning) return;

        const material = this.createTileMaterial();

        const mesh = createElevationMesh(
          result.positions,
          result.normals,
          result.uvs,
          result.indices,
          center,
          coord,
          key,
          material,
        );

        // Apply exaggeration via mesh scale
        const combinedExag = this.options.exaggeration * baseLayer.exaggeration;
        mesh.scale.z = combinedExag;

        this.sceneManager.addTileMesh(mesh);
        this.cache.set(coord, {
          coord,
          mesh,
          elevations: result.elevations,
        });

        // Resolve seams with neighboring tiles
        this.seamResolver.resolve(coord, this.cache);

        // Apply external drape texture if an external drape is active
        if (this.activeDrapeId !== null && this.activeDrapeId !== BASE_DRAPE_ID) {
          this.drapeCompositor.applyDrape(coord, mesh, this.currentZoom);
        }

        this.emit('tileload', { coord });
      })
      .catch((err) => {
        // If this tile was cancelled, silently drop the error
        if (!this.loadingTiles.has(key)) return;
        this.loadingTiles.delete(key);
        console.warn(`treelet: failed to load tile ${key}:`, err);

        if (this.isRunning && !this.cache.has(coord)) {
          const mesh = createTileMesh(coord, center, tileWorldSize, key);
          this.sceneManager.addTileMesh(mesh);
          this.cache.set(coord, { coord, mesh });
          this.emit('tileload', { coord });
        }
      });
  }

  private reloadAllTiles(): void {
    this.loadingTiles.clear();
    this.cache.clear();

    // Dispose old prototype material to avoid GPU shader program leak
    this.prototypeMaterial?.dispose();
    this.prototypeMaterial = null;

    this.drapeCompositor.clearCompositeCache();
    this.sceneManager.clearTiles();
    this.scheduleTiles();
  }

  /**
   * Sync the drape compositor with the currently active external drape,
   * then reapply drape textures to all cached tile meshes.
   */
  private syncDrapes(): void {
    const activeDrapes = this.layerRegistry.getActiveDrapeLayers();
    this.drapeCompositor.setActiveDrapes(activeDrapes);

    // Clear old composite textures when switching drape layers
    this.drapeCompositor.clearCompositeCache();

    if (!this.isRunning) return;

    const meshPairs: Array<{ coord: TileCoord; mesh: import('three').Mesh }> = [];
    for (const e of this.cache.iterateEntries()) {
      meshPairs.push({ coord: e.coord, mesh: e.mesh });
    }
    this.drapeCompositor.reapplyAll(meshPairs, this.currentZoom);
  }
}
