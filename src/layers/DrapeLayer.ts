// ============================================================================
// treelet.js - Drape Layer
//
// Fetches raster imagery tiles and provides Three.js Textures to drape
// over elevation meshes. Multiple drape layers can be registered but
// only one is active at a time (enforced by Treelet).
// ============================================================================

import { Texture, SRGBColorSpace, LinearFilter, ClampToEdgeWrapping } from 'three';
import type { TileCoord } from '../core/types';
import type { TileSource } from '../sources/TileSource';
import type { Layer } from './Layer';
import type {
  DrapeLayerOptions,
  ResolvedDrapeLayerDisplay,
} from './types';
import { packTileKey } from '../tiles/TileIndex';

/** Default maximum number of cached drape textures before LRU eviction. */
const DEFAULT_TEXTURE_CACHE_MAX = 256;

/** Auto-incrementing ID counter for drape layers. */
let nextDrapeLayerId = 0;

/**
 * Drape layer for raster imagery overlaid on terrain meshes.
 *
 * Each drape layer:
 *   - Fetches imagery tiles from an XYZ or WMS source
 *   - Converts them to Three.js Textures
 *   - Supports opacity and blend mode (normal, hillshade, softlight)
 *   - Uses LRU eviction to bound GPU memory usage
 */
export class DrapeLayer implements Layer {
  readonly id: string;
  readonly layerName: string;
  readonly source: TileSource;
  readonly attribution: string;
  readonly minZoom: number;
  readonly maxZoom: number;
  /** LOD offset: 1 = match elevation zoom, 2 = one finer, 3 = two finer. */
  readonly lodOffset: number;

  /** Per-layer display settings. */
  readonly display: ResolvedDrapeLayerDisplay;

  /** Whether this drape layer is visible (active). */
  visible: boolean;

  /** Cache of loaded textures per tile key. */
  private readonly textureCache = new Map<number, Texture>();

  /** LRU order: Map insertion order tracks least→most recently used. */
  private readonly lruOrder = new Map<number, 1>();

  /** Maximum number of cached textures before eviction. */
  private readonly textureCacheMax: number;

  constructor(options: DrapeLayerOptions) {
    this.id = `drape-${nextDrapeLayerId++}`;
    this.layerName = options.layerName;
    this.source = options.layerSource;
    this.attribution = options.layerAttribution ?? options.layerSource.attribution ?? '';
    this.minZoom = options.minZoom ?? 0;
    this.maxZoom = options.maxZoom ?? 22;
    this.lodOffset = Math.max(1, Math.min(3, options.lodOffset ?? 1));
    this.textureCacheMax = DEFAULT_TEXTURE_CACHE_MAX;

    // Resolve display settings with defaults
    const ld = options.layerDisplay;
    this.display = {
      visible: ld?.visible ?? true,
      opacity: ld?.opacity ?? 1.0,
      blendMode: ld?.blendMode ?? 'hillshade',
      hillshadeStrength: ld?.hillshadeStrength ?? 0.5,
    };
    this.visible = this.display.visible;
  }

  /**
   * Ensure the source is initialized.
   * Delegates to the source's ensureReady() method.
   */
  async ensureSourceReady(): Promise<void> {
    await this.source.ensureReady();
  }

  /**
   * Fetch a tile image and return a Three.js Texture.
   */
  async fetchTexture(coord: TileCoord): Promise<Texture> {
    const key = packTileKey(coord.z, coord.x, coord.y);

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
    return this.textureCache.get(packTileKey(coord.z, coord.x, coord.y));
  }

  /**
   * Remove a specific texture from cache.
   */
  disposeTexture(coord: TileCoord): void {
    const key = packTileKey(coord.z, coord.x, coord.y);
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
    this.lruOrder.clear();
  }

  // == Private: LRU management ==

  private touchLRU(key: number): void {
    this.lruOrder.delete(key);
    this.lruOrder.set(key, 1);
  }

  private removeLRU(key: number): void {
    this.lruOrder.delete(key);
  }

  private evictIfNeeded(): void {
    while (this.textureCache.size > this.textureCacheMax && this.lruOrder.size > 0) {
      const oldestKey = this.lruOrder.keys().next().value!;
      this.lruOrder.delete(oldestKey);
      const texture = this.textureCache.get(oldestKey);
      if (texture) {
        texture.dispose();
        this.textureCache.delete(oldestKey);
      }
    }
  }
}
