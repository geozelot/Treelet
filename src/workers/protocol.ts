// ============================================================================
// treelet.js - Worker Protocol
//
// Request/response types shared by the main thread and the tile worker.
// Type-only module: importing it never pulls worker code into the bundle.
// ============================================================================

import type { NormalizedRegion } from './raster';

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
