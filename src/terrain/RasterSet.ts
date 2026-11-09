// ============================================================================
// treelet.js - Raster Set
//
// The rasters the terrain shader can sample (up to MAX_RASTERS at once):
// value grids (R32F, nodata as RASTER_NODATA, filtered in the shader) and
// color images (RGBA8 with premultiplied alpha, so linear filtering doesn't
// darken edges; the shader un-premultiplies). Each raster has world-plane
// bounds; the shader receives them relative to the floating render origin.
// A value grid's single array serves both the texture and point queries
// (with the shader's filter).
// ============================================================================

import {
  DataTexture,
  RedFormat,
  RGBAFormat,
  FloatType,
  UnsignedByteType,
  NearestFilter,
  LinearFilter,
  ClampToEdgeWrapping,
  NoColorSpace,
} from 'three';
import { MAX_RASTERS, type RasterUniform } from '../shaders/TerrainMaterial';
import { RASTER_NODATA, isGridValue, sampleGrid } from '../analysis/grid';

export { MAX_RASTERS };

/** World-plane rectangle (x east, y north). */
export interface WorldRect {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface RasterInput {
  width: number;
  height: number;
  /** Values (width·height, NaN or `nodata` = no data) or RGBA bytes (width·height·4, straight alpha), row 0 to the north. */
  data: Float32Array | Uint8Array | Uint8ClampedArray;
  bounds: WorldRect;
  /** A value meaning no data (compared as the float32 it is stored as). */
  nodata?: number;
}

export interface RasterEntry {
  id: string;
  width: number;
  height: number;
  color: boolean;
  bounds: WorldRect;
  texture: DataTexture;
  /** A value grid's values (RASTER_NODATA = no data), shared with the texture; null for color rasters. */
  values: Float32Array | null;
  /** Range of the finite values (value grids), or null. */
  range: [number, number] | null;
}

export class RasterSet {
  private readonly slots: Array<RasterEntry | null> = new Array(MAX_RASTERS).fill(null);

  constructor(private readonly maxTextureSize = 4096) {}

  /** Slot of a bound raster, or -1. */
  slotOf(id: string): number {
    return this.slots.findIndex((s) => s?.id === id);
  }

  get(id: string): RasterEntry | undefined {
    return this.slots.find((s) => s?.id === id) ?? undefined;
  }

  /** Number of bound rasters. */
  get size(): number {
    return this.slots.filter(Boolean).length;
  }

  /**
   * Bind a raster to `id` (replacing one bound to the same id). Throws when
   * all slots are taken, the data doesn't match the size, or the raster is
   * larger than the GPU allows.
   */
  bind(id: string, input: RasterInput): RasterEntry {
    const { width, height, data } = input;
    if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) {
      throw new Error(`treelet: raster size must be positive integers, got ${width}×${height}`);
    }
    if (width > this.maxTextureSize || height > this.maxTextureSize) {
      throw new Error(`treelet: raster ${width}×${height} exceeds the GPU's texture size limit (${this.maxTextureSize})`);
    }
    const color = !(data instanceof Float32Array);
    const expected = width * height * (color ? 4 : 1);
    if (data.length !== expected) {
      throw new Error(`treelet: raster data has ${data.length} values, expected ${expected} (${width}×${height}${color ? '×4 RGBA' : ''})`);
    }
    const b = input.bounds;
    if (!(b.east > b.west && b.north > b.south)) throw new Error('treelet: raster bounds are empty');

    let slot = this.slotOf(id);
    if (slot < 0) slot = this.slots.indexOf(null);
    if (slot < 0) {
      throw new Error(`treelet: at most ${MAX_RASTERS} raster layers can be shown at once; remove one first`);
    }

    let texture: DataTexture;
    let values: Float32Array | null = null;
    let range: [number, number] | null = null;
    if (color) {
      // Premultiplied: filtering toward a transparent texel fades the color instead of darkening it
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        bytes[i] = Math.round((data[i] * a) / 255);
        bytes[i + 1] = Math.round((data[i + 1] * a) / 255);
        bytes[i + 2] = Math.round((data[i + 2] * a) / 255);
        bytes[i + 3] = a;
      }
      texture = new DataTexture(bytes, width, height, RGBAFormat, UnsignedByteType);
      texture.magFilter = LinearFilter;
      texture.minFilter = LinearFilter;
    } else {
      const src = data as Float32Array;
      // One array for the GPU and for point queries; float32 data matches nodata as a float32
      values = new Float32Array(src.length);
      const nodata = input.nodata === undefined ? undefined : Math.fround(input.nodata);
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < src.length; i++) {
        const v = src[i];
        if (!isGridValue(v) || v === nodata) {
          values[i] = RASTER_NODATA;
          continue;
        }
        values[i] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      range = min <= max ? [min, max] : null;
      texture = new DataTexture(values, width, height, RedFormat, FloatType);
      texture.magFilter = NearestFilter;
      texture.minFilter = NearestFilter;
    }
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.colorSpace = NoColorSpace;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;

    this.slots[slot]?.texture.dispose();
    const entry: RasterEntry = { id, width, height, color, bounds: { ...b }, texture, values, range };
    this.slots[slot] = entry;
    return entry;
  }

  /** Unbind and free a raster. */
  release(id: string): boolean {
    const slot = this.slotOf(id);
    if (slot < 0) return false;
    this.slots[slot]!.texture.dispose();
    this.slots[slot] = null;
    return true;
  }

  /** Shader uniforms for every slot, relative to the render origin. */
  uniforms(originX: number, originY: number): Array<RasterUniform | null> {
    return this.slots.map((r) => {
      if (!r) return null;
      const b = r.bounds;
      return {
        texture: r.texture,
        offsetX: b.west - originX,
        offsetY: b.north - originY,
        scaleX: r.width / (b.east - b.west),
        scaleY: r.height / (b.north - b.south),
        width: r.width,
        height: r.height,
        color: r.color,
      };
    });
  }

  /** Value of a value raster at a world point (the shader's filter), or null. */
  sample(id: string, worldX: number, worldY: number): number | null {
    const r = this.get(id);
    if (!r || !r.values) return null;
    const b = r.bounds;
    const px = ((worldX - b.west) / (b.east - b.west)) * r.width;
    const py = ((b.north - worldY) / (b.north - b.south)) * r.height;
    return sampleGrid(r.values, r.width, r.height, px, py);
  }

  dispose(): void {
    for (const r of this.slots) r?.texture.dispose();
    this.slots.fill(null);
  }
}
