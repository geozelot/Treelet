// ============================================================================
// treelet.js - Source Factory
//
// Creates concrete LayerSource instances from options.
// Separated from LayerSource to avoid circular imports
// (subclasses extend LayerSource, factory imports subclasses).
// ============================================================================

import type { LayerSourceOptions } from '../core/types';
import type { LayerSource } from './LayerSource';
import { XYZSource } from './XYZSource';
import { WMSSource } from './WMSSource';
import { WMTSSource } from './WMTSSource';

/**
 * Create a concrete {@link LayerSource} from options.
 *
 * Supports `'xyz'`, `'wms'`, and `'wmts'` source types.
 */
export function createSource(options: LayerSourceOptions): LayerSource {
  switch (options.type) {
    case 'xyz':
      return new XYZSource(options);
    case 'wms':
      return new WMSSource(options);
    case 'wmts':
      return new WMTSSource(options);
    default:
      throw new Error(
        `treelet: unsupported source type "${(options as LayerSourceOptions).type}"`,
      );
  }
}
