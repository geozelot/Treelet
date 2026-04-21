// ============================================================================
// treelet.js - Layer Type Definitions
//
// Options, display state, and handle types for all layer kinds.
// ============================================================================

import type { TileSource } from '../sources/TileSource';
import type { ElevationDecoder } from '../decoders/ElevationDecoder';
import type { ColorRamp, BlendMode } from '../core/types';

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
  terrainDisplay?: TerrainDisplay;
  layerAttribution?: string;
  decoder?: ElevationDecoder | DecoderName;
}

export interface BaseLayerDisplay {
  visible?: boolean;
  exaggeration?: number;
}

export interface TerrainDisplay {
  isoplethInterval?: number;
  isolineStrength?: number;
  isolineColor?: [number, number, number];
  rampInterpolationRange?: [number, number] | 'auto';
  rampDefaultElevation?: ColorRamp;
  rampDefaultSlope?: ColorRamp;
  rampDefaultAspect?: ColorRamp;
}

// Fully resolved (no optional fields)
export interface ResolvedBaseLayerDisplay {
  visible: boolean;
  exaggeration: number;
}

export interface ResolvedTerrainDisplay {
  isoplethInterval: number;
  isolineStrength: number;
  isolineColor: [number, number, number];
  rampInterpolationRange: [number, number] | 'auto';
  rampDefaultElevation: ColorRamp;
  rampDefaultSlope: ColorRamp;
  rampDefaultAspect: ColorRamp;
}

// === Drape Layer ===

export interface DrapeLayerOptions {
  layerName: string;
  layerSource: TileSource;
  minZoom?: number;
  maxZoom?: number;
  layerDisplay?: DrapeLayerDisplay;
  layerAttribution?: string;
  /** LOD offset for drape tiles relative to elevation tiles.
   *  1 = same zoom as elevation (default). 2 = one zoom finer (4 sub-tiles).
   *  3 = two zoom finer (16 sub-tiles). Clamped to source maxZoom. */
  lodOffset?: 1 | 2 | 3;
}

export interface DrapeLayerDisplay {
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  hillshadeStrength?: number;
}

export interface ResolvedDrapeLayerDisplay {
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  hillshadeStrength: number;
}

// === Overlay Layer (stub) ===

export interface OverlayLayerOptions {
  layerName: string;
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
