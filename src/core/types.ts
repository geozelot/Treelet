// ============================================================================
// treelet.js - Core Type Definitions
// ============================================================================

// === Coordinate Types ===

export interface LngLat {
  lng: number;
  lat: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export interface TileBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

// === Options ===

export interface TreeletOptions {
  initCenter: LngLat;
  /** Initial zoom (standard web-map scale: 256·2^zoom CSS px per world width). */
  initZoom: number;
  /** Minimum camera zoom. Default 0. */
  minZoom?: number;
  /** Maximum camera zoom (≤ 22). Default 20. */
  maxZoom?: number;
  guiDisplay?: GuiDisplayOptions;
  mapDisplay?: MapDisplayOptions;
  /** Web Worker pool size. Default: hardwareConcurrency − 1, clamped to [1, 4]. */
  workerCount?: number;
  /**
   * URL of the tile worker script (`dist/treelet.worker.js`). By default the
   * worker is inlined and started from a `blob:` URL; set this when your
   * Content-Security-Policy does not allow `worker-src blob:`.
   */
  workerUrl?: string | URL;
}

export interface GuiDisplayOptions {
  enabled?: boolean;
  compassPosition?: UICorner;
  layerPosition?: UICorner;
  /**
   * Frosted-glass compass and layer controls: translucent, with the map
   * blurred behind them. Costs some GPU time while the map redraws, so it is
   * off by default. Default false.
   */
  glass?: boolean;
}

export interface MapDisplayOptions {
  /** Grid segments per tile edge (even, ≤ slotSize). Default 64. */
  atlasSegments?: number;
  antialias?: boolean;
  worldScale?: number;
  minPitch?: number;
  maxPitch?: number;
  /**
   * Tiles kept in GPU memory, in [64, 2048]. Up to 60% of them can be on
   * screen at once (capped by maxInstances); more allows wider views at full
   * detail. Each tile costs ~0.5 MB (elevation, GPU + CPU copy) plus ~0.35 MB
   * of GPU memory while a drape layer is active. Default 256.
   */
  tileCacheSize?: number;
  /**
   * @deprecated Use `tileCacheSize`. Holds `(atlasSize / slotSize)²` tiles,
   * so the former default 4096 equals `tileCacheSize: 256`.
   */
  atlasSize?: number;
  /** Elevation tile slot resolution in pixels (power-of-two). Default 256. */
  slotSize?: number;
  /** Drape imagery slot resolution in pixels (power-of-two). Default 256. */
  drapeSlotSize?: number;
  /** Upper bound on tile instances rendered per frame. Default 512 (capped at 60% of tileCacheSize). */
  maxInstances?: number;
  /** Maximum concurrent tile requests per layer. Default 12. */
  maxConcurrentFetches?: number;
  /** Device-pixel-ratio cap for the render target. Default 2. */
  maxPixelRatio?: number;
  /** Level-of-detail quality multiplier: > 1 finer tiles, < 1 coarser. Default 1. */
  lodQuality?: number;
  /** Fraction of each LOD range used for geomorphing [0.05..0.5]. Default 0.3. */
  morphWidth?: number;
  /**
   * Visible range as a multiple of the orbit height (the camera's height
   * above the terrain it looks at, at the current zoom and tilt), in
   * [4, 64]. Terrain fades into the sky's horizon color there.
   * Larger values show more distant terrain and use more tiles. Default 16.
   */
  horizonDistance?: number;
  /**
   * Atmospheric haze over distant terrain. When false, terrain stays clear
   * and only blends into the horizon over the last 20% of the visible range.
   * Default true.
   */
  fog?: boolean;
  /** Render only when something changed (camera, data, settings). Default true. */
  renderOnDemand?: boolean;
}

/** Fully resolved options (all fields required). */
export interface ResolvedTreeletOptions {
  initCenter: LngLat;
  initZoom: number;
  minZoom: number;
  maxZoom: number;
  guiDisplay: Required<GuiDisplayOptions>;
  mapDisplay: Required<Omit<MapDisplayOptions, 'atlasSize'>>;
  workerCount: number;
  workerUrl: string | URL | null;
}

// === Enums / Unions ===

/** Virtual BaseDrape visualization mode derived from the base layer's elevation data. */
export type BaseDrapeMode = 'wireframe' | 'elevation' | 'slope' | 'aspect' | 'contours';

/** Internal shader mode index type (not user-facing). */
export type ShaderMode = 'base' | 'elevation' | 'slope' | 'aspect' | 'texture';

/** Color ramp for elevation-based visualizations. `cyclic` suits circular data such as aspect. */
export type ColorRamp = 'hypsometric' | 'viridis' | 'inferno' | 'grayscale' | 'cyclic';

export type BlendMode = 'normal' | 'hillshade' | 'softlight';

/** Corner position for UI components. */
export type UICorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

// === Events ===

export interface TreeletEventMap {
  zoom: { zoom: number };
  move: { center: LngLat };
  moveend: { center: LngLat; zoom: number };
  tileload: { coord: TileCoord };
  tileunload: { coord: TileCoord };
  tileerror: { coord: TileCoord; layer: 'elevation' | 'drape'; error: string };
  layeradd: { id: string };
  layerremove: { id: string };
  layerchange: Record<string, never>;
  ready: Record<string, never>;
}

// === Visible Extent ===

export interface VisibleExtent {
  corners: WorldPoint[];
  center: WorldPoint;
}

// === Inspection ===

/** Result of a terrain pick at a screen position. */
export interface TerrainPick {
  lngLat: LngLat;
  /** Elevation in meters (unexaggerated). */
  elevation: number;
}

/** One sample of an elevation profile. */
export interface ProfileSample {
  lngLat: LngLat;
  /** Ground distance from the profile start in meters. */
  distance: number;
  /** Elevation in meters, or null where no data is loaded. */
  elevation: number | null;
}

/** Runtime statistics for monitoring and debugging. */
export interface TreeletStats {
  /** Tile instances drawn in the last frame. */
  tiles: number;
  drawCalls: number;
  /** Elevation slots in use / total. */
  atlasUsed: number;
  atlasCapacity: number;
  /** Drape tiles resident in the drape atlas. */
  drapeTiles: number;
  pendingElevation: number;
  pendingDrape: number;
  /** Tiles currently in failure backoff (elevation + drape). */
  failedTiles: number;
}
