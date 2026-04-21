// ============================================================================
// treelet.js - Camera Controller
// Wraps Three.js OrbitControls, derives zoom from camera height,
// and debounces view-change callbacks.
// ============================================================================

import { PerspectiveCamera, Vector3, MOUSE } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA_DEBOUNCE_MS } from '../core/constants';

export interface CameraState {
  zoom: number;
  pitch: number;
  rotation: number;
  distance: number;
}

export class CameraController {
  readonly controls: OrbitControls;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private onChangeCallback: (() => void) | null = null;
  private onRawChangeCallback: ((state: CameraState) => void) | null = null;

  private readonly worldDimension: number;
  private readonly minZoom: number;
  private readonly maxZoom: number;

  /** Pitch limits in elevation degrees (90 = top-down, 0 = horizontal). */
  private _minPitch: number;
  private _maxPitch: number;

  private static readonly DEG2RAD = Math.PI / 180;

  /** Cached base distance - depends only on camera.fov and worldDimension (both constant). */
  private readonly baseDist: number;

  /** Scratch vector reused for camera offset computations (avoids per-call allocation). */
  private readonly _offset = new Vector3();

  /** Smooth orientation-reset animation state (spherical interpolation). */
  private _animActive = false;
  private _animStartTime = 0;
  /** Start polar angle (radians from zenith: 0 = top-down). */
  private _animFromPhi = 0;
  /** Start azimuthal angle (radians: 0 = north, positive = clockwise). */
  private _animFromTheta = 0;
  /** Orbit distance (constant during animation). */
  private _animDist = 0;
  private static readonly RESET_DURATION_MS = 400;

  constructor(
    readonly camera: PerspectiveCamera,
    domElement: HTMLElement,
    worldDimension: number,
    minZoom: number,
    maxZoom: number,
    minPitch = 25,
    maxPitch = 90,
  ) {
    this.worldDimension = worldDimension;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this._minPitch = minPitch;
    this._maxPitch = maxPitch;

    // Pre-compute baseDist once (fov and worldDimension are constant after construction)
    const fovRad = (camera.fov * Math.PI) / 360; // half-fov in radians
    this.baseDist = worldDimension / (2 * Math.tan(fovRad));

    this.controls = new OrbitControls(camera, domElement);
    this.controls.mouseButtons = {
      LEFT: MOUSE.PAN,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.ROTATE,
    };

    // Pan along the world ground plane (compass directions) instead of screen space
    this.controls.screenSpacePanning = false;

    // Enforce zoom bounds via orbit distance limits.
    // Distance decreases as zoom increases (closer = more zoomed in).
    // The +1 compensates for the -1 offset in deriveZoom() (see setZoomLevel).
    this.controls.minDistance = this.getDistanceForZoom(maxZoom + 1);
    this.controls.maxDistance = this.getDistanceForZoom(minZoom + 1);

    // Apply pitch limits to OrbitControls polar angle range
    this.applyPitchLimits();

    this.controls.addEventListener('change', this.handleControlsChange);
  }

  /**
   * Set the callback fired (debounced) when the camera moves.
   */
  onChange(callback: () => void): void {
    this.onChangeCallback = callback;
  }

  /**
   * Set a callback fired immediately on every camera change (no debounce).
   * Used for smooth compass rotation that must track every frame.
   */
  onRawChange(callback: (state: CameraState) => void): void {
    this.onRawChangeCallback = callback;
  }

  /**
   * Derive integer zoom level from camera orbit distance.
   *
   * Uses the inverse of the original TLet.js formula:
   *   distance = baseDist * e^(ln(0.56) * zoom)
   *   => zoom = ln(distance / baseDist) / ln(0.56)
   *
   * where baseDist = worldDimension / (2 * tan(fov/2))
   *
   * Uses orbit distance (camera-to-target) instead of camera.position.z
   * so that tilting the camera doesn't change the zoom level. Only
   * dollying in/out (which changes the orbit radius) affects zoom.
   */
  deriveZoom(): number {
    const distance = this.camera.position.distanceTo(this.controls.target);

    if (distance <= 0) return this.maxZoom;

    // Subtract 1 to load coarser tiles than raw camera distance implies,
    // reducing tile count and bandwidth while maintaining visual quality.
    const zoom = Math.log(distance / this.baseDist) / Math.log(0.56) - 1;
    return Math.round(Math.min(Math.max(zoom, this.minZoom), this.maxZoom));
  }

  /**
   * Get the camera distance for a given zoom level.
   */
  getDistanceForZoom(zoom: number): number {
    return this.baseDist * Math.pow(Math.E, Math.log(0.56) * zoom);
  }

  /**
   * Get current camera state.
   */
  getState(): CameraState {
    return {
      zoom: this.deriveZoom(),
      pitch: this.controls.getPolarAngle() * (180 / Math.PI),
      rotation: this.controls.getAzimuthalAngle() * (180 / Math.PI),
      distance: this.camera.position.distanceTo(this.controls.target),
    };
  }

  /**
   * Set camera position to look at a world-plane point at a given zoom.
   */
  setView(worldX: number, worldY: number, zoom: number): void {
    const distance = this.getDistanceForZoom(zoom);
    this.camera.position.set(worldX, worldY, distance);
    this.controls.target.set(worldX, worldY, 0);
    this.controls.update();
  }

  /**
   * Must be called each animation frame.
   */
  update(): void {
    if (this._animActive) {
      const elapsed = performance.now() - this._animStartTime;
      const rawT = Math.min(elapsed / CameraController.RESET_DURATION_MS, 1.0);
      // Ease-out cubic: fast start, gentle deceleration
      const t = 1 - Math.pow(1 - rawT, 3);

      // Interpolate both angles independently in spherical coordinates.
      // This ensures rotation animates visibly even as the camera approaches
      // the zenith where Cartesian lerp would erase horizontal displacement.
      const phi = this._animFromPhi * (1 - t);
      const theta = this._animFromTheta * (1 - t);
      const r = this._animDist;

      this.camera.position.set(
        this.controls.target.x + r * Math.sin(phi) * Math.sin(theta),
        this.controls.target.y - r * Math.sin(phi) * Math.cos(theta),
        this.controls.target.z + r * Math.cos(phi),
      );
      this.camera.lookAt(this.controls.target);

      if (rawT >= 1.0) {
        // Snap to exact final position (straight above target)
        this.camera.position.set(
          this.controls.target.x,
          this.controls.target.y,
          this.controls.target.z + r,
        );
        this._animActive = false;
        this.controls.enabled = true;
        // Sync OrbitControls' internal spherical state with final camera position
        this.controls.update();
      }

      // Report animated state directly — bypasses OrbitControls' azimuthal
      // angle extraction which is numerically unstable near the zenith.
      const RAD2DEG = 180 / Math.PI;
      this.onRawChangeCallback?.({
        zoom: this.deriveZoom(),
        pitch: phi * RAD2DEG,
        rotation: theta * RAD2DEG,
        distance: r,
      });
      this.scheduleDebounced();
      return;
    }

    this.controls.update();
  }

  /**
   * Activate event listeners.
   */
  enable(): void {
    this.controls.enabled = true;
  }

  /**
   * Deactivate event listeners.
   */
  disable(): void {
    this.controls.enabled = false;
  }

  /**
   * Reset azimuth (rotation) to north-up while preserving tilt and distance.
   */
  resetAzimuth(): void {
    const offset = this._offset.copy(this.camera.position).sub(this.controls.target);
    const r = offset.length();
    const phi = Math.acos(Math.min(1, offset.z / r));
    this.camera.position.set(
      this.controls.target.x,
      this.controls.target.y - r * Math.sin(phi),
      this.controls.target.z + r * Math.cos(phi),
    );
    this.controls.update();
  }

  /**
   * Reset tilt (pitch) to top-down while preserving azimuth and distance.
   */
  resetTilt(): void {
    const offset = this._offset.copy(this.camera.position).sub(this.controls.target);
    const r = offset.length();
    this.camera.position.set(
      this.controls.target.x,
      this.controls.target.y,
      this.controls.target.z + r,
    );
    this.controls.update();
  }

  /**
   * Smoothly animate both azimuth and tilt back to top-down, north-facing.
   * Uses ease-out cubic interpolation of spherical coordinates (phi → 0,
   * theta → 0) over RESET_DURATION_MS, so both pitch and rotation are
   * animated simultaneously and independently visible.
   * Disables OrbitControls during the animation to prevent input conflicts.
   */
  resetOrientation(): void {
    const offset = this._offset.copy(this.camera.position).sub(this.controls.target);
    const r = offset.length();
    if (r < 0.001) return;

    // Current spherical coordinates (Z-up convention matching setAzimuth/setPitch)
    const phi = Math.acos(Math.min(1, offset.z / r));
    const theta = Math.atan2(offset.x, -offset.y);

    // Skip animation if already at (or very close to) the target orientation
    if (Math.abs(phi) < 1e-4 && Math.abs(theta) < 1e-4) return;

    this._animFromPhi = phi;
    this._animFromTheta = theta;
    this._animDist = r;
    this._animActive = true;
    this._animStartTime = performance.now();
    this.controls.enabled = false;
  }

  /**
   * Set zoom level while preserving camera orientation.
   * Scales the camera offset vector so orbit distance matches the target zoom.
   */
  setZoomLevel(zoom: number): void {
    const clamped = Math.round(Math.min(Math.max(zoom, this.minZoom), this.maxZoom));
    // deriveZoom() subtracts 1 from the raw formula, so the reported zoom is
    // always 1 less than the "distance zoom".  Add 1 here to compensate.
    const targetDist = this.getDistanceForZoom(clamped + 1);
    const offset = this._offset.copy(this.camera.position).sub(this.controls.target);
    const currentDist = offset.length();
    if (currentDist > 0.001) {
      offset.multiplyScalar(targetDist / currentDist);
    } else {
      offset.set(0, 0, targetDist);
    }
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  /**
   * Set azimuthal angle (rotation) while preserving tilt and distance.
   */
  setAzimuth(degrees: number): void {
    const offset = this._offset.copy(this.camera.position).sub(this.controls.target);
    const r = offset.length();
    const phi = Math.acos(Math.min(1, offset.z / r));
    const theta = (degrees * Math.PI) / 180;
    this.camera.position.set(
      this.controls.target.x + r * Math.sin(phi) * Math.sin(theta),
      this.controls.target.y - r * Math.sin(phi) * Math.cos(theta),
      this.controls.target.z + r * Math.cos(phi),
    );
    this.controls.update();
  }

  /**
   * Set polar angle (pitch) while preserving azimuth and distance.
   * @param degrees - polar angle from zenith (0 = top-down, 90 = horizontal).
   *   Clamped to the configured pitch range (converted from elevation limits).
   */
  setPitch(degrees: number): void {
    const offset = this._offset.copy(this.camera.position).sub(this.controls.target);
    const r = offset.length();
    const theta = this.controls.getAzimuthalAngle();
    // Guard: polar angle must stay above ε to avoid the zenith singularity
    // where sin(φ)→0 erases the azimuthal component from the position vector.
    const EPS = 1e-4;
    const minPolar = Math.max((90 - this._maxPitch) * CameraController.DEG2RAD, EPS);
    const maxPolar = (90 - this._minPitch) * CameraController.DEG2RAD;
    const phi = Math.min(Math.max(degrees * CameraController.DEG2RAD, minPolar), maxPolar);
    this.camera.position.set(
      this.controls.target.x + r * Math.sin(phi) * Math.sin(theta),
      this.controls.target.y - r * Math.sin(phi) * Math.cos(theta),
      this.controls.target.z + r * Math.cos(phi),
    );
    this.controls.update();
  }

  /**
   * Get the minimum pitch in elevation degrees (most tilted allowed).
   */
  getMinPitch(): number {
    return this._minPitch;
  }

  /**
   * Get the maximum pitch in elevation degrees (least tilted / top-down).
   */
  getMaxPitch(): number {
    return this._maxPitch;
  }

  /**
   * Set the minimum pitch (most tilted allowed) in elevation degrees.
   */
  setMinPitch(degrees: number): void {
    this._minPitch = degrees;
    this.applyPitchLimits();
  }

  /**
   * Set the maximum pitch (least tilted / top-down) in elevation degrees.
   */
  setMaxPitch(degrees: number): void {
    this._maxPitch = degrees;
    this.applyPitchLimits();
  }

  /**
   * Cleanup.
   */
  dispose(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.controls.removeEventListener('change', this.handleControlsChange);
    this.controls.dispose();
  }

  // == Private ==

  /** Sync OrbitControls polar angle limits with current pitch config. */
  private applyPitchLimits(): void {
    this.controls.minPolarAngle = (90 - this._maxPitch) * CameraController.DEG2RAD;
    this.controls.maxPolarAngle = (90 - this._minPitch) * CameraController.DEG2RAD;
  }

  /** Schedule the debounced camera-change callback (tile scheduling, etc). */
  private scheduleDebounced(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.onChangeCallback?.();
    }, CAMERA_DEBOUNCE_MS);
  }

  private handleControlsChange = (): void => {
    // Fire raw callback immediately for smooth UI updates (compass rotation)
    this.onRawChangeCallback?.(this.getState());
    this.scheduleDebounced();
  };
}
