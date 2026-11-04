// ============================================================================
// treelet.js - Drape Atlas
//
// sRGB RGBA8 texture array with full per-layer mip chains holding draped
// imagery. Layer i holds the drape of whichever tile owns elevation layer i,
// so both atlases share one slot allocator. Each entry remembers the
// elevation slot generation it was written for: if the elevation slot is
// reassigned, the drape entry is invalid and never sampled again — no
// clearing or GPU work needed.
//
// Mipmaps are built (gamma-correct) in the workers and uploaded per layer,
// so far-away and tilted terrain samples properly filtered imagery without
// regenerating mips for the whole array.
// ============================================================================

import {
  DataArrayTexture,
  RGBAFormat,
  UnsignedByteType,
  SRGBColorSpace,
  LinearFilter,
  LinearMipmapLinearFilter,
  ClampToEdgeWrapping,
} from 'three';
import type { ArrayTextureWriter } from './ArrayTextureWriter';

interface DrapeEntry {
  /** Elevation slot generation this drape was written for. */
  gen: number;
  /** Source zoom the imagery was composited from. */
  z: number;
  /** Source reported no imagery for this tile. */
  empty: boolean;
  /** Imagery has reached the GPU (sampling before that would show stale pixels). */
  ready: boolean;
}

interface PendingUpload {
  key: number;
  layer: number;
  gen: number;
  levels: Uint8Array[];
}

export class DrapeAtlas {
  readonly slotSize: number;
  readonly capacity: number;
  readonly levelCount: number;
  readonly texture: DataArrayTexture;

  private readonly entries = new Map<number, DrapeEntry>();
  private readonly queue: PendingUpload[] = [];

  constructor(slotSize: number, capacity: number, anisotropy: number) {
    this.slotSize = slotSize;
    this.capacity = capacity;
    this.levelCount = Math.log2(slotSize) + 1;

    this.texture = new DataArrayTexture(null, slotSize, slotSize, capacity);
    this.texture.format = RGBAFormat;
    this.texture.type = UnsignedByteType;
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    // generateMipmaps makes three allocate the full mip chain; it is only
    // invoked once on the empty storage. Mips are uploaded per layer below.
    this.texture.generateMipmaps = true;
    this.texture.anisotropy = anisotropy;
    this.texture.unpackAlignment = 1;
    this.texture.source.dataReady = false;
    this.texture.needsUpdate = true;
  }

  /** Whether usable imagery is resident for `key` written against slot generation `gen`. */
  has(key: number, gen: number): boolean {
    const e = this.entries.get(key);
    return e !== undefined && e.gen === gen && e.ready && !e.empty;
  }

  /** Source zoom of the resident, queued or known-empty drape, or −1 when none matches `gen`. */
  loadedZoom(key: number, gen: number): number {
    const e = this.entries.get(key);
    return e !== undefined && e.gen === gen ? e.z : -1;
  }

  get size(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.ready && !e.empty) n++;
    return n;
  }

  /** Queue imagery (full mip chain) for `key` in elevation layer `layer`. */
  write(key: number, layer: number, gen: number, z: number, levels: Uint8Array[]): void {
    if (levels.length !== this.levelCount) {
      throw new Error(`treelet: drape mip chain must have ${this.levelCount} levels, got ${levels.length}`);
    }
    // Keep showing the previous (coarser) imagery until the new upload lands.
    const prev = this.entries.get(key);
    const keepShowing = prev !== undefined && prev.gen === gen && prev.ready && !prev.empty;
    this.entries.set(key, { gen, z, empty: false, ready: keepShowing });
    // Replace a queued upload for the same tile rather than uploading twice.
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].key === key) {
        this.queue.splice(i, 1);
        break;
      }
    }
    this.queue.push({ key, layer, gen, levels });
  }

  /** Record that the source has no imagery for `key` (falls back to ancestors). */
  writeEmpty(key: number, gen: number, z: number): void {
    this.entries.set(key, { gen, z, empty: true, ready: true });
  }

  evict(key: number): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.queue.length = 0;
  }

  get hasPendingUploads(): boolean {
    return this.queue.length > 0;
  }

  /**
   * Upload up to `maxTiles` queued tiles. Uploads whose slot generation no
   * longer matches (slot reassigned meanwhile) are dropped.
   */
  flush(writer: ArrayTextureWriter, maxTiles: number, isCurrent: (key: number, gen: number) => boolean): boolean {
    if (this.queue.length === 0) return false;
    if (!writer.begin()) return false;
    const gl = writer.context!;
    let uploaded = 0;
    while (this.queue.length > 0 && uploaded < maxTiles) {
      const job = this.queue.shift()!;
      const entry = this.entries.get(job.key);
      if (!isCurrent(job.key, job.gen) || !entry || entry.gen !== job.gen || entry.empty) continue;
      let size = this.slotSize;
      for (let level = 0; level < job.levels.length; level++) {
        writer.write(level, 0, 0, job.layer, size, size, gl.RGBA, gl.UNSIGNED_BYTE, job.levels[level]);
        size = Math.max(1, size >> 1);
      }
      entry.ready = true;
      uploaded++;
    }
    writer.end();
    return uploaded > 0;
  }

  dispose(): void {
    this.texture.dispose();
    this.clear();
  }
}
