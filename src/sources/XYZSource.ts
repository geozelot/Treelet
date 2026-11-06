// ============================================================================
// treelet.js - XYZ Tile Source
//
// Standard slippy-map tile source using URL templates with {z}/{x}/{y}
// placeholders. Supports optional {s} subdomain rotation, TMS {-y},
// {quadkey}, {r} and {accessToken}.
// ============================================================================

import type { TileCoord } from '../core/types';
import type { XYZSourceOptions } from './types';
import { UrlTileSource } from './UrlTileSource';
import { splitTemplate, expandTemplate, hasTokenPlaceholder } from './templateUrl';

/**
 * XYZ tile source for standard slippy-map tile services.
 *
 * URL templates use curly-brace placeholders:
 *   {z} - zoom level
 *   {x} - tile column
 *   {y} - tile row (XYZ, origin top-left)
 *   {-y} - tile row (TMS, origin bottom-left)
 *   {s} - subdomain (rotated round-robin)
 *   {quadkey} - Bing-style quadkey
 *   {r} - retina suffix (see `retina` option)
 *   {accessToken} - access token
 *
 * @example
 * ```ts
 * new XYZSource({
 *   url: 'https://{s}.tile.example.com/{z}/{x}/{y}.png',
 *   subdomains: ['a', 'b', 'c'],
 *   tileSize: 256,
 * });
 * ```
 */
export class XYZSource extends UrlTileSource {
  private readonly subdomains: string[];
  readonly tileSize: number;
  readonly minZoom: number;
  readonly maxZoom: number;

  /** Pre-split URL template segments for fast concatenation. */
  private readonly urlParts: string[];
  private readonly urlTokens: string[];
  private readonly hasToken: boolean;

  constructor(options: XYZSourceOptions) {
    super(options);
    this.subdomains = options.subdomains ?? [];
    this.tileSize = options.tileSize ?? 256;
    this.minZoom = options.minZoom ?? 0;
    this.maxZoom = options.maxZoom ?? 22;

    const { parts, tokens } = splitTemplate(options.url);
    this.urlParts = parts;
    this.urlTokens = tokens;
    this.hasToken = hasTokenPlaceholder(tokens);
  }

  /**
   * Generate the URL for a specific tile.
   * Subdomain rotation uses (x + y) mod to distribute requests.
   */
  getTileUrl(coord: TileCoord): string {
    const url = expandTemplate(this.urlParts, this.urlTokens, coord, this.subdomains, this.templateContext);
    return this.withAccessToken(url, this.hasToken);
  }
}
