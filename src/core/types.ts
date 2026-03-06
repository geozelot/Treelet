// ============================================================================
// treelet.js - Core Type Definitions
// ============================================================================

// --- Coordinate Types ---

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

// --- Options ---

export interface TreeletOptions {
  center: LngLat;
  zoom: number;
  minZoom?: number;
  maxZoom?: number;
  tileSegments?: number;
  worldScale?: number;
  exaggeration?: number;
  elevationRange?: [number, number];
  contourInterval?: number;
  antialias?: boolean;
  gui?: boolean;
  minPitch?: number;
  maxPitch?: number;
  compassPosition?: UICorner;
  layerPosition?: UICorner;
  workerCount?: number;
}

export interface ResolvedTreeletOptions {
  center: LngLat;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  tileSegments: number;
  worldScale: number;
  exaggeration: number;
  elevationRange: [number, number];
  contourInterval: number;
  antialias: boolean;
  gui: boolean;
  minPitch: number;
  maxPitch: number;
  compassPosition: UICorner;
  layerPosition: UICorner;
  workerCount: number;
}

export interface BaseLayerOptions {
  id: string;
  name: string;
  source: LayerSourceOptions;
  decoder?: DecoderType;
  decoderFn?: CustomDecoderFn;
  exaggeration?: number;
  active?: boolean;
}

export interface DrapeLayerOptions {
  id: string;
  name: string;
  source: LayerSourceOptions;
  opacity?: number;
  blendMode?: BlendMode;
  active?: boolean;
}

export interface LayerSourceOptions {
  type: 'xyz' | 'wms' | 'wmts';
  url: string;
  subdomains?: string[];
  tileSize?: number;
  maxZoom?: number;
  attribution?: string;
  // WMS / WMTS shared
  layers?: string;
  format?: string;
  // WMS-specific
  crs?: string;
  // WMTS-specific
  style?: string;
  tilematrixSet?: string;
}

// --- Enums / Unions ---

/** Virtual BaseDrape visualization mode derived from the base layer's elevation data. */
export type BaseDrapeMode = 'wireframe' | 'elevation' | 'slope' | 'aspect' | 'contours';

/** Internal shader mode index type (not user-facing). */
export type ShaderMode = 'base' | 'elevation' | 'slope' | 'aspect' | 'texture';

/** Color ramp for elevation-based visualizations. */
export type ColorRamp = 'hypsometric' | 'viridis' | 'inferno' | 'grayscale';

export type BlendMode = 'normal' | 'multiply' | 'screen';
export type DecoderType = 'terrain-rgb' | 'mapbox' | 'terrarium' | 'custom';

/** Corner position for UI components. */
export type UICorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type CustomDecoderFn = (
  r: number,
  g: number,
  b: number,
  a: number,
) => number;

// --- Events ---

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

// --- Tile Scheduling ---

export interface ScheduleResult {
  load: TileCoord[];
  keep: TileCoord[];
  unload: TileCoord[];
}

// --- Visible Extent ---

export interface VisibleExtent {
  corners: WorldPoint[];
  center: WorldPoint;
}
