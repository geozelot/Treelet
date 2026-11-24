// ============================================================================
// treelet.js - Layer Type Definitions
//
// Options, display state, and handle types for all layer kinds.
// ============================================================================

import type { TileBounds } from '../core/types';
import type { TileSource } from '../sources/TileSource';
import type { ElevationDecoder } from '../decoders/ElevationDecoder';
import type { CoatBlendMode, Ramp } from '../analysis/types';
import type { GeoJSON, OverlayStyleSpec } from '../overlays/types';

// === Decoder Name ===

/** Built-in decoder name. */
export type DecoderName = 'terrain-rgb' | 'mapbox' | 'terrarium';

// === Layer Handle ===

/** Opaque handle returned when adding a layer. Can be used to reference it later. */
export interface LayerHandle {
  readonly id: string;
  readonly layerName: string;
}

// === Base Layer ===

export interface BaseLayerOptions {
  layerName: string;
  layerSource: TileSource;
  minZoom?: number;
  maxZoom?: number;
  layerDisplay?: BaseLayerDisplay;
  layerAttribution?: string;
  decoder?: ElevationDecoder | DecoderName;
}

export interface BaseLayerDisplay {
  /** Make this the active base layer when added (the first layer always is). */
  visible?: boolean;
  exaggeration?: number;
}

// Fully resolved (no optional fields)
export interface ResolvedBaseLayerDisplay {
  visible: boolean;
  exaggeration: number;
}

// === Drape Layer ===

export interface DrapeLayerOptions {
  layerName: string;
  layerSource: TileSource;
  minZoom?: number;
  maxZoom?: number;
  layerDisplay?: DrapeLayerDisplay;
  layerAttribution?: string;
}

/** Display of the imagery coat a drape layer forms when active. */
export interface DrapeLayerDisplay {
  visible?: boolean;
  opacity?: number;
  /** How the imagery combines with the coats below it. Default 'normal'. */
  blendMode?: CoatBlendMode;
}

export interface ResolvedDrapeLayerDisplay {
  visible: boolean;
  opacity: number;
  blendMode: CoatBlendMode;
}

// === Analysis Layer ===

export interface AnalysisLayerOptions<P extends object = Record<string, unknown>> {
  /** Registered analysis kind, e.g. 'slope'. */
  analysis: string;
  /** Display name. Default: the analysis' label. */
  layerName?: string;
  /** Parameters; unset ones take the analysis' defaults. */
  params?: Partial<P>;
  /** Ramp for value analyses. Default: the analysis' ramp. */
  ramp?: Ramp;
  /** Unit of the values (legend). Default: the analysis' unit. */
  unit?: string;
  minZoom?: number;
  maxZoom?: number;
  layerDisplay?: AnalysisLayerDisplay;
}

/**
 * A grid to show as a coat: single-band values (colored by a ramp) or RGBA
 * colors. Rows run from north to south; cells are registered to `bounds`
 * (the outer edges of the first and last rows and columns).
 */
export interface RasterLayerOptions {
  /** Values (width·height, NaN = no data) or RGBA bytes (width·height·4). */
  data: Float32Array | Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  /** Outer edges in degrees. */
  bounds: TileBounds;
  /**
   * How rows are spaced: evenly in Web Mercator y (EPSG:3857, as map
   * tiles) or in latitude (EPSG:4326, resampled once when added). Default
   * 'EPSG:3857'.
   */
  crs?: 'EPSG:3857' | 'EPSG:4326';
  /** A value that marks missing data (besides NaN). */
  nodata?: number;
  layerName?: string;
  /** Ramp range of value grids. Default: the data's min and max. */
  range?: [number, number];
  /** Ramp of value grids. Default 'viridis'. */
  ramp?: Ramp;
  /** Unit of the values (legend). */
  unit?: string;
  layerDisplay?: AnalysisLayerDisplay;
}

export interface AnalysisLayerDisplay {
  visible?: boolean;
  opacity?: number;
  blendMode?: CoatBlendMode;
}

export interface ResolvedAnalysisLayerDisplay {
  visible: boolean;
  opacity: number;
  blendMode: CoatBlendMode;
}

// === Overlay Layer ===

export interface OverlayLayerOptions {
  layerName: string;
  /** Features to draw: a GeoJSON FeatureCollection, Feature or Geometry (lng/lat). */
  data?: GeoJSON;
  /** How to draw them: one style, or a function of each feature. */
  style?: OverlayStyleSpec;
  /** Rasterize polygon fills into a coat (default true; outlines are always lines). */
  fills?: boolean;
  minZoom?: number;
  maxZoom?: number;
  layerDisplay?: OverlayLayerDisplay;
  layerAttribution?: string;
}

export interface OverlayLayerDisplay {
  visible?: boolean;
  opacity?: number;
}

export interface ResolvedOverlayLayerDisplay {
  visible: boolean;
  opacity: number;
}
