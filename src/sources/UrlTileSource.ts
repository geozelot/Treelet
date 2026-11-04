// ============================================================================
// treelet.js - URL-based Tile Source Base Class
//
// Abstract base for tile sources that generate tile URLs from templates
// or query parameters. Handles shared defaults for tileSize, zoom range,
// attribution, concurrency, request options, access tokens and
// scheduling hints.
// ============================================================================

import type { TileCoord } from '../core/types';
import type { TileSource, TileRequestInit } from './TileSource';
import type { TileSourceOptions } from './types';
import { appendQueryParam, type TemplateContext } from './templateUrl';

/** Default maximum concurrent fetches for URL-based sources. */
const DEFAULT_MAX_CONCURRENCY = 12;

/**
 * Abstract base class for URL-based tile sources.
 *
 * Provides default implementations for {@link TileSource} methods that
 * are common to all URL-template sources (XYZ, WMTS, WMS).
 */
export abstract class UrlTileSource implements TileSource {
  readonly attribution: string;
  readonly maxConcurrency: number;

  abstract readonly tileSize: number;
  abstract readonly minZoom: number;
  abstract readonly maxZoom: number;

  /** Context for optional template tokens ({accessToken}, {r}). */
  protected readonly templateContext: TemplateContext;
  private readonly accessToken: string | undefined;
  private readonly requestInit: TileRequestInit | undefined;

  constructor(attributionOrOptions?: string | Partial<TileSourceOptions>, maxConcurrency?: number) {
    const opts: Partial<TileSourceOptions> = typeof attributionOrOptions === 'object' && attributionOrOptions !== null
      ? attributionOrOptions
      : { attribution: attributionOrOptions, maxConcurrency };
    this.attribution = opts.attribution ?? '';
    const mc = opts.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    this.maxConcurrency = Number.isFinite(mc) && mc >= 1 ? Math.floor(mc) : DEFAULT_MAX_CONCURRENCY;
    this.accessToken = opts.accessToken;

    let retina = '';
    if (typeof opts.retina === 'string') retina = opts.retina;
    else if (opts.retina === true && typeof devicePixelRatio !== 'undefined' && devicePixelRatio > 1) retina = '@2x';
    this.templateContext = { accessToken: opts.accessToken, retina };

    if (opts.headers || opts.credentials || opts.referrerPolicy) {
      this.requestInit = {
        headers: opts.headers ? { ...opts.headers } : undefined,
        credentials: opts.credentials,
        referrerPolicy: opts.referrerPolicy,
      };
    }
  }

  /** Generate the URL for a specific tile coordinate. */
  abstract getTileUrl(coord: TileCoord): string;

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

  getRequestInit(): TileRequestInit | undefined {
    return this.requestInit;
  }

  /**
   * Append `access_token=<token>` when a token is configured but the URL
   * template has no `{accessToken}` placeholder.
   */
  protected withAccessToken(url: string, templateHasPlaceholder: boolean): string {
    if (this.accessToken === undefined || templateHasPlaceholder) return url;
    return appendQueryParam(url, 'access_token', this.accessToken);
  }
}
