// ============================================================================
// treelet.js - Drape Layer
//
// Fetches raster imagery tiles and provides Three.js Textures to drape
// over elevation meshes. Multiple drape layers can be active at once.
// ============================================================================

import { Texture, SRGBColorSpace, LinearFilter, ClampToEdgeWrapping } from 'three';
import type {
  TileCoord,
  DrapeLayerOptions,
  BlendMode,
} from '../../core/types';
import type { LayerSource } from '../LayerSource';
import { createSource } from '../createSource';

/** Default maximum number of cached drape textures before LRU eviction. */
const DEFAULT_TEXTURE_CACHE_MAX = 256;

/**
 * Drape layer for raster imagery overlaid on terrain meshes.
 *
 * Each drape layer:
 *   - Fetches imagery tiles from an XYZ or WMS source
 *   - Converts them to Three.js Textures
 *   - Supports opacity and blend mode (normal, multiply, screen)
 *   - Uses LRU eviction to bound GPU memory usage
 */
export class DrapeLayer {
  readonly id: string;
  readonly name: string;
  readonly source: LayerSource;
  readonly blendMode: BlendMode;

  opacity: number;
  active: boolean;

  /** Cache of loaded textures per tile key. */
  private readonly textureCache = new Map<string, Texture>();

  /** LRU order tracking: most-recently-used keys at the end. */
  private readonly textureLRU: string[] = [];

  /** Maximum number of cached textures before eviction. */
  private readonly textureCacheMax: number;

  constructor(options: DrapeLayerOptions) {
    this.id = options.id;
    this.name = options.name;
    this.opacity = options.opacity ?? 1.0;
    this.blendMode = options.blendMode ?? 'normal';
    this.active = options.active ?? true;
    this.textureCacheMax = DEFAULT_TEXTURE_CACHE_MAX;

    this.source = createSource(options.source);
  }

  /**
   * Fetch a tile image and return a Three.js Texture.
   */
  async fetchTexture(coord: TileCoord): Promise<Texture> {
    const key = `${coord.z}/${coord.x}/${coord.y}`;

    // Return cached texture if available
    const cached = this.textureCache.get(key);
    if (cached) {
      this.touchLRU(key);
      return cached;
    }

    const url = this.source.getTileUrl(coord);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`treelet: drape tile fetch failed for ${url} (${response.status})`);
    }

    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);

    const texture = new Texture(imageBitmap);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    // ImageBitmap + WebGL2: UNPACK_FLIP_Y_WEBGL is unreliable.
    // We set flipY=false here and compensate with a V-flip in the fragment shader.
    texture.flipY = false;
    texture.needsUpdate = true;

    this.textureCache.set(key, texture);
    this.touchLRU(key);
    this.evictIfNeeded();

    return texture;
  }

  /**
   * Get a previously fetched texture, if cached.
   */
  getCachedTexture(coord: TileCoord): Texture | undefined {
    return this.textureCache.get(`${coord.z}/${coord.x}/${coord.y}`);
  }

  /**
   * Remove a specific texture from cache.
   */
  disposeTexture(coord: TileCoord): void {
    const key = `${coord.z}/${coord.x}/${coord.y}`;
    const texture = this.textureCache.get(key);
    if (texture) {
      texture.dispose();
      this.textureCache.delete(key);
      this.removeLRU(key);
    }
  }

  /**
   * Dispose all cached textures.
   */
  dispose(): void {
    for (const texture of this.textureCache.values()) {
      texture.dispose();
    }
    this.textureCache.clear();
    this.textureLRU.length = 0;
  }

  // -- Private: LRU management for texture cache --

  /**
   * Move a key to the end (most recently used) of the LRU list.
   */
  private touchLRU(key: string): void {
    const idx = this.textureLRU.indexOf(key);
    if (idx !== -1) {
      this.textureLRU.splice(idx, 1);
    }
    this.textureLRU.push(key);
  }

  /**
   * Remove a key from the LRU list.
   */
  private removeLRU(key: string): void {
    const idx = this.textureLRU.indexOf(key);
    if (idx !== -1) {
      this.textureLRU.splice(idx, 1);
    }
  }

  /**
   * Evict least-recently-used textures when cache exceeds max size.
   */
  private evictIfNeeded(): void {
    while (this.textureCache.size > this.textureCacheMax && this.textureLRU.length > 0) {
      const oldestKey = this.textureLRU.shift()!;
      const texture = this.textureCache.get(oldestKey);
      if (texture) {
        texture.dispose();
        this.textureCache.delete(oldestKey);
      }
    }
  }
}
