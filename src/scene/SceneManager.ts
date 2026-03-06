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
  ShaderMaterial,
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
    this.worldScale = options.worldScale;

    // Renderer
    this.renderer = new WebGLRenderer({ antialias: options.antialias });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new Scene();

    // Theme-aware background + horizon fog
    const BG_DARK = new Color(0x1c1c1c);
    const BG_LIGHT = new Color(0xebebeb);

    const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = (dark: boolean) => {
      const bg = dark ? BG_DARK : BG_LIGHT;
      this.renderer.setClearColor(bg);
      this.scene.background = bg;
      if (this.scene.fog) (this.scene.fog as Fog).color.copy(bg);
    };

    applyTheme(darkMq.matches);
    this.scene.fog = new Fog(darkMq.matches ? BG_DARK : BG_LIGHT, 1, 1);

    this.themeListener = () => applyTheme(darkMq.matches);
    darkMq.addEventListener('change', this.themeListener);

    // Camera - Z-up convention (matching geographic orientation)
    this.camera = new PerspectiveCamera(
      70,
      container.clientWidth / container.clientHeight,
      1,
      options.worldScale * 10,
    );
    this.camera.up.set(0, 0, 1);

    // World plane (invisible, used for raycasting)
    const planeGeo = new PlaneGeometry(options.worldScale, options.worldScale, 1, 1);
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
      options.worldScale,
      options.minZoom,
      options.maxZoom,
      options.minPitch,
      options.maxPitch,
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
   * Get extent bounds (axis-aligned bounding box).
   */
  getExtentBounds(extent: VisibleExtent): { min: WorldPoint; max: WorldPoint } {
    return FrustumCalculator.getExtentBounds(extent);
  }

  /**
   * Add a tile mesh to the scene.
   */
  addTileMesh(mesh: Mesh): void {
    this.tileGroup.add(mesh);
  }

  /**
   * Remove a tile mesh from the scene and dispose its resources.
   */
  removeTileMesh(mesh: Mesh): void {
    this.tileGroup.remove(mesh);

    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    const material = mesh.material;
    const materials = Array.isArray(material) ? material : [material];
    for (const mat of materials) {
      // Dispose drape texture from ShaderMaterial uniforms
      if (mat instanceof ShaderMaterial && mat.uniforms?.uDrapeMap?.value) {
        mat.uniforms.uDrapeMap.value.dispose();
      }
      // Dispose map from basic materials
      if ('map' in mat && (mat as MeshBasicMaterial).map) {
        (mat as MeshBasicMaterial).map!.dispose();
      }
      mat.dispose();
    }
  }

  /**
   * Remove all tile meshes.
   */
  clearTiles(): void {
    while (this.tileGroup.children.length > 0) {
      this.removeTileMesh(this.tileGroup.children[0] as Mesh);
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

      // Scale fog with camera distance so horizon tiles always fade out
      const d = this.camera.position.z;
      fog.near = d * 5;
      fog.far = d * 9;

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
