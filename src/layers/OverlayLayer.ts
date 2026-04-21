// ============================================================================
// treelet.js - Overlay Layer (Stub)
//
// Placeholder for future vector/marker overlay support.
// Implements the Layer interface but does no rendering.
// ============================================================================

import type { Layer } from './Layer';
import type {
  OverlayLayerOptions,
  ResolvedOverlayLayerDisplay,
} from './types';

/** Auto-incrementing ID counter for overlay layers. */
let nextOverlayLayerId = 0;

/**
 * Stub overlay layer for future vector / marker data.
 *
 * Currently implements the Layer interface without a tile source.
 * Will be expanded when vector overlay rendering is added.
 */
export class OverlayLayer implements Layer {
  readonly id: string;
  readonly layerName: string;
  readonly attribution: string;
  readonly minZoom: number;
  readonly maxZoom: number;

  /** Per-layer display settings. */
  readonly display: ResolvedOverlayLayerDisplay;

  /** Whether this overlay layer is visible. */
  visible: boolean;

  constructor(options: OverlayLayerOptions) {
    this.id = `overlay-${nextOverlayLayerId++}`;
    this.layerName = options.layerName;
    this.attribution = options.layerAttribution ?? '';
    this.minZoom = options.minZoom ?? 0;
    this.maxZoom = options.maxZoom ?? 20;

    const ld = options.layerDisplay;
    this.display = {
      visible: ld?.visible ?? true,
      opacity: ld?.opacity ?? 1.0,
    };
    this.visible = this.display.visible;
  }
}
