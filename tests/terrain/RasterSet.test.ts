// ============================================================================
// Tests for src/terrain/RasterSet.ts: slots, uploads, the shader transform
// and CPU sampling.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { FloatType, RedFormat, RGBAFormat } from 'three';
import { RasterSet, MAX_RASTERS } from '../../src/terrain/RasterSet';
import { RASTER_NODATA } from '../../src/analysis/grid';

const bounds = { west: 100, south: 50, east: 104, north: 52 };

describe('RasterSet', () => {
  it('binds value grids as R32F with nodata replaced; one array serves the GPU and point queries', () => {
    const set = new RasterSet();
    const src = Float32Array.from([5, NaN]);
    const e = set.bind('a', { width: 2, height: 1, data: src, bounds });
    expect(set.slotOf('a')).toBe(0);
    expect(e.texture.format).toBe(RedFormat);
    expect(e.texture.type).toBe(FloatType);
    expect(e.texture.image.data).toBe(e.values);
    expect(e.values![1]).toBe(Math.fround(RASTER_NODATA));
    expect(src[1]).toBeNaN(); // the caller's array is left alone
    expect(e.range).toEqual([5, 5]);
    const n = set.bind('b', { width: 1, height: 1, data: Float32Array.from([-1]), bounds, nodata: -1 });
    expect(n.values![0]).toBe(Math.fround(RASTER_NODATA));
    expect(n.range).toBeNull();
  });

  it('matches nodata as the float32 it is stored as', () => {
    const set = new RasterSet();
    for (const nodata of [-3.4e38, -9999.9, 0.1]) {
      const e = set.bind('nd', { width: 2, height: 1, data: Float32Array.from([nodata, 7]), bounds, nodata });
      expect(e.values![0]).toBe(Math.fround(RASTER_NODATA));
      expect(e.range).toEqual([7, 7]);
      expect(set.sample('nd', 101, 51)).toBeNull(); // on the nodata cell
      expect(set.sample('nd', 103, 51)).toBe(7);
    }
  });

  it('binds RGBA images as color rasters with premultiplied alpha', () => {
    const set = new RasterSet();
    const e = set.bind('img', { width: 2, height: 1, data: new Uint8ClampedArray([200, 100, 50, 255, 200, 100, 50, 128]), bounds });
    expect(e.color).toBe(true);
    expect(e.texture.format).toBe(RGBAFormat);
    expect([...(e.texture.image.data as Uint8Array)]).toEqual([200, 100, 50, 255, 100, 50, 25, 128]);
    expect(set.sample('img', 101, 51)).toBeNull();
  });

  it('refuses a fifth raster, bad sizes and oversized grids; rebinding an id reuses its slot', () => {
    const set = new RasterSet(16);
    for (let i = 0; i < MAX_RASTERS; i++) set.bind(`r${i}`, { width: 1, height: 1, data: new Float32Array(1), bounds });
    expect(() => set.bind('extra', { width: 1, height: 1, data: new Float32Array(1), bounds })).toThrow(/at most 4/);
    set.bind('r2', { width: 2, height: 1, data: new Float32Array(2), bounds });
    expect(set.slotOf('r2')).toBe(2);
    expect(set.release('r1')).toBe(true);
    expect(set.release('r1')).toBe(false);
    expect(set.bind('extra', { width: 1, height: 1, data: new Float32Array(1), bounds }).id).toBe('extra');
    expect(set.slotOf('extra')).toBe(1);
    const fresh = new RasterSet(16);
    expect(() => fresh.bind('x', { width: 2, height: 2, data: new Float32Array(3), bounds })).toThrow(/expected 4/);
    expect(() => fresh.bind('x', { width: 32, height: 1, data: new Float32Array(32), bounds })).toThrow(/texture size limit/);
    expect(() => fresh.bind('x', { width: 1, height: 1, data: new Float32Array(1), bounds: { ...bounds, east: 99 } })).toThrow(/empty/);
  });

  it('hands the shader its NW corner relative to the origin and texels per world unit', () => {
    const set = new RasterSet();
    set.bind('a', { width: 8, height: 4, data: new Float32Array(32), bounds });
    const [u, empty] = set.uniforms(101, 50.5);
    expect(empty).toBeNull();
    expect(u).toMatchObject({ offsetX: -1, offsetY: 1.5, scaleX: 2, scaleY: 2, width: 8, height: 4, color: false });
  });

  it('samples like the shader: cell centers, bilinear between them, null outside', () => {
    const set = new RasterSet();
    // 2×2 cells over the bounds: west column 0 / 20, east column 10 / 30
    set.bind('a', { width: 2, height: 2, data: Float32Array.from([0, 10, 20, 30]), bounds });
    expect(set.sample('a', 101, 51.5)).toBe(0); // NW cell center
    expect(set.sample('a', 103, 50.5)).toBe(30); // SE cell center
    expect(set.sample('a', 102, 51)).toBe(15); // middle
    expect(set.sample('a', 99, 51)).toBeNull();
    expect(set.sample('nope', 102, 51)).toBeNull();
  });
});
