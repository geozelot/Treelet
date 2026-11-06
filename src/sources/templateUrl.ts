// ============================================================================
// treelet.js - URL Template Utilities
//
// Shared template splitting + expansion used by XYZSource and WMTSSource.
// ============================================================================

import type { TileCoord } from '../core/types';

/** Tracks unknown tokens that have already been warned about (avoid per-tile spam). */
const _warnedTokens = new Set<string>();

/**
 * Pre-compiled URL template: literal segments interleaved with token names.
 * For "https://{s}.tile.example.com/{z}/{x}/{y}.png":
 *   parts  = ["https://", ".tile.example.com/", "/", "/", ".png"]
 *   tokens = ["s", "z", "x", "y"]
 */
export interface CompiledTemplate {
  parts: string[];
  tokens: string[];
}

/** Values for optional template tokens. */
export interface TemplateContext {
  /** Substituted for `{accessToken}` / `{token}`. */
  accessToken?: string;
  /** Substituted for `{r}` (e.g. '@2x' on high-DPI displays, '' otherwise). */
  retina?: string;
}

/**
 * Split a URL template with `{token}` placeholders into literal parts
 * and token names for fast per-tile concatenation.
 */
export function splitTemplate(template: string): CompiledTemplate {
  const parts: string[] = [];
  const tokens: string[] = [];
  let last = 0;
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    parts.push(template.slice(last, m.index));
    tokens.push(m[1]);
    last = m.index + m[0].length;
  }
  parts.push(template.slice(last));
  return { parts, tokens };
}

/** Bing-style quadkey for a tile ('' at zoom 0). */
export function tileQuadkey(coord: TileCoord): string {
  let key = '';
  for (let i = coord.z; i > 0; i--) {
    const mask = 1 << (i - 1);
    let digit = 0;
    if (coord.x & mask) digit += 1;
    if (coord.y & mask) digit += 2;
    key += digit;
  }
  return key;
}

/**
 * Expand a pre-compiled URL template for a specific tile coordinate.
 *
 * Tokens: `{z}`, `{x}`, `{y}`, `{-y}` (TMS row), `{s}` (subdomain),
 * `{quadkey}`, `{r}` (retina suffix), `{accessToken}` / `{token}`.
 */
export function expandTemplate(
  parts: string[],
  tokens: string[],
  coord: TileCoord,
  subdomains: string[],
  context?: TemplateContext,
): string {
  let url = parts[0];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'z') url += coord.z;
    else if (t === 'x') url += coord.x;
    else if (t === 'y') url += coord.y;
    else if (t === '-y') url += (1 << coord.z) - 1 - coord.y;
    else if (t === 's' && subdomains.length > 0) {
      url += subdomains[Math.abs(coord.x + coord.y) % subdomains.length];
    } else if (t === 'quadkey') url += tileQuadkey(coord);
    else if (t === 'r') url += context?.retina ?? '';
    else if ((t === 'accessToken' || t === 'token') && context?.accessToken !== undefined) {
      url += encodeURIComponent(context.accessToken);
    } else if (!_warnedTokens.has(t)) {
      _warnedTokens.add(t);
      console.warn(`treelet: unknown URL template token {${t}}`);
    }
    url += parts[i + 1];
  }
  return url;
}

/** Whether a compiled template contains an access-token placeholder. */
export function hasTokenPlaceholder(tokens: string[]): boolean {
  return tokens.includes('accessToken') || tokens.includes('token');
}

/** Append a query parameter to a URL (handles existing query strings and fragments). */
export function appendQueryParam(url: string, name: string, value: string): string {
  const hash = url.indexOf('#');
  const base = hash >= 0 ? url.slice(0, hash) : url;
  const frag = hash >= 0 ? url.slice(hash) : '';
  const sep = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
  return `${base}${sep}${encodeURIComponent(name)}=${encodeURIComponent(value)}${frag}`;
}
