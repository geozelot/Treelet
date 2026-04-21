// ============================================================================
// treelet.js - Source Option Types
// ============================================================================

/** Shared base for all tile source options. */
export interface TileSourceOptions {
  url: string;
  accessToken?: string;
  tileSize?: number;
  minZoom?: number;
  maxZoom?: number;
  maxConcurrency?: number;
  attribution?: string;
}

/** Options for XYZ tile sources. */
export interface XYZSourceOptions extends TileSourceOptions {
  subdomains?: string[];
}

/** Options for WMTS tile sources. */
export interface WMTSSourceOptions extends TileSourceOptions {
  layers?: string;
  style?: string;
  tilematrixSet?: string;
  format?: string;
  subdomains?: string[];
}
