// ============================================================================
// treelet.js - Drape Layer
//
// A drape layer binds a raster imagery source and per-layer display settings
// (opacity, blend mode, hillshade strength) to the terrain. Fetching and
// GPU residency are handled by TerrainRenderer + UnifiedDrapeAtlas — the
// layer itself is a thin configuration + identity object.
// ============================================================================

import type { TileSource } from '../sources/TileSource';
import type { Layer } from './Layer';
import type {
  DrapeLayerOptions,
  ResolvedDrapeLayerDisplay,
} from './types';

/** Auto-incrementing ID counter for drape layers. */
let nextDrapeLayerId = 0;

/**
 * Drape layer for raster imagery overlaid on terrain meshes.
 *
 * Each drape layer:
 *   - References a tile source (XYZ, WMTS, or WMS)
 *   - Carries per-layer display settings (opacity, blend mode, hillshade)
 *   - Declares an LOD offset that biases non-center rings toward finer detail
 *
 * Multiple drape layers may be registered; TerrainRenderer activates one at
 * a time. When a layer becomes active, its source is fetched through the
 * same pipeline that feeds the elevation atlas, with results landing in
 * the shared UnifiedDrapeAtlas.
 */
export class DrapeLayer implements Layer {
  readonly id: string;
  readonly layerName: string;
  readonly source: TileSource;
  readonly attribution: string;
  readonly minZoom: number;
  readonly maxZoom: number;
  /** LOD offset: 1 = match elevation zoom, 2 = one finer, 3 = two finer. */
  readonly lodOffset: number;

  /** Per-layer display settings. */
  readonly display: ResolvedDrapeLayerDisplay;

  /** Whether this drape layer is visible (active). */
  visible: boolean;

  constructor(options: DrapeLayerOptions) {
    this.id = `drape-${nextDrapeLayerId++}`;
    this.layerName = options.layerName;
    this.source = options.layerSource;
    this.attribution = options.layerAttribution ?? options.layerSource.attribution ?? '';
    this.minZoom = options.minZoom ?? 0;
    this.maxZoom = options.maxZoom ?? 22;
    this.lodOffset = Math.max(1, Math.min(3, options.lodOffset ?? 1));

    // Resolve display settings with defaults
    const ld = options.layerDisplay;
    this.display = {
      visible: ld?.visible ?? true,
      opacity: ld?.opacity ?? 1.0,
      blendMode: ld?.blendMode ?? 'hillshade',
      hillshadeStrength: ld?.hillshadeStrength ?? 0.5,
    };
    this.visible = this.display.visible;
  }

  /**
   * Ensure the source is initialized.
   * Delegates to the source's ensureReady() method.
   */
  async ensureSourceReady(): Promise<void> {
    await this.source.ensureReady();
  }
}
