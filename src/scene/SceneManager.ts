// ============================================================================
// treelet.js - Scene Manager
// Sets up the Three.js renderer, scene, camera and sky, runs the (on-demand)
// render loop, and handles resize, pixel ratio and WebGL context loss.
// ============================================================================

import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Group,
  Frustum,
  Matrix4,
  type Mesh,
} from 'three';
import { CameraController } from './CameraController';
import { FrustumCalculator } from './FrustumCalculator';
import { Sky } from './Sky';
import type { VisibleExtent, ResolvedTreeletOptions, WorldPoint } from '../core/types';

/** Per-frame callback; returns true when the scene must be re-rendered. */
export type FrameCallback = (dt: number, cameraMoved: boolean) => boolean;

/** Sky colors (sRGB hex): zenith, and the horizon haze terrain fades into. */
const SKY_LIGHT = { zenith: 0x8fbce3, horizon: 0xdde8f1 };
const SKY_DARK = { zenith: 0x081426, horizon: 0x223754 };

function srgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

export class SceneManager {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly cameraController: CameraController;
  readonly tileGroup: Group;
  /** Current horizon haze color (sRGB components); terrain fades into it. */
  readonly horizonColor: [number, number, number] = [1, 1, 1];

  private readonly sky: Sky;
  private readonly frustumCalc = new FrustumCalculator();
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
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
    console.warn(
      'treelet: WebGL context lost (GPU reset or memory pressure); waiting for the browser to restore it. ' +
      'If this repeats, lower mapDisplay.tileCacheSize or maxPixelRatio.',
    );
  };
  private readonly onContextRestored = () => {
    this.contextLost = false;
    console.info('treelet: WebGL context restored');
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
    this.sky = new Sky();
    this.scene.add(this.sky.mesh);

    // Theme-aware sky. The canvas background matches the horizon so a frame
    // the browser shows before we draw (resize, context loss) isn't white:
    // three always creates the context with alpha, so a blank canvas is
    // transparent and the page shows through.
    this.themeQuery = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    const applyTheme = () => {
      const sky = this.themeQuery?.matches ? SKY_DARK : SKY_LIGHT;
      const horizon = srgb(sky.horizon);
      this.horizonColor[0] = horizon[0];
      this.horizonColor[1] = horizon[1];
      this.horizonColor[2] = horizon[2];
      this.sky.setColors(srgb(sky.zenith), horizon);
      this.renderer.setClearColor(sky.horizon);
      this.renderer.domElement.style.backgroundColor = `#${sky.horizon.toString(16).padStart(6, '0')}`;
      this.requestRender();
    };
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

  /** Ground footprint on the plane z = planeZ, clipped to `maxDist` from the camera. */
  getVisibleExtent(planeZ = 0, maxDist = Infinity): VisibleExtent | null {
    this.camera.updateMatrixWorld();
    return this.frustumCalc.computeExtent(this.camera, planeZ, maxDist);
  }

  /** The camera's four side planes in world space, inward: (nx, ny, nz, d) × 4. */
  getSidePlanes(out: Float64Array): Float64Array {
    const cam = this.camera;
    cam.updateMatrixWorld();
    this.projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    for (let i = 0; i < 4; i++) {
      const p = this.frustum.planes[i];
      out[i * 4] = p.normal.x;
      out[i * 4 + 1] = p.normal.y;
      out[i * 4 + 2] = p.normal.z;
      out[i * 4 + 3] = p.constant;
    }
    return out;
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
    this.renderNow();
  }

  /** Handle container resize (CSS pixels). */
  resize(width: number, height: number): void {
    if (!(width > 0 && height > 0)) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.cameraController.setViewportHeight(height);
    this.renderNow();
  }

  /**
   * Resizing the canvas clears it. Draw again right away (resize observers
   * run before paint) so the cleared canvas never reaches the screen; mobile
   * browsers resize constantly as their toolbars show and hide.
   */
  private renderNow(): void {
    this.requestRender();
    if (this.animationFrameId === null || this.contextLost) return;
    this.frame(performance.now());
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
    this.sky.dispose();
    this.tileGroup.clear();
    this.renderer.dispose();
    // Release the context now instead of waiting for GC; browsers cap the
    // number of live WebGL contexts per page.
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
