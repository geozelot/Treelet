// ============================================================================
// treelet.js - WMTS Tile Source
//
// Generates OGC WMTS GetTile URLs. Supports two access patterns:
//   RESTful: URL template with {z}/{y}/{x} placeholders (like XYZ)
//   KVP: Constructs GetTile request from query parameters
//
// Detection: if `url` contains '{z}', RESTful mode; otherwise KVP.
// ============================================================================

import type { TileCoord, LayerSourceOptions } from '../core/types';
import { LayerSource } from './LayerSource';

/**
 * WMTS (Web Map Tile Service) tile source.
 *
 * Supports two access patterns:
 *
 * **RESTful** - URL template with `{z}`, `{y}`, `{x}` placeholders:
 * ```ts
 * new WMTSSource({
 *   type: 'wmts',
 *   url: 'https://example.com/wmts/rest/dem/default/EPSG3857/{z}/{y}/{x}.png',
 * });
 * ```
 *
 * **KVP** - Auto-constructs GetTile URL from options:
 * ```ts
 * new WMTSSource({
 *   type: 'wmts',
 *   url: 'https://example.com/wmts',
 *   layers: 'dem',
 *   tilematrixSet: 'EPSG:3857',
 *   style: 'default',
 *   format: 'image/png',
 * });
 * ```
 *
 * Mode is auto-detected: if `url` contains `{z}`, RESTful; otherwise KVP.
 */
export class WMTSSource extends LayerSource {
  private readonly baseUrl: string;
  private readonly isRestful: boolean;
  private readonly subdomains: string[];

  // KVP-mode fields
  private readonly layer: string;
  private readonly style: string;
  private readonly tilematrixSet: string;
  private readonly format: string;

  readonly tileSize: number;
  readonly maxZoom: number;

  constructor(options: LayerSourceOptions) {
    super(options.attribution);
    this.baseUrl = options.url;
    this.subdomains = options.subdomains ?? [];
    this.tileSize = options.tileSize ?? 256;
    this.maxZoom = options.maxZoom ?? 22;

    // Detect mode: RESTful if URL contains {z} placeholder
    this.isRestful = options.url.includes('{z}');

    // KVP fields (stored regardless of mode)
    this.layer = options.layers ?? '';
    this.style = options.style ?? 'default';
    this.tilematrixSet = options.tilematrixSet ?? 'EPSG:3857';
    this.format = options.format ?? 'image/png';
  }

  /**
   * Generate a WMTS tile URL.
   * RESTful mode: replace {z}/{y}/{x}/{s} placeholders.
   * KVP mode: construct GetTile request with query parameters.
   */
  getTileUrl(coord: TileCoord): string {
    if (this.isRestful) {
      return this.getRestfulUrl(coord);
    }
    return this.getKvpUrl(coord);
  }

  private getRestfulUrl(coord: TileCoord): string {
    let url = this.baseUrl
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

  private getKvpUrl(coord: TileCoord): string {
    // Manual query string — URLSearchParams would encode the slash in FORMAT
    // (e.g. image%2Fpng) which most WMTS servers reject.
    const params = [
      'SERVICE=WMTS',
      'REQUEST=GetTile',
      'VERSION=1.0.0',
      `LAYER=${this.layer}`,
      `STYLE=${this.style}`,
      `TILEMATRIXSET=${this.tilematrixSet}`,
      `TILEMATRIX=${coord.z}`,
      `TILEROW=${coord.y}`,
      `TILECOL=${coord.x}`,
      `FORMAT=${this.format}`,
    ].join('&');

    const separator = this.baseUrl.includes('?') ? '&' : '?';
    return `${this.baseUrl}${separator}${params}`;
  }
}
