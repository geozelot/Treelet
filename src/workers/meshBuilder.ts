// ============================================================================
// treelet.js - Mesh Builder
//
// Pure-function module that generates displaced plane geometry arrays
// from elevation data. Runs inside Web Workers (no DOM / Three.js deps).
// ============================================================================

/**
 * Output from the mesh builder - raw typed arrays ready for BufferGeometry.
 */
export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
}

/**
 * Sample an elevation value from the grid using bilinear interpolation.
 *
 * @param u - Normalized x position [0, 1]
 * @param v - Normalized y position [0, 1]
 * @param elevations - Flat elevation array (row-major)
 * @param w - Elevation grid width
 * @param h - Elevation grid height
 */
function sampleElevation(
  u: number,
  v: number,
  elevations: Float32Array,
  w: number,
  h: number,
): number {
  const fx = u * (w - 1);
  const fy = v * (h - 1);

  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;

  const ix1 = Math.min(ix + 1, w - 1);
  const iy1 = Math.min(iy + 1, h - 1);

  const a = elevations[iy * w + ix];
  const b = elevations[iy * w + ix1];
  const c = elevations[iy1 * w + ix];
  const d = elevations[iy1 * w + ix1];

  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/**
 * Build displaced plane mesh arrays from elevation data.
 *
 * The resulting geometry is centered on the origin:
 *   X: [-tileWorldSize/2, +tileWorldSize/2]  (right)
 *   Y: [-tileWorldSize/2, +tileWorldSize/2]  (up in world plane)
 *   Z: elevation in scene units               (vertical)
 *
 * @param elevations   - Flat array of elevation values in meters (row-major)
 * @param elevWidth    - Width of the elevation grid (pixels)
 * @param elevHeight   - Height of the elevation grid (pixels)
 * @param segments     - Number of mesh segments per side
 * @param tileWorldSize - Tile size in scene-world units
 * @param exaggeration - Elevation exaggeration factor
 * @param metersToScene - Conversion factor: meters → scene units
 */
export function buildMeshArrays(
  elevations: Float32Array,
  elevWidth: number,
  elevHeight: number,
  segments: number,
  tileWorldSize: number,
  exaggeration: number,
  metersToScene: number,
): MeshArrays {
  const vertsPerSide = segments + 1;
  const vertexCount = vertsPerSide * vertsPerSide;
  const quadCount = segments * segments;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = vertexCount <= 65535
    ? new Uint16Array(quadCount * 6)
    : new Uint32Array(quadCount * 6);

  const halfSize = tileWorldSize / 2;
  const cellSize = tileWorldSize / segments;
  const elevScale = metersToScene * exaggeration;

  // --- Pass 1: Positions + UVs ---
  for (let iy = 0; iy < vertsPerSide; iy++) {
    for (let ix = 0; ix < vertsPerSide; ix++) {
      const idx = iy * vertsPerSide + ix;

      const u = ix / segments;
      const v = iy / segments;

      // X: left to right,  Y: top to bottom → flip Y for world coords (Y up)
      const x = u * tileWorldSize - halfSize;
      const y = (1 - v) * tileWorldSize - halfSize;

      // Sample elevation with bilinear interpolation
      const elev = sampleElevation(u, v, elevations, elevWidth, elevHeight);
      const z = elev * elevScale;

      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;

      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = 1 - v; // UV origin bottom-left (standard OpenGL)
    }
  }

  // --- Pass 2: Normals (central differences) ---
  for (let iy = 0; iy < vertsPerSide; iy++) {
    for (let ix = 0; ix < vertsPerSide; ix++) {
      const idx = iy * vertsPerSide + ix;
      const z = positions[idx * 3 + 2];

      // Neighbor elevations (clamp at edges using forward/backward diff)
      let zLeft: number, zRight: number, zUp: number, zDown: number;
      let dx: number, dy: number;

      if (ix === 0) {
        zRight = positions[(iy * vertsPerSide + ix + 1) * 3 + 2];
        zLeft = z;
        dx = cellSize;
      } else if (ix === segments) {
        zLeft = positions[(iy * vertsPerSide + ix - 1) * 3 + 2];
        zRight = z;
        dx = cellSize;
      } else {
        zLeft = positions[(iy * vertsPerSide + ix - 1) * 3 + 2];
        zRight = positions[(iy * vertsPerSide + ix + 1) * 3 + 2];
        dx = 2 * cellSize;
      }

      if (iy === 0) {
        zDown = positions[((iy + 1) * vertsPerSide + ix) * 3 + 2];
        zUp = z;
        dy = cellSize;
      } else if (iy === segments) {
        zUp = positions[((iy - 1) * vertsPerSide + ix) * 3 + 2];
        zDown = z;
        dy = cellSize;
      } else {
        zUp = positions[((iy - 1) * vertsPerSide + ix) * 3 + 2];
        zDown = positions[((iy + 1) * vertsPerSide + ix) * 3 + 2];
        dy = 2 * cellSize;
      }

      // Surface normal for z = f(x, y): N = normalize(-dz/dx, -dz/dy, 1)
      // Note: Y is flipped (row 0 = top = +Y), so dz/dy uses (up - down)
      const dzdx = (zRight - zLeft) / dx;
      const dzdy = (zUp - zDown) / dy;

      const nx = -dzdx;
      const ny = -dzdy;
      const nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      normals[idx * 3] = nx / len;
      normals[idx * 3 + 1] = ny / len;
      normals[idx * 3 + 2] = nz / len;
    }
  }

  // --- Pass 3: Indices (two triangles per quad) ---
  let triIdx = 0;
  for (let iy = 0; iy < segments; iy++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iy * vertsPerSide + ix;
      const b = a + 1;
      const c = a + vertsPerSide;
      const d = c + 1;

      // Triangle 1: a → c → b (counter-clockwise when viewed from +Z)
      indices[triIdx++] = a;
      indices[triIdx++] = c;
      indices[triIdx++] = b;

      // Triangle 2: b → c → d
      indices[triIdx++] = b;
      indices[triIdx++] = c;
      indices[triIdx++] = d;
    }
  }

  return { positions, normals, uvs, indices };
}
