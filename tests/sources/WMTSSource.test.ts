// ============================================================================
// Tests for src/sources/WMTSSource.ts
//
// WMTS has two access patterns — RESTful (URL template) and KVP
// (query-string GetTile). Mode detection hinges on the presence of a
// `{z}` placeholder in the base URL.
// ============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { WMTSSource } from '../../src/sources/WMTSSource';

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Constructor defaults
// ---------------------------------------------------------------------------

describe('WMTSSource constructor defaults', () => {
  it('uses sensible defaults when only a URL is given', () => {
    const src = new WMTSSource({ url: 'https://example.com/wmts' });
    expect(src.tileSize).toBe(256);
    expect(src.minZoom).toBe(0);
    expect(src.maxZoom).toBe(22);
    expect(src.attribution).toBe('');
    expect(src.maxConcurrency).toBe(12);
  });

  it('respects all user-provided options', () => {
    const src = new WMTSSource({
      url: 'https://example.com/wmts',
      tileSize: 512,
      minZoom: 5,
      maxZoom: 14,
      attribution: '© WMTS',
      maxConcurrency: 6,
    });
    expect(src.tileSize).toBe(512);
    expect(src.minZoom).toBe(5);
    expect(src.maxZoom).toBe(14);
    expect(src.attribution).toBe('© WMTS');
    expect(src.maxConcurrency).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// RESTful mode (URL contains {z})
// ---------------------------------------------------------------------------

describe('WMTSSource RESTful mode', () => {
  it('detects RESTful mode from a {z} placeholder and substitutes tokens', () => {
    const src = new WMTSSource({
      url: 'https://example.com/wmts/dem/default/EPSG3857/{z}/{y}/{x}.png',
    });
    expect(src.getTileUrl({ z: 7, x: 42, y: 88 })).toBe(
      'https://example.com/wmts/dem/default/EPSG3857/7/88/42.png',
    );
  });

  it('supports subdomain rotation in RESTful mode', () => {
    const src = new WMTSSource({
      url: 'https://{s}.example.com/wmts/{z}/{y}/{x}.png',
      subdomains: ['a', 'b'],
    });
    // (0 + 0) % 2 = 0 → 'a'
    expect(src.getTileUrl({ z: 1, x: 0, y: 0 })).toBe(
      'https://a.example.com/wmts/1/0/0.png',
    );
    // (1 + 0) % 2 = 1 → 'b'
    expect(src.getTileUrl({ z: 1, x: 1, y: 0 })).toBe(
      'https://b.example.com/wmts/1/0/1.png',
    );
  });
});

// ---------------------------------------------------------------------------
// KVP mode (URL without {z} placeholder)
// ---------------------------------------------------------------------------

describe('WMTSSource KVP mode', () => {
  it('builds a full KVP GetTile URL with defaults', () => {
    const src = new WMTSSource({
      url: 'https://example.com/wmts',
      layers: 'dem',
    });

    const url = src.getTileUrl({ z: 5, x: 9, y: 11 });

    // Expect key parameters to be present in the KVP URL
    expect(url.startsWith('https://example.com/wmts?')).toBe(true);
    expect(url).toContain('SERVICE=WMTS');
    expect(url).toContain('REQUEST=GetTile');
    expect(url).toContain('VERSION=1.0.0');
    expect(url).toContain('LAYER=dem');
    expect(url).toContain('STYLE=default');
    expect(url).toContain('TILEMATRIXSET=EPSG:3857');
    expect(url).toContain('FORMAT=image/png');
    expect(url).toContain('TILEMATRIX=5');
    expect(url).toContain('TILEROW=11');
    expect(url).toContain('TILECOL=9');
  });

  it('honors explicit style / tilematrixSet / format options', () => {
    const src = new WMTSSource({
      url: 'https://example.com/wmts',
      layers: 'elevation',
      style: 'grey',
      tilematrixSet: 'GoogleMapsCompatible',
      format: 'image/jpeg',
    });
    const url = src.getTileUrl({ z: 0, x: 0, y: 0 });
    expect(url).toContain('STYLE=grey');
    expect(url).toContain('TILEMATRIXSET=GoogleMapsCompatible');
    expect(url).toContain('FORMAT=image/jpeg');
  });

  it('uses "&" as separator when the base URL already contains a query string', () => {
    const src = new WMTSSource({
      url: 'https://example.com/wmts?token=secret',
      layers: 'dem',
    });
    const url = src.getTileUrl({ z: 2, x: 1, y: 1 });
    // Must preserve the original query string and extend with '&', not '?'
    expect(url.startsWith('https://example.com/wmts?token=secret&SERVICE=WMTS')).toBe(true);
    // Ensure we don't end up with two '?'
    const questionMarks = url.match(/\?/g) ?? [];
    expect(questionMarks.length).toBe(1);
  });

  it('places TILEMATRIX/TILEROW/TILECOL at the end for each tile', () => {
    const src = new WMTSSource({ url: 'https://example.com/wmts', layers: 'dem' });
    const url = src.getTileUrl({ z: 3, x: 4, y: 5 });
    expect(url.endsWith('&TILEMATRIX=3&TILEROW=5&TILECOL=4')).toBe(true);
  });

  it('defaults LAYER to the empty string if omitted', () => {
    // The constructor falls back to '' for missing layers.
    const src = new WMTSSource({ url: 'https://example.com/wmts' });
    const url = src.getTileUrl({ z: 0, x: 0, y: 0 });
    expect(url).toContain('LAYER=&');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle + scheduling
// ---------------------------------------------------------------------------

describe('WMTSSource lifecycle', () => {
  it('ensureReady resolves immediately', async () => {
    const src = new WMTSSource({ url: 'https://example.com/wmts' });
    await expect(src.ensureReady()).resolves.toBeUndefined();
  });

  it('getSchedulingHints reports non-deferred scheduling', () => {
    const src = new WMTSSource({ url: 'https://example.com/wmts' });
    const hints = src.getSchedulingHints();
    expect(hints.deferWrites).toBe(false);
    expect(hints.maxConcurrentFetches).toBe(12);
  });
});
