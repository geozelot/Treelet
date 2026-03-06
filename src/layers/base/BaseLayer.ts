// ============================================================================
// treelet.js - Base Layer
//
// Represents an elevation data layer. Holds source configuration,
// decoder type, and mesh type settings. The actual fetch→decode→mesh
// pipeline is orchestrated by Treelet using the WorkerPool.
// ============================================================================

import type {
  TileCoord,
  BaseLayerOptions,
  DecoderType,
  CustomDecoderFn,
} from '../../core/types';
import type { LayerSource } from '../LayerSource';
import { createSource } from '../createSource';

/**
 * Base layer for elevation / terrain data.
 *
 * A base layer defines:
 *   - Which tile source to fetch DEM data from
 *   - How to decode the tile pixels into elevation values
 *   - Per-layer exaggeration multiplier
 *
 * Only one base layer is active at a time. Treelet uses the active layer
 * to drive the elevation pipeline.
 */
export class BaseLayer {
  readonly id: string;
  readonly name: string;
  readonly source: LayerSource;
  readonly decoderType: DecoderType;
  readonly customDecoderFn?: CustomDecoderFn;

  exaggeration: number;
  active: boolean;

  constructor(options: BaseLayerOptions) {
    this.id = options.id;
    this.name = options.name;

    this.source = createSource(options.source);

    this.decoderType = options.decoder ?? 'terrain-rgb';
    this.customDecoderFn = options.decoderFn;
    this.exaggeration = options.exaggeration ?? 1.0;
    this.active = options.active ?? true;
  }

  /**
   * Get the fetch URL for a tile coordinate.
   * Clamps zoom to the source's max zoom and right-shifts x/y accordingly
   * so overzoom tiles map to valid parent tile coordinates.
   */
  getTileUrl(coord: TileCoord): string {
    const clampedZ = Math.min(coord.z, this.source.maxZoom);
    const dz = coord.z - clampedZ;
    const clampedCoord: TileCoord = {
      z: clampedZ,
      x: coord.x >> dz,
      y: coord.y >> dz,
    };
    return this.source.getTileUrl(clampedCoord);
  }
}
