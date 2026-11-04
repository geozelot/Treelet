// ============================================================================
// treelet.js - WMS Plugin Source Types
// ============================================================================

import type { TileSourceOptions } from '../../../src/sources/types';

/** Options for WMS tile sources. */
export interface WMSSourceOptions extends TileSourceOptions {
  layers: string;
  styles?: string;
  format?: string;
  /** Request CRS: EPSG:3857 (default), EPSG:900913, EPSG:4326 or CRS:84. */
  crs?: string;
  /** WMS version. 1.3.0 uses `CRS=` and lat/lon axis order for EPSG:4326. Default '1.1.1'. */
  version?: '1.1.1' | '1.3.0';
  /** Request transparent images. Default true. */
  transparent?: boolean;
}
