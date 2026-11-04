// ============================================================================
// treelet.js - Camera Controller
// Wraps Three.js OrbitControls, maps orbit distance to standard web-map zoom,
// and debounces view-change callbacks.
// ============================================================================

import { PerspectiveCamera, Vector3, MOUSE, TOUCH } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA_DEBOUNCE_MS } from '../core/constants';

export interface CameraState {
  /** Fractional zoom (standard web-map scale). */
  zoom: number;
  /** Polar angle from zenith in degrees (0 = top-down). */
  pitch: number;
  /** Azimuth in degrees (0 = north-up, clockwise). */
  rotation: number;
  /** Orbit distance in world units. */
  distance: number;
}

/** Nominal tile size in CSS pixels that defines the zoom scale (Leaflet/Mapbox: 256). */
const ZOOM_TILE_PIXELS = 256;

export class CameraController {
  readonly controls: OrbitControls;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private onChangeCallback: (() => void) | null = null;
  private onRawChangeCallback: ((state: CameraState) => void) | null = null;

  private readonly worldDimension: number;
  private readonly minZoom: number;
  private readonly maxZoom: number;
  /** Viewport height in CSS pixels (zoom ↔ distance depends on it). */
  private viewportHeight: number;

  /** Pitch limits in elevation degrees (90 = top-down, 0 = horizontal). */
  private _minPitch: number;
  private _maxPitch: number;

  private static readonly DEG2RAD = Math.PI / 180;

  /** Scratch vector reused for camera offset computations (avoids per-call allocation). */
  private readonly _offset = new Vector3();

  /** Smooth orientation-reset animation state (spherical interpolation). */
  private _animActive = false;
  private _animStartTime = 0;
  private _animFromPhi = 0;
  private _animFromTheta = 0;
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
    viewportHeight = 600,
  ) {
    this.worldDimension = worldDimension;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this._minPitch = minPitch;
    this._maxPitch = maxPitch;
    this.viewportHeight = Math.max(1, viewportHeight);

    this.controls = new OrbitControls(camera, domElement);
    this.controls.mouseButtons = {
      LEFT: MOUSE.PAN,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.ROTATE,
    };
    // Touch mirrors the mouse: one finger pans, two fingers pinch-zoom + rotate.
    this.controls.touches = {
      ONE: TOUCH.PAN,
      TWO: TOUCH.DOLLY_ROTATE,
    };
    // Pan along the world ground plane (compass directions) instead of screen space
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;

    // Keyboard panning when the canvas has focus (arrow keys).
    if (domElement.tabIndex < 0) domElement.tabIndex = 0;
    this.controls.listenToKeyEvents(domElement);
    this.controls.keyPanSpeed = 20;

    this.applyDistanceLimits();
    this.applyPitchLimits();

    this.controls.addEventListener('change', this.handleControlsChange);
  }

  /** Set the callback fired (debounced) when the camera moves. */
  onChange(callback: () => void): void {
    this.onChangeCallback = callback;
  }

  /** Set a callback fired immediately on every camera change (no debounce). */
  onRawChange(callback: (state: CameraState) => void): void {
    this.onRawChangeCallback = callback;
  }

  // == Zoom ↔ distance ==

  /** Vertical focal length in CSS pixels. */
  get focalLength(): number {
    return this.viewportHeight / 2 / Math.tan((this.camera.fov * CameraController.DEG2RAD) / 2);
  }

  /**
   * Orbit distance at which `zoom` shows the standard web-map scale
   * (256·2^zoom CSS px across the world) at the orbit target.
   */
  getDistanceForZoom(zoom: number): number {
    const unitsPerPixel = this.worldDimension / (ZOOM_TILE_PIXELS * 2 ** zoom);
    return unitsPerPixel * this.focalLength;
  }

  /** Fractional zoom for the current orbit distance, clamped to the zoom bounds. */
  deriveZoom(): number {
    const distance = this.camera.position.distanceTo(this.controls.target);
    if (!(distance > 0)) return this.maxZoom;
    const zoom = Math.log2((this.worldDimension * this.focalLength) / (ZOOM_TILE_PIXELS * distance));
    return Math.min(Math.max(zoom, this.minZoom), this.maxZoom);
  }

  /**
   * Update the viewport height (CSS px). Keeps the current zoom (scale) by
   * rescaling the orbit distance, as web maps do on resize.
   */
  setViewportHeight(height: number): void {
    const h = Math.max(1, height);
    if (h === this.viewportHeight) return;
    const zoom = this.deriveZoom();
    this.viewportHeight = h;
    this.applyDistanceLimits();
    this.setZoomLevel(zoom);
  }

  /** Get current camera state. */
  getState(): CameraState {
    return {
      zoom: this.deriveZoom(),
      pitch: this.controls.getPolarAngle() * (180 / Math.PI),
      rotation: this.controls.getAzimuthalAngle() * (180 / Math.PI),
      distance: this.camera.position.distanceTo(this.controls.target),
    };
  }

  /**
   * Center the orbit on a world-plane point at a given zoom, keeping the
   * current pitch and bearing.
   */
  setView(worldX: number, worldY: number, zoom: number, targetZ = 0): void {
    const offset = this._offset.copy(this.camera.position).sub(this.controls.target);
    if (offset.lengthSq() < 1e-18) offset.set(0, 0, 1);
    offset.normalize().multiplyScalar(this.getDistanceForZoom(this.clampZoom(zoom)));
    this.controls.target.set(worldX, worldY, targetZ);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  /**
   * Advance animations and controls. Must be called each animation frame.
   * Returns true while an orientation animation is running.
   */
  update(): boolean {
    if (this._animActive) {
      const elapsed = performance.now() - this._animStartTime;
      const rawT = Math.min(elapsed / CameraController.RESET_DURATION_MS, 1.0);
      // Ease-out cubic: fast start, gentle deceleration
      const t = 1 - Math.pow(1 - rawT, 3);

      // Interpolate both angles independently in spherical coordinates so
      // rotation stays visible near the zenith.
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
        this.camera.position.set(this.controls.target.x, this.controls.target.y, this.controls.target.z + r);
        this._animActive = false;
        this.controls.enabled = true;
        this.controls.update();
      }

      const RAD2DEG = 180 / Math.PI;
      this.onRawChangeCallback?.({
        zoom: this.deriveZoom(),
        pitch: phi * RAD2DEG,
        rotation: theta * RAD2DEG,
        distance: r,
      });
      this.scheduleDebounced();
      return true;
    }

    this.controls.update();
    return false;
  }

  /** Activate event listeners. */
  enable(): void {
    this.controls.enabled = true;
  }

  /** Deactivate event listeners. */
  disable(): void {
    this.controls.enabled = false;
  }

  /** Reset azimuth (rotation) to north-up while preserving tilt and distance. */
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

  /** Reset tilt (pitch) to top-down while preserving azimuth and distance. */
  resetTilt(): void {
    const offset = this._offset.copy(this.camera.position).sub(this.controls.target);
    const r = offset.length();
    this.camera.position.set(this.controls.target.x, this.controls.target.y, this.controls.target.z + r);
    this.controls.update();
  }

  /**
   * Smoothly animate both azimuth and tilt back to top-down, north-facing.
   * Disables OrbitControls during the animation to prevent input conflicts.
   */
  resetOrientation(): void {
    const offset = this._offset.copy(this.camera.position).sub(this.controls.target);
    const r = offset.length();
    if (r < 1e-9) return;

    const phi = Math.acos(Math.min(1, offset.z / r));
    const theta = Math.atan2(offset.x, -offset.y);
    if (Math.abs(phi) < 1e-4 && Math.abs(theta) < 1e-4) return;

    this._animFromPhi = phi;
    this._animFromTheta = theta;
    this._animDist = r;
    this._animActive = true;
    this._animStartTime = performance.now();
    this.controls.enabled = false;
  }

  /** Set zoom (fractional) while preserving camera orientation. */
  setZoomLevel(zoom: number): void {
    const targetDist = this.getDistanceForZoom(this.clampZoom(zoom));
    const offset = this._offset.copy(this.camera.position).sub(this.controls.target);
    const currentDist = offset.length();
    if (currentDist > 1e-12) {
      offset.multiplyScalar(targetDist / currentDist);
    } else {
      offset.set(0, 0, targetDist);
    }
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  /** Set azimuthal angle (rotation) while preserving tilt and distance. */
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
    // Stay above ε to avoid the zenith singularity where the azimuth is lost.
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

  /** Get the minimum pitch in elevation degrees (most tilted allowed). */
  getMinPitch(): number {
    return this._minPitch;
  }

  /** Get the maximum pitch in elevation degrees (least tilted / top-down). */
  getMaxPitch(): number {
    return this._maxPitch;
  }

  /** Set the minimum pitch (most tilted allowed) in elevation degrees. */
  setMinPitch(degrees: number): void {
    this._minPitch = Math.max(0, Math.min(90, degrees));
    this.applyPitchLimits();
  }

  /** Set the maximum pitch (least tilted / top-down) in elevation degrees. */
  setMaxPitch(degrees: number): void {
    this._maxPitch = Math.max(0, Math.min(90, degrees));
    this.applyPitchLimits();
  }

  /** Cleanup. */
  dispose(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.controls.removeEventListener('change', this.handleControlsChange);
    this.controls.stopListenToKeyEvents();
    this.controls.dispose();
  }

  // == Private ==

  private clampZoom(zoom: number): number {
    if (!Number.isFinite(zoom)) return this.minZoom;
    return Math.min(Math.max(zoom, this.minZoom), this.maxZoom);
  }

  private applyDistanceLimits(): void {
    this.controls.minDistance = this.getDistanceForZoom(this.maxZoom);
    this.controls.maxDistance = this.getDistanceForZoom(this.minZoom);
  }

  /** Sync OrbitControls polar angle limits with current pitch config. */
  private applyPitchLimits(): void {
    const lo = Math.min(this._minPitch, this._maxPitch);
    const hi = Math.max(this._minPitch, this._maxPitch);
    this.controls.minPolarAngle = (90 - hi) * CameraController.DEG2RAD;
    this.controls.maxPolarAngle = (90 - lo) * CameraController.DEG2RAD;
  }

  /** Schedule the debounced camera-change callback. */
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
    this.onRawChangeCallback?.(this.getState());
    this.scheduleDebounced();
  };
}
