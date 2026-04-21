// ============================================================================
// treelet.js - Base Layer
//
// Represents an elevation data layer. Holds source configuration,
// decoder, and per-layer display settings. The actual fetch→decode
// pipeline is orchestrated by TerrainRenderer using the WorkerPool.
// ============================================================================

import type { TileCoord } from '../core/types';
import type { TileSource } from '../sources/TileSource';
import type { ElevationDecoder } from '../decoders/ElevationDecoder';
import { resolveDecoder } from '../decoders/ElevationDecoder';
import type { Layer } from './Layer';
import type {
  BaseLayerOptions,
  ResolvedBaseLayerDisplay,
  ResolvedTerrainDisplay,
  DecoderName,
} from './types';

/** Auto-incrementing ID counter for base layers. */
let nextBaseLayerId = 0;

/**
 * Base layer for elevation / terrain data.
 *
 * A base layer defines:
 *   - Which tile source to fetch DEM data from
 *   - How to decode tile pixels into elevation values
 *   - Per-layer display settings (exaggeration)
 *   - Per-layer terrain display settings (isolines, color ramps)
 *
 * Only one base layer is active at a time. Treelet uses the active layer
 * to drive the elevation pipeline.
 */
export class BaseLayer implements Layer {
  readonly id: string;
  readonly layerName: string;
  readonly source: TileSource;
  readonly attribution: string;
  readonly minZoom: number;
  readonly maxZoom: number;

  /** The resolved decoder function for converting pixels → elevation. */
  readonly decoder: ElevationDecoder;

  /** The decoder type name (for worker dispatch). */
  readonly decoderType: string;

  /**
   * Source string of a non-built-in decoder, sent to workers for on-demand
   * compilation. `null` for the three hard-coded names ('terrain-rgb',
   * 'mapbox', 'terrarium') which the worker already knows. Any other name
   * (registered via `registerDecoder`) or an inline function gets its
   * source shipped over so the worker can compile + cache a local copy.
   *
   * Note: compiled on the worker via `new Function`, so decoders must be
   * pure (no closure captures) and CSP must allow `unsafe-eval`.
   */
  readonly decoderSource: string | null;

  /** Per-layer display settings. */
  readonly display: ResolvedBaseLayerDisplay;

  /** Per-layer terrain display settings (isolines, color ramps). */
  readonly terrainDisplay: ResolvedTerrainDisplay;

  /** Whether this base layer is visible (active). */
  visible: boolean;

  constructor(options: BaseLayerOptions) {
    this.id = `base-${nextBaseLayerId++}`;
    this.layerName = options.layerName;
    this.source = options.layerSource;
    this.attribution = options.layerAttribution ?? options.layerSource.attribution ?? '';
    this.minZoom = options.minZoom ?? 0;
    this.maxZoom = options.maxZoom ?? 22;

    // Resolve decoder: string name → built-in, function → direct.
    // `decoderSource` carries the function body to the worker for any
    // decoder the worker doesn't know about natively.
    if (typeof options.decoder === 'function') {
      this.decoder = options.decoder;
      this.decoderType = 'custom';
      this.decoderSource = options.decoder.toString();
    } else {
      const name: DecoderName = options.decoder ?? 'terrain-rgb';
      this.decoder = resolveDecoder(name);
      this.decoderType = name;
      // Workers ship with the three hard-coded built-ins. Anything else
      // must be compiled from source in the worker.
      this.decoderSource =
        name === 'terrain-rgb' || name === 'mapbox' || name === 'terrarium'
          ? null
          : this.decoder.toString();
    }

    // Resolve display settings with defaults
    const ld = options.layerDisplay;
    this.display = {
      visible: ld?.visible ?? true,
      exaggeration: ld?.exaggeration ?? 1.0,
    };
    this.visible = this.display.visible;

    // Resolve terrain display settings with defaults
    const td = options.terrainDisplay;
    this.terrainDisplay = {
      isoplethInterval: td?.isoplethInterval ?? 100,
      isolineStrength: td?.isolineStrength ?? 1.5,
      isolineColor: td?.isolineColor ?? [0.12, 0.08, 0.04],
      rampInterpolationRange: td?.rampInterpolationRange ?? [0, 4000],
      rampDefaultElevation: td?.rampDefaultElevation ?? 'hypsometric',
      rampDefaultSlope: td?.rampDefaultSlope ?? 'viridis',
      rampDefaultAspect: td?.rampDefaultAspect ?? 'inferno',
    };
  }

  /**
   * Ensure the source is initialized.
   * Delegates to the source's ensureReady() method.
   */
  async ensureSourceReady(): Promise<void> {
    await this.source.ensureReady();
  }

  /**
   * Get the fetch URL for a tile coordinate.
   *
   * Clamps zoom to the source's max zoom and right-shifts x/y accordingly
   * so overzoom tiles (coord.z > source.maxZoom) map to valid parent tile
   * coordinates. Underzoom (coord.z < source.minZoom) has no single-tile
   * representation in the source's grid and is filtered out upstream by
   * TerrainRenderer.updateEffectiveZoomBounds — but a warning fires here
   * as a last-line safety check if one slips through.
   */
  getTileUrl(coord: TileCoord): string {
    if (coord.z < this.source.minZoom) {
      console.warn(
        `treelet: tile z=${coord.z} is below source.minZoom=${this.source.minZoom} ` +
        `for layer "${this.layerName}" — expect a 404. Upstream zoom bounds ` +
        `should have filtered this request.`,
      );
    }
    const clampedZ = Math.min(coord.z, this.source.maxZoom);
    const dz = coord.z - clampedZ;
    const clampedCoord: TileCoord = {
      z: clampedZ,
      x: coord.x >> dz,
      y: coord.y >> dz,
    };
    return this.source.getTileUrl(clampedCoord);
  }

  /**
   * Compute overzoom sub-region info for a tile coordinate.
   * Returns null if the tile is within the source's zoom range (no overzoom).
   * Otherwise returns the number of levels beyond source max and the
   * relative position within the parent tile at source max zoom.
   */
  getOverzoomRegion(coord: TileCoord): { dz: number; relX: number; relY: number } | null {
    if (coord.z <= this.source.maxZoom) return null;
    const dz = coord.z - this.source.maxZoom;
    const divisor = 1 << dz;
    return {
      dz,
      relX: coord.x % divisor,
      relY: coord.y % divisor,
    };
  }

}
