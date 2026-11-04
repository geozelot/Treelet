// ============================================================================
// treelet.js - Source Option Types
// ============================================================================

/** Shared base for all tile source options. */
export interface TileSourceOptions {
  url: string;
  /**
   * Access token. Substituted for `{accessToken}` / `{token}` in the URL
   * template, or appended as `access_token=<token>` when the template has
   * no placeholder.
   */
  accessToken?: string;
  tileSize?: number;
  minZoom?: number;
  maxZoom?: number;
  maxConcurrency?: number;
  attribution?: string;
  /** Extra HTTP headers for tile requests (e.g. `Authorization`). */
  headers?: Record<string, string>;
  /** Fetch credentials mode for tile requests. Default 'same-origin'. */
  credentials?: RequestCredentials;
  /** Referrer policy for tile requests. */
  referrerPolicy?: ReferrerPolicy;
  /**
   * Value for the `{r}` template token. `true` → '@2x' on high-DPI displays,
   * a string is used verbatim. Default: '' (no suffix).
   */
  retina?: boolean | string;
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
