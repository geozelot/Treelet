// ============================================================================
// treelet.js - XYZ Tile Source
//
// Standard slippy-map tile source using URL templates with {z}/{x}/{y}
// placeholders. Supports optional {s} subdomain rotation.
// ============================================================================

import type { TileCoord } from '../core/types';
import type { XYZSourceOptions } from './types';
import { UrlTileSource } from './UrlTileSource';
import { splitTemplate, expandTemplate } from './templateUrl';

/**
 * XYZ tile source for standard slippy-map tile services.
 *
 * URL templates use curly-brace placeholders:
 *   {z} - zoom level
 *   {x} - tile column
 *   {y} - tile row
 *   {s} - subdomain (rotated round-robin)
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

  constructor(options: XYZSourceOptions) {
    super(options.attribution, options.maxConcurrency);
    this.subdomains = options.subdomains ?? [];
    this.tileSize = options.tileSize ?? 256;
    this.minZoom = options.minZoom ?? 0;
    this.maxZoom = options.maxZoom ?? 22;

    // Pre-compile: split template into literal parts and token names
    const { parts, tokens } = splitTemplate(options.url);
    this.urlParts = parts;
    this.urlTokens = tokens;
  }

  /**
   * Generate the URL for a specific tile.
   * Subdomain rotation uses (x + y) mod to distribute requests.
   */
  getTileUrl(coord: TileCoord): string {
    return expandTemplate(this.urlParts, this.urlTokens, coord, this.subdomains);
  }
}
