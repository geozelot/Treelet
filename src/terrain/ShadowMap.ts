// ============================================================================
// treelet.js - Shadow Map
//
// Terrain-cast shadows from the sun: one depth map of the terrain seen from
// the sun (orthographic), fitted around the near part of the view. The depth
// pass draws the terrain mesh itself (same instances, same vertex program
// and uniforms, so morphing, exaggeration and the floating origin match the
// picture exactly) with a material that only writes depth. The light camera
// is snapped to whole texels, so the shadows don't shimmer as the view moves.
// The light box is fitted with a margin around the view and kept while the
// view stays inside it: the map is drawn again only when the sun or the
// terrain changed, the view left the box, or zooming in made it too coarse.
// ============================================================================

import {
  DepthTexture,
  Matrix4,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  UnsignedIntType,
  Vector3,
  WebGLRenderTarget,
  type BufferGeometry,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';

export const DEFAULT_SHADOW_MAP_SIZE = 2048;

/**
 * Sun height (z of the unit vector toward it) at or below which it is
 * night for shadows: everything is in shadow and the map isn't drawn. The
 * shader uses the same value (SHADOW_NIGHT_SUN_Z).
 */
export const SHADOW_NIGHT_SUN_Z = 0.005;

/** The light box is this much larger than the view's bounding sphere, so small moves keep the map. */
export const SHADOW_FIT_MARGIN = 1.3;
/** A kept box more than this much larger than a fresh fit is refitted (for detail after zooming in). */
const MAX_FIT_EXCESS = 1.6;
/** Finer terrain (tiles streaming in, LOD changes) redraws the map at most this often. */
export const SHADOW_DETAIL_INTERVAL_MS = 150;

// Scratch objects (the fitting runs every frame)
const sOrigin = new Vector3();
const sForward = new Vector3();
const sDir = new Vector3();
const sCorners = Array.from({ length: 8 }, () => new Vector3());
const sOffset = new Vector3();
const CORNER_SIGNS: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const RAY_SIGNS: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]];

/**
 * How far the view needs shadows: the view depth and camera distance at
 * which the frustum's corner rays meet the plane z = `groundZ` (the lowest
 * visible terrain), capped at `maxDistance` for rays above the horizon.
 */
export function shadowReach(camera: PerspectiveCamera, groundZ: number, maxDistance: number): { depth: number; distance: number } {
  camera.updateMatrixWorld();
  const tan = Math.tan(((camera.fov * Math.PI) / 180) / 2) / Math.max(camera.zoom, 1e-9);
  const origin = sOrigin.setFromMatrixPosition(camera.matrixWorld);
  const forward = sForward.set(0, 0, -1).transformDirection(camera.matrixWorld);
  let depth = 0;
  let distance = 0;
  for (const [sx, sy] of RAY_SIGNS) {
    const dir = sDir.set(sx * tan * camera.aspect, sy * tan, -1).transformDirection(camera.matrixWorld);
    let t = maxDistance;
    if (dir.z < -1e-9) t = Math.min(maxDistance, (groundZ - origin.z) / dir.z);
    if (!(t > 0)) t = maxDistance;
    distance = Math.max(distance, t);
    depth = Math.max(depth, t * dir.dot(forward));
  }
  return { depth: depth * 1.02, distance: distance * 1.02 };
}

/** Bounding sphere (world) of the camera's view between `near` and view depth `depth`. */
export function frustumSphere(camera: PerspectiveCamera, near: number, depth: number): { center: Vector3; radius: number } {
  camera.updateMatrixWorld();
  const tan = Math.tan(((camera.fov * Math.PI) / 180) / 2) / Math.max(camera.zoom, 1e-9);
  let k = 0;
  for (const d of [near, depth]) {
    const h = d * tan;
    const w = h * camera.aspect;
    for (const [sx, sy] of CORNER_SIGNS) sCorners[k++].set(sx * w, sy * h, -d).applyMatrix4(camera.matrixWorld);
  }
  const center = new Vector3();
  for (const c of sCorners) center.add(c);
  center.divideScalar(sCorners.length);
  let radius = 0;
  for (const c of sCorners) radius = Math.max(radius, c.distanceTo(center));
  return { center, radius };
}

export interface LightFit {
  /** Light camera position and the point it looks at (world). */
  position: Vector3;
  target: Vector3;
  up: Vector3;
  /** Light-space axes: across the light (with `up`) and toward the sun. */
  right: Vector3;
  light: Vector3;
  /** Half-size of the orthographic box, and its depth. */
  halfSize: number;
  far: number;
  /** World size of one shadow-map texel. */
  texel: number;
}

/**
 * The light camera for a region (bounding sphere) lit from `sun` (unit
 * vector toward the sun). The box reaches `heightSpan / sin(altitude)`
 * further toward the sun so that terrain rising above the region still
 * casts into it. The center is snapped to whole texels (across the light,
 * so the texel grid stays fixed on the ground, and along it) and the size
 * to steps of 10 %, so small view changes keep the same shadow map.
 */
export function fitLight(center: Vector3, radius: number, sun: Vector3, heightSpan: number, size: number): LightFit {
  const L = sun.clone().normalize();
  // Size in steps of 10 %
  const halfSize = Math.pow(1.1, Math.ceil(Math.log(Math.max(radius, 1e-9)) / Math.log(1.1)));
  const texel = (2 * halfSize) / size;
  const up = Math.abs(L.z) < 0.99 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  // Light-space axes (right, up') across the light direction
  const right = new Vector3().crossVectors(up, L).normalize();
  const upAxis = new Vector3().crossVectors(L, right).normalize();
  // Whole texels across the light (no shimmer) and along it (no redraw for tiny moves)
  const cr = center.dot(right);
  const cu = center.dot(upAxis);
  const cl = center.dot(L);
  const snapped = center.clone()
    .addScaledVector(right, Math.round(cr / texel) * texel - cr)
    .addScaledVector(upAxis, Math.round(cu / texel) * texel - cu)
    .addScaledVector(L, Math.round(cl / texel) * texel - cl);
  const extra = Math.min(heightSpan / Math.max(L.z, 0.05), halfSize * 20);
  const back = halfSize + extra;
  return {
    position: snapped.clone().addScaledVector(L, back),
    target: snapped,
    up: upAxis,
    right,
    light: L,
    halfSize,
    far: back + halfSize,
    texel,
  };
}

/** Maps clip space [-1, 1] to texture space [0, 1]. */
const BIAS = new Matrix4().set(
  0.5, 0, 0, 0.5,
  0, 0.5, 0, 0.5,
  0, 0, 0.5, 0.5,
  0, 0, 0, 1,
);

export interface ShadowView {
  camera: PerspectiveCamera;
  /** The terrain mesh (its world matrix carries the render origin). */
  terrain: Mesh;
  /** View depth the shadow map covers (world units). */
  range: number;
  /** Camera distance the shadows reach; they fade out over its last fifth. */
  fadeDistance: number;
  /** Elevation span of the visible terrain in world units (taller casters). */
  heightSpan: number;
  /** Unit vector toward the sun. */
  sun: Vector3;
  /** Changes when the terrain's shape changes as a whole (exaggeration): the map is drawn again at once. */
  version: string;
  /** Changes as terrain detail changes (tiles loaded, LOD): drawn again at most every SHADOW_DETAIL_INTERVAL_MS. */
  detail: string;
}

export class ShadowMap {
  readonly target: WebGLRenderTarget;
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** Terrain-local position → shadow-map texture coordinates and depth. */
  readonly matrix = new Matrix4();
  /** UV size of a texel, depth per texel, fade start and end (camera distance). */
  readonly params: [number, number, number, number] = [0, 0, 0, 0];
  private readonly scene = new Scene();
  private readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  /** What the map was drawn for (sun, terrain, origin) and the light box it covers. */
  private key = '';
  private fit: LightFit | null = null;
  private drawnDetail = '';
  private lastDraw = -Infinity;
  private detailPending = false;

  constructor(geometry: BufferGeometry, terrainMaterial: ShaderMaterial, readonly size = DEFAULT_SHADOW_MAP_SIZE) {
    const depthTexture = new DepthTexture(size, size, UnsignedIntType);
    this.target = new WebGLRenderTarget(size, size, { depthBuffer: true, depthTexture });
    // Same vertex program and uniforms as the terrain; depth only
    this.material = new ShaderMaterial({
      vertexShader: terrainMaterial.vertexShader,
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
      uniforms: terrainMaterial.uniforms,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false;
    this.scene.add(this.mesh);
    this.scene.matrixWorldAutoUpdate = false;
  }

  /** Draw the depth map again on the next update. */
  invalidate(): void {
    this.key = '';
    this.fit = null;
  }

  /** Terrain detail changed but the map waits for SHADOW_DETAIL_INTERVAL_MS: update again after it. */
  get pending(): boolean {
    return this.detailPending;
  }

  /**
   * Fit the light and draw the depth map if needed (see the header); the
   * fade follows the view every call. Returns whether the shadow uniforms
   * changed (the map was drawn or the fade moved).
   */
  update(renderer: WebGLRenderer, view: ShadowView, now = performance.now()): boolean {
    const cam = view.camera;
    cam.updateMatrixWorld();
    const { center, radius } = frustumSphere(cam, cam.near, Math.max(view.range, cam.near * 2));
    const t = view.terrain.matrixWorld.elements;
    const key = [view.sun.x.toFixed(5), view.sun.y.toFixed(5), view.sun.z.toFixed(5), t[12], t[13], view.version].join('|');
    let draw = key !== this.key || !this.covers(center, radius, view);
    this.detailPending = false;
    if (!draw && view.detail !== this.drawnDetail) {
      if (now - this.lastDraw >= SHADOW_DETAIL_INTERVAL_MS) draw = true;
      else this.detailPending = true;
    }
    if (draw) {
      this.draw(renderer, view, fitLight(center, radius * SHADOW_FIT_MARGIN, view.sun, view.heightSpan, this.size));
      this.key = key;
      this.drawnDetail = view.detail;
      this.lastDraw = now;
    }
    const drawn = draw;
    // The fade (a uniform) follows the view without drawing the map again
    const fadeStart = view.fadeDistance * 0.8;
    const fadeEnd = view.fadeDistance;
    const faded = this.params[2] !== fadeStart || this.params[3] !== fadeEnd;
    this.params[2] = fadeStart;
    this.params[3] = fadeEnd;
    return drawn || faded;
  }

  /** Whether the kept light box still holds the view (and its casters) at enough detail. */
  private covers(center: Vector3, radius: number, view: ShadowView): boolean {
    const fit = this.fit;
    if (!fit) return false;
    // Zoomed in: a box much larger than a fresh fit wastes resolution
    if (fit.halfSize > radius * SHADOW_FIT_MARGIN * MAX_FIT_EXCESS) return false;
    const d = sOffset.copy(center).sub(fit.target);
    const r = d.dot(fit.right);
    const u = d.dot(fit.up);
    const l = d.dot(fit.light);
    // Toward the sun the box must also hold terrain up to the height span above the view
    const reach = Math.min(view.heightSpan / Math.max(fit.light.z, 0.05), fit.halfSize * 20);
    const back = fit.far - fit.halfSize;
    return Math.abs(r) + radius <= fit.halfSize
      && Math.abs(u) + radius <= fit.halfSize
      && l - radius >= -fit.halfSize
      && l + radius + reach <= back;
  }

  private draw(renderer: WebGLRenderer, view: ShadowView, fit: LightFit): void {
    const lc = this.camera;
    lc.left = -fit.halfSize;
    lc.right = fit.halfSize;
    lc.top = fit.halfSize;
    lc.bottom = -fit.halfSize;
    lc.near = 0;
    lc.far = fit.far;
    lc.position.copy(fit.position);
    lc.up.copy(fit.up);
    lc.lookAt(fit.target);
    lc.updateProjectionMatrix();
    lc.updateMatrixWorld();

    this.mesh.matrix.copy(view.terrain.matrixWorld);
    this.mesh.matrixWorld.copy(view.terrain.matrixWorld);

    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.clear(true, true, false);
    renderer.render(this.scene, lc);
    renderer.setRenderTarget(previous);

    this.matrix.copy(BIAS).multiply(lc.projectionMatrix).multiply(lc.matrixWorldInverse).multiply(view.terrain.matrixWorld);
    this.params[0] = 1 / this.size;
    this.params[1] = fit.texel / fit.far;
    this.fit = fit;
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.material.dispose();
  }
}
