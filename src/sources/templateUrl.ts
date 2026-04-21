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

/**
 * Expand a pre-compiled URL template for a specific tile coordinate.
 * Handles `{z}`, `{x}`, `{y}`, and optional `{s}` subdomain rotation.
 */
export function expandTemplate(
  parts: string[],
  tokens: string[],
  coord: TileCoord,
  subdomains: string[],
): string {
  let url = parts[0];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'z') url += coord.z;
    else if (t === 'x') url += coord.x;
    else if (t === 'y') url += coord.y;
    else if (t === 's' && subdomains.length > 0) {
      url += subdomains[Math.abs(coord.x + coord.y) % subdomains.length];
    } else if (!_warnedTokens.has(t)) {
      _warnedTokens.add(t);
      console.warn(`treelet: unknown URL template token {${t}}`);
    }
    url += parts[i + 1];
  }
  return url;
}
