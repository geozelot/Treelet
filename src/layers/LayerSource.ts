// ============================================================================
// treelet.js - Abstract Layer Source
//
// Base class for all tile data sources. Concrete subclasses implement
// URL generation for different source types (XYZ, WMS, WMTS).
// ============================================================================

import type { TileCoord } from '../core/types';

/**
 * Abstract base class for tile data sources.
 *
 * A source knows how to generate URLs for individual tiles,
 * but does not fetch or decode data - that's the worker's job.
 */
export abstract class LayerSource {
  readonly attribution: string;

  constructor(attribution?: string) {
    this.attribution = attribution ?? '';
  }

  /** Generate the URL for a specific tile coordinate. */
  abstract getTileUrl(coord: TileCoord): string;

  /** Tile pixel size (e.g. 256, 512). */
  abstract readonly tileSize: number;

  /** Maximum zoom level supported by this source. */
  abstract readonly maxZoom: number;
}
