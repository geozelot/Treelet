// ============================================================================
// Tests for option resolution / validation in src/core/Treelet.ts
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { resolveOptions } from '../../src/core/Treelet';
import { validateTileConfig, tilesForAtlasSize } from '../../src/core/constants';

const base = { initCenter: { lng: 11.4, lat: 47.3 }, initZoom: 10 };

describe('resolveOptions', () => {
  it('applies defaults', () => {
    const o = resolveOptions(base);
    expect(o.minZoom).toBe(0);
    expect(o.maxZoom).toBe(20);
    expect(o.mapDisplay.renderOnDemand).toBe(true);
    expect(o.mapDisplay.maxPixelRatio).toBe(2);
    expect(o.mapDisplay.tileCacheSize).toBe(256);
    expect(o.mapDisplay.horizonDistance).toBe(16);
    expect(o.mapDisplay.fog).toBe(true);
    expect(o.guiDisplay.glass).toBe(false);
    expect(resolveOptions({ ...base, guiDisplay: { glass: true } }).guiDisplay.glass).toBe(true);
    expect(o.workerCount).toBeGreaterThanOrEqual(1);
    expect(o.workerCount).toBeLessThanOrEqual(4);
  });

  it('rejects non-finite and inconsistent values', () => {
    expect(() => resolveOptions({ ...base, initCenter: { lng: NaN, lat: 0 } })).toThrow(/finite/);
    expect(() => resolveOptions({ ...base, minZoom: 12, maxZoom: 8 })).toThrow(/minZoom/);
    expect(() => resolveOptions({ ...base, mapDisplay: { minPitch: 80, maxPitch: 40 } })).toThrow(/minPitch/);
  });

  it('clamps soft limits', () => {
    const o = resolveOptions({ ...base, maxZoom: 30, initZoom: 99, initCenter: { lng: 200, lat: 89 } });
    expect(o.maxZoom).toBe(22);
    expect(o.initZoom).toBe(22);
    expect(o.initCenter.lng).toBe(180);
    expect(o.initCenter.lat).toBeLessThan(86);
    expect(resolveOptions({ ...base, mapDisplay: { horizonDistance: 1000 } }).mapDisplay.horizonDistance).toBe(64);
  });

  it('maps the deprecated atlasSize to a tile count, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveOptions({ ...base, mapDisplay: { atlasSize: 8192 } }).mapDisplay.tileCacheSize).toBe(1024);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/tileCacheSize/));
    // An explicit tileCacheSize wins.
    expect(resolveOptions({ ...base, mapDisplay: { atlasSize: 8192, tileCacheSize: 300 } }).mapDisplay.tileCacheSize).toBe(300);
    warn.mockRestore();
  });

  it('explains too-small caches in terms of tiles', () => {
    expect(() => resolveOptions({ ...base, mapDisplay: { atlasSize: 512 } })).toThrow(/holds 4 tiles.*tileCacheSize/);
    expect(() => resolveOptions({ ...base, mapDisplay: { tileCacheSize: 32 } })).toThrow(/tileCacheSize must be an integer in \[64, 2048\]/);
  });
});

describe('validateTileConfig', () => {
  it('rejects invalid sizes and segment counts', () => {
    expect(() => validateTileConfig(256, 200, 512, 12)).toThrow(/slotSize must be a power-of-two/);
    expect(() => validateTileConfig(63, 256, 512, 12)).toThrow(/tileCacheSize/);
    expect(() => validateTileConfig(256.5, 256, 512, 12)).toThrow(/tileCacheSize/);
    expect(() => validateTileConfig(256, 256, 512, 12, 63)).toThrow(/even/);
    expect(() => validateTileConfig(256, 256, 512, 0)).toThrow(/maxConcurrentFetches/);
    expect(() => validateTileConfig(256, 256, 512, 12, 64)).not.toThrow();
  });

  it('converts legacy atlas sizes', () => {
    expect(tilesForAtlasSize(4096, 256)).toBe(256);
    expect(() => tilesForAtlasSize(3000, 256)).toThrow(/power-of-two/);
  });
});
