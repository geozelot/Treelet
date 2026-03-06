// ============================================================================
// treelet.js - Camera Controller
// Wraps Three.js OrbitControls, derives zoom from camera height,
// and debounces view-change callbacks.
// ============================================================================

import { PerspectiveCamera, MOUSE } from 'three';
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
   * Derive integer zoom level from camera height above world plane.
   *
   * Uses the inverse of the original TLet.js formula:
   *   distance = baseDist * e^(ln(0.56) * zoom)
   *   => zoom = ln(distance / baseDist) / ln(0.56)
   *
   * where baseDist = worldDimension / (2 * tan(fov/2))
   */
  deriveZoom(): number {
    const height = this.camera.position.z;

    if (height <= 0) return this.maxZoom;

    // Subtract 1 to load coarser tiles than raw camera height implies,
    // reducing tile count and bandwidth while maintaining visual quality.
    const zoom = Math.log(height / this.baseDist) / Math.log(0.56) - 1;
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
      distance: this.camera.position.z,
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
    const offset = this.camera.position.clone().sub(this.controls.target);
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
    const offset = this.camera.position.clone().sub(this.controls.target);
    const r = offset.length();
    this.camera.position.set(
      this.controls.target.x,
      this.controls.target.y,
      this.controls.target.z + r,
    );
    this.controls.update();
  }

  /**
   * Reset both azimuth and tilt - camera straight above target looking down.
   */
  resetOrientation(): void {
    const r = this.camera.position.distanceTo(this.controls.target);
    this.camera.position.set(
      this.controls.target.x,
      this.controls.target.y,
      this.controls.target.z + r,
    );
    this.controls.update();
  }

  /**
   * Set zoom level while preserving camera orientation.
   * Scales the camera offset vector so z-component matches target zoom height.
   */
  setZoomLevel(zoom: number): void {
    const clamped = Math.round(Math.min(Math.max(zoom, this.minZoom), this.maxZoom));
    // deriveZoom() subtracts 1 from the raw formula, so the reported zoom is
    // always 1 less than the "distance zoom".  Add 1 here to compensate.
    const targetZ = this.getDistanceForZoom(clamped + 1);
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (offset.z > 0.001) {
      offset.multiplyScalar(targetZ / offset.z);
    } else {
      offset.set(0, 0, targetZ);
    }
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  /**
   * Set azimuthal angle (rotation) while preserving tilt and distance.
   */
  setAzimuth(degrees: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
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
    const offset = this.camera.position.clone().sub(this.controls.target);
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

  // -- Private --

  /** Sync OrbitControls polar angle limits with current pitch config. */
  private applyPitchLimits(): void {
    this.controls.minPolarAngle = (90 - this._maxPitch) * CameraController.DEG2RAD;
    this.controls.maxPolarAngle = (90 - this._minPitch) * CameraController.DEG2RAD;
  }

  private handleControlsChange = (): void => {
    // Fire raw callback immediately for smooth UI updates (compass rotation)
    this.onRawChangeCallback?.(this.getState());

    // Debounced callback for expensive operations (tile scheduling)
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.onChangeCallback?.();
    }, CAMERA_DEBOUNCE_MS);
  };
}
