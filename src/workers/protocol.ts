// ============================================================================
// treelet.js - Worker Protocol
//
// Request/response types shared by the main thread and the tile worker.
// Type-only module: importing it never pulls worker code into the bundle.
// ============================================================================

import type { NormalizedRegion } from './raster';
import type { RegionWindow } from '../analysis/region';
import type { ViewshedOptions } from '../analysis/compute/viewshed';
import type { SunSample } from '../analysis/compute/sunHours';
import type { SkyViewOptions, TpiOptions } from '../analysis/compute/skyView';

export type { NormalizedRegion } from './raster';

/** Structured-cloneable subset of RequestInit forwarded to worker fetches. */
export interface TileRequestInit {
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  referrerPolicy?: ReferrerPolicy;
}

export interface ElevationRequest {
  /** Request id used for cancellation. */
  id: number;
  url: string;
  decoderType: string;
  /** Source of a non-built-in decoder, compiled and cached inside the worker. */
  decoderSource?: string;
  /** Sub-region of the source tile to extract (overzoom), or null for the full tile. */
  region: NormalizedRegion | null;
  /** Output slot edge length in texels. */
  size: number;
  init?: TileRequestInit;
}

export type ElevationResponse =
  | {
    status: 'ok';
    data: Float32Array;
    min: number;
    max: number;
    /** The range without isolated spikes (see robustRange): what the tile shows. */
    low: number;
    high: number;
    /** Slot texels per source pixel (> 1 when overzoomed); sizes the edge-stitch band. */
    texelsPerPixel: number;
  }
  | { status: 'empty'; httpStatus: number };

/** One source image composited into a drape slot. */
export interface DrapePart {
  url: string;
  /** Destination rectangle inside the slot, in slot pixels. */
  dx: number;
  dy: number;
  dSize: number;
  /** Sub-region of the source image to draw (overzoom crop), or null for all of it. */
  crop: NormalizedRegion | null;
}

export interface DrapeRequest {
  id: number;
  parts: DrapePart[];
  /** Output slot edge length in pixels (power of two). */
  size: number;
  init?: TileRequestInit;
}

export type DrapeResponse =
  /** `imageSize`: pixel width of the source images (for the drape layer's slot math). */
  | { status: 'ok'; levels: Uint8Array[]; imageSize: number }
  | { status: 'empty' };

/** HTTP statuses that mean "this tile does not exist" rather than "try again". */
export const EMPTY_TILE_STATUSES: ReadonlySet<number> = new Set([204, 404, 410]);

// ---------------------------------------------------------------------------
// Region analyses (dedicated analysis worker)
// ---------------------------------------------------------------------------

/** Elevation tiles at one zoom, assembled into one grid covering `window`. */
export interface RegionSpec {
  /** Identifies the assembled grid (the worker keeps the last few). */
  key: string;
  zoom: number;
  tiles: Array<{ x: number; y: number; url: string }>;
  window: RegionWindow;
  decoderType: string;
  decoderSource?: string;
  init?: TileRequestInit;
}

export type RegionTask =
  | { kind: 'viewshed'; options: Omit<ViewshedOptions, 'x' | 'y'> & { tileX: number; tileY: number } }
  | { kind: 'sunhours'; options: { samples: SunSample[]; stepMinutes: number } }
  | { kind: 'skyview'; options: SkyViewOptions }
  | { kind: 'tpi'; options: TpiOptions };

export interface RegionAnalysisRequest {
  id: number;
  region: RegionSpec;
  /** Latitude of the region's center (ground cell size). */
  centerLat: number;
  /** Analysis to run on the grid, or null to only load it. */
  task: RegionTask | null;
  /** Return a copy of the elevation grid. */
  returnGrid?: boolean;
}

export interface RegionAnalysisResponse {
  width: number;
  height: number;
  tileSize: number;
  zoom: number;
  /** The grid's NW corner in global pixels at `zoom`. */
  px0: number;
  py0: number;
  /** Ground meters between cell centers at the region's center. */
  cellSize: number;
  min: number;
  max: number;
  /** Tiles the source doesn't have / that kept failing (nodata). */
  missing: number;
  failed: number;
  grid?: Float32Array;
  /** The analysis' output grids (which ones depends on the task's kind). */
  outputs: RegionOutputs;
  stats: RegionStats;
}

/** Output grids of the region analyses, by kind. */
export interface RegionOutputs {
  /** viewshed: 1 visible, 0 hidden, NaN outside the radius / field of view. */
  visible?: Float32Array;
  /** viewshed (with `clearance`): meters hidden ground would have to rise to be seen. */
  clearance?: Float32Array;
  /** sunhours: hours of direct sun, and the first and last sun (hours of the day). */
  hours?: Float32Array;
  firstSun?: Float32Array;
  lastSun?: Float32Array;
  /** skyview: visible fraction of the sky. */
  skyview?: Float32Array;
  /** tpi: height above (+) or below (−) the surrounding mean, meters. */
  tpi?: Float32Array;
}

/** Scalar results of the region analyses, by kind. */
export interface RegionStats {
  visibleCells?: number;
  analysedCells?: number;
  observerElevation?: number;
  daylight?: number;
}

export type RegionProgress = (stage: 'loading' | 'computing', fraction: number) => void;
