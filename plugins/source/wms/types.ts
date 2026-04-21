// ============================================================================
// treelet.js - WMS Plugin Source Types
// ============================================================================

import type { TileSourceOptions } from '../../../src/sources/types';

/** Options for WMS tile sources. */
export interface WMSSourceOptions extends TileSourceOptions {
  layers: string;
  format?: string;
  crs?: string;
}
