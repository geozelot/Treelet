// ============================================================================
// treelet.js - Sky
//
// A full-screen triangle at the far plane, drawn after the terrain so early
// depth testing limits it to uncovered pixels. Each pixel's view ray picks a
// color: below the horizon it is the haze color the terrain fades into, above
// it a gradient toward the zenith color. Because distant terrain reaches the
// same haze color exactly at the visible range, the terrain's end is never
// visible; it reads as a horizon in every direction.
// ============================================================================

import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  Matrix4,
  Vector3,
  type Camera,
} from 'three';

const vertexShader = /* glsl */ `
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
out vec3 vRay;

void main() {
  vec4 view = uInvProjection * vec4(position.xy, 1.0, 1.0);
  vRay = mat3(uCameraWorld) * (view.xyz / view.w);
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
in vec3 vRay;

void main() {
  float e = normalize(vRay).z; // sine of the ray's elevation angle (Z up)
  float t = smoothstep(0.0, 0.45, e);
  gl_FragColor = vec4(mix(uHorizon, uZenith, t * (2.0 - t)), 1.0);
}
`;

export class Sky {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor() {
    // One triangle covering clip space [-1, 1]².
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uInvProjection: { value: new Matrix4() },
        uCameraWorld: { value: new Matrix4() },
        uZenith: { value: new Vector3() },
        uHorizon: { value: new Vector3() },
      },
      depthWrite: false,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    // After all terrain: early-z then rejects every covered pixel.
    this.mesh.renderOrder = Number.MAX_SAFE_INTEGER;
    this.mesh.onBeforeRender = (_r, _s, camera: Camera) => {
      const u = this.material.uniforms;
      (u.uInvProjection.value as Matrix4).copy(camera.projectionMatrixInverse);
      (u.uCameraWorld.value as Matrix4).copy(camera.matrixWorld);
    };
  }

  /** Colors as sRGB components in [0, 1]. */
  setColors(zenith: readonly number[], horizon: readonly number[]): void {
    const u = this.material.uniforms;
    (u.uZenith.value as Vector3).set(zenith[0], zenith[1], zenith[2]);
    (u.uHorizon.value as Vector3).set(horizon[0], horizon[1], horizon[2]);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
