// ============================================================================
// treelet.js - Frustum Calculator
// Derives visible world extent by raycasting camera frustum corners
// onto the world ground plane.
// ============================================================================

import {
  Raycaster,
  Vector2,
  Mesh,
  PerspectiveCamera,
} from 'three';
import type { WorldPoint, VisibleExtent } from '../core/types';

/**
 * Raycasts the camera frustum corners and center onto a flat world plane
 * to determine which region of the world is visible.
 */
/**
 * Artificial horizon: maximum ground distance from camera nadir as a
 * multiple of camera height. Limits tile loading for tilted views.
 * Factor of 8 ≈ looking ~83° from vertical (7° above horizon).
 */
const MAX_HORIZON_FACTOR = 8;

export class FrustumCalculator {
  private readonly raycaster = new Raycaster();
  private readonly ndcCorners: Vector2[] = [
    new Vector2(1, 1),   // top-right
    new Vector2(-1, 1),  // top-left
    new Vector2(1, -1),  // bottom-right
    new Vector2(-1, -1), // bottom-left
  ];
  private readonly ndcCenter = new Vector2(0, 0);

  /** Pre-allocated reusable objects to avoid per-call allocations. */
  private readonly reusableCenter: WorldPoint = { x: 0, y: 0 };
  private readonly reusableCorners: WorldPoint[] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  private readonly reusableExtent: VisibleExtent = {
    corners: this.reusableCorners,
    center: this.reusableCenter,
  };

  /**
   * Pre-allocated Float32Array for frustum planes: 4 planes × 3 floats (nx, ny, d).
   * A point is inside plane p if: planes[p*3]*x + planes[p*3+1]*y + planes[p*3+2] >= 0.
   */
  private readonly reusablePlanes = new Float32Array(12);

  /**
   * Compute the visible world extent by raycasting.
   *
   * @param camera - The perspective camera
   * @param worldPlane - The invisible ground plane mesh (Z=0)
   * @returns Visible extent with 4 corner points and center, or null if
   *          the camera doesn't intersect the plane (e.g. looking away).
   *
   * NOTE: The returned object is reused across calls. Callers must consume
   * or copy the data before the next call to computeExtent().
   */
  computeExtent(camera: PerspectiveCamera, worldPlane: Mesh): VisibleExtent | null {
    const planeArray = [worldPlane];

    // Raycast center
    this.raycaster.setFromCamera(this.ndcCenter, camera);
    const centerHits = this.raycaster.intersectObjects(planeArray);
    if (centerHits.length === 0) return null;

    this.reusableCenter.x = centerHits[0].point.x;
    this.reusableCenter.y = centerHits[0].point.y;

    // Artificial horizon: clamp all corner points to max ground distance
    // from camera nadir, preventing massive tile extents in tilted views.
    const cameraX = camera.position.x;
    const cameraY = camera.position.y;
    const maxDist = camera.position.z * MAX_HORIZON_FACTOR;

    // Raycast corners
    for (let i = 0; i < this.ndcCorners.length; i++) {
      const ndc = this.ndcCorners[i];
      const point = this.reusableCorners[i];

      this.raycaster.setFromCamera(ndc, camera);
      const hits = this.raycaster.intersectObjects(planeArray);

      if (hits.length === 0) {
        // Ray misses ground - project along ray direction to max distance
        const dir = this.raycaster.ray.direction;
        point.x = cameraX + dir.x * maxDist;
        point.y = cameraY + dir.y * maxDist;
      } else {
        point.x = hits[0].point.x;
        point.y = hits[0].point.y;
      }

      // Clamp to artificial horizon
      const dx = point.x - cameraX;
      const dy = point.y - cameraY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist) {
        const scale = maxDist / dist;
        point.x = cameraX + dx * scale;
        point.y = cameraY + dy * scale;
      }
    }

    return this.reusableExtent;
  }

  /**
   * Compute 4 inward-facing 2D half-planes from the ground-plane frustum
   * trapezoid. Returns a pre-allocated Float32Array(12) with 3 floats per
   * plane (nx, ny, d). A point is inside all planes when
   * `nx*x + ny*y + d >= 0` for every plane.
   *
   * Returns null when the camera is nearly top-down (trapezoid degenerates
   * to a rectangle where the AABB is already tight enough).
   *
   * @param extent - The visible extent with 4 corner points
   */
  computeFrustumPlanes(extent: VisibleExtent): Float32Array | null {
    const c = extent.corners;
    // corners[0]=top-right, [1]=top-left, [2]=bottom-right, [3]=bottom-left

    // Quick degeneracy check: if max corner distance from center ≈ min
    // corner distance, the trapezoid is nearly rectangular and culling
    // against the AABB is sufficient. Avoids wasted work at nadir view.
    const cx = extent.center.x;
    const cy = extent.center.y;
    let minD2 = Infinity, maxD2 = 0;
    for (let i = 0; i < 4; i++) {
      const ddx = c[i].x - cx, ddy = c[i].y - cy;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < minD2) minD2 = d2;
      if (d2 > maxD2) maxD2 = d2;
    }
    // Ratio threshold: 1.1² = 1.21
    if (minD2 > 0 && maxD2 / minD2 < 1.21) return null;

    const planes = this.reusablePlanes;

    // Edge winding for inward-facing normals:
    //   Edge 0: corners[0] → corners[1]  (top-right → top-left, top edge)
    //   Edge 1: corners[1] → corners[3]  (top-left → bottom-left, left edge)
    //   Edge 2: corners[3] → corners[2]  (bottom-left → bottom-right, bottom edge)
    //   Edge 3: corners[2] → corners[0]  (bottom-right → top-right, right edge)
    const edgeFrom = [0, 1, 3, 2];
    const edgeTo   = [1, 3, 2, 0];

    for (let p = 0; p < 4; p++) {
      const p0 = c[edgeFrom[p]];
      const p1 = c[edgeTo[p]];
      const ex = p1.x - p0.x;
      const ey = p1.y - p0.y;
      const len = Math.sqrt(ex * ex + ey * ey);
      if (len < 1e-10) {
        // Degenerate edge — disable this plane (always passes)
        planes[p * 3]     = 0;
        planes[p * 3 + 1] = 0;
        planes[p * 3 + 2] = 1;
        continue;
      }

      // Perpendicular (rotated 90° CCW): (-ey, ex) normalized
      let nx = -ey / len;
      let ny = ex / len;
      let d = -(nx * p0.x + ny * p0.y);

      // Verify inward: dot(normal, center - p0) must be >= 0
      const dot = nx * (cx - p0.x) + ny * (cy - p0.y);
      if (dot < 0) {
        nx = -nx;
        ny = -ny;
        d = -d;
      }

      planes[p * 3]     = nx;
      planes[p * 3 + 1] = ny;
      planes[p * 3 + 2] = d;
    }

    return planes;
  }

  /**
   * Get the bounding box of the visible extent in world-plane coordinates.
   */
  static getExtentBounds(extent: VisibleExtent): { min: WorldPoint; max: WorldPoint } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const corner of extent.corners) {
      if (corner.x < minX) minX = corner.x;
      if (corner.y < minY) minY = corner.y;
      if (corner.x > maxX) maxX = corner.x;
      if (corner.y > maxY) maxY = corner.y;
    }

    return {
      min: { x: minX, y: minY },
      max: { x: maxX, y: maxY },
    };
  }
}
