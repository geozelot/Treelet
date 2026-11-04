// ============================================================================
// Tests for option resolution / validation in src/core/Treelet.ts
// ============================================================================

import { describe, it, expect } from 'vitest';
import { resolveOptions } from '../../src/core/Treelet';
import { validateAtlasConfig } from '../../src/core/constants';

const base = { initCenter: { lng: 11.4, lat: 47.3 }, initZoom: 10 };

describe('resolveOptions', () => {
  it('applies defaults', () => {
    const o = resolveOptions(base);
    expect(o.minZoom).toBe(0);
    expect(o.maxZoom).toBe(20);
    expect(o.mapDisplay.renderOnDemand).toBe(true);
    expect(o.mapDisplay.maxPixelRatio).toBe(2);
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
  });
});

describe('validateAtlasConfig', () => {
  it('rejects invalid sizes and segment counts', () => {
    expect(() => validateAtlasConfig(3000, 256, 512, 12)).toThrow(/power-of-two/);
    expect(() => validateAtlasConfig(512, 256, 512, 12)).toThrow(/>= 64 slots/);
    expect(() => validateAtlasConfig(4096, 256, 512, 12, 63)).toThrow(/even/);
    expect(() => validateAtlasConfig(4096, 256, 512, 0)).toThrow(/maxConcurrentFetches/);
    expect(() => validateAtlasConfig(4096, 256, 512, 12, 64)).not.toThrow();
  });
});
