// ============================================================================
// treelet.js - Tile Selection (CDLOD)
//
// Screen-space-error driven quadtree selection in the spirit of CDLOD
// (Strugar 2010). A tile of level z is refined when the camera is closer
// than K·size(z+1) to its footprint, where K follows from the viewport's
// focal length so every tile covers a roughly constant number of screen
// pixels at any zoom, tilt or viewport size.
//
// Each selected tile gets a morph range [start, end] in camera distance.
// The vertex shader slides odd grid vertices onto the coarse grid and blends
// toward the parent's elevation across that range, reaching the parent's
// exact geometry at `end` — the distance at which the neighbouring coarser
// tile begins. With K ≥ 3.2 the selection guarantees:
//   • neighbouring tiles differ by at most one level, and
//   • a coarse tile never morphs along an edge it shares with a finer one,
// so LOD boundaries are watertight and transitions are continuous in time.
//
// Distances are 3D from the camera to the tile footprint on a horizontal
// reference plane (the orbit target's height); the shader uses the identical
// metric per vertex, so CPU selection and GPU morphing always agree.
//
// Culling is radial (a horizon circle around the camera) plus the camera's
// four side planes against each tile's 3D box, whose height range comes from
// the loaded elevation data. LOD never depends on the cull region, so moving
// the culling boundaries can't change any tile's level.
// ============================================================================

import type { TileGrid } from '../tiles/TileGrid';
import { packTileKey, NO_TILE_KEY } from '../tiles/TileIndex';
import { MIN_LOD_RANGE_FACTOR } from '../core/constants';

/** A tile selected for rendering this frame. Pooled: valid until the next select(). */
export interface SelectedTile {
  key: number;
  z: number;
  x: number;
  y: number;
  /** World-space center and edge length. */
  centerX: number;
  centerY: number;
  size: number;
  /** Minimum camera distance to the tile footprint (fetch priority). */
  distance: number;
  /** Geomorph range in camera distance; start ≥ end means no morph. */
  morphStart: number;
  morphEnd: number;
  /** Whether any part of the tile can be morphing (parent data needed). */
  needsParent: boolean;
  /** Parent key (z−1) or NO_TILE_KEY at the coarsest level. */
  parentKey: number;
}

/** Culling region: a root box, a horizon radius and optional 3D side planes. */
export interface CullRegion {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Tiles whose footprint lies farther than this (ground distance from the camera) are dropped. */
  radius: number;
  /** 4 planes × (nx, ny, nz, d): inside when nx·x + ny·y + nz·z + d ≥ 0. */
  planes: Float64Array | null;
  /**
   * Optional lookahead along the camera's motion: extra offsets for the 4
   * planes and the radius ([d0, d1, d2, d3, r]). Dropped first when the
   * selection exceeds the budget, before any detail is given up.
   */
  prefetch: Float64Array | null;
}

/**
 * Height range of a tile in scene units: writes [min, max] into `out`.
 * Only consulted when 3D planes are given.
 */
export type HeightBounds = (z: number, x: number, y: number, south: number, north: number, out: Float64Array) => void;

export interface SelectParams {
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  /** Height of the horizontal plane distances are measured on. */
  refZ: number;
  /** Desired range factor (from focal length × quality); clamped to ≥ MIN_LOD_RANGE_FACTOR. */
  rangeFactor: number;
  minLevel: number;
  maxLevel: number;
  /** Fraction of each range used for morphing. */
  morphWidth: number;
  budget: number;
  cull: CullRegion;
  /** Tile height ranges for plane culling; flat at refZ when omitted. */
  heightBounds?: HeightBounds;
}

/** Morph distances for tiles that must never morph (coarsest level). */
const NO_MORPH_START = 1e20;
const NO_MORPH_END = 2e20;

function createTile(): SelectedTile {
  return {
    key: 0, z: 0, x: 0, y: 0,
    centerX: 0, centerY: 0, size: 0, distance: 0,
    morphStart: NO_MORPH_START, morphEnd: NO_MORPH_END,
    needsParent: false, parentKey: NO_TILE_KEY,
  };
}

const byDistance = (a: SelectedTile, b: SelectedTile) => a.distance - b.distance;

export class TilePool {
  private readonly tileGrid: TileGrid;
  private readonly pool: SelectedTile[] = [];
  private readonly _selected: SelectedTile[] = [];
  private count = 0;
  private overflow = false;

  /** Range factor actually used by the last select() (after budget fitting). */
  rangeFactor = MIN_LOD_RANGE_FACTOR;
  /** Whether the last select() had to drop tiles to respect the budget. */
  truncated = false;
  /** Whether the last select() included the motion lookahead. */
  prefetched = false;

  /** Budget-fitted factor kept from the previous frame (Infinity when unconstrained). */
  private fittedK = Infinity;
  private lastCount = 0;
  private usePrefetch = false;

  // Per-select parameters (avoids threading them through the recursion).
  private p!: SelectParams;
  private dz = 0;
  private half = 0;
  private readonly zRange = new Float64Array(2);

  constructor(tileGrid: TileGrid) {
    this.tileGrid = tileGrid;
  }

  /** Tiles selected by the last select(), nearest first. */
  get selected(): readonly SelectedTile[] {
    return this._selected;
  }

  /**
   * Select tiles for the current view. When the selection exceeds the
   * budget, the motion lookahead is dropped first, then the range factor is
   * lowered (coarser tiles) until it fits; if even the minimum factor
   * overflows, the farthest tiles are dropped and `truncated` is set.
   */
  select(params: SelectParams): readonly SelectedTile[] {
    this.p = params;
    this.dz = params.cameraZ - params.refZ;
    this.half = this.tileGrid.worldScale / 2;

    const minLevel = Math.max(0, Math.min(params.minLevel, params.maxLevel));
    const preferred = Math.max(MIN_LOD_RANGE_FACTOR, params.rangeFactor);
    let k = preferred;
    // Hysteresis: once the budget forced a coarser factor, keep it until the
    // view clearly fits at the preferred one (the tile count grows ~1.6× per
    // step), so the LOD doesn't flip back and forth between frames.
    if (this.fittedK < preferred && this.lastCount > params.budget * 0.5) k = this.fittedK;
    this.usePrefetch = params.cull.prefetch !== null;

    for (let attempt = 0; ; attempt++) {
      this.rangeFactor = k;
      this.runSelection(minLevel, k);
      if (!this.overflow || attempt >= 10) break;
      if (this.usePrefetch) {
        this.usePrefetch = false;
        continue;
      }
      if (k <= MIN_LOD_RANGE_FACTOR) break;
      k = Math.max(MIN_LOD_RANGE_FACTOR, k * 0.8);
    }
    this.fittedK = k < preferred ? k : Infinity;
    this.lastCount = this.count;
    this.prefetched = this.usePrefetch;

    const out = this._selected;
    out.length = 0;
    for (let i = 0; i < this.count; i++) out.push(this.pool[i]);
    out.sort(byDistance);
    this.truncated = this.overflow;
    if (out.length > params.budget) out.length = params.budget;
    return out;
  }

  private runSelection(minLevel: number, k: number): void {
    this.count = 0;
    this.overflow = false;
    const { cull } = this.p;
    const size = this.tileGrid.getTileSize(minLevel);
    const n = 2 ** minLevel;
    const half = this.half;
    const x0 = Math.max(0, Math.floor((cull.minX + half) / size));
    const x1 = Math.min(n - 1, Math.floor((cull.maxX + half) / size));
    const y0 = Math.max(0, Math.floor((half - cull.maxY) / size));
    const y1 = Math.min(n - 1, Math.floor((half - cull.minY) / size));
    // Hard limit on candidates collected (selection budget plus slack for
    // the farthest-first truncation fallback).
    const hardLimit = this.p.budget * 4;
    for (let y = y0; y <= y1 && this.count < hardLimit; y++) {
      for (let x = x0; x <= x1 && this.count < hardLimit; x++) {
        this.visit(minLevel, x, y, minLevel, k, hardLimit);
      }
    }
    if (this.count >= hardLimit) this.overflow = true;
  }

  private visit(z: number, x: number, y: number, minLevel: number, k: number, hardLimit: number): void {
    if (this.count >= hardLimit) {
      this.overflow = true;
      return;
    }
    const p = this.p;
    const size = this.tileGrid.getTileSize(z);
    const west = x * size - this.half;
    const east = west + size;
    const north = this.half - y * size;
    const south = north - size;

    const cull = p.cull;
    if (east < cull.minX || west > cull.maxX || north < cull.minY || south > cull.maxY) return;

    const cx = p.cameraX;
    const cy = p.cameraY;
    const dx = cx < west ? west - cx : cx > east ? cx - east : 0;
    const dy = cy < south ? south - cy : cy > north ? cy - north : 0;
    const ground2 = dx * dx + dy * dy;
    const prefetch = this.usePrefetch ? cull.prefetch : null;
    const radius = prefetch !== null ? cull.radius + prefetch[4] : cull.radius;
    if (ground2 > radius * radius) return;

    const planes = cull.planes;
    if (planes !== null) {
      const zr = this.zRange;
      if (p.heightBounds) p.heightBounds(z, x, y, south, north, zr);
      else { zr[0] = p.refZ; zr[1] = p.refZ; }
      for (let i = 0; i < 4; i++) {
        const o = i * 4;
        const nx = planes[o];
        const ny = planes[o + 1];
        const nz = planes[o + 2];
        const d = prefetch !== null ? planes[o + 3] + prefetch[i] : planes[o + 3];
        // Test the box corner farthest along the plane normal.
        const tx = nx > 0 ? east : west;
        const ty = ny > 0 ? north : south;
        const tz = nz > 0 ? zr[1] : zr[0];
        if (nx * tx + ny * ty + nz * tz + d < 0) return;
      }
    }

    const minDist = Math.sqrt(ground2 + this.dz * this.dz);

    if (z >= p.maxLevel || minDist >= k * size * 0.5) {
      this.emit(z, x, y, west, north, size, minDist, minLevel, k);
      return;
    }

    const cz = z + 1;
    const x2 = x * 2;
    const y2 = y * 2;
    this.visit(cz, x2, y2, minLevel, k, hardLimit);
    this.visit(cz, x2 + 1, y2, minLevel, k, hardLimit);
    this.visit(cz, x2, y2 + 1, minLevel, k, hardLimit);
    this.visit(cz, x2 + 1, y2 + 1, minLevel, k, hardLimit);
  }

  private emit(
    z: number, x: number, y: number,
    west: number, north: number, size: number,
    minDist: number, minLevel: number, k: number,
  ): void {
    if (this.count >= this.p.budget) this.overflow = true;
    if (this.count >= this.pool.length) this.pool.push(createTile());
    const t = this.pool[this.count++];
    t.key = packTileKey(z, x, y);
    t.z = z;
    t.x = x;
    t.y = y;
    t.size = size;
    t.centerX = west + size * 0.5;
    t.centerY = north - size * 0.5;
    t.distance = minDist;

    if (z <= minLevel) {
      t.morphStart = NO_MORPH_START;
      t.morphEnd = NO_MORPH_END;
      t.needsParent = false;
      t.parentKey = z > 0 ? packTileKey(z - 1, x >> 1, y >> 1) : NO_TILE_KEY;
      return;
    }

    // Fully morphed at K·size: where the parent level stops refining.
    // Morphing must not start before K·size/2 + √2·size, the farthest an
    // edge shared with a finer neighbour can lie.
    const end = k * size;
    const start = Math.max(end * (1 - this.p.morphWidth), end * 0.5 + Math.SQRT2 * size);
    t.morphEnd = end;
    t.morphStart = Math.min(start, end * 0.999);
    t.parentKey = packTileKey(z - 1, x >> 1, y >> 1);

    // Farthest footprint point decides whether morphing can occur at all.
    const cx = this.p.cameraX;
    const cy = this.p.cameraY;
    const fx = Math.max(Math.abs(west - cx), Math.abs(west + size - cx));
    const fy = Math.max(Math.abs(north - cy), Math.abs(north - size - cy));
    const maxDist = Math.sqrt(fx * fx + fy * fy + this.dz * this.dz);
    t.needsParent = maxDist > t.morphStart;
  }
}
