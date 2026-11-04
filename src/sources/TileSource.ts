// ============================================================================
// treelet.js - TileSource Interface
//
// Core interface for all tile data sources. Concrete implementations
// provide URL generation and optional custom fetch/decode pipelines.
// ============================================================================

import type { TileCoord } from '../core/types';
import type { TileRequestInit } from '../workers/protocol';

export type { TileRequestInit } from '../workers/protocol';

/**
 * Core interface for all tile data sources.
 *
 * A source knows how to generate URLs for individual tiles and provides
 * metadata about the source's capabilities. Concrete implementations
 * extend {@link UrlTileSource} for URL-template sources or implement
 * this interface directly for custom fetch pipelines.
 */
export interface TileSource {
  /** Generate the URL for a specific tile coordinate. */
  getTileUrl(coord: TileCoord): string;

  /** Tile pixel size (e.g. 256, 512). */
  readonly tileSize: number;

  /** Minimum zoom level supported by this source. */
  readonly minZoom: number;

  /** Maximum zoom level supported by this source. */
  readonly maxZoom: number;

  /** Attribution string for this source. */
  readonly attribution: string;

  /** Maximum concurrent fetches for this source. */
  readonly maxConcurrency: number;

  /**
   * Async initialization hook (e.g. for sources that need header parsing).
   * Resolves immediately for most sources.
   */
  ensureReady(): Promise<void>;

  /**
   * Scheduling hints for the fetch pipeline.
   *
   * `maxConcurrentFetches` - caps parallel tile fetches for this source.
   * `deferWrites` - retained for compatibility; ignored since decoding and
   *   resampling moved into the workers (atlas writes are now cheap copies).
   */
  getSchedulingHints(): { maxConcurrentFetches: number; deferWrites: boolean };

  /**
   * Optional request options (headers, credentials, referrer policy) applied
   * to every tile fetch. Must be structured-cloneable (sent to workers).
   */
  getRequestInit?(): TileRequestInit | undefined;
}
