// ============================================================================
// treelet.js - Scene Manager
// Sets up the Three.js renderer, scene and camera, runs the (on-demand)
// render loop, and handles resize, pixel ratio and WebGL context loss.
// ============================================================================

import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Group,
  Color,
  Fog,
  type Mesh,
} from 'three';
import { CameraController } from './CameraController';
import { FrustumCalculator } from './FrustumCalculator';
import type { VisibleExtent, ResolvedTreeletOptions, WorldPoint } from '../core/types';

/** Per-frame callback; returns true when the scene must be re-rendered. */
export type FrameCallback = (dt: number, cameraMoved: boolean) => boolean;

export class SceneManager {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly cameraController: CameraController;
  readonly tileGroup: Group;

  private readonly frustumCalc = new FrustumCalculator();
  private readonly container: HTMLElement;
  private readonly maxPixelRatio: number;
  private readonly renderOnDemand: boolean;
  private animationFrameId: number | null = null;
  private frameCallback: FrameCallback | null = null;
  private renderRequested = true;
  private lastFrameTime = 0;
  private contextLost = false;

  /** Camera matrices at the last render, to detect motion cheaply. */
  private readonly lastCameraState = new Float64Array(33);

  private readonly themeQuery: MediaQueryList | null;
  private readonly themeListener: () => void;
  private dprQuery: MediaQueryList | null = null;
  private readonly dprListener = () => this.applyPixelRatio();
  private readonly onContextLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
  };
  private readonly onContextRestored = () => {
    this.contextLost = false;
    this.contextRestoredCallback?.();
    this.requestRender();
  };
  private contextRestoredCallback: (() => void) | null = null;

  constructor(container: HTMLElement, options: ResolvedTreeletOptions) {
    const md = options.mapDisplay;
    this.container = container;
    this.maxPixelRatio = md.maxPixelRatio;
    this.renderOnDemand = md.renderOnDemand;

    // Renderer
    this.renderer = new WebGLRenderer({ antialias: md.antialias, powerPreference: 'high-performance' });
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    this.renderer.setSize(width, height);
    this.applyPixelRatio();
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);

    // Scene
    this.scene = new Scene();

    // Theme-aware sky background + atmospheric haze fog.
    // Background = deep sky color; fog = lighter horizon glow color.
    const BG_DARK = new Color(0x0a1628);    // deep navy night sky
    const BG_LIGHT = new Color(0xb8d4e8);   // soft powder blue sky
    const FOG_DARK = new Color(0x1a2e48);   // lighter navy - horizon glow
    const FOG_LIGHT = new Color(0xd4e4f0);  // very light blue - horizon glow

    this.themeQuery = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    const applyTheme = () => {
      const dark = this.themeQuery?.matches ?? false;
      this.renderer.setClearColor(dark ? BG_DARK : BG_LIGHT);
      this.scene.background = dark ? BG_DARK : BG_LIGHT;
      if (this.scene.fog) (this.scene.fog as Fog).color.copy(dark ? FOG_DARK : FOG_LIGHT);
      this.requestRender();
    };
    this.scene.fog = new Fog(FOG_LIGHT, 1, 2);
    applyTheme();
    this.themeListener = applyTheme;
    this.themeQuery?.addEventListener('change', this.themeListener);

    // Camera - Z-up convention (matching geographic orientation).
    // Near/far are updated every frame from the orbit distance.
    this.camera = new PerspectiveCamera(70, width / height, 0.01, md.worldScale * 10);
    this.camera.up.set(0, 0, 1);

    // Tile group - all terrain meshes live here
    this.tileGroup = new Group();
    this.scene.add(this.tileGroup);

    this.cameraController = new CameraController(
      this.camera,
      this.renderer.domElement,
      md.worldScale,
      options.minZoom,
      options.maxZoom,
      md.minPitch,
      md.maxPitch,
      height,
    );
  }

  /** Called after the WebGL context is restored (GPU resources must be rebuilt). */
  onContextRestore(callback: () => void): void {
    this.contextRestoredCallback = callback;
  }

  /** Ground footprint on the plane z = planeZ. */
  getVisibleExtent(planeZ = 0): VisibleExtent | null {
    this.camera.updateMatrixWorld();
    return this.frustumCalc.computeExtent(this.camera, planeZ);
  }

  /**
   * 2D frustum half-planes for the extent returned by the last
   * getVisibleExtent() call (shares its buffers), or null near top-down.
   */
  getVisibleFrustumPlanes(extent: VisibleExtent): Float32Array | null {
    return this.frustumCalc.computeFrustumPlanes(extent);
  }

  getExtentBounds(extent: VisibleExtent): { min: WorldPoint; max: WorldPoint } {
    return FrustumCalculator.getExtentBounds(extent);
  }

  /** Add a mesh to the tile group. */
  addTileMesh(mesh: Mesh): void {
    this.tileGroup.add(mesh);
  }

  /** Update the camera clip planes. */
  setClipPlanes(near: number, far: number): void {
    const cam = this.camera;
    if (Math.abs(cam.near - near) > cam.near * 1e-3 || Math.abs(cam.far - far) > cam.far * 1e-3) {
      cam.near = near;
      cam.far = far;
      cam.updateProjectionMatrix();
    }
  }

  /** Update fog distances (world units from the camera). */
  setFog(near: number, far: number): void {
    const fog = this.scene.fog as Fog;
    fog.near = near;
    fog.far = far;
  }

  /** Set the per-frame callback. @internal */
  onFrame(callback: FrameCallback): void {
    this.frameCallback = callback;
  }

  /** Render on the next animation frame (no-op work otherwise when idle). */
  requestRender(): void {
    this.renderRequested = true;
  }

  /** Start the animation loop. */
  startRenderLoop(): void {
    if (this.animationFrameId !== null) return;
    this.lastFrameTime = performance.now();
    this.renderRequested = true;
    const tick = (now: number) => {
      this.animationFrameId = requestAnimationFrame(tick);
      this.frame(now);
    };
    this.animationFrameId = requestAnimationFrame(tick);
  }

  /** Stop the animation loop. */
  stopRenderLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private frame(now: number): void {
    const dt = Math.min(Math.max((now - this.lastFrameTime) / 1000, 0), 0.25);
    this.lastFrameTime = now;
    if (this.contextLost) return;

    const animating = this.cameraController.update();
    const moved = this.cameraChanged() || animating;
    const wanted = this.frameCallback ? this.frameCallback(dt, moved) : false;
    // The callback may adjust the camera (terrain following, clip planes).
    const movedAfter = this.cameraChanged();

    if (!this.renderOnDemand || moved || movedAfter || wanted || this.renderRequested) {
      this.renderRequested = false;
      this.renderer.render(this.scene, this.camera);
      this.snapshotCamera();
    }
  }

  private cameraChanged(): boolean {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const s = this.lastCameraState;
    const m = cam.matrixWorld.elements;
    const p = cam.projectionMatrix.elements;
    for (let i = 0; i < 16; i++) if (s[i] !== m[i]) return true;
    for (let i = 0; i < 16; i++) if (s[16 + i] !== p[i]) return true;
    return false;
  }

  private snapshotCamera(): void {
    const s = this.lastCameraState;
    const m = this.camera.matrixWorld.elements;
    const p = this.camera.projectionMatrix.elements;
    for (let i = 0; i < 16; i++) s[i] = m[i];
    for (let i = 0; i < 16; i++) s[16 + i] = p[i];
  }

  /** Apply min(devicePixelRatio, maxPixelRatio) and re-arm the DPR watcher. */
  private applyPixelRatio(): void {
    if (typeof window === 'undefined') return;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, this.maxPixelRatio));
    this.dprQuery?.removeEventListener('change', this.dprListener);
    if (window.matchMedia) {
      this.dprQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
      this.dprQuery.addEventListener('change', this.dprListener);
    }
    this.requestRender();
  }

  /** Handle container resize (CSS pixels). */
  resize(width: number, height: number): void {
    if (!(width > 0 && height > 0)) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.cameraController.setViewportHeight(height);
    this.requestRender();
  }

  get viewportHeight(): number {
    return Math.max(1, this.container.clientHeight);
  }

  /** Full cleanup: GPU resources, listeners and the WebGL context itself. */
  dispose(): void {
    this.stopRenderLoop();
    this.themeQuery?.removeEventListener('change', this.themeListener);
    this.dprQuery?.removeEventListener('change', this.dprListener);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.cameraController.dispose();
    this.tileGroup.clear();
    this.renderer.dispose();
    // Release the context now instead of waiting for GC; browsers cap the
    // number of live WebGL contexts per page.
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
