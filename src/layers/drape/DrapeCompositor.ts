// ============================================================================
// treelet.js - Drape Compositor
//
// Manages drape texture application on terrain meshes.
// Applies the single active drape layer's texture to each tile mesh
// via the terrain material's drape uniforms. No blending - one drape at a time.
//
// When a tile's LOD zoom < camera zoom, composites multiple full-resolution
// sub-tiles into a single texture to maintain drape quality across LOD rings.
// ============================================================================

import {
  Texture,
  SRGBColorSpace,
  LinearFilter,
  ClampToEdgeWrapping,
} from 'three';
import type { ShaderMaterial, Mesh } from 'three';
import type { TileCoord } from '../../core/types';
import { DrapeLayer } from './DrapeLayer';
import { setMaterialDrape, isTerrainMaterial } from '../../shaders/TerrainMaterial';

/** Maximum composite texture dimension (pixels). */
const MAX_COMPOSITE_SIZE = 1024;

/** Default source tile size (pixels). */
const SOURCE_TILE_SIZE = 256;

/**
 * Coordinates drape texture fetching and application to terrain meshes.
 * Supports one active drape layer at a time.
 *
 * For LOD-reduced tiles (coord.z < cameraZoom), composites multiple
 * full-resolution sub-tiles into a single texture so drape quality
 * is uniform across all LOD rings.
 */
export class DrapeCompositor {
  private activeDrapes: DrapeLayer[] = [];

  /** Cache of composite textures keyed by "layerId:z/x/y@camZ". */
  private compositeCache = new Map<string, Texture>();

  /** Reusable OffscreenCanvas for sub-tile compositing. */
  private compositeCanvas: OffscreenCanvas | null = null;

  /**
   * Set the active drape layers (expects 0 or 1 active).
   */
  setActiveDrapes(layers: DrapeLayer[]): void {
    this.activeDrapes = layers.filter((l) => l.active);
  }

  /**
   * Fetch drape texture for a tile and apply to its mesh.
   * When coord.z < cameraZoom, composites sub-tiles at full resolution.
   */
  async applyDrape(coord: TileCoord, mesh: Mesh, cameraZoom?: number): Promise<void> {
    const material = mesh.material;
    if (!isTerrainMaterial(material)) return;

    if (this.activeDrapes.length === 0) {
      setMaterialDrape(material as ShaderMaterial, null);
      return;
    }

    const drape = this.activeDrapes[0];

    try {
      let texture: Texture;

      if (cameraZoom === undefined || coord.z >= cameraZoom) {
        // Full-resolution tile or no zoom info: single-fetch path
        texture = await drape.fetchTexture(coord);
      } else {
        // LOD-reduced tile: composite sub-tiles at camera zoom
        const cacheKey = compositeKey(drape.id, coord, cameraZoom);
        const cached = this.compositeCache.get(cacheKey);
        if (cached) {
          texture = cached;
        } else {
          texture = await this.compositeSubTiles(drape, coord, cameraZoom);
          this.compositeCache.set(cacheKey, texture);
        }
      }

      // Tile might have been removed while fetching
      if (!mesh.parent) return;

      setMaterialDrape(material as ShaderMaterial, texture, drape.opacity);
    } catch (err) {
      console.warn(`treelet: drape texture fetch failed for ${coord.z}/${coord.x}/${coord.y}:`, err);
    }
  }

  /**
   * Remove drape texture from a mesh.
   */
  clearDrape(mesh: Mesh): void {
    const material = mesh.material;
    if (isTerrainMaterial(material)) {
      setMaterialDrape(material as ShaderMaterial, null);
    }
  }

  /**
   * Reapply drapes to all provided meshes (used when drape layers change).
   */
  async reapplyAll(
    meshes: Array<{ coord: TileCoord; mesh: Mesh }>,
    cameraZoom?: number,
  ): Promise<void> {
    await Promise.all(
      meshes.map(({ coord, mesh }) => this.applyDrape(coord, mesh, cameraZoom)),
    );
  }

  /**
   * Evict composite textures associated with a specific tile coordinate.
   * Called when a tile is unloaded.
   *
   * Uses structured key matching to avoid false positives
   * (e.g., coord "1/2/3" no longer matches key "11/2/3").
   */
  evictCompositesForTile(coord: TileCoord): void {
    const coordStr = `${coord.z}/${coord.x}/${coord.y}@`;
    for (const [key, tex] of this.compositeCache) {
      // Keys are formatted as "layerId:z/x/y@camZ"
      // Match only after the ":" separator to avoid false prefix matches
      const colonIdx = key.indexOf(':');
      if (colonIdx !== -1 && key.substring(colonIdx + 1).startsWith(coordStr)) {
        tex.dispose();
        this.compositeCache.delete(key);
      }
    }
  }

  /**
   * Dispose all composite textures.
   */
  clearCompositeCache(): void {
    for (const tex of this.compositeCache.values()) {
      tex.dispose();
    }
    this.compositeCache.clear();
  }

  // ===========================================================================
  // Private: Sub-tile Compositing
  // ===========================================================================

  /**
   * Fetch sub-tiles at cameraZoom that cover a single LOD tile's extent,
   * composite them onto an OffscreenCanvas, and return a Three.js Texture.
   *
   * After compositing, disposes the intermediate sub-tile textures from
   * the drape layer's cache to free GPU memory.
   */
  private async compositeSubTiles(
    layer: DrapeLayer,
    lodCoord: TileCoord,
    cameraZoom: number,
  ): Promise<Texture> {
    const zoomDiff = cameraZoom - lodCoord.z;
    const scale = Math.pow(2, zoomDiff); // e.g., 4 for zoomDiff=2

    // Output canvas size: scale * sourceSize, capped at MAX_COMPOSITE_SIZE
    const compositeSize = Math.min(scale * SOURCE_TILE_SIZE, MAX_COMPOSITE_SIZE);
    const subTileDrawSize = compositeSize / scale;

    // Generate all sub-tile coordinates
    const subTiles: Array<{ coord: TileCoord; dx: number; dy: number }> = [];
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        subTiles.push({
          coord: {
            z: cameraZoom,
            x: lodCoord.x * scale + dx,
            y: lodCoord.y * scale + dy,
          },
          dx,
          dy,
        });
      }
    }

    // Fetch all sub-tile textures in parallel
    const fetchResults = await Promise.allSettled(
      subTiles.map(async (st) => {
        const texture = await layer.fetchTexture(st.coord);
        return { ...st, texture };
      }),
    );

    const succeeded = fetchResults.filter(
      (r): r is PromiseFulfilledResult<{ coord: TileCoord; dx: number; dy: number; texture: Texture }> =>
        r.status === 'fulfilled',
    );

    // Total failure: fall back to single LOD-resolution tile
    if (succeeded.length === 0) {
      return layer.fetchTexture(lodCoord);
    }

    // Reuse OffscreenCanvas when size matches, otherwise create new
    if (!this.compositeCanvas || this.compositeCanvas.width !== compositeSize || this.compositeCanvas.height !== compositeSize) {
      this.compositeCanvas = new OffscreenCanvas(compositeSize, compositeSize);
    }
    const canvas = this.compositeCanvas;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, compositeSize, compositeSize);

    // If some sub-tiles failed, draw stretched LOD tile as background
    if (succeeded.length < subTiles.length) {
      try {
        const fallback = await layer.fetchTexture(lodCoord);
        const fallbackImg = fallback.image as ImageBitmap;
        ctx.drawImage(fallbackImg, 0, 0, compositeSize, compositeSize);
      } catch {
        // Even fallback failed; gaps will be transparent/black
      }
    }

    // Draw high-res sub-tiles on top at correct positions
    for (const result of succeeded) {
      const { dx, dy, texture } = result.value;
      const img = texture.image as ImageBitmap;
      ctx.drawImage(
        img,
        dx * subTileDrawSize,
        dy * subTileDrawSize,
        subTileDrawSize,
        subTileDrawSize,
      );
    }

    // Dispose intermediate sub-tile textures from the drape layer's cache
    // since they've been composited and are no longer needed individually
    for (const result of succeeded) {
      layer.disposeTexture(result.value.coord);
    }

    // Convert canvas to ImageBitmap, then to Three.js Texture
    const compositeBitmap = await createImageBitmap(canvas);
    const compositeTexture = new Texture(compositeBitmap);
    compositeTexture.colorSpace = SRGBColorSpace;
    compositeTexture.minFilter = LinearFilter;
    compositeTexture.magFilter = LinearFilter;
    compositeTexture.wrapS = ClampToEdgeWrapping;
    compositeTexture.wrapT = ClampToEdgeWrapping;
    compositeTexture.generateMipmaps = false;
    compositeTexture.flipY = false;
    compositeTexture.needsUpdate = true;

    return compositeTexture;
  }
}

/** Build a cache key for composite textures. */
function compositeKey(layerId: string, coord: TileCoord, cameraZoom: number): string {
  return `${layerId}:${coord.z}/${coord.x}/${coord.y}@${cameraZoom}`;
}
