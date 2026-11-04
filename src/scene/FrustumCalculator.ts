// ============================================================================
// treelet.js - Frustum Calculator
// Derives the visible ground footprint by intersecting the camera's corner
// and center rays with a horizontal plane (analytic, allocation-free).
// ============================================================================

import { Vector3, type PerspectiveCamera } from 'three';
import type { WorldPoint, VisibleExtent } from '../core/types';

/**
 * Artificial horizon: maximum ground distance from the camera nadir as a
 * multiple of the camera's height above the plane. Limits tile loading for
 * tilted views. Factor 8 ≈ looking ~83° from vertical (7° above horizon).
 */
export const MAX_HORIZON_FACTOR = 8;

const NDC_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],   // top-right
  [-1, 1],  // top-left
  [1, -1],  // bottom-right
  [-1, -1], // bottom-left
];

export class FrustumCalculator {
  private readonly origin = new Vector3();
  private readonly dir = new Vector3();

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

  /** Set `this.dir` to the world-space ray direction through NDC (x, y). */
  private rayThrough(camera: PerspectiveCamera, x: number, y: number): void {
    this.dir.set(x, y, 0.5).unproject(camera).sub(this.origin).normalize();
  }

  /**
   * Compute the visible footprint on the plane z = planeZ.
   *
   * Corner rays that miss the plane (sky) are projected along their ground
   * direction to the artificial horizon; all corners are clamped to it.
   * Returns null when the camera is below the plane or the view center
   * doesn't hit it. The returned object is reused across calls.
   *
   * The camera's world matrix must be up to date.
   */
  computeExtent(camera: PerspectiveCamera, planeZ: number = 0): VisibleExtent | null {
    this.origin.setFromMatrixPosition(camera.matrixWorld);
    const height = this.origin.z - planeZ;
    if (!(height > 0)) return null;

    this.rayThrough(camera, 0, 0);
    if (this.dir.z >= -1e-9) return null;
    const tc = (planeZ - this.origin.z) / this.dir.z;
    this.reusableCenter.x = this.origin.x + this.dir.x * tc;
    this.reusableCenter.y = this.origin.y + this.dir.y * tc;

    const cameraX = this.origin.x;
    const cameraY = this.origin.y;
    const maxDist = height * MAX_HORIZON_FACTOR;

    for (let i = 0; i < NDC_CORNERS.length; i++) {
      const point = this.reusableCorners[i];
      this.rayThrough(camera, NDC_CORNERS[i][0], NDC_CORNERS[i][1]);
      const d = this.dir;
      if (d.z < -1e-9) {
        const t = (planeZ - this.origin.z) / d.z;
        point.x = cameraX + d.x * t;
        point.y = cameraY + d.y * t;
      } else {
        // Ray misses the ground: follow its horizontal direction to the horizon.
        const hl = Math.hypot(d.x, d.y) || 1;
        point.x = cameraX + (d.x / hl) * maxDist;
        point.y = cameraY + (d.y / hl) * maxDist;
      }

      const dx = point.x - cameraX;
      const dy = point.y - cameraY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist) {
        const s = maxDist / dist;
        point.x = cameraX + dx * s;
        point.y = cameraY + dy * s;
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
   */
  computeFrustumPlanes(extent: VisibleExtent): Float32Array | null {
    const c = extent.corners;
    const cx = extent.center.x;
    const cy = extent.center.y;
    let minD2 = Infinity, maxD2 = 0;
    for (let i = 0; i < 4; i++) {
      const ddx = c[i].x - cx, ddy = c[i].y - cy;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < minD2) minD2 = d2;
      if (d2 > maxD2) maxD2 = d2;
    }
    if (minD2 > 0 && maxD2 / minD2 < 1.21) return null;

    const planes = this.reusablePlanes;
    //   Edge 0: corners[0] → corners[1]  (top edge)
    //   Edge 1: corners[1] → corners[3]  (left edge)
    //   Edge 2: corners[3] → corners[2]  (bottom edge)
    //   Edge 3: corners[2] → corners[0]  (right edge)
    const edgeFrom = [0, 1, 3, 2];
    const edgeTo = [1, 3, 2, 0];

    for (let p = 0; p < 4; p++) {
      const p0 = c[edgeFrom[p]];
      const p1 = c[edgeTo[p]];
      const ex = p1.x - p0.x;
      const ey = p1.y - p0.y;
      const len = Math.sqrt(ex * ex + ey * ey);
      if (len < 1e-10) {
        planes[p * 3] = 0;
        planes[p * 3 + 1] = 0;
        planes[p * 3 + 2] = 1;
        continue;
      }

      let nx = -ey / len;
      let ny = ex / len;
      let d = -(nx * p0.x + ny * p0.y);
      if (nx * (cx - p0.x) + ny * (cy - p0.y) < 0) {
        nx = -nx;
        ny = -ny;
        d = -d;
      }
      planes[p * 3] = nx;
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
