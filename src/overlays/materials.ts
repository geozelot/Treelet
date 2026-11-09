// ============================================================================
// treelet.js - Overlay materials
//
// Lines are three's wide lines (LineSegments2 / LineMaterial) and points a
// small shader drawing round markers with an outline. Both are pulled
// toward the camera by a fraction of their distance in view space: that
// changes depth only (not the screen position), so draped features stay in
// front of the terrain mesh they lie on (whose LOD can be coarser than the
// DEM they were draped with) while terrain in front still hides them.
// ============================================================================

import { ShaderMaterial, Vector2, type IUniform } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/** Fraction of its distance a feature is pulled toward the camera (depth only). */
export const OVERLAY_DEPTH_BIAS = 0.003;

/** sRGB component → linear (LineMaterial converts its output back to sRGB). */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Wide lines in CSS pixels, with per-vertex colors and the depth bias. */
export function createLineMaterial(width: number, opacity: number, resolution: Vector2): LineMaterial {
  const material = new LineMaterial({
    linewidth: width,
    vertexColors: true,
    transparent: opacity < 1,
    opacity,
    worldUnits: false,
    depthTest: true,
    depthWrite: opacity >= 1,
  });
  material.resolution.copy(resolution);
  const bias: IUniform = { value: OVERLAY_DEPTH_BIAS };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDepthBias = bias;
    const before = shader.vertexShader;
    shader.vertexShader = 'uniform float uDepthBias;\n' + before
      .replace('vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );',
        'vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 ); start.xyz *= ( 1.0 - uDepthBias );')
      .replace('vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );',
        'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 ); end.xyz *= ( 1.0 - uDepthBias );');
  };
  material.customProgramCacheKey = () => 'treelet-overlay-line';
  return material;
}

const pointVertex = /* glsl */ `
attribute vec3 color;
attribute vec3 strokeColor;
attribute float radius;
attribute float strokeWidth;
attribute float alpha;
uniform float uPixelRatio;
uniform float uDepthBias;
varying vec3 vColor;
varying vec3 vStroke;
varying float vRadius;
varying float vStrokeWidth;
varying float vHalf;
varying float vAlpha;

void main() {
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xyz *= (1.0 - uDepthBias);
  gl_Position = projectionMatrix * mv;
  // Marker plus outline plus a pixel for the soft edge, in CSS pixels
  vHalf = radius + strokeWidth + 1.0;
  gl_PointSize = 2.0 * vHalf * uPixelRatio;
  vColor = color;
  vStroke = strokeColor;
  vRadius = radius;
  vStrokeWidth = strokeWidth;
}`;

const pointFragment = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
varying vec3 vStroke;
varying float vRadius;
varying float vStrokeWidth;
varying float vHalf;
varying float vAlpha;

void main() {
  // Distance from the marker center in CSS pixels
  float d = length(gl_PointCoord - 0.5) * 2.0 * vHalf;
  float outer = vRadius + vStrokeWidth;
  float alpha = 1.0 - smoothstep(outer - 0.5, outer + 0.5, d);
  if (alpha <= 0.0) discard;
  float t = vStrokeWidth > 0.0 ? smoothstep(vRadius - 0.5, vRadius + 0.5, d) : 0.0;
  gl_FragColor = vec4(mix(vColor, vStroke, t), alpha * vAlpha * uOpacity);
}`;

/** Round point markers (sRGB colors, sizes in CSS pixels) with the depth bias. */
export function createPointMaterial(opacity: number, pixelRatio: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
    uniforms: {
      uPixelRatio: { value: pixelRatio },
      uDepthBias: { value: OVERLAY_DEPTH_BIAS },
      uOpacity: { value: opacity },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
}
