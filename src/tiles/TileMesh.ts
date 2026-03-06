// ============================================================================
// treelet.js - Tile Mesh
//
// Creates Three.js meshes for tiles. Supports both placeholder flat
// meshes (Phase 1) and displaced elevation meshes (Phase 2+).
// ============================================================================

import {
  Mesh,
  PlaneGeometry,
  BufferGeometry,
  BufferAttribute,
  MeshBasicMaterial,
  Color,
  type Material,
} from 'three';
import type { TileCoord, WorldPoint } from '../core/types';
import { createTerrainMaterial } from '../shaders/TerrainMaterial';

/**
 * User data attached to each tile mesh for identification.
 */
export interface TileMeshUserData {
  tileKey: string;
  coord: TileCoord;
}

/**
 * Create a flat placeholder mesh for a tile.
 *
 * Used when no base layer is active or as a loading fallback.
 */
export function createTileMesh(
  coord: TileCoord,
  center: WorldPoint,
  tileWorldSize: number,
  tileKey: string,
): Mesh {
  const geometry = new PlaneGeometry(tileWorldSize, tileWorldSize, 1, 1);

  // Generate a consistent color from tile coordinates for visual debugging
  const hue = ((coord.x * 37 + coord.y * 73 + coord.z * 17) % 360) / 360;
  const color = new Color().setHSL(hue, 0.6, 0.5);

  const material = new MeshBasicMaterial({
    color,
    wireframe: false,
    transparent: true,
    opacity: 0.85,
  });

  const mesh = new Mesh(geometry, material);

  // Position in world-plane: X right, Y up, Z elevation (0 for flat)
  mesh.position.set(center.x, center.y, 0.01); // slight Z offset above world plane

  // Attach metadata
  mesh.userData = {
    tileKey,
    coord,
  } satisfies TileMeshUserData;

  return mesh;
}

/**
 * Create a terrain mesh from worker-generated buffer arrays.
 *
 * The geometry vertices are in tile-local space (centered on origin),
 * positioned in the world via mesh.position.
 *
 * @param material - Optional material to use. If not provided, creates
 *                   a default terrain ShaderMaterial.
 */
export function createElevationMesh(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  indices: Uint16Array | Uint32Array,
  center: WorldPoint,
  coord: TileCoord,
  tileKey: string,
  material?: Material,
): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));

  // Compute bounding box/sphere for frustum culling
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mat = material ?? createTerrainMaterial();
  const mesh = new Mesh(geometry, mat);

  // Position tile center in world coordinates
  mesh.position.set(center.x, center.y, 0);

  // Attach metadata
  mesh.userData = {
    tileKey,
    coord,
  } satisfies TileMeshUserData;

  return mesh;
}

/**
 * Create a wireframe overlay for tile debugging.
 */
export function createTileWireframe(
  center: WorldPoint,
  tileWorldSize: number,
): Mesh {
  const geometry = new PlaneGeometry(tileWorldSize, tileWorldSize, 1, 1);
  const material = new MeshBasicMaterial({
    color: 0xffffff,
    wireframe: true,
    transparent: true,
    opacity: 0.3,
  });

  const mesh = new Mesh(geometry, material);
  mesh.position.set(center.x, center.y, 0.02);

  return mesh;
}
