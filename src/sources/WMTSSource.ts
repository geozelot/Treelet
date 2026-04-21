// ============================================================================
// treelet.js - WMTS Tile Source
//
// Generates OGC WMTS GetTile URLs. Supports two access patterns:
//   RESTful: URL template with {z}/{y}/{x} placeholders (like XYZ)
//   KVP: Constructs GetTile request from query parameters
//
// Detection: if `url` contains '{z}', RESTful mode; otherwise KVP.
// ============================================================================

import type { TileCoord } from '../core/types';
import type { WMTSSourceOptions } from './types';
import { UrlTileSource } from './UrlTileSource';
import { splitTemplate, expandTemplate } from './templateUrl';

/**
 * WMTS (Web Map Tile Service) tile source.
 *
 * Supports two access patterns:
 *
 * **RESTful** - URL template with `{z}`, `{y}`, `{x}` placeholders:
 * ```ts
 * new WMTSSource({
 *   url: 'https://example.com/wmts/rest/dem/default/EPSG3857/{z}/{y}/{x}.png',
 * });
 * ```
 *
 * **KVP** - Auto-constructs GetTile URL from options:
 * ```ts
 * new WMTSSource({
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
export class WMTSSource extends UrlTileSource {
  private readonly baseUrl: string;
  private readonly isRestful: boolean;
  private readonly subdomains: string[];

  // RESTful-mode: pre-compiled URL template
  private readonly urlParts: string[];
  private readonly urlTokens: string[];

  // KVP-mode: pre-built static query prefix
  private readonly kvpPrefix: string;

  readonly tileSize: number;
  readonly minZoom: number;
  readonly maxZoom: number;

  constructor(options: WMTSSourceOptions) {
    super(options.attribution, options.maxConcurrency);
    this.baseUrl = options.url;
    this.subdomains = options.subdomains ?? [];
    this.tileSize = options.tileSize ?? 256;
    this.minZoom = options.minZoom ?? 0;
    this.maxZoom = options.maxZoom ?? 22;

    // Detect mode: RESTful if URL contains {z} placeholder
    this.isRestful = options.url.includes('{z}');

    // Pre-compile RESTful template
    const { parts, tokens } = splitTemplate(options.url);
    this.urlParts = parts;
    this.urlTokens = tokens;

    // Pre-build KVP static prefix
    const layer = options.layers ?? '';
    const style = options.style ?? 'default';
    const tilematrixSet = options.tilematrixSet ?? 'EPSG:3857';
    const format = options.format ?? 'image/png';
    const separator = this.baseUrl.includes('?') ? '&' : '?';
    this.kvpPrefix = `${this.baseUrl}${separator}SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
      `&LAYER=${layer}&STYLE=${style}&TILEMATRIXSET=${tilematrixSet}&FORMAT=${format}`;
  }

  /**
   * Generate a WMTS tile URL.
   * RESTful mode: concatenate pre-compiled template parts.
   * KVP mode: append tile-specific params to pre-built prefix.
   */
  getTileUrl(coord: TileCoord): string {
    if (this.isRestful) {
      return this.getRestfulUrl(coord);
    }
    return this.getKvpUrl(coord);
  }

  private getRestfulUrl(coord: TileCoord): string {
    return expandTemplate(this.urlParts, this.urlTokens, coord, this.subdomains);
  }

  private getKvpUrl(coord: TileCoord): string {
    return `${this.kvpPrefix}&TILEMATRIX=${coord.z}&TILEROW=${coord.y}&TILECOL=${coord.x}`;
  }
}
