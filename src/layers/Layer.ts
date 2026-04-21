// ============================================================================
// treelet.js - Layer Interface
//
// Common interface for all layer kinds (base, drape, overlay).
// ============================================================================

import type { TileSource } from '../sources/TileSource';

/**
 * Common interface for all map layers.
 *
 * Implementations: BaseLayer, DrapeLayer, OverlayLayer.
 */
export interface Layer {
  /** Stable internal ID (auto-generated). */
  readonly id: string;

  /** Human-readable name. */
  readonly layerName: string;

  /** Tile source providing data for this layer (absent for overlay stubs). */
  readonly source?: TileSource;

  /** Attribution string (resolved: layerAttribution ?? source.attribution). */
  readonly attribution: string;

  /** Zoom range for visibility. */
  readonly minZoom: number;
  readonly maxZoom: number;

  /** Whether this layer is visible. */
  visible: boolean;
}
