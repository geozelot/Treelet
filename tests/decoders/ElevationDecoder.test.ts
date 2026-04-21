// ============================================================================
// Tests for src/decoders/ElevationDecoder.ts
//
// Verifies the pluggable pixel → elevation decoders that replaced the old
// COG SampleFormat-based interpretation. Decoders run inside Web Workers so
// they must be pure, deterministic functions of (pixels, width, height).
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  RawRGBDecoder,
  MapboxDecoder,
  TerrariumDecoder,
  registerDecoder,
  getDecoder,
  resolveDecoder,
  type ElevationDecoder,
} from '../../src/decoders/ElevationDecoder';

// ---------------------------------------------------------------------------
// Helpers: build a flat RGBA pixel buffer
// ---------------------------------------------------------------------------

/**
 * Build a flat Uint8ClampedArray where each pixel is (r, g, b, a).
 */
function rgbaPixels(pixels: Array<[number, number, number, number?]>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    const [r, g, b, a = 255] = pixels[i];
    out[i * 4 + 0] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  }
  return out;
}

// ---------------------------------------------------------------------------
// RawRGBDecoder / MapboxDecoder (identical formula)
// ---------------------------------------------------------------------------

describe('RawRGBDecoder (Mapbox Terrain-RGB)', () => {
  it('decodes the baseline zero pixel to -10000m', () => {
    // height = -10000 + (0 * 65536 + 0 * 256 + 0) * 0.1 = -10000
    const pixels = rgbaPixels([[0, 0, 0]]);
    const result = RawRGBDecoder(pixels, 1, 1);

    expect(result).toBeInstanceOf(Float32Array);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeCloseTo(-10000, 4);
  });

  it('decodes the canonical Mapbox example correctly', () => {
    // The Mapbox documentation uses (R=1, G=134, B=160) → 1667.2 m
    // height = -10000 + (1 * 65536 + 134 * 256 + 160) * 0.1 = -300.0 m? Let's just compute:
    // 1*65536 + 134*256 + 160 = 65536 + 34304 + 160 = 100000
    // -10000 + 100000 * 0.1 = -10000 + 10000 = 0.0
    // So (1, 134, 160) → 0m (sea level). Useful sentinel.
    const pixels = rgbaPixels([[1, 134, 160]]);
    const result = RawRGBDecoder(pixels, 1, 1);
    expect(result[0]).toBeCloseTo(0, 4);
  });

  it('decodes a positive elevation', () => {
    // (R=1, G=134, B=170) → 1m above sea level
    // 1*65536 + 134*256 + 170 = 100010 → -10000 + 10001.0 = 1.0
    const pixels = rgbaPixels([[1, 134, 170]]);
    const result = RawRGBDecoder(pixels, 1, 1);
    expect(result[0]).toBeCloseTo(1.0, 4);
  });

  it('reaches the maximum value at (255, 255, 255)', () => {
    // height = -10000 + 16777215 * 0.1 = 1667721.5
    const pixels = rgbaPixels([[255, 255, 255]]);
    const result = RawRGBDecoder(pixels, 1, 1);
    expect(result[0]).toBeCloseTo(1667721.5, 1);
  });

  it('decodes every pixel in a multi-pixel tile', () => {
    const pixels = rgbaPixels([
      [0, 0, 0],       // -10000
      [1, 134, 160],   // 0
      [1, 134, 170],   // 1
      [255, 255, 255], // max
    ]);
    const result = RawRGBDecoder(pixels, 2, 2);

    expect(result).toHaveLength(4);
    expect(result[0]).toBeCloseTo(-10000, 4);
    expect(result[1]).toBeCloseTo(0, 4);
    expect(result[2]).toBeCloseTo(1.0, 4);
    expect(result[3]).toBeCloseTo(1667721.5, 1);
  });

  it('ignores the alpha channel', () => {
    // Two pixels with the same RGB but different alpha
    const pixels = rgbaPixels([
      [1, 134, 160, 255],
      [1, 134, 160, 0],
    ]);
    const result = RawRGBDecoder(pixels, 2, 1);
    expect(result[0]).toBeCloseTo(0, 4);
    expect(result[1]).toBeCloseTo(0, 4);
  });

  it('produces an empty array for zero-size tiles', () => {
    const result = RawRGBDecoder(new Uint8ClampedArray(0), 0, 0);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result).toHaveLength(0);
  });

  it('MapboxDecoder is the same function as RawRGBDecoder', () => {
    expect(MapboxDecoder).toBe(RawRGBDecoder);
  });
});

// ---------------------------------------------------------------------------
// TerrariumDecoder
// ---------------------------------------------------------------------------

describe('TerrariumDecoder', () => {
  it('decodes zero to -32768m (deep floor)', () => {
    // height = (0 * 256 + 0 + 0 / 256) - 32768 = -32768
    const pixels = rgbaPixels([[0, 0, 0]]);
    const result = TerrariumDecoder(pixels, 1, 1);
    expect(result[0]).toBeCloseTo(-32768, 4);
  });

  it('decodes (128, 0, 0) to 0m (sea level)', () => {
    // height = 128*256 + 0 + 0/256 - 32768 = 32768 - 32768 = 0
    const pixels = rgbaPixels([[128, 0, 0]]);
    const result = TerrariumDecoder(pixels, 1, 1);
    expect(result[0]).toBeCloseTo(0, 4);
  });

  it('decodes integer elevations via the G channel', () => {
    // (128, 1, 0) → 32768 + 1 - 32768 = 1 m
    const pixels = rgbaPixels([[128, 1, 0]]);
    const result = TerrariumDecoder(pixels, 1, 1);
    expect(result[0]).toBeCloseTo(1, 4);
  });

  it('decodes fractional elevations via the B channel', () => {
    // (128, 0, 128) → 0 + 0 + 128/256 = 0.5 m
    const pixels = rgbaPixels([[128, 0, 128]]);
    const result = TerrariumDecoder(pixels, 1, 1);
    expect(result[0]).toBeCloseTo(0.5, 4);
  });

  it('decodes the maximum value', () => {
    // (255, 255, 255) → 65535 + 255/256 - 32768 ≈ 32767.996
    const pixels = rgbaPixels([[255, 255, 255]]);
    const result = TerrariumDecoder(pixels, 1, 1);
    expect(result[0]).toBeCloseTo(32767.996, 2);
  });

  it('decodes a small multi-pixel tile', () => {
    const pixels = rgbaPixels([
      [128, 0, 0],     // 0
      [128, 100, 0],   // 100
      [128, 1, 128],   // 1.5
      [0, 0, 0],       // -32768
    ]);
    const result = TerrariumDecoder(pixels, 2, 2);
    expect(result[0]).toBeCloseTo(0, 4);
    expect(result[1]).toBeCloseTo(100, 4);
    expect(result[2]).toBeCloseTo(1.5, 4);
    expect(result[3]).toBeCloseTo(-32768, 4);
  });

  it('ignores the alpha channel', () => {
    const pixels = rgbaPixels([
      [128, 1, 0, 255],
      [128, 1, 0, 42],
    ]);
    const result = TerrariumDecoder(pixels, 2, 1);
    expect(result[0]).toBeCloseTo(1, 4);
    expect(result[1]).toBeCloseTo(1, 4);
  });
});

// ---------------------------------------------------------------------------
// Decoder Registry: getDecoder / registerDecoder / resolveDecoder
// ---------------------------------------------------------------------------

describe('decoder registry', () => {
  it('getDecoder returns the built-ins by name', () => {
    expect(getDecoder('terrain-rgb')).toBe(RawRGBDecoder);
    expect(getDecoder('mapbox')).toBe(MapboxDecoder);
    expect(getDecoder('terrarium')).toBe(TerrariumDecoder);
  });

  it('getDecoder returns undefined for unknown names', () => {
    expect(getDecoder('nonexistent')).toBeUndefined();
  });

  it('registerDecoder makes a custom decoder retrievable by name', () => {
    const custom: ElevationDecoder = () => new Float32Array([42]);
    registerDecoder('test-decoder-registry', custom);

    expect(getDecoder('test-decoder-registry')).toBe(custom);
  });

  it('registerDecoder overwrites an existing registration', () => {
    const first: ElevationDecoder = () => new Float32Array([1]);
    const second: ElevationDecoder = () => new Float32Array([2]);

    registerDecoder('test-decoder-overwrite', first);
    expect(getDecoder('test-decoder-overwrite')).toBe(first);

    registerDecoder('test-decoder-overwrite', second);
    expect(getDecoder('test-decoder-overwrite')).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// resolveDecoder
// ---------------------------------------------------------------------------

describe('resolveDecoder', () => {
  it('resolves "terrain-rgb" as the default when called with no argument', () => {
    expect(resolveDecoder()).toBe(RawRGBDecoder);
  });

  it('resolves "terrain-rgb" as the default when called with undefined', () => {
    expect(resolveDecoder(undefined)).toBe(RawRGBDecoder);
  });

  it('resolves each built-in decoder name', () => {
    expect(resolveDecoder('terrain-rgb')).toBe(RawRGBDecoder);
    expect(resolveDecoder('mapbox')).toBe(MapboxDecoder);
    expect(resolveDecoder('terrarium')).toBe(TerrariumDecoder);
  });

  it('resolves a previously registered custom decoder by name', () => {
    const custom: ElevationDecoder = () => new Float32Array([7, 8, 9]);
    registerDecoder('test-decoder-resolve', custom);

    expect(resolveDecoder('test-decoder-resolve')).toBe(custom);
  });

  it('throws a helpful error for unknown decoder names', () => {
    expect(() => resolveDecoder('definitely-not-registered')).toThrow(
      /unknown elevation decoder "definitely-not-registered"/,
    );
    expect(() => resolveDecoder('definitely-not-registered')).toThrow(/registerDecoder/);
  });
});
