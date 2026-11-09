// ============================================================================
// treelet.js - Main Orchestrator
// The central class that wires together scene, tiles, layers, workers, UI,
// and rendering. Delegates display mutations to DisplayController and layer
// lifecycle to LayerController.
//
// Layer architecture:
//   Base layer     = geometry source (elevation data)
//   Coat stack     = what colors the ground, bottom first: the active drape
//                    (imagery, one at a time) and any number of analysis
//                    layers (elevation, slope, contours, hillshade…), each
//                    with opacity and a blend mode.
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
  LineOfSightResult,
  LngLat,
  BlendMode,
  TerrainPick,
  TerrainSample,
  ProfileSample,
  TreeletStats,
  UICorner,
  TileBounds,
} from './types';
import { SceneManager } from '../scene/SceneManager';
import { CameraTerrain, marchToTerrain, type GroundSampler } from '../scene/CameraTerrain';
import type { CameraController } from '../scene/CameraController';
import type { BaseLayer } from '../layers/BaseLayer';
import type { DrapeLayer } from '../layers/DrapeLayer';
import type { AnalysisLayer } from '../layers/AnalysisLayer';
import type { StackLayer } from '../layers/LayerRegistry';
import type {
  BaseLayerOptions,
  DrapeLayerOptions,
  AnalysisLayerOptions,
  OverlayLayerOptions,
  RasterLayerOptions,
  LayerHandle,
} from '../layers/types';
import type { LegendSpec, Ramp, SurfaceSample } from '../analysis/types';
import { registerBuiltinAnalyses, slopeDegrees, aspectDegrees, curvatureOf } from '../analysis/builtins';
import { startTween, type TweenHandle } from './tween';
import {
  AnalysisController,
  REGION_ANALYSES,
  type AnalysisJob,
  type RegionOptions,
  type ElevationGrid,
  type ViewshedOptions,
  type ViewshedResult,
  type SunHoursOptions,
  type SunHoursResult,
  type SkyViewOptions,
  type TpiOptions,
  type GridResult,
  type RegionAnalysisKind,
} from './AnalysisController';
import { sunPosition, type SunPosition } from '../analysis/solar';
import { OverlayRenderer } from '../overlays/OverlayRenderer';
import type { GeoJSON, OverlayStyleSpec } from '../overlays/types';
import type { OverlayLayer } from '../layers/OverlayLayer';
import type { TreeletLabels } from '../ui/TreeletLabels';
import type { TreeletProfile, ProfileData } from '../ui/TreeletProfile';
import type { TreeletToolbar } from '../ui/TreeletToolbar';
import { ToolController, type ToolMode, type ToolResult } from '../tools/ToolController';
import { formatDistance, formatElevation } from '../tools/format';
import { measurePath, measureSurfaceArea, geodesicAreaOf, type PathMeasure, type AreaMeasure } from '../tools/measure';
import { lineOfSightProfile, type LineOfSightOptions } from '../analysis/lineOfSight';
import { geodesicDistance } from '../analysis/geodesy';
import { boundsAround } from '../analysis/region';
import { gridRange, resampleRowsToMercator } from '../analysis/grid';
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
import type { TreeletLegend } from '../ui/TreeletLegend';
import type { TreeletReadout } from '../ui/TreeletReadout';

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
      legendPosition: gui.legendPosition ?? DEFAULT_OPTIONS.guiDisplay.legendPosition,
      readoutPosition: gui.readoutPosition ?? DEFAULT_OPTIONS.guiDisplay.readoutPosition,
      tools: gui.tools ?? DEFAULT_OPTIONS.guiDisplay.tools,
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
  private legend: TreeletLegend | null = null;
  private readout: TreeletReadout | null = null;
  /** Containers stacking the legend and readout that share a corner. */
  private readonly corners = new Map<UICorner, HTMLDivElement>();
  /** Running parameter animations by layer id. */
  private readonly tweens = new Map<string, TweenHandle>();
  private readonly analysisController: AnalysisController;
  /** Date the sun is placed for (follows the map center), or null for a manual sun. */
  private sunTime: Date | null = null;
  /** The pending pickLocation(), if any. */
  private picking: { finish: (pick: TerrainPick | null) => void } | null = null;
  /** Draws overlay layers (and the tools' geometry) on the terrain. */
  private readonly overlays: OverlayRenderer;
  private readonly labels: TreeletLabels | null = null;
  /** Measuring tools, the profile panel and the toolbar. */
  private readonly tools: ToolController;
  private profile: TreeletProfile | null = null;
  private toolbar: TreeletToolbar | null = null;
  private readonly scratch = new Vector3();
  private readonly scratchDir = new Vector3();

  constructor(container: string | HTMLElement, userOptions: TreeletOptions) {
    super();
    registerBuiltinAnalyses();

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
      onRangeChange: (min, max) => this.emit('rangechange', { min, max }),
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
      () => this.terrainRenderer.autoElevationRange,
    );
    this.analysisController = new AnalysisController({
      workerPool: this.workerPool,
      layerRegistry: this.layerRegistry,
      layerController: this.layerController,
      emit: (event, data) => this.emit(event, data),
      toWorld: (lngLat) => this.lngLatToWorld(lngLat),
      defaultBounds: () => this.defaultRegionBounds(),
      sunTime: () => this.sunTime,
    });
    // Overlays: draped lines and points, fills as coats, DOM labels
    defineTreeletElements();
    if (typeof document !== 'undefined') {
      this.labels = document.createElement('treelet-labels') as TreeletLabels;
      this.container.appendChild(this.labels);
    }
    this.overlays = new OverlayRenderer({
      scene: this.sceneManager.scene,
      camera: this.sceneManager.camera,
      renderer: this.sceneManager.renderer,
      labels: this.labels,
      toWorld: (lngLat) => this.lngLatToWorld(lngLat),
      groundZ: (x, y) => this.groundZ(x, y),
      texelWorld: () => this.terrainRenderer.finestTexelWorld(),
      terrainKey: () => `${this.terrainRenderer.elevationVersion}|${this.exag}`,
      zoom: () => this.sceneManager.cameraController.deriveZoom(),
      requestRender: () => this.sceneManager.requestRender(),
      isOccluded: (x, y, z) => this.isOccluded(x, y, z),
      fills: {
        add: (name, raster, opacity) => {
          try {
            return this.layerController.addRasterLayer({ analysis: 'image', layerName: name, layerDisplay: { opacity } }, raster).id;
          } catch (err) {
            console.warn(`treelet: overlay "${name}" fills not shown:`, (err as Error).message);
            return null;
          }
        },
        remove: (id) => { this.layerController.removeAnalysisLayer(id); },
        setVisible: (id, visible) => { if (this.displayController.setLayerVisible(id, visible)) this.emit('layerchange', {}); },
        setOpacity: (id, opacity) => { if (this.displayController.setLayerOpacity(id, opacity)) this.emit('layerchange', {}); },
      },
    });
    this.tools = new ToolController({
      canvas: this.sceneManager.renderer.domElement,
      container: this.container,
      pick: (x, y) => this.pick(x, y),
      project: (lngLat) => this.project(lngLat),
      setOverlay: (id, data, style) => this.setInternalOverlay(id, data, style),
      setControlsEnabled: (enabled) => { this.sceneManager.cameraController.controls.enabled = enabled; },
      measureDistance: (points) => this.measureDistance(points),
      measureArea: (ring, cells) => this.measureArea(ring, { cells }),
      lineOfSight: (from, to) => this.lineOfSight(from, to),
      report: (result, final) => {
        this.emit('measure', { mode: this.tools.mode, final, result });
        if (final && result?.mode === 'profile') this.showProfile(result.points);
        if (final && result?.mode === 'sight' && result.sight) this.showProfile(result.sight);
      },
      changed: () => this.emit('toolchange', { mode: this.tools.mode, drawing: this.tools.active }),
    });
    // A bare map shows shaded relief; imagery and analyses stack over it.
    this.layerController.addAnalysisLayer({ analysis: 'hillshade' });
    this.displayController.updateSunDirection();

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

      // Cursor readout and legends, above the attribution by default; the
      // two stack when they share a corner
      if (gd.enabled && gd.readoutPosition !== false) {
        this.readout = document.createElement('treelet-readout') as TreeletReadout;
        this.cornerSlot(gd.readoutPosition).appendChild(this.readout);
        this.readout.attach(this, { glass: gd.glass });
      }
      if (gd.enabled && gd.legendPosition !== false) {
        this.legend = document.createElement('treelet-legend') as TreeletLegend;
        this.cornerSlot(gd.legendPosition).appendChild(this.legend);
        this.legend.attach(this, { glass: gd.glass });
      }
      if (gd.enabled && gd.tools !== false) {
        this.toolbar = document.createElement('treelet-toolbar') as TreeletToolbar;
        const slot = this.cornerSlot(gd.tools === true ? 'top-left' : gd.tools);
        slot.prepend(this.toolbar);
        this.toolbar.attach(this, { glass: gd.glass });
      }
    }
  }

  /** The container that stacks the floating elements of a corner (created on demand). */
  private cornerSlot(corner: UICorner): HTMLDivElement {
    let slot = this.corners.get(corner);
    if (slot) return slot;
    slot = document.createElement('div');
    slot.className = 'treelet-corner';
    slot.dataset.corner = corner;
    const st = slot.style;
    st.position = 'absolute';
    st.zIndex = '998';
    st.display = 'flex';
    st.flexDirection = 'column';
    st.gap = '8px';
    st.pointerEvents = 'none';
    st.maxWidth = 'calc(100% - 24px)';
    const [v, h] = corner.split('-') as ['top' | 'bottom', 'left' | 'right'];
    st.alignItems = h === 'left' ? 'flex-start' : 'flex-end';
    if (h === 'left') st.left = '12px'; else st.right = '12px';
    // Bottom corners sit above the attribution bar
    if (v === 'top') st.top = '12px'; else st.bottom = '24px';
    this.container.appendChild(slot);
    this.corners.set(corner, slot);
    return slot;
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

    // ==== Shadows: the near part of the visible range ====
    const shadowsChanged = this.terrainRenderer.renderShadows(cam, Math.min(horizon / 3, dist * 4));

    // ==== Overlays (draped again as finer terrain loads) ====
    const overlaysChanged = this.overlays.update(cameraMoved || adjusted);

    // ==== Events ====
    if (cameraMoved || adjusted) this.emit('move', { center: this.getCenter() });
    if (!(Math.abs(zoom - this.lastZoom) < 1e-3)) {
      this.lastZoom = zoom;
      this.emit('zoom', { zoom });
    }

    return needsRender || shadowsChanged || overlaysChanged || adjusted || horizon !== range || this.terrainHeight !== terrainHeight;
  }

  /** Whether terrain lies between the camera and a world point (scene units). */
  private isOccluded(x: number, y: number, z: number): boolean {
    const cam = this.sceneManager.camera;
    const origin = this.scratch.setFromMatrixPosition(cam.matrixWorld);
    const dir = this.scratchDir.set(x - origin.x, y - origin.y, z - origin.z);
    const dist = dir.length();
    if (!(dist > 0)) return false;
    dir.divideScalar(dist);
    // The march may step past its end: only a hit in front of the point counts
    const t = marchToTerrain(this.groundZ, origin, dir, cam.near, dist * 0.985, 1.03, dist / 300, 240);
    return t !== null && t < dist * 0.985;
  }

  /** Debounced end of a camera interaction. */
  private onCameraSettled(): void {
    if (!this.isRunning || this.destroyed) return;
    // A sun placed by date follows the location
    if (this.sunTime) this.applySunTime();
    this.sceneManager.requestRender();
    this.emit('moveend', { center: this.getCenter(), zoom: this.getZoom() });
  }

  /** The area in view around the screen center (at most twice the camera distance away). */
  private defaultRegionBounds(): TileBounds | null {
    const b = this.getBounds();
    if (!b) return null;
    const cc = this.sceneManager.cameraController;
    const t = cc.controls.target;
    const worldDist = cc.camera.position.distanceTo(t);
    const k = WebMercator.scaleFactorAtWorldY(t.y, this.options.mapDisplay.worldScale);
    const meters = worldDist / (this.metersToScene * k);
    const c = this.getCenter();
    const box = boundsAround(c.lng, c.lat, Math.max(2 * meters, 500));
    const out = {
      west: Math.max(b.sw.lng, box.west),
      east: Math.min(b.ne.lng, box.east),
      south: Math.max(b.sw.lat, box.south),
      north: Math.min(b.ne.lat, box.north),
    };
    return out.east > out.west && out.north > out.south ? out : null;
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

  /** The element the map renders into. */
  getContainer(): HTMLElement { return this.container; }

  /** Number of terrain tiles drawn in the last frame. */
  getTileCount(): number { return this.terrainRenderer.getInstanceCount(); }

  /** Runtime statistics (tiles, atlas use, pending and failed requests, frame time). */
  getStats(): TreeletStats {
    return { ...this.terrainRenderer.getStats(), frameTime: this.sceneManager.frameTime };
  }

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
   * The terrain surface at a geographic position (elevation, slope, aspect,
   * curvature, normal) from the finest loaded tile, or null when no data
   * covering it is loaded. Slope and aspect are true scale.
   */
  sampleTerrain(lngLat: LngLat): TerrainSample | null {
    if (this.destroyed) return null;
    const w = this.lngLatToWorld(lngLat);
    const s = this.terrainRenderer.sampleSurfaceAtWorld(w.x, w.y);
    return s ? Treelet.toTerrainSample(s) : null;
  }

  private static toTerrainSample(s: SurfaceSample): TerrainSample {
    const aspect = aspectDegrees(s);
    const g = s.g ?? [0, 0];
    const c = s.c ?? [0, 0, 0];
    return {
      elevation: s.h,
      slope: slopeDegrees(s),
      aspect: Number.isNaN(aspect) ? null : aspect,
      curvature: curvatureOf('total', g[0], g[1], c[0], c[1], c[2]),
      normal: [s.n[0], s.n[1], s.n[2]],
    };
  }

  /**
   * Pick the terrain under a point in container-relative CSS pixels.
   * Ray-marches the loaded elevation data (exaggeration-aware) and samples
   * the surface where the ray hits it.
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
    const surface = this.terrainRenderer.sampleSurfaceAtWorld(px, py);
    if (surface === null) return null;
    return { lngLat: this.worldToLngLat(px, py), ...Treelet.toTerrainSample(surface) };
  }

  /** Screen position (container-relative CSS pixels) of the terrain at a position, or null when it is off screen or behind the camera. */
  project(lngLat: LngLat): { x: number; y: number } | null {
    if (this.destroyed) return null;
    const w = this.lngLatToWorld(lngLat);
    const z = this.groundZ(w.x, w.y) ?? 0;
    const cam = this.sceneManager.camera;
    cam.updateMatrixWorld();
    const v = this.scratch.set(w.x, w.y, z).project(cam);
    if (v.z > 1 || v.z < -1) return null;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height };
  }

  /** Ground meters between samples at the finest loaded terrain resolution, at a latitude. */
  private sampleSpacing(lat: number): number {
    const texel = this.terrainRenderer.finestTexelWorld();
    const metersPerUnit = 1 / this.metersToScene; // at the equator
    return Math.max(1, texel * metersPerUnit * Math.cos((lat * Math.PI) / 180));
  }

  /**
   * Measure a path: geodesic length, length along the terrain, ascent and
   * descent, lowest and highest point, and its elevation profile, sampled at
   * the loaded terrain's resolution.
   */
  measureDistance(points: readonly LngLat[]): PathMeasure {
    const lat = points.length ? points.reduce((a, p) => a + p.lat, 0) / points.length : 0;
    return measurePath(points, (p) => this.getElevation(p), this.sampleSpacing(lat));
  }

  /** Measure a polygon (a ring of positions): geodesic area and perimeter, and the area of the terrain surface inside. */
  measureArea(ring: readonly LngLat[], options: { cells?: number } = {}): AreaMeasure {
    const { area, perimeter } = geodesicAreaOf(ring);
    const worldRing = ring.map((p) => { const w = this.lngLatToWorld(p); return [w.x, w.y] as [number, number]; });
    const W = this.options.mapDisplay.worldScale;
    const surface = measureSurfaceArea([worldRing], {
      cells: options.cells,
      metersPerUnit: (y) => 1 / (this.metersToScene * WebMercator.scaleFactorAtWorldY(y, W)),
      surfaceAt: (x, y) => {
        const s = this.terrainRenderer.sampleSurfaceAtWorld(x, y);
        return s ? { h: s.h, nz: s.n[2] } : null;
      },
    });
    // The grid's area converges on the geodesic one; scale the surface to match it
    const scale = surface.planarArea > 0 ? area / surface.planarArea : 1;
    return {
      area,
      perimeter,
      surfaceArea: surface.surfaceArea * scale,
      minElevation: surface.minElevation,
      maxElevation: surface.maxElevation,
    };
  }

  /**
   * Whether `to` can be seen from `from` over the loaded terrain (Earth
   * curvature and refraction included), with the first obstruction and the
   * profile. Null when the ends have no elevation data.
   */
  lineOfSight(from: LngLat, to: LngLat, options: LineOfSightOptions = {}): LineOfSightResult | null {
    const distance = geodesicDistance(from, to);
    const n = Math.max(64, Math.min(8000, Math.ceil(distance / this.sampleSpacing((from.lat + to.lat) / 2)) + 1));
    const profile = this.getElevationProfile(from, to, n);
    if (profile[0].elevation === null || profile[profile.length - 1].elevation === null) return null;
    // Rescale the sampled distances to the ellipsoid's
    const along = profile[profile.length - 1].distance;
    if (along > 0) for (const s of profile) s.distance *= distance / along;
    const r = lineOfSightProfile(profile, options);
    const o = r.obstructionIndex >= 0 ? profile[r.obstructionIndex] : null;
    return {
      visible: r.visible,
      distance,
      clearance: r.clearance,
      eyeElevation: r.eyeElevation,
      targetElevation: r.targetElevation,
      obstruction: o ? { lngLat: o.lngLat, distance: o.distance, elevation: o.elevation! } : null,
      profile: profile.map((s, i) => ({ ...s, sight: r.sight[i] })),
    };
  }

  // =========================================================================
  // Tools and profile
  // =========================================================================

  /**
   * Start a measuring tool on the map: 'distance', 'area', 'profile' (a path
   * whose profile opens when finished) or 'sight' (observer, then target).
   * Results arrive as 'measure' events.
   */
  startTool(mode: ToolMode): this {
    if (!['distance', 'area', 'profile', 'sight'].includes(mode)) throw new Error(`treelet: unknown tool "${mode as string}"`);
    this.cancelPick();
    this.tools.start(mode);
    return this;
  }
  /** Finish drawing (the result stays shown until clearTool()). */
  finishTool(): this { this.tools.finish(); return this; }
  /** Stop the tool and remove its geometry. */
  clearTool(): this { this.tools.clear(); return this; }
  /** The tool's state: mode, whether it is still drawing, its points and result. */
  getTool(): { mode: ToolMode | null; drawing: boolean; points: LngLat[]; result: ToolResult | null } {
    return { mode: this.tools.mode, drawing: this.tools.active, points: [...this.tools.points], result: this.tools.result };
  }

  /**
   * Show an elevation profile at the bottom of the map: of a path (two or
   * more positions) or of a line-of-sight result (with the sight line).
   * Hovering the chart marks the point on the terrain.
   */
  showProfile(input: readonly LngLat[] | LineOfSightResult, options: { title?: string } = {}): this {
    let data: ProfileData;
    if (Array.isArray(input)) {
      if (input.length < 2) throw new Error('treelet: a profile needs at least two positions');
      const m = this.measureDistance(input);
      const range = m.minElevation !== null ? `${formatElevation(m.minElevation)} – ${formatElevation(m.maxElevation)}` : '–';
      data = {
        title: options.title ?? 'Elevation profile',
        points: m.profile,
        stats: [
          ['Length', formatDistance(m.distance)],
          ['Terrain', formatDistance(m.surfaceDistance)],
          ['Ascent', formatElevation(m.gain)],
          ['Descent', formatElevation(m.loss)],
          ['Range', range],
        ],
      };
    } else {
      const r = input as LineOfSightResult;
      data = {
        title: options.title ?? 'Line of sight',
        points: r.profile,
        obstructionIndex: r.obstruction ? r.profile.findIndex((p) => p.distance >= r.obstruction!.distance) : -1,
        stats: [
          ['Distance', formatDistance(r.distance)],
          ['Result', r.visible ? 'Visible' : `Blocked at ${formatDistance(r.obstruction!.distance)}`],
          ['Clearance', formatElevation(r.clearance)],
          ['Eye', formatElevation(r.eyeElevation)],
          ['Target', formatElevation(r.targetElevation)],
        ],
      };
    }
    if (!this.profile) {
      defineTreeletElements();
      this.profile = document.createElement('treelet-profile') as TreeletProfile;
      this.container.appendChild(this.profile);
      this.profile.attach({
        glass: this.options.guiDisplay.glass,
        onHover: (p) => this.setInternalOverlay('__profile_marker__',
          p ? { type: 'Point', coordinates: [p.lngLat.lng, p.lngLat.lat] } : null,
          { color: '#1c7ed6', pointRadius: 6, pointStrokeWidth: 2 }),
        onClose: () => this.setInternalOverlay('__profile_marker__', null, {}),
      });
    }
    this.profile.show(data);
    return this;
  }

  /** Close the profile panel. */
  hideProfile(): this {
    this.profile?.hide();
    this.setInternalOverlay('__profile_marker__', null, {});
    return this;
  }

  /** Geometry drawn by the tools (not listed as overlay layers). */
  private setInternalOverlay(id: string, data: GeoJSON | null, style: OverlayStyleSpec): void {
    if (!data) {
      this.overlays.remove(id);
      return;
    }
    this.overlays.set(id, { name: id, data, style, fills: false, order: 100 });
  }

  /** The elevation range (min, max in meters) of the tiles drawn in the last frame. */
  getVisibleElevationRange(): [number, number] {
    return this.terrainRenderer.autoElevationRange;
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
  /** Make a drape layer the imagery coat (one drape is active at a time). */
  activateDrapeLayer(handle: LayerHandle | string): this { this.layerController.activateDrapeLayer(handle); return this; }
  /** Remove the imagery coat; the drape layer stays registered. */
  deactivateDrapeLayer(): this { this.layerController.deactivateDrapeLayer(); return this; }
  getActiveDrapeId(): string | null { return this.layerRegistry.getActiveDrapeId(); }

  // =========================================================================
  // Analysis API (→ LayerController / DisplayController)
  // =========================================================================

  /** Add an analysis coat on top of the stack. */
  addAnalysisLayer<P extends object = Record<string, unknown>>(options: AnalysisLayerOptions<P>): LayerHandle {
    return this.layerController.addAnalysisLayer(options);
  }
  removeAnalysisLayer(handle: LayerHandle | string): this { this.layerController.removeAnalysisLayer(handle); return this; }
  /** Merge parameters into an analysis layer (see the analysis' param schema). */
  setAnalysisParams(handle: LayerHandle | string, params: object): this {
    if (this.displayController.setAnalysisParams(handle, params)) this.emit('layerchange', {});
    return this;
  }
  getAnalysisParams(handle: LayerHandle | string): Record<string, unknown> | null { return this.displayController.getAnalysisParams(handle); }
  /**
   * Animate numeric parameters of an analysis layer: each key gets a target
   * value, or a `[from, to]` pair. Resolves true when done, false when a
   * later animation of the same layer replaced it (or the map was destroyed).
   */
  animateAnalysisParams(
    handle: LayerHandle | string,
    targets: Record<string, number | [number, number]>,
    duration = 1000,
  ): Promise<boolean> {
    const id = typeof handle === 'string' ? handle : handle.id;
    const current = this.displayController.getAnalysisParams(id);
    if (!current) return Promise.resolve(false);
    this.tweens.get(id)?.cancel();
    const spans: Array<[string, number, number]> = [];
    for (const [key, target] of Object.entries(targets)) {
      const from = Array.isArray(target) ? target[0] : current[key];
      const to = Array.isArray(target) ? target[1] : target;
      if (typeof from !== 'number' || !Number.isFinite(from) || !Number.isFinite(to)) {
        console.warn(`treelet: cannot animate ${id}.${key} from`, from, 'to', to);
        continue;
      }
      spans.push([key, from, to]);
    }
    if (spans.length === 0) return Promise.resolve(false);
    const tween = startTween({
      duration: requireFinite(duration, 'duration'),
      onUpdate: (t) => {
        if (this.destroyed) return;
        const params: Record<string, number> = {};
        for (const [key, from, to] of spans) params[key] = from + (to - from) * t;
        this.setAnalysisParams(id, params);
      },
    });
    this.tweens.set(id, tween);
    return tween.done.then((completed) => {
      if (this.tweens.get(id) === tween) this.tweens.delete(id);
      return completed;
    });
  }
  /** Color ramp of a value analysis: a built-in name or stops / classes. */
  setAnalysisRamp(handle: LayerHandle | string, ramp: Ramp): this {
    if (this.displayController.setAnalysisRamp(handle, ramp)) this.emit('layerchange', {});
    return this;
  }
  getAnalysisRamp(handle: LayerHandle | string): Ramp | undefined { return this.displayController.getAnalysisRamp(handle); }
  /** Legend of a value analysis layer (null for color kinds such as contours). */
  getLegend(handle: LayerHandle | string): LegendSpec | null { return this.displayController.getLegend(handle); }
  /** Legends of the visible value analyses, top of the stack first. */
  getLegends(): LegendSpec[] { return this.displayController.getLegends(); }

  // =========================================================================
  // Rasters and region analyses (→ LayerController / AnalysisController)
  // =========================================================================

  /**
   * Show a grid as a coat: single-band values colored by a ramp (Float32
   * data) or an RGBA image (byte data). At most 4 raster coats at once.
   */
  addRasterLayer(options: RasterLayerOptions): LayerHandle {
    const { width, height, bounds } = options;
    const color = !(options.data instanceof Float32Array);
    let data = options.data;
    if (!color && options.nodata !== undefined) {
      const nodata = options.nodata;
      data = (data as Float32Array).map((v) => (v === nodata ? NaN : v));
    }
    if (options.crs === 'EPSG:4326') {
      data = resampleRowsToMercator(data, width, height, bounds.south, bounds.north, color ? 4 : 1);
    } else if (options.crs !== undefined && options.crs !== 'EPSG:3857') {
      throw new Error(`treelet: unsupported raster crs "${options.crs}"`);
    }
    const nw = this.lngLatToWorld({ lng: bounds.west, lat: bounds.north });
    const se = this.lngLatToWorld({ lng: bounds.east, lat: bounds.south });
    let params: Record<string, unknown> = {};
    if (!color) {
      const r = options.range ?? gridRange(data) ?? [0, 1];
      params = { range: r[1] > r[0] ? [r[0], r[1]] : [r[0], r[0] + 1] };
    }
    return this.layerController.addRasterLayer({
      analysis: color ? 'image' : 'raster',
      layerName: options.layerName ?? (color ? 'Image' : 'Raster'),
      ramp: color ? undefined : options.ramp,
      unit: options.unit,
      params,
      layerDisplay: options.layerDisplay,
    }, { width, height, data, bounds: { west: nw.x, north: nw.y, east: se.x, south: se.y } });
  }

  /** Size, bounds and value range of a raster coat, or null. */
  getRasterInfo(handle: LayerHandle | string): { width: number; height: number; bounds: TileBounds; range: [number, number] | null; color: boolean } | null {
    const r = this.terrainRenderer.getRaster(typeof handle === 'string' ? handle : handle.id);
    if (!r) return null;
    const nw = this.worldToLngLat(r.bounds.west, r.bounds.north);
    const se = this.worldToLngLat(r.bounds.east, r.bounds.south);
    return {
      width: r.width,
      height: r.height,
      bounds: { west: nw.lng, north: nw.lat, east: se.lng, south: se.lat },
      range: r.range ? [r.range[0], r.range[1]] : null,
      color: r.color,
    };
  }

  /** Value of a raster coat at a position (filtered as drawn), or null outside it / without data. */
  getRasterValue(handle: LayerHandle | string, lngLat: LngLat): number | null {
    const w = this.lngLatToWorld(lngLat);
    return this.terrainRenderer.sampleRaster(typeof handle === 'string' ? handle : handle.id, w.x, w.y);
  }

  /**
   * Elevations of a region as one grid, from the active base layer's tiles
   * at the finest zoom within the tile budget (default: the area in view).
   */
  getElevationGrid(options?: RegionOptions): Promise<ElevationGrid> {
    return this.analysisController.getElevationGrid(options);
  }

  /** Ground visible from an observer (eye height, radius, field of view; Earth curvature and refraction). */
  computeViewshed(observer: LngLat, options?: ViewshedOptions): Promise<ViewshedResult> {
    return this.analysisController.computeViewshed(observer, options);
  }

  /** Hours of direct sun on a day, with terrain shadows (default: the sun time's day, or today). */
  computeSunHours(options?: SunHoursOptions): Promise<SunHoursResult> {
    return this.analysisController.computeSunHours(options);
  }

  /** Sky-view factor: the visible fraction of the sky (1 = open, lower in valleys). */
  computeSkyView(options?: SkyViewOptions): Promise<GridResult> {
    return this.analysisController.computeSkyView(options);
  }

  /** Topographic position index: height above (+) or below (−) the surrounding mean. */
  computeTpi(options?: TpiOptions): Promise<GridResult> {
    return this.analysisController.computeTpi(options);
  }

  /**
   * Run a region analysis by kind with default options (the viewshed needs
   * `observer`). Used by the layer panel.
   */
  computeAnalysis(
    kind: RegionAnalysisKind,
    options: (ViewshedOptions & { observer?: LngLat }) | SunHoursOptions | SkyViewOptions | TpiOptions = {},
  ): Promise<ViewshedResult | SunHoursResult | GridResult> {
    switch (kind) {
      case 'viewshed': {
        const { observer, ...rest } = options as ViewshedOptions & { observer?: LngLat };
        if (!observer) return Promise.reject(new Error('treelet: a viewshed needs an observer'));
        return this.computeViewshed(observer, rest);
      }
      case 'sunhours': return this.computeSunHours(options as SunHoursOptions);
      case 'skyview': return this.computeSkyView(options as SkyViewOptions);
      case 'tpi': return this.computeTpi(options as TpiOptions);
      default: return Promise.reject(new Error(`treelet: "${kind as string}" is not a region analysis`));
    }
  }

  /** Kinds computeAnalysis() runs. */
  getRegionAnalyses(): readonly RegionAnalysisKind[] { return REGION_ANALYSES; }

  /** Region analyses that are running. */
  getAnalysisJobs(): AnalysisJob[] { return this.analysisController.getJobs(); }

  /** Cancel a running region analysis (its promise rejects with an AbortError). */
  cancelAnalysis(id: string): this { this.analysisController.cancel(id); return this; }

  /**
   * Wait for a click on the terrain (a press without dragging); resolves
   * with the terrain under it, or null after Escape, cancelPick() or another
   * pickLocation(). The cursor shows a crosshair meanwhile; `prompt` is
   * shown in the legend.
   */
  pickLocation(options: { prompt?: string } = {}): Promise<TerrainPick | null> {
    this.cancelPick();
    if (this.destroyed) return Promise.resolve(null);
    const canvas = this.sceneManager.renderer.domElement;
    const container = this.container;
    const cursor = container.style.cursor;
    container.style.cursor = 'crosshair';
    let down: { x: number; y: number; id: number } | null = null;
    return new Promise<TerrainPick | null>((resolve) => {
      const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
      const onUp = (e: PointerEvent) => {
        if (!down || down.id !== e.pointerId) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        down = null;
        if (moved > 6) return;
        const rect = container.getBoundingClientRect();
        const pick = this.pick(e.clientX - rect.left, e.clientY - rect.top);
        if (pick) finish(pick);
      };
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(null); };
      const finish = (pick: TerrainPick | null) => {
        if (this.picking !== state) return;
        this.picking = null;
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointerup', onUp);
        document.removeEventListener('keydown', onKey, true);
        container.style.cursor = cursor;
        this.emit('pickend', {});
        resolve(pick);
      };
      const state = { finish };
      this.picking = state;
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);
      document.addEventListener('keydown', onKey, true);
      this.emit('pickstart', { prompt: options.prompt ?? 'Click the terrain' });
    });
  }

  /** Stop a pending pickLocation() (it resolves null). */
  cancelPick(): this {
    this.picking?.finish(null);
    return this;
  }

  /** Whether a pickLocation() is waiting for a click. */
  isPicking(): boolean { return this.picking !== null; }

  // =========================================================================
  // Coat stack API
  // =========================================================================

  /** The coats in drawing order, bottom first (the active drape and the analysis layers). */
  getLayerStack(): StackLayer[] { return this.layerController.getLayerStack(); }
  /** Move a coat to `index` in the stack (0 = bottom). */
  moveLayer(handle: LayerHandle | string, index: number): this {
    this.layerController.moveLayer(handle, requireFinite(index, 'index'));
    return this;
  }
  /** Show or hide a coat without removing it. */
  setLayerVisible(handle: LayerHandle | string, visible: boolean): this {
    if (this.displayController.setLayerVisible(handle, visible)) this.emit('layerchange', {});
    return this;
  }
  setLayerOpacity(handle: LayerHandle | string, opacity: number): this {
    if (this.displayController.setLayerOpacity(handle, opacity)) this.emit('layerchange', {});
    return this;
  }
  getLayerOpacity(handle: LayerHandle | string): number { return this.displayController.getLayerOpacity(handle); }
  setLayerBlendMode(handle: LayerHandle | string, mode: BlendMode): this {
    if (this.displayController.setLayerBlendMode(handle, mode)) this.emit('layerchange', {});
    return this;
  }
  getLayerBlendMode(handle: LayerHandle | string): BlendMode { return this.displayController.getLayerBlendMode(handle); }
  /** Alias of setLayerOpacity for drape layers. */
  setDrapeOpacity(handle: LayerHandle | string, opacity: number): this { return this.setLayerOpacity(handle, opacity); }
  getDrapeOpacity(handle: LayerHandle | string): number { return this.getLayerOpacity(handle); }

  // =========================================================================
  // Overlay Layer API (→ LayerController)
  // =========================================================================

  /**
   * Draw GeoJSON features on the terrain: lines and points draped over it,
   * polygon fills as a coat, labels from a property.
   */
  addOverlayLayer(options: OverlayLayerOptions): LayerHandle {
    const handle = this.layerController.addOverlayLayer(options);
    const layer = this.layerRegistry.getOverlayLayer(handle)!;
    this.overlays.set(layer.id, this.overlayInput(layer));
    return handle;
  }
  removeOverlayLayer(handle: LayerHandle | string): this {
    const id = typeof handle === 'string' ? handle : handle.id;
    this.overlays.remove(id);
    this.layerController.removeOverlayLayer(id);
    return this;
  }
  /** Replace an overlay's features. */
  setOverlayData(handle: LayerHandle | string, data: GeoJSON | null): this {
    const layer = this.overlayLayer(handle);
    if (!layer) return this;
    layer.data = data;
    this.overlays.set(layer.id, this.overlayInput(layer));
    this.emit('layerchange', {});
    return this;
  }
  /** Replace an overlay's style (an object, or a function of each feature). */
  setOverlayStyle(handle: LayerHandle | string, style: OverlayStyleSpec | undefined): this {
    const layer = this.overlayLayer(handle);
    if (!layer) return this;
    layer.style = style;
    this.overlays.setStyle(layer.id, style);
    this.emit('layerchange', {});
    return this;
  }
  setOverlayVisible(handle: LayerHandle | string, visible: boolean): this {
    const layer = this.overlayLayer(handle);
    if (!layer || layer.visible === visible) return this;
    layer.visible = visible;
    (layer.display as { visible: boolean }).visible = visible;
    this.overlays.setVisible(layer.id, visible);
    this.emit('layerchange', {});
    return this;
  }
  setOverlayOpacity(handle: LayerHandle | string, opacity: number): this {
    const layer = this.overlayLayer(handle);
    if (!layer || !Number.isFinite(opacity)) return this;
    (layer.display as { opacity: number }).opacity = Math.max(0, Math.min(1, opacity));
    this.overlays.setOpacity(layer.id, layer.display.opacity);
    this.emit('layerchange', {});
    return this;
  }
  getOverlayLayers(): OverlayLayer[] { return this.layerRegistry.getAllOverlayLayers(); }

  private overlayLayer(handle: LayerHandle | string): OverlayLayer | null {
    const layer = this.layerRegistry.getOverlayLayer(handle);
    if (!layer) console.warn(`treelet: overlay layer "${typeof handle === 'string' ? handle : handle.id}" not found`);
    return layer ?? null;
  }

  private overlayInput(layer: OverlayLayer) {
    return {
      name: layer.layerName,
      data: layer.data,
      style: layer.style,
      visible: layer.visible,
      opacity: layer.display.opacity,
      minZoom: layer.minZoom,
      maxZoom: layer.maxZoom,
      fills: layer.fills,
    };
  }

  // =========================================================================
  // Display API (→ DisplayController)
  // =========================================================================

  setExaggeration(handleOrValue: LayerHandle | string | number, value?: number): this { this.displayController.setExaggeration(handleOrValue, value); return this; }
  getExaggeration(): number { return this.displayController.getExaggeration(); }

  /** Sun direction in degrees clockwise from north (clears a sun time). */
  setSunAzimuth(degrees: number): this {
    this.sunTime = null;
    this.displayController.setSunAzimuth(degrees);
    this.emitSun();
    return this;
  }
  getSunAzimuth(): number { return this.displayController.getSunAzimuth(); }
  /** Sun altitude in degrees, 5–90 (clears a sun time). */
  setSunAltitude(degrees: number): this {
    this.sunTime = null;
    this.displayController.setSunAltitude(degrees);
    this.emitSun();
    return this;
  }
  getSunAltitude(): number { return this.displayController.getSunAltitude(); }

  /**
   * Place the sun where it stands at `date` over the map center (and keep
   * it there as the map moves), or `null` to go back to the manual sun.
   * The hillshade coat follows; sun hours default to this day.
   */
  setSunTime(date: Date | null): this {
    if (date !== null && !(date instanceof Date && Number.isFinite(date.getTime()))) {
      throw new Error('treelet: setSunTime expects a valid Date or null');
    }
    this.sunTime = date ? new Date(date.getTime()) : null;
    if (this.sunTime) this.applySunTime();
    else this.emitSun();
    return this;
  }
  getSunTime(): Date | null { return this.sunTime ? new Date(this.sunTime.getTime()) : null; }

  /** Where the sun stands at `date` (default: the sun time, or now) over `lngLat` (default: the map center). */
  getSunPosition(date?: Date, lngLat?: LngLat): SunPosition {
    const at = lngLat ?? this.getCenter();
    return sunPosition(date ?? this.sunTime ?? new Date(), at.lng, at.lat);
  }

  private applySunTime(): void {
    if (!this.sunTime || this.destroyed) return;
    const p = this.getSunPosition(this.sunTime);
    this.displayController.setSunPosition(p.azimuth, p.altitude);
    this.sceneManager.requestRender();
    this.emitSun();
  }

  private emitSun(): void {
    this.emit('sunchange', {
      azimuth: this.displayController.getSunAzimuth(),
      altitude: this.displayController.getSunAltitude(),
      time: this.getSunTime(),
    });
  }

  /** Draw the terrain mesh as a wireframe (colored by the coats, or white). */
  setWireframe(enabled: boolean): this { this.displayController.setWireframe(enabled); return this; }
  getWireframe(): boolean { return this.displayController.getWireframe(); }
  setWireframeWhite(white: boolean): this { this.displayController.setWireframeWhite(white); return this; }
  getWireframeWhite(): boolean { return this.displayController.getWireframeWhite(); }

  /** Level-of-detail quality: > 1 finer tiles, < 1 coarser. */
  setLodQuality(quality: number): this { this.terrainRenderer.setLodQuality(requireFinite(quality, 'quality')); return this; }

  // =========================================================================
  // UI accessor methods
  // =========================================================================

  getBaseLayers(): BaseLayer[] { return this.layerController.getBaseLayers(); }
  getDrapeLayers(): DrapeLayer[] { return this.layerController.getDrapeLayers(); }
  getAnalysisLayers(): AnalysisLayer[] { return this.layerController.getAnalysisLayers(); }
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
    this.tools.dispose();
    this.overlays.dispose();
    this.terrainRenderer.dispose();
    this.workerPool.dispose();
    this.sceneManager.dispose();
    this.removeAllListeners();

    for (const tween of this.tweens.values()) tween.cancel();
    this.tweens.clear();
    this.cancelPick();
    this.analysisController.cancelAll();
    if (this.labels) this.labels.remove();
    if (this.profile) { this.profile.remove(); this.profile = null; }
    if (this.toolbar) { this.toolbar.remove(); this.toolbar = null; }
    if (this.compass) { this.compass.remove(); this.compass = null; }
    if (this.attribution) { this.attribution.remove(); this.attribution = null; }
    if (this.legend) { this.legend.remove(); this.legend = null; }
    if (this.readout) { this.readout.remove(); this.readout = null; }
    for (const slot of this.corners.values()) slot.remove();
    this.corners.clear();
  }
}
