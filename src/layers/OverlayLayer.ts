// ============================================================================
// treelet.js - Overlay Layer
//
// GeoJSON features drawn on the terrain: lines and points draped over it,
// polygon fills as a coat, labels. Holds the data, style and display state;
// the overlay renderer draws it.
// ============================================================================

import type { Layer } from './Layer';
import type {
  OverlayLayerOptions,
  ResolvedOverlayLayerDisplay,
} from './types';
import type { GeoJSON, OverlayStyleSpec } from '../overlays/types';

/** Auto-incrementing ID counter for overlay layers. */
let nextOverlayLayerId = 0;

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

  /** The features drawn. */
  data: GeoJSON | null;
  style: OverlayStyleSpec | undefined;
  /** Polygon fills are rasterized into a coat (off once that coat is removed). */
  fills: boolean;

  constructor(options: OverlayLayerOptions) {
    this.id = `overlay-${nextOverlayLayerId++}`;
    this.layerName = options.layerName;
    this.attribution = options.layerAttribution ?? '';
    this.minZoom = options.minZoom ?? 0;
    this.maxZoom = options.maxZoom ?? 20;
    this.data = options.data ?? null;
    this.style = options.style;
    this.fills = options.fills ?? true;

    const ld = options.layerDisplay;
    this.display = {
      visible: ld?.visible ?? true,
      opacity: ld?.opacity ?? 1.0,
    };
    this.visible = this.display.visible;
  }
}
