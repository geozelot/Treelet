// ============================================================================
// treelet.js - Tile Geometry
//
// Single shared grid mesh used by all tile instances. Every visible tile is
// an instance of this geometry, displaced per-instance in the vertex shader.
//
// 64×64 quad grid in [-0.5, +0.5] with UVs in [0, 1]. Skirt geometry on
// all 4 edges hides LOD cracks between adjacent tiles at different zoom levels.
// ============================================================================

import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from 'three';

/** Default tile grid resolution (quads per edge). */
export const TILE_GRID_RESOLUTION = 64;

/**
 * Write skirt quad triangles connecting surface boundary vertices to their
 * skirt duplicates. Creates one quad (2 triangles) per consecutive edge pair.
 */
function writeSkirtQuads(
  indices: Uint32Array,
  ptr: number,
  surfaceEdge: number[],
  skirtEdge: number[],
): number {
  for (let i = 0; i < surfaceEdge.length - 1; i++) {
    const s0 = surfaceEdge[i], s1 = surfaceEdge[i + 1];
    const k0 = skirtEdge[i], k1 = skirtEdge[i + 1];
    indices[ptr++] = s0; indices[ptr++] = k0; indices[ptr++] = s1;
    indices[ptr++] = s1; indices[ptr++] = k0; indices[ptr++] = k1;
  }
  return ptr;
}

/**
 * For each (ix, iy) coordinate on an edge, record the surface vertex index
 * and create a matching skirt vertex with z=-1 at the same XY/UV position.
 */
function addEdgeSkirt(
  coords: Array<[number, number]>,
  positions: Float32Array,
  uvs: Float32Array,
  si: number,
  N: number,
  V: number,
): { surfaceEdge: number[]; skirtEdge: number[]; nextSi: number } {
  const surfaceEdge: number[] = [];
  const skirtEdge: number[] = [];
  for (const [ix, iy] of coords) {
    surfaceEdge.push(iy * V + ix);
    const u = ix / N, v = iy / N;
    positions[si * 3] = u - 0.5;
    positions[si * 3 + 1] = v - 0.5;
    positions[si * 3 + 2] = -1;
    uvs[si * 2] = u;
    uvs[si * 2 + 1] = v;
    skirtEdge.push(si);
    si++;
  }
  return { surfaceEdge, skirtEdge, nextSi: si };
}

/**
 * Build the shared tile grid geometry: a single NxN quad grid with
 * boundary skirt geometry on all 4 edges.
 *
 * Surface: (N+1)×(N+1) vertices, N×N×2 triangles.
 * Skirt: 4 outer edges × (N+1) vertices with z=-1, 4×N×2 triangles.
 */
export function buildTileGrid(resolution: number = TILE_GRID_RESOLUTION): BufferGeometry {
  const N = resolution;
  const V = N + 1; // vertices per edge

  // Vertex counts
  const surfaceVertCount = V * V;
  const skirtVertCount = 4 * V; // 4 outer edges
  const totalVertCount = surfaceVertCount + skirtVertCount;

  // Index counts
  const surfaceQuadCount = N * N;
  const skirtQuadCount = 4 * N;

  const positions = new Float32Array(totalVertCount * 3);
  const uvs = new Float32Array(totalVertCount * 2);
  const indices = new Uint32Array((surfaceQuadCount + skirtQuadCount) * 6);

  // === Surface vertices ===
  for (let iy = 0; iy < V; iy++) {
    for (let ix = 0; ix < V; ix++) {
      const idx = iy * V + ix;
      const u = ix / N;
      const v = iy / N;
      positions[idx * 3] = u - 0.5;
      positions[idx * 3 + 1] = v - 0.5;
      positions[idx * 3 + 2] = 0;
      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;
    }
  }

  // === Skirt vertices ===
  let si = surfaceVertCount;
  const edgeDefs: Array<Array<[number, number]>> = [[], [], [], []];
  for (let i = 0; i < V; i++) {
    edgeDefs[0].push([i, 0]);   // top
    edgeDefs[1].push([i, N]);   // bottom
    edgeDefs[2].push([0, i]);   // left
    edgeDefs[3].push([N, i]);   // right
  }

  const edges: Array<{ surfaceEdge: number[]; skirtEdge: number[] }> = [];
  for (const coords of edgeDefs) {
    const result = addEdgeSkirt(coords, positions, uvs, si, N, V);
    edges.push(result);
    si = result.nextSi;
  }

  // === Surface indices ===
  let ptr = 0;
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const a = iy * V + ix;
      const b = a + 1;
      const c = a + V;
      const d = c + 1;
      indices[ptr++] = a; indices[ptr++] = c; indices[ptr++] = b;
      indices[ptr++] = b; indices[ptr++] = c; indices[ptr++] = d;
    }
  }

  // === Skirt indices ===
  for (const edge of edges) {
    ptr = writeSkirtQuads(indices, ptr, edge.surfaceEdge, edge.skirtEdge);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geo.setIndex(new Uint32BufferAttribute(indices, 1));
  return geo;
}
