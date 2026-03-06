// ============================================================================
// treelet.js - WMS Tile Source
//
// Generates OGC WMS GetMap URLs from tile coordinates. Supports
// reprojection of tile bounding boxes between EPSG:3857 and EPSG:4326.
// ============================================================================

import type { TileCoord, LayerSourceOptions } from '../core/types';
import { LayerSource } from './LayerSource';
import { WebMercator } from '../crs/WebMercator';
import { WEB_MERCATOR_EXTENT } from '../core/constants';

/**
 * WMS (Web Map Service) tile source.
 *
 * Constructs GetMap requests for the given tile coordinate by computing
 * the tile's bounding box in the target CRS.
 *
 * @example
 * ```ts
 * new WMSSource({
 *   type: 'wms',
 *   url: 'https://example.com/geoserver/wms',
 *   layers: 'dem',
 *   format: 'image/png',
 *   crs: 'EPSG:4326',
 *   tileSize: 256,
 * });
 * ```
 */
export class WMSSource extends LayerSource {
  private readonly baseUrl: string;
  private readonly layers: string;
  private readonly format: string;
  private readonly crs: string;
  readonly tileSize: number;
  readonly maxZoom: number;

  constructor(options: LayerSourceOptions) {
    super(options.attribution);
    this.baseUrl = options.url;
    this.layers = options.layers ?? '';
    this.format = options.format ?? 'image/png';
    this.crs = (options.crs ?? 'EPSG:3857').toUpperCase();
    this.tileSize = options.tileSize ?? 256;
    this.maxZoom = options.maxZoom ?? 22;
  }

  /**
   * Generate a WMS GetMap URL for a tile coordinate.
   *
   * Constructs the query string manually instead of via `URLSearchParams`
   * because the latter encodes commas and slashes (`%2C`, `%2F`) that WMS
   * servers expect as literal characters in BBOX and FORMAT values.
   */
  getTileUrl(coord: TileCoord): string {
    const bbox = this.getTileBBox(coord);

    const params = [
      'SERVICE=WMS',
      'VERSION=1.1.1',
      'REQUEST=GetMap',
      `LAYERS=${this.layers}`,
      'STYLES=',
      `SRS=${this.crs}`,
      `BBOX=${bbox}`,
      `WIDTH=${this.tileSize}`,
      `HEIGHT=${this.tileSize}`,
      `FORMAT=${this.format}`,
      'TRANSPARENT=TRUE',
    ].join('&');

    const separator = this.baseUrl.includes('?') ? '&' : '?';
    return `${this.baseUrl}${separator}${params}`;
  }

  /**
   * Compute the bounding box string for a tile in the configured CRS.
   */
  private getTileBBox(coord: TileCoord): string {
    const n = Math.pow(2, coord.z);
    const tileSize = (WEB_MERCATOR_EXTENT * 2) / n;

    // Tile bounds in EPSG:3857 (meters)
    const minX = -WEB_MERCATOR_EXTENT + coord.x * tileSize;
    const maxX = minX + tileSize;
    const maxY = WEB_MERCATOR_EXTENT - coord.y * tileSize;
    const minY = maxY - tileSize;

    if (this.crs === 'EPSG:3857' || this.crs === 'EPSG:900913') {
      return `${minX},${minY},${maxX},${maxY}`;
    }

    if (this.crs === 'EPSG:4326' || this.crs === 'CRS:84') {
      // Reproject corners to geographic coordinates
      const sw = WebMercator.unproject({ x: minX, y: minY });
      const ne = WebMercator.unproject({ x: maxX, y: maxY });
      return `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;
    }

    // Unsupported CRS - fall back to 3857 bbox
    console.warn(`treelet: unsupported WMS CRS "${this.crs}", using EPSG:3857`);
    return `${minX},${minY},${maxX},${maxY}`;
  }
}
