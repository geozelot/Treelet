// ============================================================================
// treelet.js - Drape Layer
//
// A drape layer binds a raster imagery source and per-layer display settings
// (opacity, blend mode, hillshade strength) to the terrain. Fetching and
// GPU residency are handled by TerrainRenderer + DrapeAtlas — the
// layer itself is a thin configuration + identity object.
// ============================================================================

import type { TileSource } from '../sources/TileSource';
import type { DrapePart } from '../workers/protocol';
import type { Layer } from './Layer';
import type {
  DrapeLayerOptions,
  ResolvedDrapeLayerDisplay,
} from './types';

/** Auto-incrementing ID counter for drape layers. */
let nextDrapeLayerId = 0;
let lodOffsetWarned = false;

/** Most source zoom levels finer than the terrain tile one slot composites (4×4 tiles). */
const MAX_SLOT_ZOOM_ROOM = 2;

/**
 * Drape layer for raster imagery overlaid on terrain meshes.
 *
 * Each drape layer:
 *   - References a tile source (XYZ, WMTS, or WMS)
 *   - Carries per-layer display settings (opacity, blend mode, hillshade)
 *   - Picks the source zoom for each terrain tile (as fine as its slot holds)
 *
 * Multiple drape layers may be registered; TerrainRenderer activates one at
 * a time. When a layer becomes active, its source is fetched through the
 * same pipeline that feeds the elevation atlas, with results landing in
 * the shared DrapeAtlas.
 */
export class DrapeLayer implements Layer {
  readonly id: string;
  readonly layerName: string;
  readonly source: TileSource;
  readonly attribution: string;
  readonly minZoom: number;
  readonly maxZoom: number;
  /**
   * @deprecated Ignored: drape tiles fetch as much detail as their slot holds
   * (see `mapDisplay.drapeSlotSize`). Kept for compatibility.
   */
  readonly lodOffset: number;

  /** Per-layer display settings. */
  readonly display: ResolvedDrapeLayerDisplay;

  /** Whether this drape layer is visible (active). */
  visible: boolean;

  /** Pixel width of the source's images, measured from a loaded tile (0 until then). */
  private measuredTileSize = 0;
  /** slotZoomRoom() for `roomSlotSize` (recomputed when either changes). */
  private roomSlotSize = -1;
  private room = 0;

  constructor(options: DrapeLayerOptions) {
    this.id = `drape-${nextDrapeLayerId++}`;
    this.layerName = options.layerName;
    this.source = options.layerSource;
    this.attribution = options.layerAttribution ?? options.layerSource.attribution ?? '';
    this.minZoom = options.minZoom ?? 0;
    this.maxZoom = Math.min(options.maxZoom ?? 22, 22);
    this.lodOffset = Math.max(1, Math.min(3, options.lodOffset ?? 1));
    if (this.lodOffset > 1 && !lodOffsetWarned) {
      lodOffsetWarned = true;
      console.warn(
        'treelet: DrapeLayerOptions.lodOffset is deprecated and ignored. Drape tiles now fetch as much ' +
        'detail as their slot holds; raise mapDisplay.drapeSlotSize (e.g. 512) for sharper imagery.',
      );
    }

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
   * Pixel width of the source's images: measured once a tile has loaded,
   * else the declared `tileSize × pixelRatio`; 0 when neither is known.
   */
  get tilePixels(): number {
    if (this.measuredTileSize > 0) return this.measuredTileSize;
    const px = this.source.tileSize * (this.source.pixelRatio ?? 1);
    return px > 0 ? px : 0;
  }

  /**
   * Record the real pixel width of a loaded source image (the first one
   * counts). A declared tileSize that doesn't match is reported once.
   */
  observeTileSize(px: number): void {
    if (this.measuredTileSize > 0 || !(px > 0)) return;
    const declared = this.tilePixels;
    if (declared > 0 && declared !== px) {
      console.info(
        `treelet: drape layer "${this.layerName}" declares ${declared}-px tiles but serves ${px}-px images; using ${px}.`,
      );
    }
    this.measuredTileSize = px;
    this.roomSlotSize = -1;
  }

  /**
   * Source zoom levels finer than the terrain tile that a drape slot of
   * `slotSize` pixels holds at full resolution: log2(slotSize / tilePixels),
   * from 0 (one source tile per slot; also when the tile size is unknown)
   * to 2 (4×4 tiles).
   */
  slotZoomRoom(slotSize: number): number {
    if (slotSize !== this.roomSlotSize) {
      const px = this.tilePixels;
      const room = px > 0 ? Math.round(Math.log2(slotSize / px)) : 0;
      this.room = Number.isFinite(room) ? Math.max(0, Math.min(MAX_SLOT_ZOOM_ROOM, room)) : 0;
      this.roomSlotSize = slotSize;
    }
    return this.room;
  }

  /**
   * Finest terrain tile zoom worth drawing for this drape: tiles that show
   * the source's max-zoom imagery at full resolution in a `slotSize` slot.
   */
  finestTileZoom(slotSize: number): number {
    return this.source.maxZoom - this.slotZoomRoom(slotSize);
  }

  /**
   * Source zoom to fetch for a terrain tile at zoom `z`: the finest whose
   * tiles still fit the slot at full resolution, capped at the source's
   * maxZoom (finer terrain tiles then crop a max-zoom tile). Below the
   * source's minZoom, finer tiles are composited (up to 4×4); -1 when even
   * that isn't enough.
   */
  sourceZoomFor(z: number, slotSize: number): number {
    const src = this.source;
    let ez = Math.min(z + this.slotZoomRoom(slotSize), Math.max(z, src.maxZoom));
    if (ez < src.minZoom) {
      if (src.minZoom - z > MAX_SLOT_ZOOM_ROOM) return -1;
      ez = src.minZoom;
    }
    return ez;
  }

  /**
   * Source images composited into the `slotSize` drape slot of terrain tile
   * z/x/y: one tile (or a crop of a coarser one past the source's maxZoom),
   * or a grid of finer tiles. `z` is the zoom of the result (the tile's own
   * zoom for crops); null when the source can't cover the tile.
   */
  drapeParts(z: number, x: number, y: number, slotSize: number): { z: number; parts: DrapePart[] } | null {
    const ez = this.sourceZoomFor(z, slotSize);
    if (ez < 0) return null;
    const src = this.source;
    const parts: DrapePart[] = [];

    if (ez <= z) {
      // Same zoom, or overzoom: crop the sub-region from a coarser source tile.
      const fz = Math.min(z, src.maxZoom);
      const dz = z - fz;
      const div = 2 ** dz;
      parts.push({
        url: src.getTileUrl({ z: fz, x: x >> dz, y: y >> dz }),
        dx: 0, dy: 0, dSize: slotSize,
        crop: dz > 0 ? { x: (x % div) / div, y: (y % div) / div, w: 1 / div, h: 1 / div } : null,
      });
      return { z, parts };
    }

    // Finer source zoom: composite div×div sub-tiles.
    const div = 2 ** (ez - z);
    const sub = slotSize / div;
    for (let sy = 0; sy < div; sy++) {
      for (let sx = 0; sx < div; sx++) {
        parts.push({
          url: src.getTileUrl({ z: ez, x: x * div + sx, y: y * div + sy }),
          dx: sx * sub, dy: sy * sub, dSize: sub,
          crop: null,
        });
      }
    }
    return { z: ez, parts };
  }

  /**
   * Ensure the source is initialized.
   * Delegates to the source's ensureReady() method.
   */
  async ensureSourceReady(): Promise<void> {
    await this.source.ensureReady();
  }
}
