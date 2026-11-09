// ============================================================================
// Tests for src/workers/raster.ts
//
// Resampling defines the atlas texel convention every shader and the CPU
// sampler rely on; the mip builder decides how distant imagery looks.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  ELEVATION_NODATA,
  applyAlphaNodata,
  buildMipChain,
  hashString,
  resampleElevation,
  robustRange,
} from '../../src/workers/raster';

/** Source raster where value = column index (a horizontal ramp). */
function rampX(w: number, h: number): Float32Array {
  const a = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) a[j * w + i] = i;
  return a;
}

describe('resampleElevation', () => {
  it('is corner-aligned: first/last output texels sit on the tile edges', () => {
    const src = rampX(4, 4); // pixel centers at 0.5..3.5 → values 0..3
    const out = new Float32Array(5 * 5);
    resampleElevation(src, 4, 4, 5, null, out);
    // Edges clamp to the outermost pixel centers; the middle hits exactly between pixels 1 and 2.
    expect(out[0]).toBe(0);
    expect(out[4]).toBe(3);
    expect(out[2]).toBeCloseTo(1.5, 6);
  });

  it('copies a matching-size raster without distortion in the interior', () => {
    const src = rampX(256, 256);
    const out = new Float32Array(256 * 256);
    const stats = resampleElevation(src, 256, 256, 256, null, out);
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(255);
    expect(stats.valid).toBe(256 * 256);
    // Monotone ramp stays monotone.
    for (let i = 1; i < 256; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
  });

  it('extracts sub-regions so sibling overzoom tiles share their common edge', () => {
    const src = rampX(64, 64);
    const left = new Float32Array(17 * 17);
    const right = new Float32Array(17 * 17);
    resampleElevation(src, 64, 64, 17, { x: 0, y: 0, w: 0.5, h: 1 }, left);
    resampleElevation(src, 64, 64, 17, { x: 0.5, y: 0, w: 0.5, h: 1 }, right);
    for (let j = 0; j < 17; j++) {
      expect(left[j * 17 + 16]).toBeCloseTo(right[j * 17], 6);
    }
  });

  it('ignores NaN taps and marks fully invalid texels as nodata', () => {
    const src = new Float32Array([10, NaN, 30, 40]);
    const out3 = new Float32Array(3 * 3);
    resampleElevation(src, 2, 2, 3, null, out3);
    expect(out3[0]).toBe(10);
    expect(out3[1 * 3 + 1]).toBeCloseTo((10 + 30 + 40) / 3, 5); // center: NaN tap dropped, weights renormalized
    expect(out3[2]).toBe(ELEVATION_NODATA); // only tap is NaN
    const out = new Float32Array(2 * 2);
    const allNaN = new Float32Array([NaN, NaN, NaN, NaN]);
    const stats = resampleElevation(allNaN, 2, 2, 2, null, out);
    expect(stats.valid).toBe(0);
    expect(Array.from(out)).toEqual([ELEVATION_NODATA, ELEVATION_NODATA, ELEVATION_NODATA, ELEVATION_NODATA]);
  });
});

describe('applyAlphaNodata', () => {
  it('turns fully transparent pixels into NaN and leaves opaque ones alone', () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 0, 1, 2, 3, 255]);
    const elev = new Float32Array([-10000, 123]);
    applyAlphaNodata(pixels, elev);
    expect(elev[0]).toBeNaN();
    expect(elev[1]).toBe(123);
  });
});

describe('buildMipChain', () => {
  it('produces log2(size)+1 levels down to 1×1', () => {
    const levels = buildMipChain(new Uint8Array(8 * 8 * 4).fill(255), 8);
    expect(levels.map((l) => l.length)).toEqual([256, 64, 16, 4]);
  });

  it('averages in linear light (black/white checker → ~188, not 128)', () => {
    const size = 2;
    const img = new Uint8Array(size * size * 4);
    [0, 255, 255, 0].forEach((v, i) => img.set([v, v, v, 255], i * 4));
    const [, mip] = buildMipChain(img, size);
    expect(mip[0]).toBeGreaterThan(180);
    expect(mip[0]).toBeLessThan(195);
    expect(mip[3]).toBe(255);
  });

  it('weights color by alpha so transparent texels do not darken edges', () => {
    const img = new Uint8Array(2 * 2 * 4);
    img.set([255, 0, 0, 255], 0); // one opaque red texel, three transparent black
    const [, mip] = buildMipChain(img, 2);
    expect(mip[0]).toBe(255);
    expect(mip[3]).toBe(64);
  });
});

describe('hashString', () => {
  it('is stable and distributes different URLs', () => {
    expect(hashString('a/1/2/3.png')).toBe(hashString('a/1/2/3.png'));
    expect(hashString('a/1/2/3.png')).not.toBe(hashString('a/1/2/4.png'));
  });
});

describe('robust tile range', () => {
  it('a few spikes in the source data do not set the range; real relief does', () => {
    const S = 256;
    const src = new Float32Array(S * S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) src[j * S + i] = 600 + i * 8; // 600 … 2640 m
    // Bad source pixels (as found in the AWS Terrarium tiles)
    src[93 * S + 99] = 5596;
    src[94 * S + 99] = -6946;
    src[15 * S + 111] = -1329;
    const out = new Float32Array(S * S);
    const r = resampleElevation(src, S, S, S, null, out);
    // The raw range has the (resampled) spikes
    expect(r.min).toBeLessThan(-1000);
    expect(r.max).toBeGreaterThan(3000);
    expect(r.low).toBeGreaterThan(590);
    expect(r.low).toBeLessThan(620);
    expect(r.high).toBeGreaterThan(2620);
    expect(r.high).toBeLessThan(2650);
  });

  it('keeps the full range when there is nothing to trim', () => {
    const data = Float32Array.from([1, 2, 3]);
    expect(robustRange(data, 1, 3, 3)).toEqual([1, 3]);
  });
});
