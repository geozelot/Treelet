// ============================================================================
// treelet.js - Tile Geometry
//
// Single shared grid mesh used by all tile instances. Every visible tile is
// an instance of this geometry, displaced and geomorphed in the vertex shader.
//
// N×N quad grid in [-0.5, +0.5] with UVs in [0, 1] (v up), front faces
// pointing +Z (counter-clockwise from above) so back faces can be culled.
// All quads share one diagonal orientation: when odd grid vertices collapse
// onto even ones during geomorphing, every 2×2 block degenerates exactly
// into one coarse quad with the same diagonal, keeping LOD boundaries
// watertight.
//
// Skirts (z = −1 marker, dropped in the shader) face outward on all four
// edges and hide sub-pixel cracks between tiles whose data hasn't loaded yet.
// ============================================================================

import {
  BufferGeometry,
  Float32BufferAttribute,
  Uint16BufferAttribute,
  Uint32BufferAttribute,
} from 'three';

/** Default tile grid resolution (quads per edge). */
export const TILE_GRID_RESOLUTION = 64;

/**
 * Build the shared tile grid geometry: a single N×N quad grid with
 * outward-facing skirts on all 4 edges.
 *
 * Surface: (N+1)² vertices, 2N² triangles. Skirt: 4(N+1) vertices, 8N triangles.
 */
export function buildTileGrid(resolution: number = TILE_GRID_RESOLUTION): BufferGeometry {
  const N = resolution;
  if (!Number.isInteger(N) || N < 2 || N % 2 !== 0) {
    throw new Error(`treelet: tile grid resolution must be an even integer >= 2, got ${N}`);
  }
  const V = N + 1;
  const surfaceVerts = V * V;
  const totalVerts = surfaceVerts + 4 * V;

  const positions = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indexCount = (N * N + 4 * N) * 6;
  const indices = totalVerts <= 65535 ? new Uint16Array(indexCount) : new Uint32Array(indexCount);

  const setVertex = (i: number, ix: number, iy: number, z: number) => {
    const u = ix / N;
    const v = iy / N;
    positions[i * 3] = u - 0.5;
    positions[i * 3 + 1] = v - 0.5;
    positions[i * 3 + 2] = z;
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  };

  for (let iy = 0; iy < V; iy++) {
    for (let ix = 0; ix < V; ix++) setVertex(iy * V + ix, ix, iy, 0);
  }

  let ptr = 0;
  // Surface: a=(ix,iy) b=(ix+1,iy) c=(ix,iy+1) d=(ix+1,iy+1); CCW from +Z.
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const a = iy * V + ix;
      const b = a + 1;
      const c = a + V;
      const d = c + 1;
      indices[ptr++] = a; indices[ptr++] = b; indices[ptr++] = c;
      indices[ptr++] = b; indices[ptr++] = d; indices[ptr++] = c;
    }
  }

  // Skirts: one strip per edge, vertices ordered by increasing x (bottom/top)
  // or increasing y (left/right). `outward` flips winding so each wall's
  // front face points away from the tile.
  let next = surfaceVerts;
  const addSkirt = (edge: (i: number) => [number, number], flip: boolean) => {
    const start = next;
    for (let i = 0; i < V; i++) {
      const [ix, iy] = edge(i);
      setVertex(next++, ix, iy, -1);
    }
    for (let i = 0; i < N; i++) {
      const [ix0, iy0] = edge(i);
      const [ix1, iy1] = edge(i + 1);
      const s0 = iy0 * V + ix0;
      const s1 = iy1 * V + ix1;
      const k0 = start + i;
      const k1 = start + i + 1;
      if (!flip) {
        indices[ptr++] = s0; indices[ptr++] = k0; indices[ptr++] = s1;
        indices[ptr++] = s1; indices[ptr++] = k0; indices[ptr++] = k1;
      } else {
        indices[ptr++] = s0; indices[ptr++] = s1; indices[ptr++] = k0;
        indices[ptr++] = s1; indices[ptr++] = k1; indices[ptr++] = k0;
      }
    }
  };
  addSkirt((i) => [i, 0], false); // south edge, faces −Y
  addSkirt((i) => [i, N], true);  // north edge, faces +Y
  addSkirt((i) => [0, i], true);  // west edge, faces −X
  addSkirt((i) => [N, i], false); // east edge, faces +X

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices instanceof Uint16Array
    ? new Uint16BufferAttribute(indices, 1)
    : new Uint32BufferAttribute(indices, 1));
  return geo;
}
