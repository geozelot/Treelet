// ============================================================================
// treelet.js - Unified Hierarchical Atlas
//
// Single large Float32 texture holding elevation data for ALL visible tiles
// across ALL zoom levels. A slot allocator manages fixed-size regions within
// the atlas, with LRU eviction when capacity is reached.
//
// One texture bind in the shader covers all tiles at all zoom levels.
// ============================================================================

import {
  DataTexture,
  FloatType,
  RedFormat,
  NearestFilter,
  ClampToEdgeWrapping,
  type WebGLRenderer,
} from 'three';

import { DEFAULT_ATLAS_SIZE, DEFAULT_SLOT_SIZE } from '../core/constants';

/** Information about a single tile slot in the atlas. */
export interface SlotInfo {
  /** Slot index in the grid (used for free list management). */
  slotIndex: number;
  /** Atlas pixel coordinates of the slot's top-left corner. */
  atlasX: number;
  atlasY: number;
  /** Size of the slot in pixels. */
  tilePixels: number;
  /** Frame number when this slot was last referenced by a visible tile. */
  lastUsedFrame: number;
  /** LRU doubly-linked list: tile key of the previous (older) entry, or -1 if head. */
  lruPrev: number;
  /** LRU doubly-linked list: tile key of the next (newer) entry, or -1 if tail. */
  lruNext: number;
  /** Pre-computed atlas UV coordinates (allocated once per slot, reused across frames). */
  uv: AtlasCoords;
}

/** Atlas coordinates returned to callers for instance buffer population. */
export interface AtlasCoords {
  /** UV offset of the slot in [0, 1] atlas space. */
  u: number;
  v: number;
  /** UV scale of the slot (slotPixels / atlasPixels). */
  scale: number;
}

// Re-export default atlas configuration from central constants for backward compatibility.
export { DEFAULT_ATLAS_SIZE, DEFAULT_SLOT_SIZE } from '../core/constants';

/** Sentinel value for unloaded elevation data. GLSL checks < -99990.0. */
export const ELEVATION_SENTINEL = -99999;

/** A slot region queued for GPU upload. */
interface DirtySlot {
  x: number;
  y: number;
  size: number;
}

/**
 * Sub-region within a source tile for overzoom extraction.
 * Pixel coordinates in the source elevation array.
 */
export interface SourceRegion {
  /** Pixel X offset in the source tile. */
  x: number;
  /** Pixel Y offset in the source tile. */
  y: number;
  /** Pixel width of the sub-region. */
  w: number;
  /** Pixel height of the sub-region. */
  h: number;
}

export class UnifiedAtlas {
  readonly texture: DataTexture;
  readonly data: Float32Array;
  readonly atlasSize: number;
  readonly slotSize: number;

  /** Number of slots per atlas axis. */
  readonly slotsPerSide: number;
  /** Total number of slots. */
  readonly totalSlots: number;

  /** Maps numeric tile key → slot info. */
  private readonly slotMap = new Map<number, SlotInfo>();
  /** Maps slot index → numeric tile key (reverse lookup for eviction). */
  private readonly indexToKey = new Map<number, number>();
  /** Free slot indices (stack - LIFO for cache locality). */
  private readonly freeSlots: number[] = [];

  /** Pinned tile keys - protected from LRU eviction (nearest tiles). */
  private readonly pinnedKeys = new Set<number>();

  /** Optional callback invoked when a slot is evicted, before the slot is reused.
   *  Used to keep the drape atlas in sync with elevation slot changes. */
  onSlotEvicted: ((evictedKey: number) => void) | null = null;

  /** Slot regions that have changed since the last GPU upload. */
  private readonly dirtySlots: DirtySlot[] = [];

  /** Reusable buffer for sub-region extraction during GPU upload. */
  private readonly _uploadBuffer: Float32Array;

  /** Whether the texture has been uploaded at least once (full texImage2D). */
  private _initialUploadDone = false;

  /** LRU doubly-linked list head (oldest entry). Tile key or -1 if empty. */
  private _lruHead = -1;
  /** LRU doubly-linked list tail (newest entry). Tile key or -1 if empty. */
  private _lruTail = -1;

  /** Current frame counter for LRU tracking. */
  private frameCounter = 0;

  constructor(atlasSize: number = DEFAULT_ATLAS_SIZE, slotSize: number = DEFAULT_SLOT_SIZE) {
    this.atlasSize = atlasSize;
    this.slotSize = slotSize;
    this.slotsPerSide = Math.floor(atlasSize / slotSize);
    this.totalSlots = this.slotsPerSide * this.slotsPerSide;

    // Allocate atlas data (Float32, one channel per pixel)
    this.data = new Float32Array(atlasSize * atlasSize);
    this.data.fill(ELEVATION_SENTINEL); // sentinel: no data loaded

    // Pre-allocate sub-region upload buffer (avoids per-slot allocation)
    this._uploadBuffer = new Float32Array(slotSize * slotSize);

    this.texture = new DataTexture(
      this.data,
      atlasSize,
      atlasSize,
      RedFormat,
      FloatType,
    );
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;

    // Initialize free list (all slots available)
    for (let i = this.totalSlots - 1; i >= 0; i--) {
      this.freeSlots.push(i);
    }
  }

  /**
   * Advance the frame counter. Call once per frame before touch() calls.
   */
  advanceFrame(): void {
    this.frameCounter++;
  }

  /**
   * Check if a tile is loaded in the atlas.
   */
  hasTile(key: number): boolean {
    return this.slotMap.has(key);
  }

  /**
   * Get atlas coordinates for a loaded tile. Returns null if not loaded.
   * Returns a cached reference (zero allocation) — do not mutate.
   */
  getCoords(key: number): AtlasCoords | null {
    const slot = this.slotMap.get(key);
    return slot ? slot.uv : null;
  }

  /**
   * Sample elevation from the CPU-side atlas data using bilinear interpolation.
   * @param key  Tile key "z/x/y"
   * @param u    Horizontal [0,1] within the tile (0 = west, 1 = east)
   * @param v    Vertical   [0,1] within the tile (0 = north/top, 1 = south/bottom)
   * @returns Elevation in meters, or null if the tile is not loaded or contains sentinel data.
   */
  sampleElevation(key: number, u: number, v: number): number | null {
    const slot = this.slotMap.get(key);
    if (!slot) return null;

    const { atlasX, atlasY, tilePixels } = slot;
    const cu = Math.max(0, Math.min(1, u));
    const cv = Math.max(0, Math.min(1, v));

    // Map [0,1] to pixel-center range [0, tilePixels-1]
    const px = cu * (tilePixels - 1);
    const py = cv * (tilePixels - 1);

    const x0 = Math.floor(px);
    const x1 = Math.min(x0 + 1, tilePixels - 1);
    const y0 = Math.floor(py);
    const y1 = Math.min(y0 + 1, tilePixels - 1);
    const fx = px - x0;
    const fy = py - y0;

    const stride = this.atlasSize;
    const d = this.data;
    const v00 = d[(atlasY + y0) * stride + (atlasX + x0)];
    const v10 = d[(atlasY + y0) * stride + (atlasX + x1)];
    const v01 = d[(atlasY + y1) * stride + (atlasX + x0)];
    const v11 = d[(atlasY + y1) * stride + (atlasX + x1)];

    // Reject sentinel values (unloaded / cleared slots)
    if (v00 <= ELEVATION_SENTINEL + 1 || v10 <= ELEVATION_SENTINEL + 1 ||
        v01 <= ELEVATION_SENTINEL + 1 || v11 <= ELEVATION_SENTINEL + 1) {
      return null;
    }

    return v00 * (1 - fx) * (1 - fy) +
           v10 * fx * (1 - fy) +
           v01 * (1 - fx) * fy +
           v11 * fx * fy;
  }

  /**
   * Mark a tile as recently used (prevents LRU eviction).
   * Moves the entry to the tail of the LRU list in O(1).
   * Call each frame for every visible tile.
   */
  touch(key: number): void {
    const slot = this.slotMap.get(key);
    if (slot) {
      slot.lastUsedFrame = this.frameCounter;
      this.lruMoveToTail(key, slot);
    }
  }

  /**
   * Pin a tile key to protect it from LRU eviction.
   * Call each frame for the nearest tiles (innermost LOD ring).
   */
  pin(key: number): void {
    this.pinnedKeys.add(key);
  }

  /**
   * Clear all pins. Call at the start of each frame before pinning new tiles.
   */
  clearPins(): void {
    this.pinnedKeys.clear();
  }

  /**
   * Allocate a slot for a tile. If the atlas is full, evicts the
   * least-recently-used tile. Returns null if no slot is available
   * (all occupied slots are pinned).
   */
  allocateSlot(key: number): { atlasX: number; atlasY: number; tilePixels: number } | null {
    // Already allocated?
    const existing = this.slotMap.get(key);
    if (existing) {
      existing.lastUsedFrame = this.frameCounter;
      this.lruMoveToTail(key, existing);
      return { atlasX: existing.atlasX, atlasY: existing.atlasY, tilePixels: existing.tilePixels };
    }

    // Get a free slot (evict if necessary)
    let slotIndex: number;
    if (this.freeSlots.length > 0) {
      slotIndex = this.freeSlots.pop()!;
    } else {
      slotIndex = this.evictLRU();
      if (slotIndex === -1) return null; // Atlas saturated - all slots pinned
    }

    const col = slotIndex % this.slotsPerSide;
    const row = Math.floor(slotIndex / this.slotsPerSide);
    const atlasX = col * this.slotSize;
    const atlasY = row * this.slotSize;

    const slot: SlotInfo = {
      slotIndex,
      atlasX,
      atlasY,
      tilePixels: this.slotSize,
      lastUsedFrame: this.frameCounter,
      lruPrev: -1,
      lruNext: -1,
      uv: {
        u: atlasX / this.atlasSize,
        v: atlasY / this.atlasSize,
        scale: this.slotSize / this.atlasSize,
      },
    };

    this.slotMap.set(key, slot);
    this.indexToKey.set(slotIndex, key);
    this.lruAppend(key, slot);

    return { atlasX, atlasY, tilePixels: this.slotSize };
  }

  /**
   * Get the pixel coordinates of a loaded tile's slot.
   * Returns null if the tile is not in the atlas.
   * Returns a cached reference (zero allocation) — do not mutate.
   */
  getCoordsPixels(key: number): { atlasX: number; atlasY: number; tilePixels: number } | null {
    return this.slotMap.get(key) ?? null;
  }

  /**
   * Allocate a slot and write tile elevation data in one call.
   * Returns the pixel coordinates of the slot, or null if the atlas is
   * saturated (all slots pinned - tile stays in the missing list and
   * retries when space opens up via view changes).
   */
  allocateAndWrite(
    key: number,
    elevations: Float32Array,
    elevW: number,
    elevH: number,
    region?: SourceRegion,
  ): { atlasX: number; atlasY: number; tilePixels: number } | null {
    const coords = this.allocateSlot(key);
    if (!coords) return null;
    this.writeTile(key, elevations, elevW, elevH, coords.atlasX, coords.atlasY, coords.tilePixels, region);
    return coords;
  }

  /**
   * Write tile elevation data into an allocated slot.
   * Bilinear resamples from source dimensions into the slot region.
   */
  writeTile(
    key: number,
    elevations: Float32Array,
    elevW: number,
    elevH: number,
    atlasX: number,
    atlasY: number,
    tilePixels: number,
    region?: SourceRegion,
  ): void {
    const dst = this.data;
    const stride = this.atlasSize;

    // Fast path: when source dimensions match slot size and no sub-region,
    // copy rows directly - avoids the bilinear resampling loop entirely.
    if (!region && elevW === tilePixels && elevH === tilePixels) {
      for (let r = 0; r < tilePixels; r++) {
        const dstOffset = (atlasY + r) * stride + atlasX;
        const srcOffset = r * elevW;
        dst.set(elevations.subarray(srcOffset, srcOffset + tilePixels), dstOffset);
      }
      this.dirtySlots.push({ x: atlasX, y: atlasY, size: tilePixels });
      return;
    }

    // Source sub-region (defaults to full source tile when no region is provided)
    const srcX = region ? region.x : 0;
    const srcY = region ? region.y : 0;
    const srcW = region ? region.w : elevW;
    const srcH = region ? region.h : elevH;

    // Bilinear resample from source region into atlas region (tilePixels × tilePixels)
    for (let dy = 0; dy < tilePixels; dy++) {
      const sy = srcY + (dy + 0.5) * srcH / tilePixels - 0.5;
      const sy0 = Math.max(0, Math.floor(sy));
      const sy1 = Math.min(elevH - 1, sy0 + 1);
      const fy = sy - sy0;

      for (let dx = 0; dx < tilePixels; dx++) {
        const sx = srcX + (dx + 0.5) * srcW / tilePixels - 0.5;
        const sx0 = Math.max(0, Math.floor(sx));
        const sx1 = Math.min(elevW - 1, sx0 + 1);
        const fx = sx - sx0;

        const v00 = elevations[sy0 * elevW + sx0];
        const v10 = elevations[sy0 * elevW + sx1];
        const v01 = elevations[sy1 * elevW + sx0];
        const v11 = elevations[sy1 * elevW + sx1];

        const value =
          v00 * (1 - fx) * (1 - fy) +
          v10 * fx * (1 - fy) +
          v01 * (1 - fx) * fy +
          v11 * fx * fy;

        dst[(atlasY + dy) * stride + (atlasX + dx)] = value;
      }
    }

    this.dirtySlots.push({ x: atlasX, y: atlasY, size: tilePixels });
  }

  /**
   * Clear all slots and reset the atlas.
   */
  clear(): void {
    this.data.fill(ELEVATION_SENTINEL);
    this.slotMap.clear();
    this.indexToKey.clear();
    this.freeSlots.length = 0;
    this._lruHead = -1;
    this._lruTail = -1;
    for (let i = this.totalSlots - 1; i >= 0; i--) {
      this.freeSlots.push(i);
    }
    // Force full re-upload after clear (all sentinel data must reach GPU).
    this._initialUploadDone = false;
    this.texture.needsUpdate = true;
  }

  /**
   * Upload dirty atlas regions to the GPU.
   *
   * Uses gl.texSubImage2D() to upload only the changed slot regions instead
   * of re-uploading the entire 4096² Float32 atlas (~64MB). Each dirty slot
   * is a 256² region (~256KB), reducing upload cost by ~250×.
   *
   * Falls back to a full-texture needsUpdate on the first frame (before
   * Three.js has created the underlying WebGLTexture) and on clear().
   *
   * Call once per frame from the update loop.
   */
  uploadDirtySlots(renderer: WebGLRenderer): void {
    if (this.dirtySlots.length === 0) return;

    // First upload must go through Three.js to create the WebGLTexture.
    if (!this._initialUploadDone) {
      this.texture.needsUpdate = true;
      this.dirtySlots.length = 0;
      this._initialUploadDone = true;
      return;
    }

    const gl = renderer.getContext() as WebGL2RenderingContext;
    const texProps = renderer.properties.get(this.texture) as { __webglTexture?: WebGLTexture };
    const glTex = texProps.__webglTexture;

    if (!glTex) {
      // Texture was disposed and not yet re-created - fall back to full upload.
      this.texture.needsUpdate = true;
      this.dirtySlots.length = 0;
      return;
    }

    // Bind through Three.js's state manager to keep its texture cache consistent.
    // Direct gl.bindTexture() bypasses the cache, causing Three.js to skip
    // rebinding on the next draw (cache hit with stale GL state → shader reads zeros).
    renderer.state.bindTexture(gl.TEXTURE_2D, glTex);

    const buf = this._uploadBuffer;
    for (const slot of this.dirtySlots) {
      // Extract the slot's pixel rows into the reusable contiguous buffer.
      for (let r = 0; r < slot.size; r++) {
        const srcOffset = (slot.y + r) * this.atlasSize + slot.x;
        buf.set(this.data.subarray(srcOffset, srcOffset + slot.size), r * slot.size);
      }
      gl.texSubImage2D(
        gl.TEXTURE_2D, 0,
        slot.x, slot.y, slot.size, slot.size,
        gl.RED, gl.FLOAT, buf,
      );
    }

    // Unbind through state manager to stay consistent.
    renderer.state.unbindTexture();
    this.dirtySlots.length = 0;
  }

  dispose(): void {
    this.texture.dispose();
    this.slotMap.clear();
    this.indexToKey.clear();
    this.pinnedKeys.clear();
    this.freeSlots.length = 0;
    this._lruHead = -1;
    this._lruTail = -1;
  }

  // ==== Private: LRU linked list ====

  /**
   * Find and evict the least-recently-used slot. Returns the freed slot index.
   *
   * Walks the LRU list from head (oldest) to find the first unpinned entry.
   * O(1) amortized - pinned tiles tend to be at the tail (most recently touched),
   * so the head is almost always unpinned. Worst case O(p) where p = pinned count.
   */
  private evictLRU(): number {
    let curKey = this._lruHead;
    while (curKey !== -1) {
      if (!this.pinnedKeys.has(curKey)) {
        // Found an unpinned entry - evict it
        const slot = this.slotMap.get(curKey)!;
        const slotIndex = slot.slotIndex;

        // Remove from LRU list
        this.lruRemove(curKey, slot);

        // Notify listener (drape atlas) before clearing the slot
        if (this.onSlotEvicted) {
          this.onSlotEvicted(curKey);
        }

        this.clearSlotPixels(slot.atlasX, slot.atlasY, slot.tilePixels);
        this.slotMap.delete(curKey);
        this.indexToKey.delete(slotIndex);

        return slotIndex;
      }
      // Skip pinned entry - advance to next
      const slot = this.slotMap.get(curKey)!;
      curKey = slot.lruNext;
    }

    // All occupied slots are pinned - atlas is saturated.
    return -1;
  }

  /** Append a slot to the tail of the LRU list (newest position). */
  private lruAppend(key: number, slot: SlotInfo): void {
    slot.lruPrev = this._lruTail;
    slot.lruNext = -1;
    if (this._lruTail !== -1) {
      const tailSlot = this.slotMap.get(this._lruTail)!;
      tailSlot.lruNext = key;
    } else {
      // List was empty - this is also the head
      this._lruHead = key;
    }
    this._lruTail = key;
  }

  /** Remove a slot from its current position in the LRU list. */
  private lruRemove(key: number, slot: SlotInfo): void {
    const prev = slot.lruPrev;
    const next = slot.lruNext;

    if (prev !== -1) {
      this.slotMap.get(prev)!.lruNext = next;
    } else {
      this._lruHead = next;
    }

    if (next !== -1) {
      this.slotMap.get(next)!.lruPrev = prev;
    } else {
      this._lruTail = prev;
    }

    slot.lruPrev = -1;
    slot.lruNext = -1;
  }

  /** Move a slot to the tail of the LRU list (mark as most recently used). */
  private lruMoveToTail(key: number, slot: SlotInfo): void {
    // Already at tail - no-op
    if (this._lruTail === key) return;
    this.lruRemove(key, slot);
    this.lruAppend(key, slot);
  }

  /**
   * Fill a slot region with the sentinel value (-99999).
   */
  private clearSlotPixels(atlasX: number, atlasY: number, tilePixels: number): void {
    const dst = this.data;
    const stride = this.atlasSize;

    for (let dy = 0; dy < tilePixels; dy++) {
      const rowStart = (atlasY + dy) * stride + atlasX;
      dst.subarray(rowStart, rowStart + tilePixels).fill(ELEVATION_SENTINEL);
    }

    this.dirtySlots.push({ x: atlasX, y: atlasY, size: tilePixels });
  }
}
