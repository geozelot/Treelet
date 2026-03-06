// ============================================================================
// treelet.js - Seam Resolver
//
// Averages elevation values at shared tile edges so adjacent tiles
// connect seamlessly without visible cracks. Runs on the main thread
// because it needs access to both tiles' geometries via the cache.
//
// Supports cross-LOD seam resolution: when a high-zoom tile is adjacent
// to a lower-zoom tile, the high-zoom tile's edge vertices are snapped
// to interpolated positions along the low-zoom tile's edge.
// ============================================================================

import type { TileCoord } from '../../core/types';
import type { BufferAttribute, Mesh } from 'three';
import type { TileCache, CacheEntry } from '../../tiles/TileCache';

/** Direction constants for edge identification. */
const enum Direction {
  North,
  South,
  West,
  East,
}

/**
 * Resolves gaps between adjacent tile meshes by averaging shared
 * edge vertices at the same zoom level, and snapping high-zoom edges
 * to interpolated low-zoom edges for cross-LOD boundaries.
 *
 * Batches normal recomputation: collects all dirty meshes and
 * recomputes once per resolve().
 */
export class SeamResolver {
  private readonly segments: number;
  /** Maximum zoom level difference to search for cross-LOD neighbors. */
  private readonly maxZoomDiff: number;

  constructor(segments: number, maxZoomDiff: number = 2) {
    this.segments = segments;
    this.maxZoomDiff = maxZoomDiff;
  }

  /**
   * Resolve seams between a newly-loaded tile and its cached neighbors.
   *
   * 1. Same-zoom neighbors: average the shared edge Z values.
   * 2. Cross-LOD neighbors: snap the high-zoom tile's edge to the
   *    interpolated low-zoom tile's edge.
   */
  resolve(coord: TileCoord, cache: TileCache): void {
    const entry = cache.get(coord);
    if (!entry) return;

    const vertsPerSide = this.segments + 1;
    const positions = entry.mesh.geometry.getAttribute('position') as BufferAttribute;

    // Collect all meshes that need normal recomputation (deduped via Set)
    const dirtyMeshes = new Set<Mesh>();

    // --- Same-zoom seam resolution (N, S, W, E) ---

    // North neighbor: our row 0 ↔ their last row
    const northEntry = this.getNeighborEntry(cache, coord, 0, -1);
    if (northEntry) {
      const nPos = northEntry.mesh.geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < vertsPerSide; i++) {
        const ourIdx = i; // row 0, col i
        const theirIdx = this.segments * vertsPerSide + i; // last row, col i
        const avg = (positions.getZ(ourIdx) + nPos.getZ(theirIdx)) / 2;
        positions.setZ(ourIdx, avg);
        nPos.setZ(theirIdx, avg);
      }
      this.markPositionsDirty(northEntry.mesh);
      dirtyMeshes.add(northEntry.mesh);
    }

    // South neighbor: our last row ↔ their row 0
    const southEntry = this.getNeighborEntry(cache, coord, 0, 1);
    if (southEntry) {
      const sPos = southEntry.mesh.geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < vertsPerSide; i++) {
        const ourIdx = this.segments * vertsPerSide + i; // last row
        const theirIdx = i; // first row
        const avg = (positions.getZ(ourIdx) + sPos.getZ(theirIdx)) / 2;
        positions.setZ(ourIdx, avg);
        sPos.setZ(theirIdx, avg);
      }
      this.markPositionsDirty(southEntry.mesh);
      dirtyMeshes.add(southEntry.mesh);
    }

    // West neighbor: our col 0 ↔ their last col
    const westEntry = this.getNeighborEntry(cache, coord, -1, 0);
    if (westEntry) {
      const wPos = westEntry.mesh.geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < vertsPerSide; i++) {
        const ourIdx = i * vertsPerSide; // col 0
        const theirIdx = i * vertsPerSide + this.segments; // last col
        const avg = (positions.getZ(ourIdx) + wPos.getZ(theirIdx)) / 2;
        positions.setZ(ourIdx, avg);
        wPos.setZ(theirIdx, avg);
      }
      this.markPositionsDirty(westEntry.mesh);
      dirtyMeshes.add(westEntry.mesh);
    }

    // East neighbor: our last col ↔ their col 0
    const eastEntry = this.getNeighborEntry(cache, coord, 1, 0);
    if (eastEntry) {
      const ePos = eastEntry.mesh.geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < vertsPerSide; i++) {
        const ourIdx = i * vertsPerSide + this.segments; // last col
        const theirIdx = i * vertsPerSide; // col 0
        const avg = (positions.getZ(ourIdx) + ePos.getZ(theirIdx)) / 2;
        positions.setZ(ourIdx, avg);
        ePos.setZ(theirIdx, avg);
      }
      this.markPositionsDirty(eastEntry.mesh);
      dirtyMeshes.add(eastEntry.mesh);
    }

    // --- Cross-LOD seam resolution ---
    // For each direction where no same-zoom neighbor was found,
    // search for a lower-zoom tile covering the adjacent space.
    // Also check if higher-zoom tiles border this tile.

    if (!northEntry) {
      this.resolveCrossLOD(coord, entry, positions, Direction.North, cache, dirtyMeshes);
    }
    if (!southEntry) {
      this.resolveCrossLOD(coord, entry, positions, Direction.South, cache, dirtyMeshes);
    }
    if (!westEntry) {
      this.resolveCrossLOD(coord, entry, positions, Direction.West, cache, dirtyMeshes);
    }
    if (!eastEntry) {
      this.resolveCrossLOD(coord, entry, positions, Direction.East, cache, dirtyMeshes);
    }

    // Also check if this tile is a LOW-zoom tile adjacent to HIGH-zoom tiles.
    // When a low-zoom tile loads, snap any existing high-zoom neighbors' edges.
    this.resolveAsLowZoomNeighbor(coord, entry, cache, dirtyMeshes);

    if (dirtyMeshes.size > 0) {
      // Mark the current tile's positions dirty and add to batch
      this.markPositionsDirty(entry.mesh);
      dirtyMeshes.add(entry.mesh);

      // Batch: recompute normals once per dirty mesh
      for (const mesh of dirtyMeshes) {
        mesh.geometry.computeVertexNormals();
      }
    }
  }

  /**
   * For a given tile and direction, search for a lower-zoom tile that
   * covers the adjacent space and snap this tile's edge to match.
   */
  private resolveCrossLOD(
    coord: TileCoord,
    _entry: CacheEntry, // eslint-disable-line @typescript-eslint/no-unused-vars -- positions already extracted by caller
    positions: BufferAttribute,
    direction: Direction,
    cache: TileCache,
    dirtyMeshes: Set<Mesh>,
  ): void {
    const vertsPerSide = this.segments + 1;

    // Search for lower-zoom neighbor covering the adjacent space
    for (let d = 1; d <= this.maxZoomDiff && d <= coord.z; d++) {
      const lowNeighbor = this.findLowZoomNeighbor(coord, direction, d);
      if (!lowNeighbor) continue;

      const lowEntry = cache.get(lowNeighbor.coord);
      if (!lowEntry) continue;

      // Found a lower-zoom neighbor - snap our edge to their interpolated edge
      const lowPos = lowEntry.mesh.geometry.getAttribute('position') as BufferAttribute;

      this.snapEdgeToLowZoom(
        positions,
        lowPos,
        direction,
        lowNeighbor.startFrac,
        lowNeighbor.endFrac,
        vertsPerSide,
      );

      this.markPositionsDirty(lowEntry.mesh);
      dirtyMeshes.add(lowEntry.mesh);
      break; // Only resolve with the closest lower-zoom neighbor
    }
  }

  /**
   * When a tile loads, check if it serves as a low-zoom neighbor for
   * existing higher-zoom tiles along each of its edges.
   */
  private resolveAsLowZoomNeighbor(
    coord: TileCoord,
    _entry: CacheEntry,
    cache: TileCache,
    dirtyMeshes: Set<Mesh>,
  ): void {
    const vertsPerSide = this.segments + 1;
    const lowPos = _entry.mesh.geometry.getAttribute('position') as BufferAttribute;

    for (let d = 1; d <= this.maxZoomDiff; d++) {
      const highZoom = coord.z + d;
      const scale = 1 << d;

      // For each direction, find high-zoom tiles that border this tile's edge
      // North edge of this tile: high-zoom tiles with y = coord.y * scale - 1
      this.snapHighZoomNeighbors(
        coord, highZoom, scale, Direction.North, lowPos,
        cache, dirtyMeshes, vertsPerSide,
      );
      // South edge
      this.snapHighZoomNeighbors(
        coord, highZoom, scale, Direction.South, lowPos,
        cache, dirtyMeshes, vertsPerSide,
      );
      // West edge
      this.snapHighZoomNeighbors(
        coord, highZoom, scale, Direction.West, lowPos,
        cache, dirtyMeshes, vertsPerSide,
      );
      // East edge
      this.snapHighZoomNeighbors(
        coord, highZoom, scale, Direction.East, lowPos,
        cache, dirtyMeshes, vertsPerSide,
      );
    }
  }

  /**
   * Find high-zoom tiles along a specific edge of a low-zoom tile and snap them.
   */
  private snapHighZoomNeighbors(
    lowCoord: TileCoord,
    highZoom: number,
    scale: number,
    direction: Direction,
    lowPos: BufferAttribute,
    cache: TileCache,
    dirtyMeshes: Set<Mesh>,
    vertsPerSide: number,
  ): void {
    const maxHighTile = Math.pow(2, highZoom);

    // Determine which high-zoom tiles border this low-zoom tile's edge
    // The low-zoom tile covers high-zoom tiles from
    //   x: [lowCoord.x * scale, lowCoord.x * scale + scale - 1]
    //   y: [lowCoord.y * scale, lowCoord.y * scale + scale - 1]
    const xStart = lowCoord.x * scale;
    const yStart = lowCoord.y * scale;

    if (direction === Direction.North) {
      // High-zoom tiles just above this low-zoom tile: y = yStart - 1
      const hy = yStart - 1;
      if (hy < 0) return;
      for (let s = 0; s < scale; s++) {
        const hx = xStart + s;
        const highCoord: TileCoord = { z: highZoom, x: hx, y: hy };
        const highEntry = cache.get(highCoord);
        if (!highEntry) continue;

        // This high-zoom tile's south edge borders our north edge
        // The high tile's position within the low tile's north edge
        const startFrac = s / scale;
        const endFrac = (s + 1) / scale;
        const highPos = highEntry.mesh.geometry.getAttribute('position') as BufferAttribute;

        // The high-zoom tile's south edge should match our north edge
        this.snapEdgeToLowZoom(
          highPos, lowPos,
          Direction.South, // The high tile's SOUTH edge faces our NORTH edge
          startFrac, endFrac,
          vertsPerSide,
        );
        this.markPositionsDirty(highEntry.mesh);
        dirtyMeshes.add(highEntry.mesh);
      }
    } else if (direction === Direction.South) {
      // High-zoom tiles just below: y = yStart + scale
      const hy = yStart + scale;
      if (hy >= maxHighTile) return;
      for (let s = 0; s < scale; s++) {
        const hx = xStart + s;
        const highCoord: TileCoord = { z: highZoom, x: hx, y: hy };
        const highEntry = cache.get(highCoord);
        if (!highEntry) continue;

        const startFrac = s / scale;
        const endFrac = (s + 1) / scale;
        const highPos = highEntry.mesh.geometry.getAttribute('position') as BufferAttribute;

        this.snapEdgeToLowZoom(
          highPos, lowPos,
          Direction.North, // The high tile's NORTH edge faces our SOUTH edge
          startFrac, endFrac,
          vertsPerSide,
        );
        this.markPositionsDirty(highEntry.mesh);
        dirtyMeshes.add(highEntry.mesh);
      }
    } else if (direction === Direction.West) {
      // High-zoom tiles just left: x = xStart - 1
      const hx = xStart - 1;
      if (hx < 0) return; // No wrap for simplicity; could add wrap
      for (let s = 0; s < scale; s++) {
        const hy = yStart + s;
        const highCoord: TileCoord = { z: highZoom, x: hx, y: hy };
        const highEntry = cache.get(highCoord);
        if (!highEntry) continue;

        const startFrac = s / scale;
        const endFrac = (s + 1) / scale;
        const highPos = highEntry.mesh.geometry.getAttribute('position') as BufferAttribute;

        this.snapEdgeToLowZoom(
          highPos, lowPos,
          Direction.East, // The high tile's EAST edge faces our WEST edge
          startFrac, endFrac,
          vertsPerSide,
        );
        this.markPositionsDirty(highEntry.mesh);
        dirtyMeshes.add(highEntry.mesh);
      }
    } else if (direction === Direction.East) {
      // High-zoom tiles just right: x = xStart + scale
      const hx = xStart + scale;
      if (hx >= maxHighTile) return;
      for (let s = 0; s < scale; s++) {
        const hy = yStart + s;
        const highCoord: TileCoord = { z: highZoom, x: hx, y: hy };
        const highEntry = cache.get(highCoord);
        if (!highEntry) continue;

        const startFrac = s / scale;
        const endFrac = (s + 1) / scale;
        const highPos = highEntry.mesh.geometry.getAttribute('position') as BufferAttribute;

        this.snapEdgeToLowZoom(
          highPos, lowPos,
          Direction.West, // The high tile's WEST edge faces our EAST edge
          startFrac, endFrac,
          vertsPerSide,
        );
        this.markPositionsDirty(highEntry.mesh);
        dirtyMeshes.add(highEntry.mesh);
      }
    }
  }

  /**
   * Find the lower-zoom tile that covers the space adjacent to `coord`
   * in the given direction, at zoom difference `d`.
   *
   * Returns the low-zoom tile coord and the fractional range [startFrac, endFrac]
   * indicating which portion of the low-zoom tile's edge corresponds to
   * the high-zoom tile's full edge.
   */
  private findLowZoomNeighbor(
    coord: TileCoord,
    direction: Direction,
    d: number,
  ): { coord: TileCoord; startFrac: number; endFrac: number } | null {
    const lowZoom = coord.z - d;
    if (lowZoom < 0) return null;

    const scale = 1 << d;

    // Compute which same-zoom neighbor cell we're looking at
    let nx = coord.x;
    let ny = coord.y;
    if (direction === Direction.North) ny = coord.y - 1;
    else if (direction === Direction.South) ny = coord.y + 1;
    else if (direction === Direction.West) nx = coord.x - 1;
    else if (direction === Direction.East) nx = coord.x + 1;

    const maxTile = Math.pow(2, coord.z);
    // Vertical out-of-range
    if (ny < 0 || ny >= maxTile) return null;
    // Horizontal wrap
    nx = ((nx % maxTile) + maxTile) % maxTile;

    // Map the same-zoom neighbor cell to the low-zoom tile containing it
    const lowX = Math.floor(nx / scale);
    const lowY = Math.floor(ny / scale);

    // Compute the fractional position of our tile's edge on the low-zoom tile's edge
    // For N/S edges: fraction depends on x position within the low-zoom tile
    // For W/E edges: fraction depends on y position within the low-zoom tile
    let startFrac: number;
    let endFrac: number;

    if (direction === Direction.North || direction === Direction.South) {
      // Our tile spans a horizontal fraction of the low-zoom tile
      const posInLow = coord.x % scale;
      startFrac = posInLow / scale;
      endFrac = (posInLow + 1) / scale;
    } else {
      // Our tile spans a vertical fraction of the low-zoom tile
      const posInLow = coord.y % scale;
      startFrac = posInLow / scale;
      endFrac = (posInLow + 1) / scale;
    }

    return {
      coord: { z: lowZoom, x: lowX, y: lowY },
      startFrac,
      endFrac,
    };
  }

  /**
   * Snap a high-zoom tile's edge vertices to match the interpolated
   * positions from a low-zoom tile's opposing edge.
   *
   * @param highPos - Position attribute of the high-zoom tile (modified in place)
   * @param lowPos - Position attribute of the low-zoom tile (read only)
   * @param highEdge - Which edge of the high-zoom tile to snap
   * @param startFrac - Start fraction [0,1] on the low-zoom tile's opposing edge
   * @param endFrac - End fraction [0,1] on the low-zoom tile's opposing edge
   * @param vertsPerSide - Number of vertices per side (segments + 1)
   */
  private snapEdgeToLowZoom(
    highPos: BufferAttribute,
    lowPos: BufferAttribute,
    highEdge: Direction,
    startFrac: number,
    endFrac: number,
    vertsPerSide: number,
  ): void {
    const segments = this.segments;

    for (let i = 0; i < vertsPerSide; i++) {
      // Normalized position along the high-zoom tile's edge [0, 1]
      const t = i / segments;

      // Map to position along the low-zoom tile's opposing edge
      const lowT = startFrac + t * (endFrac - startFrac);

      // Interpolate Z from the low-zoom tile's opposing edge
      const lowZ = this.sampleLowEdgeZ(lowPos, highEdge, lowT, vertsPerSide);

      // Get the high-zoom vertex index for this edge position
      const highIdx = this.getEdgeVertexIndex(highEdge, i, vertsPerSide);

      // Snap to the low-zoom tile's interpolated value
      highPos.setZ(highIdx, lowZ);
    }

    highPos.needsUpdate = true;
  }

  /**
   * Sample the Z value at a fractional position along the opposing edge
   * of the low-zoom tile.
   *
   * @param lowPos - Low-zoom tile's position attribute
   * @param highEdge - The high-zoom tile's edge direction. The low-zoom tile's
   *                   opposing edge is the opposite direction.
   * @param t - Fractional position [0, 1] along the low-zoom edge
   * @param vertsPerSide - Vertices per side
   */
  private sampleLowEdgeZ(
    lowPos: BufferAttribute,
    highEdge: Direction,
    t: number,
    vertsPerSide: number,
  ): number {
    const segments = this.segments;

    // Map t to a floating-point vertex index along the low-zoom edge
    const fIdx = t * segments;
    const idx0 = Math.floor(fIdx);
    const idx1 = Math.min(idx0 + 1, segments);
    const frac = fIdx - idx0;

    // Determine which edge of the low-zoom tile is opposite to the high-zoom edge
    // High's North edge ↔ Low's South edge, etc.
    let v0Idx: number;
    let v1Idx: number;

    switch (highEdge) {
      case Direction.North:
        // High's north ↔ low's south (last row)
        v0Idx = segments * vertsPerSide + idx0;
        v1Idx = segments * vertsPerSide + idx1;
        break;
      case Direction.South:
        // High's south ↔ low's north (first row)
        v0Idx = idx0;
        v1Idx = idx1;
        break;
      case Direction.West:
        // High's west ↔ low's east (last col)
        v0Idx = idx0 * vertsPerSide + segments;
        v1Idx = idx1 * vertsPerSide + segments;
        break;
      case Direction.East:
        // High's east ↔ low's west (first col)
        v0Idx = idx0 * vertsPerSide;
        v1Idx = idx1 * vertsPerSide;
        break;
    }

    const z0 = lowPos.getZ(v0Idx);
    const z1 = lowPos.getZ(v1Idx);

    return z0 + frac * (z1 - z0);
  }

  /**
   * Get the vertex index for position `i` along a tile edge.
   */
  private getEdgeVertexIndex(
    edge: Direction,
    i: number,
    vertsPerSide: number,
  ): number {
    switch (edge) {
      case Direction.North:
        return i; // row 0, col i
      case Direction.South:
        return this.segments * vertsPerSide + i; // last row, col i
      case Direction.West:
        return i * vertsPerSide; // col 0, row i
      case Direction.East:
        return i * vertsPerSide + this.segments; // last col, row i
    }
  }

  /**
   * Look up a neighbor at the same zoom level.
   */
  private getNeighborEntry(
    cache: TileCache,
    coord: TileCoord,
    dx: number,
    dy: number,
  ): CacheEntry | undefined {
    const maxTile = Math.pow(2, coord.z);
    const nx = coord.x + dx;
    const ny = coord.y + dy;

    // Out-of-range vertically
    if (ny < 0 || ny >= maxTile) return undefined;

    // Wrap horizontally
    const wrappedX = ((nx % maxTile) + maxTile) % maxTile;

    return cache.get({ z: coord.z, x: wrappedX, y: ny });
  }

  /**
   * Mark a mesh's position attribute as needing GPU re-upload.
   */
  private markPositionsDirty(mesh: Mesh): void {
    const pos = mesh.geometry.getAttribute('position');
    if (pos) {
      (pos as BufferAttribute).needsUpdate = true;
    }
  }
}
