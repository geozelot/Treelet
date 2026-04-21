// ============================================================================
// Tests for src/sources/templateUrl.ts
//
// The template compiler + expander is on the hot path — every tile URL goes
// through it. Correctness here is load-bearing for every XYZ/WMTS request.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { splitTemplate, expandTemplate } from '../../src/sources/templateUrl';

// ---------------------------------------------------------------------------
// splitTemplate
// ---------------------------------------------------------------------------

describe('splitTemplate', () => {
  it('returns a single literal part and no tokens for a plain string', () => {
    const { parts, tokens } = splitTemplate('https://example.com/tiles.png');
    expect(parts).toEqual(['https://example.com/tiles.png']);
    expect(tokens).toEqual([]);
  });

  it('splits a classic XYZ template', () => {
    const { parts, tokens } = splitTemplate(
      'https://{s}.tile.example.com/{z}/{x}/{y}.png',
    );
    expect(parts).toEqual([
      'https://',
      '.tile.example.com/',
      '/',
      '/',
      '.png',
    ]);
    expect(tokens).toEqual(['s', 'z', 'x', 'y']);
  });

  it('handles consecutive tokens with no literal text between them', () => {
    const { parts, tokens } = splitTemplate('{z}{x}{y}');
    // 4 parts (including leading/trailing empties) for 3 tokens
    expect(parts).toEqual(['', '', '', '']);
    expect(tokens).toEqual(['z', 'x', 'y']);
  });

  it('handles an empty template', () => {
    const { parts, tokens } = splitTemplate('');
    expect(parts).toEqual(['']);
    expect(tokens).toEqual([]);
  });

  it('preserves trailing and leading literals around tokens', () => {
    const { parts, tokens } = splitTemplate('prefix-{z}-suffix');
    expect(parts).toEqual(['prefix-', '-suffix']);
    expect(tokens).toEqual(['z']);
  });

  it('accepts arbitrary token names (not just z/x/y/s)', () => {
    // splitTemplate is agnostic; unknown tokens are reported at expansion time.
    const { parts, tokens } = splitTemplate('/{layer}/{z}/{apikey}');
    // Trailing empty part after the last token preserves the invariant
    // parts.length === tokens.length + 1.
    expect(parts).toEqual(['/', '/', '/', '']);
    expect(tokens).toEqual(['layer', 'z', 'apikey']);
  });

  it('maintains parts.length === tokens.length + 1 (invariant)', () => {
    const cases = [
      '',
      'literal',
      '{a}',
      '{a}{b}',
      'x{a}y{b}z',
      'https://{s}.example.com/{z}/{x}/{y}.png?key={key}',
    ];
    for (const c of cases) {
      const { parts, tokens } = splitTemplate(c);
      expect(parts.length).toBe(tokens.length + 1);
    }
  });
});

// ---------------------------------------------------------------------------
// expandTemplate
// ---------------------------------------------------------------------------

describe('expandTemplate', () => {
  beforeEach(() => {
    // Silence warnings about unknown tokens for cleaner output;
    // individual tests override this where relevant.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('substitutes z/x/y correctly', () => {
    const { parts, tokens } = splitTemplate(
      'https://tile.example.com/{z}/{x}/{y}.png',
    );
    const url = expandTemplate(parts, tokens, { z: 5, x: 10, y: 20 }, []);
    expect(url).toBe('https://tile.example.com/5/10/20.png');
  });

  it('handles z=0 (falsy zero must not be skipped)', () => {
    const { parts, tokens } = splitTemplate('{z}/{x}/{y}');
    expect(expandTemplate(parts, tokens, { z: 0, x: 0, y: 0 }, [])).toBe('0/0/0');
  });

  it('handles large tile coordinates', () => {
    const { parts, tokens } = splitTemplate('{z}/{x}/{y}');
    expect(expandTemplate(parts, tokens, { z: 22, x: 4194303, y: 4194303 }, [])).toBe(
      '22/4194303/4194303',
    );
  });

  it('rotates subdomains using Math.abs(x + y) % subdomains.length', () => {
    const { parts, tokens } = splitTemplate('https://{s}.tile.example.com/');
    const subs = ['a', 'b', 'c'];

    // (0 + 0) % 3 = 0 → 'a'
    expect(expandTemplate(parts, tokens, { z: 1, x: 0, y: 0 }, subs)).toBe(
      'https://a.tile.example.com/',
    );
    // (1 + 0) % 3 = 1 → 'b'
    expect(expandTemplate(parts, tokens, { z: 1, x: 1, y: 0 }, subs)).toBe(
      'https://b.tile.example.com/',
    );
    // (1 + 1) % 3 = 2 → 'c'
    expect(expandTemplate(parts, tokens, { z: 1, x: 1, y: 1 }, subs)).toBe(
      'https://c.tile.example.com/',
    );
    // (2 + 1) % 3 = 0 → 'a'
    expect(expandTemplate(parts, tokens, { z: 1, x: 2, y: 1 }, subs)).toBe(
      'https://a.tile.example.com/',
    );
  });

  it('emits nothing (and no error) for {s} when no subdomains are configured', () => {
    // When subdomains is empty, the `s` token falls through to the "unknown"
    // path — it is not substituted, but it also must not break URL assembly.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { parts, tokens } = splitTemplate('https://{s}example.com/');
    const url = expandTemplate(parts, tokens, { z: 1, x: 2, y: 3 }, []);
    expect(url).toBe('https://example.com/');
    expect(warn).toHaveBeenCalled();
  });

  it('warns exactly once per unknown token across many calls', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Use a unique token name so the module-level _warnedTokens set is clean
    // for this assertion even if other tests ran first.
    const unique = `t_${Math.random().toString(36).slice(2)}`;
    const { parts, tokens } = splitTemplate(`x/{${unique}}/y`);

    for (let i = 0; i < 10; i++) {
      expandTemplate(parts, tokens, { z: 1, x: 0, y: 0 }, []);
    }

    const relatedCalls = warn.mock.calls.filter(
      (args) => typeof args[0] === 'string' && (args[0] as string).includes(unique),
    );
    expect(relatedCalls.length).toBe(1);
  });

  it('preserves all literal segments when tokens are unknown', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Use a unique token; unknown tokens emit nothing at the token position,
    // but all literals between them must remain intact.
    const u = `u_${Math.random().toString(36).slice(2)}`;
    const { parts, tokens } = splitTemplate(`A/{${u}}/B/{z}/C`);
    const url = expandTemplate(parts, tokens, { z: 7, x: 0, y: 0 }, []);
    expect(url).toBe('A//B/7/C');
  });

  it('handles negative subdomain rotation defensively via Math.abs', () => {
    // Tile x,y are always >= 0 in practice, but Math.abs(x+y) guards against
    // any accidental negative input. This verifies the guard works.
    const { parts, tokens } = splitTemplate('{s}');
    const subs = ['a', 'b', 'c'];
    // We simulate the defensive behavior by casting to TileCoord-shaped arg
    const coord = { z: 0, x: -1, y: -1 } as const;
    const url = expandTemplate(parts, tokens, coord, subs);
    // Math.abs(-1 + -1) = 2 → subs[2] = 'c'
    expect(url).toBe('c');
  });

  it('expands every token occurrence (tokens can repeat)', () => {
    const { parts, tokens } = splitTemplate('{z}/{z}/{x}');
    expect(expandTemplate(parts, tokens, { z: 4, x: 9, y: 0 }, [])).toBe('4/4/9');
  });
});
