// ============================================================================
// treelet.js - Elevation Atlas
//
// R32F texture array holding one elevation tile per layer, with an LRU slot
// allocator, per-frame pinning, slot generations (so async work can detect
// that a slot was reused), per-tile min/max, and CPU edge stitching.
//
// Texel layout is corner-aligned (see workers/raster.ts): texel (0,0) is the
// tile's NW corner and (S−1,S−1) its SE corner. When a tile loads, its
// shared edges and corners with loaded same-zoom neighbours are set to the
// average of both tiles' own edge values, so adjacent tiles agree exactly on
// their common boundary. The correction fades out linearly over a band about
// one source pixel wide, so overzoomed tiles (several texels per source
// pixel) get a smooth seam instead of a one-texel kink. Each tile's original
// edges are kept so the average can be recomputed whenever a neighbour
// (re)loads; the band correction is linear, so re-stitching is idempotent.
//
// Layers have no shared borders, so sampling can never bleed into another
// tile — no half-texel insets or sentinel-guarded filtering is needed.
// ============================================================================

import {
  DataArrayTexture,
  FloatType,
  RedFormat,
  NearestFilter,
  ClampToEdgeWrapping,
} from 'three';
import { packTileKey } from '../tiles/TileIndex';
import { ELEVATION_NODATA } from '../workers/raster';
import type { ArrayTextureWriter } from './ArrayTextureWriter';

export { ELEVATION_NODATA } from '../workers/raster';

/** Reference into an atlas layer: own tile (offset 0, scale 1) or an ancestor sub-region. */
export interface AtlasRef {
  layer: number;
  /** Offset of the sub-region in tile-normalized coordinates (y down). */
  ox: number;
  oy: number;
  /** Size of the sub-region in tile-normalized coordinates. */
  scale: number;
}

/** Information about one occupied slot. */
export interface SlotInfo {
  key: number;
  z: number;
  x: number;
  y: number;
  layer: number;
  /** Allocation generation; changes whenever the layer is (re)assigned. */
  gen: number;
  /** Minimum / maximum valid elevation in meters (0/0 for empty tiles). */
  min: number;
  max: number;
  /** Tile reported as nonexistent by the source (filled with zeros, not stitched). */
  empty: boolean;
  /** Width in texels of the edge-stitch band (≈ one source pixel). */
  band: number;
  /** Own-data reference (layer, 0, 0, 1). */
  readonly ref: AtlasRef;
  lruPrev: number;
  lruNext: number;
}

/** Edge order in the raw-edge store. */
const TOP = 0, BOTTOM = 1, LEFT = 2, RIGHT = 3;

/** Upper bound on the stitch band width in texels. */
const MAX_STITCH_BAND = 8;

interface Strip {
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class ElevationAtlas {
  readonly slotSize: number;
  readonly capacity: number;
  /** CPU copy of every layer (source of truth for sampling, stitching, re-upload). */
  readonly data: Float32Array<ArrayBuffer>;
  readonly texture: DataArrayTexture;

  /** Original (unstitched) edge texels per layer: 4 edges × S values. */
  private readonly rawEdges: Float32Array;
  private readonly slotMap = new Map<number, SlotInfo>();
  private readonly freeLayers: number[] = [];
  private readonly pinned = new Set<number>();
  private pinnedOccupied = 0;
  /** Occupied pins allowed before pin() refuses: keeps slots evictable so loading never deadlocks. */
  private readonly pinLimit: number;
  private generation = 0;
  private lruHead = -1;
  private lruTail = -1;

  private readonly dirtyLayers = new Set<number>();
  private readonly dirtyStrips: Strip[] = [];
  private readonly stripBuffer: Float32Array;

  /** Invoked before an occupied slot is reassigned to another tile. */
  onEvict: ((slot: SlotInfo) => void) | null = null;

  constructor(slotSize: number, capacity: number) {
    this.slotSize = slotSize;
    this.capacity = capacity;
    this.data = new Float32Array(slotSize * slotSize * capacity);
    this.rawEdges = new Float32Array(capacity * 4 * slotSize);
    this.stripBuffer = new Float32Array(slotSize * MAX_STITCH_BAND);
    this.pinLimit = capacity - Math.floor(capacity * 0.1);

    // Allocation-only texture: three creates immutable storage (texStorage3D)
    // and never uploads `data` itself — all uploads go through flush().
    this.texture = new DataArrayTexture(this.data, slotSize, slotSize, capacity);
    this.texture.format = RedFormat;
    this.texture.type = FloatType;
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.unpackAlignment = 1;
    this.texture.source.dataReady = false;
    this.texture.needsUpdate = true;

    for (let i = capacity - 1; i >= 0; i--) this.freeLayers.push(i);
  }

  // ==== Queries ====

  has(key: number): boolean {
    return this.slotMap.has(key);
  }

  get(key: number): SlotInfo | undefined {
    return this.slotMap.get(key);
  }

  /** Own-data reference for a loaded tile, or null. */
  ref(key: number): AtlasRef | null {
    return this.slotMap.get(key)?.ref ?? null;
  }

  /** Slot generation for `key`, or 0 when not loaded. */
  gen(key: number): number {
    return this.slotMap.get(key)?.gen ?? 0;
  }

  get size(): number {
    return this.slotMap.size;
  }

  /** Occupied slots (in no particular order). */
  slots(): IterableIterator<SlotInfo> {
    return this.slotMap.values();
  }

  /** Slots that an allocation could obtain right now (free + evictable). */
  get available(): number {
    return this.freeLayers.length + (this.slotMap.size - this.pinnedOccupied);
  }

  /**
   * Bilinear elevation (meters) at tile-normalized (u, v) of a loaded tile,
   * using the same corner-aligned convention as the shader. Returns null when
   * the tile isn't loaded or the neighbourhood has no data.
   */
  sample(key: number, u: number, v: number): number | null {
    const slot = this.slotMap.get(key);
    if (!slot) return null;
    const S = this.slotSize;
    const smax = S - 1;
    const tx = Math.min(Math.max(u, 0), 1) * smax;
    const ty = Math.min(Math.max(v, 0), 1) * smax;
    const x0 = Math.min(Math.floor(tx), smax);
    const y0 = Math.min(Math.floor(ty), smax);
    const x1 = Math.min(x0 + 1, smax);
    const y1 = Math.min(y0 + 1, smax);
    const fx = tx - x0;
    const fy = ty - y0;
    const base = slot.layer * S * S;
    const d = this.data;
    let sum = 0;
    let ws = 0;
    const acc = (value: number, weight: number) => {
      if (value > ELEVATION_NODATA + 1) {
        sum += value * weight;
        ws += weight;
      }
    };
    acc(d[base + y0 * S + x0], (1 - fx) * (1 - fy));
    acc(d[base + y0 * S + x1], fx * (1 - fy));
    acc(d[base + y1 * S + x0], (1 - fx) * fy);
    acc(d[base + y1 * S + x1], fx * fy);
    return ws > 1e-9 ? sum / ws : null;
  }

  // ==== LRU / pinning ====

  /** Mark a tile as recently used. */
  touch(key: number): void {
    const slot = this.slotMap.get(key);
    if (slot && this.lruTail !== key) {
      this.lruRemove(slot);
      this.lruAppend(slot);
    }
  }

  /**
   * Protect a tile from eviction until the next clearPins(). Callers pin in
   * priority order; once ~90% of the atlas is pinned further pins are
   * refused, so missing tiles can always claim a slot. Returns whether the
   * tile is pinned.
   */
  pin(key: number): boolean {
    if (this.pinned.has(key)) return true;
    const occupied = this.slotMap.has(key);
    if (occupied && this.pinnedOccupied >= this.pinLimit) return false;
    this.pinned.add(key);
    if (occupied) this.pinnedOccupied++;
    return true;
  }

  clearPins(): void {
    this.pinned.clear();
    this.pinnedOccupied = 0;
  }

  // ==== Writes ====

  /**
   * Store a resampled S×S elevation tile. Returns the slot, or null when the
   * atlas is saturated with pinned tiles (the caller should retry later).
   *
   * @param texelsPerPixel - slot texels per source pixel (sizes the stitch band)
   */
  write(
    z: number, x: number, y: number,
    tile: Float32Array, min: number, max: number,
    texelsPerPixel = 1,
  ): SlotInfo | null {
    const S = this.slotSize;
    if (tile.length !== S * S) throw new Error(`treelet: elevation tile must have ${S * S} values, got ${tile.length}`);
    const slot = this.allocate(z, x, y);
    if (!slot) return null;
    slot.min = min;
    slot.max = max;
    slot.empty = false;
    slot.band = Math.max(1, Math.min(MAX_STITCH_BAND, Math.ceil(texelsPerPixel - 1e-6), Math.floor(S / 4)));
    this.data.set(tile, slot.layer * S * S);
    this.captureRawEdges(slot.layer);
    this.dirtyLayers.add(slot.layer);
    this.stitch(slot);
    return slot;
  }

  /** Store a tile the source reports as nonexistent: flat at sea level, never stitched. */
  writeEmpty(z: number, x: number, y: number): SlotInfo | null {
    const S = this.slotSize;
    const slot = this.allocate(z, x, y);
    if (!slot) return null;
    slot.min = 0;
    slot.max = 0;
    slot.empty = true;
    slot.band = 1;
    this.data.fill(0, slot.layer * S * S, (slot.layer + 1) * S * S);
    this.captureRawEdges(slot.layer);
    this.dirtyLayers.add(slot.layer);
    return slot;
  }

  /** Forget every tile. GPU data is not touched: no instance references it anymore. */
  clear(): void {
    this.slotMap.clear();
    this.freeLayers.length = 0;
    for (let i = this.capacity - 1; i >= 0; i--) this.freeLayers.push(i);
    this.clearPins();
    this.lruHead = -1;
    this.lruTail = -1;
    this.dirtyLayers.clear();
    this.dirtyStrips.length = 0;
  }

  /** Re-upload every occupied layer (after a WebGL context restore). */
  markAllDirty(): void {
    this.dirtyStrips.length = 0;
    for (const slot of this.slotMap.values()) this.dirtyLayers.add(slot.layer);
  }

  /** Whether flush() has work to do. */
  get hasPendingUploads(): boolean {
    return this.dirtyLayers.size > 0 || this.dirtyStrips.length > 0;
  }

  /** Upload dirty layers and stitched edge strips. Returns true if anything was uploaded. */
  flush(writer: ArrayTextureWriter): boolean {
    if (!this.hasPendingUploads) return false;
    if (!writer.begin()) return false;
    const gl = writer.context!;
    const S = this.slotSize;
    for (const layer of this.dirtyLayers) {
      writer.write(0, 0, 0, layer, S, S, gl.RED, gl.FLOAT, this.data.subarray(layer * S * S, (layer + 1) * S * S));
    }
    for (const s of this.dirtyStrips) {
      if (this.dirtyLayers.has(s.layer)) continue;
      const base = s.layer * S * S;
      const buf = this.stripBuffer.subarray(0, s.w * s.h);
      for (let j = 0; j < s.h; j++) {
        const row = base + (s.y + j) * S + s.x;
        buf.set(this.data.subarray(row, row + s.w), j * s.w);
      }
      writer.write(0, s.x, s.y, s.layer, s.w, s.h, gl.RED, gl.FLOAT, buf);
    }
    writer.end();
    this.dirtyLayers.clear();
    this.dirtyStrips.length = 0;
    return true;
  }

  dispose(): void {
    this.texture.dispose();
    this.clear();
  }

  // ==== Allocation ====

  private allocate(z: number, x: number, y: number): SlotInfo | null {
    const key = packTileKey(z, x, y);
    const existing = this.slotMap.get(key);
    if (existing) {
      this.touch(key);
      return existing;
    }

    let layer: number;
    if (this.freeLayers.length > 0) {
      layer = this.freeLayers.pop()!;
    } else {
      layer = this.evictLRU();
      if (layer < 0) return null;
    }

    const slot: SlotInfo = {
      key, z, x, y, layer,
      gen: ++this.generation,
      min: 0,
      max: 0,
      empty: false,
      band: 1,
      ref: { layer, ox: 0, oy: 0, scale: 1 },
      lruPrev: -1,
      lruNext: -1,
    };
    this.slotMap.set(key, slot);
    this.lruAppend(slot);
    if (this.pinned.has(key)) this.pinnedOccupied++;
    return slot;
  }

  /** Evict the least-recently-used unpinned slot; returns its layer or −1. */
  private evictLRU(): number {
    let key = this.lruHead;
    while (key !== -1) {
      const slot = this.slotMap.get(key)!;
      if (!this.pinned.has(key)) {
        this.lruRemove(slot);
        this.onEvict?.(slot);
        this.slotMap.delete(key);
        return slot.layer;
      }
      key = slot.lruNext;
    }
    return -1;
  }

  private lruAppend(slot: SlotInfo): void {
    slot.lruPrev = this.lruTail;
    slot.lruNext = -1;
    if (this.lruTail !== -1) this.slotMap.get(this.lruTail)!.lruNext = slot.key;
    else this.lruHead = slot.key;
    this.lruTail = slot.key;
  }

  private lruRemove(slot: SlotInfo): void {
    if (slot.lruPrev !== -1) this.slotMap.get(slot.lruPrev)!.lruNext = slot.lruNext;
    else this.lruHead = slot.lruNext;
    if (slot.lruNext !== -1) this.slotMap.get(slot.lruNext)!.lruPrev = slot.lruPrev;
    else this.lruTail = slot.lruPrev;
    slot.lruPrev = -1;
    slot.lruNext = -1;
  }

  // ==== Edge stitching ====

  private captureRawEdges(layer: number): void {
    const S = this.slotSize;
    const base = layer * S * S;
    const e = layer * 4 * S;
    const d = this.data;
    const r = this.rawEdges;
    for (let i = 0; i < S; i++) {
      r[e + TOP * S + i] = d[base + i];
      r[e + BOTTOM * S + i] = d[base + (S - 1) * S + i];
      r[e + LEFT * S + i] = d[base + i * S];
      r[e + RIGHT * S + i] = d[base + i * S + S - 1];
    }
  }

  private neighbour(z: number, x: number, y: number): SlotInfo | null {
    const n = 2 ** z;
    if (y < 0 || y >= n) return null;
    const wx = ((x % n) + n) % n;
    const slot = this.slotMap.get(packTileKey(z, wx, y));
    return slot && !slot.empty ? slot : null;
  }

  private static average(a: number, b: number): number {
    const va = a > ELEVATION_NODATA + 1;
    const vb = b > ELEVATION_NODATA + 1;
    if (va && vb) return (a + b) * 0.5;
    if (va) return a;
    if (vb) return b;
    return ELEVATION_NODATA;
  }

  /** Average shared edges and corners with every loaded same-zoom neighbour. */
  private stitch(slot: SlotInfo): void {
    const { z, x, y } = slot;
    const S = this.slotSize;
    const last = S - 1;
    const left = this.neighbour(z, x - 1, y);
    const right = this.neighbour(z, x + 1, y);
    const top = this.neighbour(z, x, y - 1);
    const bottom = this.neighbour(z, x, y + 1);

    if (left) this.stitchEdge(slot, LEFT, left, RIGHT);
    if (right) this.stitchEdge(slot, RIGHT, right, LEFT);
    if (top) this.stitchEdge(slot, TOP, top, BOTTOM);
    if (bottom) this.stitchEdge(slot, BOTTOM, bottom, TOP);

    // Corners: average over every loaded tile touching the corner point.
    // Each participant lists (slot, column, row, raw edge, raw index).
    const tl = this.neighbour(z, x - 1, y - 1);
    const tr = this.neighbour(z, x + 1, y - 1);
    const bl = this.neighbour(z, x - 1, y + 1);
    const br = this.neighbour(z, x + 1, y + 1);
    this.stitchCorner([
      [slot, 0, 0, TOP, 0], [left, last, 0, TOP, last], [top, 0, last, BOTTOM, 0], [tl, last, last, BOTTOM, last],
    ]);
    this.stitchCorner([
      [slot, last, 0, TOP, last], [right, 0, 0, TOP, 0], [top, last, last, BOTTOM, last], [tr, 0, last, BOTTOM, 0],
    ]);
    this.stitchCorner([
      [slot, 0, last, BOTTOM, 0], [left, last, last, BOTTOM, last], [bottom, 0, 0, TOP, 0], [bl, last, 0, TOP, last],
    ]);
    this.stitchCorner([
      [slot, last, last, BOTTOM, last], [right, 0, last, BOTTOM, 0], [bottom, last, 0, TOP, last], [br, 0, 0, TOP, 0],
    ]);
  }

  /**
   * Set the shared edge of `a` and `b` to the average of their raw edges and
   * fade the correction into each tile over its stitch band.
   */
  private stitchEdge(a: SlotInfo, edgeA: number, b: SlotInfo, edgeB: number): void {
    const S = this.slotSize;
    const raw = this.rawEdges;
    const ra = a.layer * 4 * S + edgeA * S;
    const rb = b.layer * 4 * S + edgeB * S;
    for (let i = 0; i < S; i++) {
      const v = ElevationAtlas.average(raw[ra + i], raw[rb + i]);
      this.applyEdgeValue(a, edgeA, i, v);
      this.applyEdgeValue(b, edgeB, i, v);
    }
    this.markBand(a, edgeA);
    this.markBand(b, edgeB);
  }

  /**
   * Move edge texel `i` of `slot` to `value`, spreading the same correction
   * with linear falloff over the band (depth 0 = edge texel). Because the
   * band shape is fixed per slot, applying a new target on top of an earlier
   * one composes linearly — re-stitching never drifts.
   */
  private applyEdgeValue(slot: SlotInfo, edge: number, i: number, value: number): void {
    const S = this.slotSize;
    const last = S - 1;
    const base = slot.layer * S * S;
    const d = this.data;
    const idx = (depth: number): number => {
      switch (edge) {
        case TOP: return base + depth * S + i;
        case BOTTOM: return base + (last - depth) * S + i;
        case LEFT: return base + i * S + depth;
        default: return base + i * S + (last - depth);
      }
    };
    const e = idx(0);
    const current = d[e];
    if (!(value > ELEVATION_NODATA + 1) || !(current > ELEVATION_NODATA + 1)) {
      d[e] = value;
      return;
    }
    const delta = value - current;
    if (delta === 0) return;
    // The band at i = 0 / S−1 would run along the perpendicular edge, whose
    // texels are matched to a different neighbour: only move the edge texel
    // (stitchCorner settles the corner itself).
    const band = i === 0 || i === last ? 1 : slot.band;
    for (let depth = 0; depth < band; depth++) {
      const k = idx(depth);
      if (d[k] > ELEVATION_NODATA + 1) d[k] += delta * (1 - depth / band);
    }
  }

  private markBand(slot: SlotInfo, edge: number): void {
    const S = this.slotSize;
    const band = slot.band;
    const last = S - 1;
    switch (edge) {
      case TOP: this.dirtyStrips.push({ layer: slot.layer, x: 0, y: 0, w: S, h: band }); break;
      case BOTTOM: this.dirtyStrips.push({ layer: slot.layer, x: 0, y: last - band + 1, w: S, h: band }); break;
      case LEFT: this.dirtyStrips.push({ layer: slot.layer, x: 0, y: 0, w: band, h: S }); break;
      default: this.dirtyStrips.push({ layer: slot.layer, x: last - band + 1, y: 0, w: band, h: S }); break;
    }
  }

  private stitchCorner(participants: Array<[SlotInfo | null, number, number, number, number]>): void {
    const S = this.slotSize;
    let sum = 0;
    let count = 0;
    let present = 0;
    for (const [slot, , , edge, idx] of participants) {
      if (!slot) continue;
      present++;
      const v = this.rawEdges[slot.layer * 4 * S + edge * S + idx];
      if (v > ELEVATION_NODATA + 1) {
        sum += v;
        count++;
      }
    }
    if (present < 2) return;
    const value = count > 0 ? sum / count : ELEVATION_NODATA;
    for (const [slot, col, row] of participants) {
      if (!slot) continue;
      this.data[slot.layer * S * S + row * S + col] = value;
      this.dirtyStrips.push({ layer: slot.layer, x: col, y: row, w: 1, h: 1 });
    }
  }
}
