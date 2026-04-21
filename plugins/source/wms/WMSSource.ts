// ============================================================================
// treelet.js - WMS Tile Source (Plugin)
//
// Generates OGC WMS GetMap URLs from tile coordinates. Supports
// reprojection of tile bounding boxes between EPSG:3857 and EPSG:4326.
// ============================================================================

import type { TileCoord } from '../../../src/core/types';
import type { WMSSourceOptions } from './types';
import { UrlTileSource } from '../../../src/sources/UrlTileSource';
import { WebMercator } from '../../../src/crs/WebMercator';
import { WEB_MERCATOR_EXTENT } from '../../../src/core/constants';

/**
 * WMS (Web Map Service) tile source.
 *
 * Constructs GetMap requests for the given tile coordinate by computing
 * the tile's bounding box in the target CRS.
 *
 * @example
 * ```ts
 * new WMSSource({
 *   url: 'https://example.com/geoserver/wms',
 *   layers: 'dem',
 *   format: 'image/png',
 *   crs: 'EPSG:4326',
 *   tileSize: 256,
 * });
 * ```
 */
export class WMSSource extends UrlTileSource {
  private readonly crs: string;
  readonly tileSize: number;
  readonly minZoom: number;
  readonly maxZoom: number;

  /** Pre-built static query prefix (everything except BBOX). */
  private readonly queryPrefix: string;

  constructor(options: WMSSourceOptions) {
    super(options.attribution, options.maxConcurrency);
    const baseUrl = options.url;
    const layers = options.layers ?? '';
    const format = options.format ?? 'image/png';
    this.crs = (options.crs ?? 'EPSG:3857').toUpperCase();
    this.tileSize = options.tileSize ?? 256;
    this.minZoom = options.minZoom ?? 0;
    this.maxZoom = options.maxZoom ?? 22;

    // Pre-build the static portion of the GetMap query string
    const separator = baseUrl.includes('?') ? '&' : '?';
    this.queryPrefix = `${baseUrl}${separator}SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap` +
      `&LAYERS=${layers}&STYLES=&SRS=${this.crs}` +
      `&WIDTH=${this.tileSize}&HEIGHT=${this.tileSize}` +
      `&FORMAT=${format}&TRANSPARENT=TRUE&BBOX=`;
  }

  /**
   * Generate a WMS GetMap URL for a tile coordinate.
   */
  getTileUrl(coord: TileCoord): string {
    return this.queryPrefix + this.getTileBBox(coord);
  }

  /**
   * Compute the bounding box string for a tile in the configured CRS.
   */
  private getTileBBox(coord: TileCoord): string {
    const n = 1 << coord.z;
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
