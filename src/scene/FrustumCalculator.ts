// ============================================================================
// treelet.js - Frustum Calculator
// Derives the visible ground footprint by intersecting the camera's corner
// and center rays with a horizontal plane (analytic, allocation-free).
// ============================================================================

import { Vector3, type PerspectiveCamera } from 'three';
import type { WorldPoint, VisibleExtent } from '../core/types';

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

  /** Set `this.dir` to the world-space ray direction through NDC (x, y). */
  private rayThrough(camera: PerspectiveCamera, x: number, y: number): void {
    this.dir.set(x, y, 0.5).unproject(camera).sub(this.origin).normalize();
  }

  /**
   * Compute the visible footprint on the plane z = planeZ.
   *
   * Corner rays that miss the plane (sky) are projected along their ground
   * direction to the horizon (`maxDist` from the camera, or 8× the camera's
   * height when unbounded); all corners are clamped to it.
   * Returns null when the camera is below the plane or the view center
   * doesn't hit it. The returned object is reused across calls.
   *
   * The camera's world matrix must be up to date.
   */
  computeExtent(camera: PerspectiveCamera, planeZ: number = 0, maxDist: number = Infinity): VisibleExtent | null {
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
    if (!Number.isFinite(maxDist)) maxDist = height * 8;

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
