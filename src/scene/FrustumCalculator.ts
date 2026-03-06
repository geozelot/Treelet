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
