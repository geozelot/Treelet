// ============================================================================
// treelet.js - WMS Tile Source (Plugin)
//
// Generates OGC WMS GetMap URLs from tile coordinates. Supports
// reprojection of tile bounding boxes between EPSG:3857 and EPSG:4326 and
// both WMS 1.1.1 and 1.3.0 axis conventions.
// ============================================================================

import type { TileCoord } from '../../../src/core/types';
import type { WMSSourceOptions } from './types';
import { UrlTileSource } from '../../../src/sources/UrlTileSource';
import { WebMercator } from '../../../src/crs/WebMercator';
import { WEB_MERCATOR_EXTENT } from '../../../src/core/constants';

const MERCATOR_CRS = new Set(['EPSG:3857', 'EPSG:900913', 'EPSG:102100']);
const GEOGRAPHIC_CRS = new Set(['EPSG:4326', 'CRS:84']);

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
  private readonly version: '1.1.1' | '1.3.0';
  readonly tileSize: number;
  readonly minZoom: number;
  readonly maxZoom: number;

  /** Pre-built static query prefix (everything except BBOX). */
  private readonly queryPrefix: string;

  constructor(options: WMSSourceOptions) {
    super(options);
    const enc = encodeURIComponent;
    const baseUrl = options.url;
    const format = options.format ?? 'image/png';
    this.version = options.version ?? '1.1.1';
    let crs = (options.crs ?? 'EPSG:3857').toUpperCase();
    if (!MERCATOR_CRS.has(crs) && !GEOGRAPHIC_CRS.has(crs)) {
      console.warn(`treelet: unsupported WMS CRS "${crs}", using EPSG:3857`);
      crs = 'EPSG:3857';
    }
    this.crs = crs;
    this.tileSize = options.tileSize ?? 256;
    this.minZoom = options.minZoom ?? 0;
    this.maxZoom = options.maxZoom ?? 22;

    const separator = baseUrl.includes('?') ? (baseUrl.endsWith('?') || baseUrl.endsWith('&') ? '' : '&') : '?';
    const crsParam = this.version === '1.3.0' ? 'CRS' : 'SRS';
    this.queryPrefix = `${baseUrl}${separator}SERVICE=WMS&VERSION=${this.version}&REQUEST=GetMap` +
      `&LAYERS=${enc(options.layers ?? '')}&STYLES=${enc(options.styles ?? '')}&${crsParam}=${enc(this.crs)}` +
      `&WIDTH=${this.tileSize}&HEIGHT=${this.tileSize}` +
      `&FORMAT=${enc(format)}&TRANSPARENT=${options.transparent === false ? 'FALSE' : 'TRUE'}&BBOX=`;
  }

  /**
   * Generate a WMS GetMap URL for a tile coordinate.
   */
  getTileUrl(coord: TileCoord): string {
    return this.withAccessToken(this.queryPrefix + this.getTileBBox(coord), false);
  }

  /**
   * Compute the bounding box string for a tile in the configured CRS.
   */
  private getTileBBox(coord: TileCoord): string {
    const n = 2 ** coord.z;
    const tileSize = (WEB_MERCATOR_EXTENT * 2) / n;

    // Tile bounds in EPSG:3857 (meters)
    const minX = -WEB_MERCATOR_EXTENT + coord.x * tileSize;
    const maxX = minX + tileSize;
    const maxY = WEB_MERCATOR_EXTENT - coord.y * tileSize;
    const minY = maxY - tileSize;

    if (MERCATOR_CRS.has(this.crs)) {
      return `${minX},${minY},${maxX},${maxY}`;
    }

    const sw = WebMercator.unproject({ x: minX, y: minY });
    const ne = WebMercator.unproject({ x: maxX, y: maxY });
    // WMS 1.3.0 + EPSG:4326 uses the EPSG axis order (lat, lon); CRS:84 is always lon, lat.
    if (this.version === '1.3.0' && this.crs === 'EPSG:4326') {
      return `${sw.lat},${sw.lng},${ne.lat},${ne.lng}`;
    }
    return `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;
  }
}
