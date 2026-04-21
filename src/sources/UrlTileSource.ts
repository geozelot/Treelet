// ============================================================================
// treelet.js - URL-based Tile Source Base Class
//
// Abstract base for tile sources that generate tile URLs from templates
// or query parameters. Handles shared defaults for tileSize, zoom range,
// attribution, concurrency, and scheduling hints.
// ============================================================================

import type { TileSource } from './TileSource';

/** Default maximum concurrent fetches for URL-based sources. */
const DEFAULT_MAX_CONCURRENCY = 12;

/**
 * Abstract base class for URL-based tile sources.
 *
 * Provides default implementations for {@link TileSource} methods that
 * are common to all URL-template sources (XYZ, WMTS).
 */
export abstract class UrlTileSource implements TileSource {
  readonly attribution: string;
  readonly maxConcurrency: number;

  abstract readonly tileSize: number;
  abstract readonly minZoom: number;
  abstract readonly maxZoom: number;

  constructor(attribution?: string, maxConcurrency?: number) {
    this.attribution = attribution ?? '';
    this.maxConcurrency = maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  }

  /** Generate the URL for a specific tile coordinate. */
  abstract getTileUrl(coord: import('../core/types').TileCoord): string;

  /** URL sources are ready immediately. */
  async ensureReady(): Promise<void> {
    // No-op for URL-based sources
  }

  /** URL sources use standard fetch scheduling. */
  getSchedulingHints(): { maxConcurrentFetches: number; deferWrites: boolean } {
    return {
      maxConcurrentFetches: this.maxConcurrency,
      deferWrites: false,
    };
  }
}
