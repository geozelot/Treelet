// ============================================================================
// Tests for src/sources/XYZSource.ts
// ============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { XYZSource } from '../../src/sources/XYZSource';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('XYZSource constructor defaults', () => {
  it('applies defaults when only a URL template is provided', () => {
    const src = new XYZSource({
      url: 'https://tile.example.com/{z}/{x}/{y}.png',
    });

    expect(src.tileSize).toBe(256);
    expect(src.minZoom).toBe(0);
    expect(src.maxZoom).toBe(22);
    expect(src.attribution).toBe('');
    expect(src.maxConcurrency).toBe(12);
  });

  it('respects all user-provided options', () => {
    const src = new XYZSource({
      url: 'https://t.example.com/{z}/{x}/{y}.png',
      tileSize: 512,
      minZoom: 3,
      maxZoom: 15,
      attribution: '© Example',
      maxConcurrency: 4,
    });

    expect(src.tileSize).toBe(512);
    expect(src.minZoom).toBe(3);
    expect(src.maxZoom).toBe(15);
    expect(src.attribution).toBe('© Example');
    expect(src.maxConcurrency).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// URL generation
// ---------------------------------------------------------------------------

describe('XYZSource.getTileUrl', () => {
  it('substitutes z/x/y tokens', () => {
    const src = new XYZSource({
      url: 'https://tile.example.com/{z}/{x}/{y}.png',
    });
    expect(src.getTileUrl({ z: 4, x: 7, y: 11 })).toBe(
      'https://tile.example.com/4/7/11.png',
    );
  });

  it('rotates subdomains when {s} is present and subdomains are provided', () => {
    const src = new XYZSource({
      url: 'https://{s}.tile.example.com/{z}/{x}/{y}.png',
      subdomains: ['a', 'b', 'c'],
    });

    expect(src.getTileUrl({ z: 1, x: 0, y: 0 })).toBe(
      'https://a.tile.example.com/1/0/0.png',
    );
    expect(src.getTileUrl({ z: 1, x: 1, y: 1 })).toBe(
      'https://c.tile.example.com/1/1/1.png',
    );
  });

  it('falls back gracefully when {s} is present but no subdomains are configured', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const src = new XYZSource({
      url: 'https://{s}.tile.example.com/{z}/{x}/{y}.png',
    });
    // The {s} token is silently dropped; the rest of the URL is still usable.
    expect(src.getTileUrl({ z: 1, x: 2, y: 3 })).toBe(
      'https://.tile.example.com/1/2/3.png',
    );
  });

  it('is deterministic: same coord produces the same URL every time', () => {
    const src = new XYZSource({
      url: 'https://{s}.tile.example.com/{z}/{x}/{y}.png',
      subdomains: ['a', 'b', 'c'],
    });
    const coord = { z: 8, x: 135, y: 98 };
    const first = src.getTileUrl(coord);
    for (let i = 0; i < 10; i++) {
      expect(src.getTileUrl(coord)).toBe(first);
    }
  });
});

// ---------------------------------------------------------------------------
// Lifecycle + scheduling
// ---------------------------------------------------------------------------

describe('XYZSource lifecycle', () => {
  it('ensureReady resolves immediately (no network)', async () => {
    const src = new XYZSource({ url: '{z}/{x}/{y}' });
    await expect(src.ensureReady()).resolves.toBeUndefined();
  });

  it('getSchedulingHints reports default (non-deferred) scheduling', () => {
    const src = new XYZSource({ url: '{z}/{x}/{y}' });
    const hints = src.getSchedulingHints();
    expect(hints.maxConcurrentFetches).toBe(12);
    expect(hints.deferWrites).toBe(false);
  });

  it('getSchedulingHints reflects a custom maxConcurrency', () => {
    const src = new XYZSource({ url: '{z}/{x}/{y}', maxConcurrency: 2 });
    expect(src.getSchedulingHints().maxConcurrentFetches).toBe(2);
  });
});
