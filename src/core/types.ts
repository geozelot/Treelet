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
  initZoom: number;
  minZoom?: number;
  maxZoom?: number;
  guiDisplay?: GuiDisplayOptions;
  mapDisplay?: MapDisplayOptions;
  workerCount?: number;
}

export interface GuiDisplayOptions {
  enabled?: boolean;
  compassPosition?: UICorner;
  layerPosition?: UICorner;
}

export interface MapDisplayOptions {
  atlasSegments?: number;
  antialias?: boolean;
  worldScale?: number;
  minPitch?: number;
  maxPitch?: number;
  /** Atlas texture resolution in pixels (must be power-of-two, divisible by slotSize). Default 4096. */
  atlasSize?: number;
  /** Individual tile slot resolution in pixels (must be power-of-two). Default 256. */
  slotSize?: number;
  /** Maximum number of tile instances rendered per frame. Default 512. */
  maxInstances?: number;
  /** Maximum concurrent tile fetch requests. Default 12. */
  maxConcurrentFetches?: number;
}

/** Fully resolved options (all fields required). */
export interface ResolvedTreeletOptions {
  initCenter: LngLat;
  initZoom: number;
  minZoom: number;
  maxZoom: number;
  guiDisplay: Required<GuiDisplayOptions>;
  mapDisplay: Required<MapDisplayOptions>;
  workerCount: number;
}

// === Enums / Unions ===

/** Virtual BaseDrape visualization mode derived from the base layer's elevation data. */
export type BaseDrapeMode = 'wireframe' | 'elevation' | 'slope' | 'aspect' | 'contours';

/** Internal shader mode index type (not user-facing). */
export type ShaderMode = 'base' | 'elevation' | 'slope' | 'aspect' | 'texture';

/** Color ramp for elevation-based visualizations. */
export type ColorRamp = 'hypsometric' | 'viridis' | 'inferno' | 'grayscale';

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
