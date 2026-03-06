// ============================================================================
// treelet.js - XYZ Tile Source
//
// Standard slippy-map tile source using URL templates with {z}/{x}/{y}
// placeholders. Supports optional {s} subdomain rotation.
// ============================================================================

import type { TileCoord, LayerSourceOptions } from '../core/types';
import { LayerSource } from './LayerSource';

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
 *   type: 'xyz',
 *   url: 'https://{s}.tile.example.com/{z}/{x}/{y}.png',
 *   subdomains: ['a', 'b', 'c'],
 *   tileSize: 256,
 * });
 * ```
 */
export class XYZSource extends LayerSource {
  private readonly urlTemplate: string;
  private readonly subdomains: string[];
  readonly tileSize: number;
  readonly maxZoom: number;

  constructor(options: LayerSourceOptions) {
    super(options.attribution);
    this.urlTemplate = options.url;
    this.subdomains = options.subdomains ?? [];
    this.tileSize = options.tileSize ?? 256;
    this.maxZoom = options.maxZoom ?? 22;
  }

  /**
   * Generate the URL for a specific tile.
   * Subdomain rotation uses (x + y) mod to distribute requests.
   */
  getTileUrl(coord: TileCoord): string {
    let url = this.urlTemplate
      .replace('{z}', String(coord.z))
      .replace('{x}', String(coord.x))
      .replace('{y}', String(coord.y));

    // Subdomain rotation
    if (this.subdomains.length > 0) {
      const idx = Math.abs(coord.x + coord.y) % this.subdomains.length;
      url = url.replace('{s}', this.subdomains[idx]);
    }

    return url;
  }
}
