// ============================================================================
// treelet.js - Unified Drape Atlas
//
// Single RGBA CanvasTexture holding drape imagery for ALL visible tiles.
// Mirrors the elevation atlas slot layout so both share the same per-tile
// atlas coordinates. Uses OffscreenCanvas + 2D context for efficient blitting.
//
// GPU uploads use renderer.copyTextureToTexture() for individual slot regions
// (~256KB each) instead of full-canvas texImage2D (~64MB). This eliminates
// frame stalls during zoom transitions when many slots change simultaneously.
// Using Three.js's copy API (not raw GL) keeps the internal texture state
// cache in sync, avoiding the flat-terrain bug from stale texture bindings.
//
// Created lazily when a drape layer is activated. Disposed when cleared.
// ============================================================================

import {
  CanvasTexture,
  SRGBColorSpace,
  LinearFilter,
  ClampToEdgeWrapping,
  Vector2,
  type WebGLRenderer,
} from 'three';

import { DEFAULT_ATLAS_SIZE, DEFAULT_SLOT_SIZE } from './UnifiedAtlas';

/** A slot region queued for GPU upload. */
interface DirtySlot {
  x: number;
  y: number;
  size: number;
}

export class UnifiedDrapeAtlas {
  readonly texture: CanvasTexture;
  readonly atlasSize: number;

  private readonly canvas: OffscreenCanvas;
  private readonly ctx: OffscreenCanvasRenderingContext2D;

  /** Reusable small canvas for extracting slot regions for GPU upload. */
  private readonly slotCanvas: OffscreenCanvas;
  private readonly slotCtx: OffscreenCanvasRenderingContext2D;

  /**
   * Lightweight CanvasTexture wrapping slotCanvas for copyTextureToTexture.
   * Must NEVER have needsUpdate=true set - keeping it off the GPU property
   * cache ensures copyTextureToTexture takes the fast CPU→GPU texSubImage2D
   * path instead of the framebuffer blit path.
   */
  private readonly slotTexture: CanvasTexture;

  /** Tile keys that have drape imagery loaded. */
  private readonly loadedTiles = new Set<number>();

  /** Slot regions that have changed since the last GPU upload. */
  private readonly dirtySlots: DirtySlot[] = [];

  /** Reusable Vector2 for copy destination position (avoids per-frame alloc). */
  private readonly copyDst = new Vector2();

  constructor(atlasSize: number = DEFAULT_ATLAS_SIZE, slotSize: number = DEFAULT_SLOT_SIZE) {
    this.atlasSize = atlasSize;

    this.canvas = new OffscreenCanvas(atlasSize, atlasSize);
    const ctx = this.canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) throw new Error('UnifiedDrapeAtlas: failed to create 2D context');
    this.ctx = ctx;

    // Start transparent (no drape data)
    this.ctx.clearRect(0, 0, atlasSize, atlasSize);

    // Reusable slot canvas for sub-region extraction
    this.slotCanvas = new OffscreenCanvas(slotSize, slotSize);
    const sctx = this.slotCanvas.getContext('2d', { willReadFrequently: false });
    if (!sctx) throw new Error('UnifiedDrapeAtlas: failed to create slot 2D context');
    this.slotCtx = sctx;

    // Slot texture wrapper - never GPU-initialized (no needsUpdate = true).
    // copyTextureToTexture reads from its .image (the slotCanvas) directly.
    this.slotTexture = new CanvasTexture(this.slotCanvas);
    this.slotTexture.colorSpace = SRGBColorSpace;
    this.slotTexture.flipY = false;
    this.slotTexture.generateMipmaps = false;

    // Main atlas texture
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;

    // Initial full upload to create the GPU texture object.
    // After this, all updates go through copyTextureToTexture (sub-region).
    this.texture.needsUpdate = true;
  }

  /**
   * Check if drape imagery is loaded for a tile.
   */
  hasTile(key: number): boolean {
    return this.loadedTiles.has(key);
  }

  /**
   * Write drape imagery into the atlas at the given slot position.
   * The slot coordinates must match the elevation atlas allocation
   * for the same tile key (shared atlas UV space).
   *
   * Does NOT trigger a full-canvas GPU upload. Instead, the slot is
   * queued for sub-region upload via uploadDirtySlots().
   */
  writeTile(
    key: number,
    image: ImageBitmap,
    atlasX: number,
    atlasY: number,
    tilePixels: number,
  ): void {
    this.ctx.drawImage(image, atlasX, atlasY, tilePixels, tilePixels);
    this.loadedTiles.add(key);
    this.dirtySlots.push({ x: atlasX, y: atlasY, size: tilePixels });
  }

  /**
   * Write a sub-tile image into a sub-region of a slot.
   * Used by the lodOffset composite path: each sub-tile covers a fraction
   * of the slot. Does NOT mark the tile as loaded or push a dirty slot —
   * call markLoadedAndDirty() once all sub-tiles for the slot are written.
   */
  writeSubRegion(
    image: ImageBitmap,
    atlasX: number, atlasY: number,
    subX: number, subY: number,
    subSize: number,
  ): void {
    this.ctx.drawImage(image, atlasX + subX, atlasY + subY, subSize, subSize);
  }

  /**
   * Mark a tile as loaded and queue its slot for GPU upload.
   * Called once when all sub-tiles for a composite slot have been written,
   * triggering a single GPU upload for the entire slot.
   */
  markLoadedAndDirty(key: number, atlasX: number, atlasY: number, tilePixels: number): void {
    this.loadedTiles.add(key);
    this.dirtySlots.push({ x: atlasX, y: atlasY, size: tilePixels });
  }

  /**
   * Evict a tile's drape imagery tracking.
   */
  evictTile(key: number): void {
    this.loadedTiles.delete(key);
  }

  /**
   * Clear the canvas pixels for a slot region (set to transparent).
   * Queues the region for GPU upload so the shader sees alpha=0 and
   * falls back to the base placeholder color instead of showing stale
   * drape imagery from a geographically unrelated evicted tile.
   */
  clearSlot(atlasX: number, atlasY: number, tilePixels: number): void {
    this.ctx.clearRect(atlasX, atlasY, tilePixels, tilePixels);
    this.dirtySlots.push({ x: atlasX, y: atlasY, size: tilePixels });
  }

  /**
   * Copy a sub-region of the atlas canvas into a destination slot, upscaling
   * as needed. Used to fill a newly-allocated slot with the correct quadrant
   * of an ancestor tile's drape - providing a low-res but geographically
   * correct placeholder until the actual drape tile loads.
   *
   * Source and destination must not overlap (different atlas slots).
   */
  blitRegion(
    srcX: number, srcY: number, srcSize: number,
    dstX: number, dstY: number, dstSize: number,
  ): void {
    this.ctx.drawImage(
      this.canvas,
      srcX, srcY, srcSize, srcSize,
      dstX, dstY, dstSize, dstSize,
    );
    this.dirtySlots.push({ x: dstX, y: dstY, size: dstSize });
  }

  /**
   * Upload all dirty slot regions to the GPU via sub-region copies.
   *
   * Uses renderer.copyTextureToTexture() which internally calls
   * textures.setTexture2D() + gl.texSubImage2D(), properly maintaining
   * Three.js's texture state cache. Each 256×256 slot uploads ~256KB
   * instead of the full ~64MB atlas canvas.
   *
   * Call once per frame from the update loop.
   */
  uploadDirtySlots(renderer: WebGLRenderer): void {
    if (this.dirtySlots.length === 0) return;

    for (const slot of this.dirtySlots) {
      // Resize reusable slot canvas if needed (handles non-default slot sizes)
      if (this.slotCanvas.width !== slot.size || this.slotCanvas.height !== slot.size) {
        this.slotCanvas.width = slot.size;
        this.slotCanvas.height = slot.size;
        // Reassign image reference after resize so Three.js sees updated dimensions
        this.slotTexture.image = this.slotCanvas;
      }

      // Copy the slot region from the main atlas canvas to the small canvas
      this.slotCtx.clearRect(0, 0, slot.size, slot.size);
      this.slotCtx.drawImage(
        this.canvas,
        slot.x, slot.y, slot.size, slot.size, // source region
        0, 0, slot.size, slot.size,            // destination (full small canvas)
      );

      // Upload the small canvas to the atlas GPU texture at the correct offset.
      // copyTextureToTexture binds the destination via textures.setTexture2D()
      // (keeping the state cache in sync) and calls gl.texSubImage2D() with
      // the slotCanvas as a TexImageSource (~256KB vs ~64MB for full atlas).
      this.copyDst.set(slot.x, slot.y);
      renderer.copyTextureToTexture(this.slotTexture, this.texture, null, this.copyDst);
    }

    this.dirtySlots.length = 0;
  }

  /**
   * Clear all drape imagery and reset.
   * Uses full-canvas upload (only for complete reset, not per-slot).
   */
  clear(): void {
    this.ctx.clearRect(0, 0, this.atlasSize, this.atlasSize);
    this.loadedTiles.clear();
    this.dirtySlots.length = 0;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.slotTexture.dispose();
    this.loadedTiles.clear();
    this.dirtySlots.length = 0;
  }
}
