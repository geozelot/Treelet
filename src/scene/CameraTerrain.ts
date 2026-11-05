// ============================================================================
// treelet.js - Camera / Terrain
// Keeps the orbit target on the terrain at the screen center and the camera
// clear of the terrain. The camera keeps its height while the view moves and
// only rises where it (or its near plane) would otherwise touch the terrain,
// or where moving brings the terrain ahead much closer than the zoom shows.
// Past the obstacle it settles back down to the zoom it remembers.
// ============================================================================

import { Vector3 } from 'three';
import type { CameraController } from './CameraController';

/** Terrain height (scene units) at a world-plane point, or null where nothing is loaded. */
export type GroundSampler = (x: number, y: number) => number | null;

/** Radius of the clearance sphere around the camera, as a fraction of the zoom's orbit distance. */
const CLEARANCE_FRACTION = 0.03;
/** Ground samples on a ring around the camera: radius (fraction of the sphere's) and count. */
const RING_RADIUS = 0.7;
const RING_SAMPLES = 8;
/**
 * Moving keeps the screen-center terrain at least this fraction of the zoom's
 * orbit distance away: closer, the camera glides up (eased over
 * VIEW_EASE_S seconds) instead of flying into the slope ahead.
 */
const VIEW_FLOOR = 0.5;
const VIEW_EASE_S = 0.15;
/**
 * Time constant (s) of settling back down once the terrain allows it; a
 * step is taken only while the screen-center terrain stays at least this
 * fraction of the zoom's distance away (above VIEW_FLOOR, so the two never
 * take turns).
 */
const SETTLE_EASE_S = 0.5;
const SETTLE_VIEW_FLOOR = 0.6;
/** Settling stops this close to its goal (fraction of the zoom's distance; invisible). */
const SETTLE_DONE = 1e-3;
/** Most ground samples along one frame's camera path (ridges crossed within a frame). */
const PATH_SAMPLES = 16;
/** Steps of the screen-center search along the line of sight. */
const MARCH_STEPS = 48;
const BISECT_STEPS = 24;

const RING_COS = new Float64Array(RING_SAMPLES);
const RING_SIN = new Float64Array(RING_SAMPLES);
for (let i = 0; i < RING_SAMPLES; i++) {
  RING_COS[i] = Math.cos((i / RING_SAMPLES) * 2 * Math.PI);
  RING_SIN[i] = Math.sin((i / RING_SAMPLES) * 2 * Math.PI);
}

/**
 * Distance along a ray to where it first drops below the terrain: marched in
 * steps that grow with the distance (`growth`, at least `minStep`), then
 * bisected. Samples without data count as above the surface. Returns null
 * when the ray stays above it up to `tMax`.
 */
export function marchToTerrain(
  ground: GroundSampler,
  origin: Vector3, dir: Vector3,
  t0: number, tMax: number, growth: number, minStep: number, maxSteps: number,
): number | null {
  const ox = origin.x, oy = origin.y, oz = origin.z;
  const dx = dir.x, dy = dir.y, dz = dir.z;
  let lastAbove = t0;
  for (let i = 0, t = t0; i < maxSteps && t < tMax; i++) {
    const t1 = t + Math.max(t * (growth - 1), minStep);
    const g1 = ground(ox + dx * t1, oy + dy * t1);
    if (g1 !== null && oz + dz * t1 <= g1) {
      let lo = lastAbove, hi = t1;
      for (let k = 0; k < BISECT_STEPS; k++) {
        const mid = (lo + hi) / 2;
        const g = ground(ox + dx * mid, oy + dy * mid);
        if (g !== null && oz + dz * mid <= g) hi = mid; else lo = mid;
      }
      return hi;
    }
    lastAbove = t = t1;
  }
  return null;
}

export class CameraTerrain {
  /** Radius of the clearance sphere in the last update (scene units). */
  clearance = 0;
  /** Terrain height under the camera in the last update, or null. */
  cameraGround: number | null = null;

  /**
   * Orbit distance of the zoom the user chose: follows zooming, but not the
   * distance changes from moving the target over terrain. Scales the
   * clearance (so approaching a slope doesn't shrink it) and the visible
   * range. Read-only outside this class.
   */
  zoomDistance = NaN;

  /** Move the orbit onto the terrain at the target once its height is known (after setView). */
  private snapPending = true;
  private lastDist = NaN;
  /** Camera height the user's own input set (zoom, tilt): what lifts settle back to. */
  private ownZ = NaN;
  /** Settle back like the last movement: keeping the view direction (pan) or the target (orbit). */
  private settleMode: 'pan' | 'orbit' = 'pan';
  /** Settling may still have work to do (cleared once it finds none, so idle frames stay cheap). */
  private settling = false;
  /** Where the target and camera were left last frame (detects pans and zooms). */
  private pivotX = NaN;
  private pivotY = NaN;
  private readonly lastCam = new Vector3(NaN, NaN, NaN);
  private readonly dir = new Vector3();

  /**
   * @param minClearance - smallest clearance radius (scene units)
   */
  constructor(private readonly cc: CameraController, private readonly minClearance: number) {}

  /** The view jumped (setView): ride the orbit onto the terrain at the new target. */
  snapToTerrain(): void {
    this.snapPending = true;
  }

  /**
   * Run once per frame, after the controls. Returns true when it moved the
   * camera or the target.
   *
   * - Pan and zoom keep the camera's height and view direction; the target
   *   becomes the terrain at the screen center (so the zoom follows the
   *   distance to it, up to max zoom; closer terrain leaves the target just
   *   behind the surface). Where that terrain comes closer than half the
   *   zoom's distance, the camera glides up, keeping its pitch.
   * - Rotation keeps the target; the camera rises over terrain in its way,
   *   still looking at the target.
   * - Where its clearance sphere would touch the terrain, the camera rises at
   *   once. Once the terrain allows, it settles back down until it shows the
   *   remembered zoom again, but never below its own height (it doesn't dive
   *   into valleys).
   *
   * @param terrainChanged - elevation data or exaggeration changed since the last frame
   * @param range - visible range (how far to look for the screen-center terrain)
   * @param dt - seconds since the last frame
   */
  update(ground: GroundSampler, terrainChanged: boolean, range: number, dt: number): boolean {
    const cam = this.cc.camera.position;
    const target = this.cc.controls.target;
    const dist = cam.distanceTo(target);
    let adjusted = false;

    // Zooming scales the orbit distance and moves the camera's own height;
    // following the terrain changes neither.
    if (this.lastDist > 0) this.zoomDistance *= dist / this.lastDist;
    if (!(this.zoomDistance > 0)) this.zoomDistance = dist;
    this.ownZ += cam.z - this.lastCam.z;
    if (!Number.isFinite(this.ownZ)) this.ownZ = cam.z;

    if (this.snapPending) {
      const g = ground(target.x, target.y);
      if (g !== null) {
        const dz = g - target.z;
        target.z += dz;
        cam.z += dz;
        this.snapPending = false;
        this.zoomDistance = dist;
        this.ownZ = cam.z;
        this.pivotX = target.x;
        this.pivotY = target.y;
        this.lastCam.copy(cam);
        adjusted = Math.abs(dz) > dist * 1e-7;
      }
    }

    const r = Math.max(this.zoomDistance * CLEARANCE_FRACTION, this.minClearance);
    this.clearance = r;

    const moved = !this.snapPending &&
      Math.hypot(target.x - this.pivotX, target.y - this.pivotY) > dist * 1e-6;
    const camMoved = cam.distanceTo(this.lastCam) > dist * 1e-6;
    if (moved) this.settleMode = 'pan';
    else if (camMoved) this.settleMode = 'orbit';
    if (moved || camMoved || terrainChanged) this.settling = true;

    const tMax = Math.max(range, dist * 4);
    if (moved) {
      // ---- Pan / zoom: keep height and view direction ----
      const dir = this.dir.copy(target).sub(cam).normalize();
      const floor = Math.max(this.floor(ground, cam.x, cam.y, r), this.pathFloor(ground, r));
      if (floor > cam.z) cam.z = floor;
      let t = this.screenCenter(ground, dir, r, tMax);
      const tMin = this.zoomDistance * VIEW_FLOOR;
      if (t !== null && t < tMin && dir.z < 0) {
        // Exact over level ground; steeper slopes take a few frames more.
        cam.z += (tMin - t) * -dir.z * (1 - Math.exp(-dt / VIEW_EASE_S));
        t = this.screenCenter(ground, dir, r, tMax);
      } else if (t !== null) {
        t = this.settle(ground, dir, t, floor, r, tMax, dt) ?? t;
      }
      this.placeTarget(dir, t ?? dist);
      adjusted = true;
    } else {
      // ---- Rotation, programmatic changes, new data: the target stays ----
      if (terrainChanged && !this.snapPending) {
        const g = ground(target.x, target.y);
        if (g !== null && Math.abs(target.z - g) > dist * 1e-5) {
          const dir = this.dir.copy(target).sub(cam).normalize();
          const t = this.screenCenter(ground, dir, r, tMax);
          if (t !== null) {
            this.placeTarget(dir, t);
            adjusted = true;
          }
        }
      }
      const floor = this.floor(ground, cam.x, cam.y, r);
      if (floor - cam.z > dist * 1e-7) {
        this.raise(floor);
        adjusted = true;
      } else if (this.settling && !this.snapPending) {
        // Settle back as the last movement would: around the target after
        // rotating, along the line of sight after panning.
        let settled = false;
        if (this.settleMode === 'orbit') {
          settled = this.lower(floor, dt);
        } else {
          const dir = this.dir.copy(target).sub(cam).normalize();
          const t = this.screenCenter(ground, dir, r, tMax);
          const t1 = t === null ? null : this.settle(ground, dir, t, floor, r, tMax, dt);
          if (t1 !== null) {
            this.placeTarget(dir, t1);
            settled = true;
          }
        }
        if (settled) adjusted = true;
        else this.settling = false;
      }
    }

    this.cameraGround = ground(cam.x, cam.y);
    if (!this.snapPending) {
      this.pivotX = target.x;
      this.pivotY = target.y;
    }
    this.lastCam.copy(cam);
    this.lastDist = cam.distanceTo(target);
    if (adjusted) this.cc.camera.updateMatrixWorld();
    return adjusted;
  }

  /**
   * Lowest camera height at which a sphere of radius `r` around the camera
   * clears the terrain: the ground below plus r, and a ring of samples at
   * 0.7 r. The sphere contains the near plane, so the terrain can't cut into
   * the view either. -Infinity where nothing is loaded.
   */
  private floor(ground: GroundSampler, x: number, y: number, r: number): number {
    const below = ground(x, y);
    let floor = below === null ? -Infinity : below + r;
    const ring = r * RING_RADIUS;
    const rise = r * Math.sqrt(1 - RING_RADIUS * RING_RADIUS);
    for (let i = 0; i < RING_SAMPLES; i++) {
      const g = ground(x + ring * RING_COS[i], y + ring * RING_SIN[i]);
      if (g !== null && g + rise > floor) floor = g + rise;
    }
    return floor;
  }

  /**
   * Height that clears terrain this frame's camera path went through, so a
   * fast move carries the camera over a ridge instead of past it.
   */
  private pathFloor(ground: GroundSampler, r: number): number {
    const from = this.lastCam;
    const to = this.cc.camera.position;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy);
    if (!(len > r)) return -Infinity;
    const n = Math.min(PATH_SAMPLES, Math.ceil(len / r));
    let floor = -Infinity;
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const g = ground(from.x + dx * f, from.y + dy * f);
      if (g !== null && g > from.z + dz * f && g + r > floor) floor = g + r;
    }
    return floor;
  }

  /**
   * Ease the camera down, keeping the view direction, toward the higher of
   * its own height and the height that shows the remembered zoom at the
   * screen center (`t` away), never below `floor`. Returns the new
   * screen-center distance, or null when there is nothing to settle.
   */
  private settle(
    ground: GroundSampler, dir: Vector3, t: number, floor: number, r: number, tMax: number, dt: number,
  ): number | null {
    const cam = this.cc.camera.position;
    if (!(dir.z < 0)) return null;
    // Lowering by h brings level ground h / -dir.z closer along the line of sight.
    const zoomZ = cam.z - (t - this.zoomDistance) * -dir.z;
    const gap = cam.z - Math.max(this.ownZ, zoomZ, floor);
    if (!(gap > this.zoomDistance * SETTLE_DONE)) return null;
    const step = gap * (1 - Math.exp(-dt / SETTLE_EASE_S));
    cam.z -= step;
    const t1 = this.screenCenter(ground, dir, r, tMax) ?? t;
    // Not while that would bring a crest ahead into view (the view floor would
    // lift the camera again): wait until it has passed.
    if (t1 < this.zoomDistance * SETTLE_VIEW_FLOOR) {
      cam.z += step;
      return null;
    }
    return t1;
  }

  /**
   * Ease the camera down toward its own height, still looking at the target
   * (the counterpart of raise()), never below `floor` or flatter than the
   * controls allow. Returns false when there is nothing to settle.
   */
  private lower(floor: number, dt: number): boolean {
    const controls = this.cc.controls;
    const target = controls.target;
    const cam = this.cc.camera;
    const horiz = Math.hypot(cam.position.x - target.x, cam.position.y - target.y);
    const flattest = target.z + horiz / Math.tan(controls.maxPolarAngle);
    const gap = cam.position.z - Math.max(this.ownZ, floor, flattest);
    if (!(gap > this.zoomDistance * SETTLE_DONE)) return false;
    cam.position.z -= gap * (1 - Math.exp(-dt / SETTLE_EASE_S));
    cam.lookAt(target);
    return true;
  }

  /** Distance along the line of sight to the first terrain on it, or null. */
  private screenCenter(ground: GroundSampler, dir: Vector3, r: number, tMax: number): number | null {
    const t0 = r * 0.5;
    const growth = Math.max(1.01, Math.pow(tMax / t0, 1 / MARCH_STEPS));
    return marchToTerrain(ground, this.cc.camera.position, dir, t0, tMax, growth, 0, MARCH_STEPS + 8);
  }

  /**
   * Put the target `t` along the line of sight, within the zoom limits
   * (closer than max zoom, it stays just behind the surface).
   */
  private placeTarget(dir: Vector3, t: number): void {
    const controls = this.cc.controls;
    const d = Math.min(Math.max(t, controls.minDistance), controls.maxDistance);
    controls.target.copy(this.cc.camera.position).addScaledVector(dir, d);
  }

  /**
   * Lift the camera to height `z`, still looking at the target. Lifting
   * straight up steepens the view; at the steepest allowed pitch the camera
   * moves out along that pitch instead.
   */
  private raise(z: number): void {
    const controls = this.cc.controls;
    const target = controls.target;
    const cam = this.cc.camera;
    let dx = cam.position.x - target.x;
    let dy = cam.position.y - target.y;
    const horiz = Math.hypot(dx, dy);
    const reach = (z - target.z) * Math.tan(controls.minPolarAngle);
    if (horiz > 0 && horiz < reach) {
      dx *= reach / horiz;
      dy *= reach / horiz;
    }
    cam.position.set(target.x + dx, target.y + dy, z);
    cam.lookAt(target);
  }
}
