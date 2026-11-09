// ============================================================================
// treelet.js - Shadow Map
//
// Terrain-cast shadows from the sun: one depth map of the terrain seen from
// the sun (orthographic), fitted around the near part of the view. The depth
// pass draws the terrain mesh itself (same instances, same vertex program
// and uniforms, so morphing, exaggeration and the floating origin match the
// picture exactly) with a material that only writes depth. The light camera
// is snapped to whole texels, so the shadows don't shimmer as the view moves,
// and the map is drawn again only when the sun, the view or the terrain
// changed.
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
 * How far the view needs shadows: the view depth and camera distance at
 * which the frustum's corner rays meet the plane z = `groundZ` (the lowest
 * visible terrain), capped at `maxDistance` for rays above the horizon.
 */
export function shadowReach(camera: PerspectiveCamera, groundZ: number, maxDistance: number): { depth: number; distance: number } {
  camera.updateMatrixWorld();
  const tan = Math.tan(((camera.fov * Math.PI) / 180) / 2) / Math.max(camera.zoom, 1e-9);
  const origin = new Vector3().setFromMatrixPosition(camera.matrixWorld);
  const forward = new Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
  let depth = 0;
  let distance = 0;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
    const dir = new Vector3(sx * tan * camera.aspect, sy * tan, -1).transformDirection(camera.matrixWorld);
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
  const corners: Vector3[] = [];
  for (const d of [near, depth]) {
    const h = d * tan;
    const w = h * camera.aspect;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      corners.push(new Vector3(sx * w, sy * h, -d).applyMatrix4(camera.matrixWorld));
    }
  }
  const center = new Vector3();
  for (const c of corners) center.add(c);
  center.divideScalar(corners.length);
  let radius = 0;
  for (const c of corners) radius = Math.max(radius, c.distanceTo(center));
  return { center, radius };
}

export interface LightFit {
  /** Light camera position and the point it looks at (world). */
  position: Vector3;
  target: Vector3;
  up: Vector3;
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
  /** Changes whenever the drawn terrain changes (data, instances, exaggeration). */
  version: string;
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
  private key = '';

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
  }

  /** Fit the light and draw the depth map if anything changed. Returns whether it drew. */
  update(renderer: WebGLRenderer, view: ShadowView): boolean {
    const cam = view.camera;
    cam.updateMatrixWorld();
    const { center, radius } = frustumSphere(cam, cam.near, Math.max(view.range, cam.near * 2));
    const fit = fitLight(center, radius, view.sun, view.heightSpan, this.size);
    const t = view.terrain.matrixWorld.elements;
    // The snapped target in whole texels (free of rounding noise)
    const tq = (v: number) => Math.round(v / fit.texel);
    const key = [
      tq(fit.target.x), tq(fit.target.y), tq(fit.target.z), fit.halfSize, fit.far.toPrecision(6),
      view.sun.x.toFixed(5), view.sun.y.toFixed(5), view.sun.z.toFixed(5),
      t[12], t[13], view.version, view.range.toPrecision(3), view.fadeDistance.toPrecision(3),
    ].join('|');
    if (key === this.key) return false;
    this.key = key;

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
    this.params[2] = view.fadeDistance * 0.8;
    this.params[3] = view.fadeDistance;
    return true;
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.material.dispose();
  }
}
