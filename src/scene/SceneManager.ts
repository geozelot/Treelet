// ============================================================================
// treelet.js - Scene Manager
// Sets up Three.js renderer, scene, camera, world plane, and manages
// the tile mesh group.
// ============================================================================

import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Mesh,
  PlaneGeometry,
  MeshBasicMaterial,
  Group,
  DoubleSide,
  Color,
  Fog,
} from 'three';
import { CameraController } from './CameraController';
import { FrustumCalculator } from './FrustumCalculator';
import type { VisibleExtent, ResolvedTreeletOptions, WorldPoint } from '../core/types';

export class SceneManager {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly cameraController: CameraController;
  readonly tileGroup: Group;
  readonly worldPlane: Mesh;

  private readonly frustumCalc: FrustumCalculator;
  private readonly worldScale: number;
  private animationFrameId: number | null = null;
  private renderCallback: (() => void) | null = null;
  private readonly themeListener: () => void;

  constructor(container: HTMLElement, options: ResolvedTreeletOptions) {
    const md = options.mapDisplay;
    this.worldScale = md.worldScale;

    // Renderer
    this.renderer = new WebGLRenderer({ antialias: md.antialias });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new Scene();

    // Theme-aware sky background + atmospheric haze fog
    // Background = deep sky color; fog = lighter horizon glow color.
    // Distant terrain fades into the lighter fog color, creating a subtle
    // atmospheric shine band before the deeper sky behind it.
    const BG_DARK = new Color(0x0a1628);    // deep navy night sky
    const BG_LIGHT = new Color(0xb8d4e8);   // soft powder blue sky
    const FOG_DARK = new Color(0x1a2e48);   // lighter navy - horizon glow
    const FOG_LIGHT = new Color(0xd4e4f0);  // very light blue - horizon glow

    const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = (dark: boolean) => {
      const bg = dark ? BG_DARK : BG_LIGHT;
      const fog = dark ? FOG_DARK : FOG_LIGHT;
      this.renderer.setClearColor(bg);
      this.scene.background = bg;
      if (this.scene.fog) (this.scene.fog as Fog).color.copy(fog);
    };

    applyTheme(darkMq.matches);
    this.scene.fog = new Fog(darkMq.matches ? FOG_DARK : FOG_LIGHT, 1, 1);

    this.themeListener = () => applyTheme(darkMq.matches);
    darkMq.addEventListener('change', this.themeListener);

    // Camera - Z-up convention (matching geographic orientation)
    this.camera = new PerspectiveCamera(
      70,
      container.clientWidth / container.clientHeight,
      1,
      md.worldScale * 10,
    );
    this.camera.up.set(0, 0, 1);

    // World plane (invisible, used for raycasting)
    const planeGeo = new PlaneGeometry(md.worldScale, md.worldScale, 1, 1);
    const planeMat = new MeshBasicMaterial({
      visible: false,
      side: DoubleSide,
    });
    this.worldPlane = new Mesh(planeGeo, planeMat);
    this.scene.add(this.worldPlane);

    // Tile group - all terrain meshes live here
    this.tileGroup = new Group();
    this.scene.add(this.tileGroup);

    // Camera controller
    this.cameraController = new CameraController(
      this.camera,
      this.renderer.domElement,
      md.worldScale,
      options.minZoom,
      options.maxZoom,
      md.minPitch,
      md.maxPitch,
    );

    // Frustum calculator
    this.frustumCalc = new FrustumCalculator();
  }

  /**
   * Get current visible extent by raycasting.
   */
  getVisibleExtent(): VisibleExtent | null {
    return this.frustumCalc.computeExtent(this.camera, this.worldPlane);
  }

  /**
   * Compute 2D frustum half-planes for tight trapezoid culling.
   * Returns a Float32Array(12) with 4 planes (nx, ny, d) each, or null
   * when the camera is nearly top-down (AABB is sufficient).
   *
   * Must be called AFTER getVisibleExtent() in the same frame — reuses
   * the same pre-allocated extent data.
   */
  getVisibleFrustumPlanes(extent: VisibleExtent): Float32Array | null {
    return this.frustumCalc.computeFrustumPlanes(extent);
  }

  /**
   * Get extent bounds (axis-aligned bounding box).
   */
  getExtentBounds(extent: VisibleExtent): { min: WorldPoint; max: WorldPoint } {
    return FrustumCalculator.getExtentBounds(extent);
  }

  /**
   * Add a mesh to the tile group (the single instanced terrain mesh).
   */
  addTileMesh(mesh: Mesh): void {
    this.tileGroup.add(mesh);
  }

  /**
   * Remove a mesh from the tile group and dispose its geometry and material.
   */
  removeTileMesh(mesh: Mesh): void {
    this.tileGroup.remove(mesh);

    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    const material = mesh.material;
    const materials = Array.isArray(material) ? material : [material];
    for (const mat of materials) {
      mat.dispose();
    }
  }

  /**
   * Remove all tile meshes.
   */
  clearTiles(): void {
    const toRemove: Mesh[] = [];
    for (const child of this.tileGroup.children) {
      toRemove.push(child as Mesh);
    }
    for (const mesh of toRemove) {
      this.removeTileMesh(mesh);
    }
  }

  /**
   * Set a callback called on every render frame (before renderer.render).
   * @internal Reserved for Treelet orchestrator use.
   */
  onRender(callback: () => void): void {
    this.renderCallback = callback;
  }

  /**
   * Start the animation/render loop.
   */
  startRenderLoop(): void {
    if (this.animationFrameId !== null) return;
    const fog = this.scene.fog as Fog;
    const animate = () => {
      this.animationFrameId = requestAnimationFrame(animate);
      this.cameraController.update();

      // Scale fog with camera distance for atmospheric haze on distant terrain
      const d = this.camera.position.z;
      fog.near = d * 4;
      fog.far = d * 8;

      this.renderCallback?.();
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  /**
   * Stop the animation/render loop.
   */
  stopRenderLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Handle container resize.
   */
  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /**
   * Full cleanup.
   */
  dispose(): void {
    this.stopRenderLoop();
    this.clearTiles();
    window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', this.themeListener);
    this.cameraController.dispose();
    this.worldPlane.geometry.dispose();
    (this.worldPlane.material as MeshBasicMaterial).dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
