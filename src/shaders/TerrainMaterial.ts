// ============================================================================
// treelet.js - Unified Terrain Material
//
// Single ShaderMaterial supporting 5 shader modes and 4 color ramps via
// uniform switches, plus independent contour line overlay and drape texture.
// Mode/ramp switching is instant (uniform update only, no shader recompile).
//
// Shader modes: 0=base, 1=elevation, 2=slope, 3=aspect, 4=texture
// Color ramps:  0=hypsometric, 1=viridis, 2=inferno, 3=grayscale
// Contour:      uContourEnabled (bool) overlays contour lines on any mode
// ============================================================================

import {
  ShaderMaterial,
  UniformsUtils,
  UniformsLib,
  DoubleSide,
  Vector3,
  Texture,
  type IUniform,
} from 'three';
import type { ShaderMode, BlendMode, ColorRamp } from '../core/types';

// ---- GLSL shaders ----

const vertexShader = /* glsl */ `
varying vec3 vNormal;
varying vec2 vUv;
varying float vElevation;

uniform float uElevationScale;

#include <fog_pars_vertex>

void main() {
  vNormal = normalize(normalMatrix * normal);
  vUv = uv;
  vElevation = position.z / uElevationScale;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

varying vec3 vNormal;
varying vec2 vUv;
varying float vElevation;

// Shader mode: 0=base, 1=elevation, 2=slope, 3=aspect, 4=texture
uniform int uMode;

// Color ramp: 0=hypsometric, 1=viridis, 2=inferno, 3=grayscale
uniform int uColorRamp;

// Elevation range (meters)
uniform float uMinElevation;
uniform float uMaxElevation;

// Lighting
uniform vec3 uSunDirection;

// Wireframe: when true, base mode renders flat white instead of normals
uniform bool uBaseWhite;

// Contour overlay (independent of mode)
uniform bool uContourEnabled;
uniform float uContourInterval;
uniform float uContourThickness;
uniform vec3 uContourColor;

// Drape texture
uniform sampler2D uDrapeMap;
uniform float uDrapeOpacity;
uniform int uHasDrape;

#include <fog_pars_fragment>

// --- Utility ---

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// --- Color ramps ---

vec3 hypsometricColor(float t) {
  vec3 c0 = vec3(0.08, 0.32, 0.18);  // deep green
  vec3 c1 = vec3(0.30, 0.58, 0.22);  // forest
  vec3 c2 = vec3(0.62, 0.72, 0.32);  // light green
  vec3 c3 = vec3(0.80, 0.72, 0.40);  // tan
  vec3 c4 = vec3(0.64, 0.48, 0.34);  // brown
  vec3 c5 = vec3(0.72, 0.68, 0.65);  // gray rock
  vec3 c6 = vec3(0.96, 0.96, 0.98);  // snow

  if (t < 0.0)  return c0;
  if (t < 0.08) return mix(c0, c1, t / 0.08);
  if (t < 0.20) return mix(c1, c2, (t - 0.08) / 0.12);
  if (t < 0.38) return mix(c2, c3, (t - 0.20) / 0.18);
  if (t < 0.55) return mix(c3, c4, (t - 0.38) / 0.17);
  if (t < 0.78) return mix(c4, c5, (t - 0.55) / 0.23);
  return mix(c5, c6, clamp((t - 0.78) / 0.22, 0.0, 1.0));
}

vec3 viridisColor(float t) {
  vec3 c0 = vec3(0.267, 0.004, 0.329);
  vec3 c1 = vec3(0.282, 0.140, 0.458);
  vec3 c2 = vec3(0.127, 0.566, 0.551);
  vec3 c3 = vec3(0.369, 0.789, 0.383);
  vec3 c4 = vec3(0.993, 0.906, 0.144);

  t = clamp(t, 0.0, 1.0);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.50) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.50) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

vec3 infernoColor(float t) {
  vec3 c0 = vec3(0.001, 0.000, 0.014);
  vec3 c1 = vec3(0.341, 0.062, 0.429);
  vec3 c2 = vec3(0.735, 0.215, 0.330);
  vec3 c3 = vec3(0.988, 0.645, 0.040);
  vec3 c4 = vec3(0.988, 0.998, 0.645);

  t = clamp(t, 0.0, 1.0);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.50) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.50) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

vec3 grayscaleColor(float t) {
  t = clamp(t, 0.0, 1.0);
  return vec3(t);
}

vec3 applyRamp(float t) {
  if (uColorRamp == 0) return hypsometricColor(t);
  if (uColorRamp == 1) return viridisColor(t);
  if (uColorRamp == 2) return infernoColor(t);
  return grayscaleColor(t);
}

// --- Shader modes ---

vec3 baseMode() {
  if (uBaseWhite) return vec3(1.0);
  // Normal-as-RGB, same rendering as MeshNormalMaterial
  return normalize(vNormal) * 0.5 + 0.5;
}

vec3 elevationMode() {
  float t = (vElevation - uMinElevation) / max(uMaxElevation - uMinElevation, 1.0);
  vec3 color = applyRamp(t);
  float light = max(dot(vNormal, uSunDirection), 0.0) * 0.55 + 0.45;
  return color * light;
}

vec3 slopeMode() {
  float slopeAngle = acos(clamp(dot(vNormal, vec3(0.0, 0.0, 1.0)), -1.0, 1.0));
  float t = clamp(slopeAngle / 1.5708, 0.0, 1.0);
  vec3 color = applyRamp(t);
  float light = max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0) * 0.3 + 0.7;
  return color * light;
}

vec3 aspectMode() {
  vec3 n = normalize(vNormal);
  float flatness = n.z;
  float angle = atan(n.x, n.y);
  float t = (angle + 3.14159265) / 6.28318530;
  vec3 color = applyRamp(t);
  color = mix(color, vec3(0.65), smoothstep(0.15, 0.0, 1.0 - flatness));
  return color;
}

vec3 textureMode() {
  // Fallback to elevation coloring when no drape texture is loaded
  if (uHasDrape == 0) return elevationMode();

  // Sample drape texture with V-flip for ImageBitmap (flipY=false)
  vec2 drapeUv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 drape = texture2D(uDrapeMap, drapeUv);

  // Blend drape with elevation base using opacity
  vec3 base = elevationMode();
  return mix(base, drape.rgb, uDrapeOpacity);
}

void main() {
  vec3 color;

  if (uMode == 0) color = baseMode();
  else if (uMode == 1) color = elevationMode();
  else if (uMode == 2) color = slopeMode();
  else if (uMode == 3) color = aspectMode();
  else color = textureMode();

  // Contour line overlay (independent of mode)
  if (uContourEnabled) {
    float d = fract(vElevation / uContourInterval);
    float fw = fwidth(vElevation / uContourInterval);
    float line = 1.0 - smoothstep(0.0, uContourThickness * fw, min(d, 1.0 - d));
    color = mix(color, uContourColor, line * 0.75);
  }

  gl_FragColor = vec4(color, 1.0);
  #include <fog_fragment>
}
`;

// ---- Mode / ramp indices ----

const SHADER_MODE_INDEX: Record<ShaderMode, number> = {
  base: 0,
  elevation: 1,
  slope: 2,
  aspect: 3,
  texture: 4,
};

const COLOR_RAMP_INDEX: Record<ColorRamp, number> = {
  hypsometric: 0,
  viridis: 1,
  inferno: 2,
  grayscale: 3,
};

// Default sun: azimuth 315°, altitude 45° in Z-up
const DEFAULT_SUN = new Vector3(-0.5, 0.5, 0.7071).normalize();

// ---- Public API ----

export interface TerrainMaterialOptions {
  mode?: ShaderMode;
  colorRamp?: ColorRamp;
  minElevation?: number;
  maxElevation?: number;
  metersToScene?: number;
  sunDirection?: Vector3;
  baseWhite?: boolean;
  contourEnabled?: boolean;
  contourInterval?: number;
  contourThickness?: number;
  contourColor?: Vector3;
  wireframe?: boolean;
}

/**
 * Create a unified terrain ShaderMaterial.
 *
 * `uElevationScale` is metersToScene only (no exaggeration).
 * Exaggeration is handled via mesh.scale.z for proper vertex displacement.
 */
export function createTerrainMaterial(options: TerrainMaterialOptions = {}): ShaderMaterial {
  const uniforms: Record<string, IUniform> = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uMode: { value: SHADER_MODE_INDEX[options.mode ?? 'base'] },
      uColorRamp: { value: COLOR_RAMP_INDEX[options.colorRamp ?? 'hypsometric'] },
      uElevationScale: { value: options.metersToScene ?? 0.001 },
      uMinElevation: { value: options.minElevation ?? 0 },
      uMaxElevation: { value: options.maxElevation ?? 4000 },
      uSunDirection: { value: options.sunDirection ?? DEFAULT_SUN.clone() },
      uBaseWhite: { value: options.baseWhite ?? false },
      uContourEnabled: { value: options.contourEnabled ?? false },
      uContourInterval: { value: options.contourInterval ?? 100 },
      uContourThickness: { value: options.contourThickness ?? 1.5 },
      uContourColor: { value: options.contourColor ?? new Vector3(0.12, 0.08, 0.04) },
      uDrapeMap: { value: null },
      uDrapeOpacity: { value: 1.0 },
      uHasDrape: { value: 0 },
    },
  ]);

  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    side: DoubleSide,
    wireframe: options.wireframe ?? false,
    fog: true,
  });
}

/**
 * Update the shader mode on a terrain material.
 */
export function setMaterialMode(material: ShaderMaterial, mode: ShaderMode): void {
  material.uniforms.uMode.value = SHADER_MODE_INDEX[mode];
}

/**
 * Update the color ramp on a terrain material.
 */
export function setMaterialColorRamp(material: ShaderMaterial, ramp: ColorRamp): void {
  material.uniforms.uColorRamp.value = COLOR_RAMP_INDEX[ramp];
}

/**
 * Enable or disable contour line overlay.
 */
export function setMaterialContourEnabled(material: ShaderMaterial, enabled: boolean): void {
  material.uniforms.uContourEnabled.value = enabled;
}

/**
 * Set material wireframe rendering.
 */
export function setMaterialWireframe(material: ShaderMaterial, enabled: boolean): void {
  material.wireframe = enabled;
}

/**
 * Update elevation range on a terrain material.
 */
export function setMaterialElevationRange(
  material: ShaderMaterial,
  min: number,
  max: number,
): void {
  material.uniforms.uMinElevation.value = min;
  material.uniforms.uMaxElevation.value = max;
}

/**
 * Update the elevation scale (metersToScene only - no exaggeration).
 */
export function setMaterialElevationScale(
  material: ShaderMaterial,
  metersToScene: number,
): void {
  material.uniforms.uElevationScale.value = metersToScene;
}

/**
 * Update the sun direction for elevation lighting.
 */
export function setMaterialSunDirection(material: ShaderMaterial, dir: Vector3): void {
  material.uniforms.uSunDirection.value.copy(dir).normalize();
}

/**
 * Update contour settings.
 */
export function setMaterialContourSettings(
  material: ShaderMaterial,
  interval: number,
  thickness?: number,
): void {
  material.uniforms.uContourInterval.value = interval;
  if (thickness !== undefined) {
    material.uniforms.uContourThickness.value = thickness;
  }
}

/**
 * Set drape texture on a terrain material.
 */
export function setMaterialDrape(
  material: ShaderMaterial,
  texture: Texture | null,
  opacity: number = 1.0,
): void {
  if (texture) {
    material.uniforms.uDrapeMap.value = texture;
    material.uniforms.uDrapeOpacity.value = opacity;
    material.uniforms.uHasDrape.value = 1;
  } else {
    material.uniforms.uHasDrape.value = 0;
    material.uniforms.uDrapeMap.value = null;
  }
}

/**
 * Set wireframe base color mode (normals vs flat white).
 */
export function setMaterialBaseWhite(material: ShaderMaterial, white: boolean): void {
  material.uniforms.uBaseWhite.value = white;
}

/**
 * Set contour line color.
 */
export function setMaterialContourColor(material: ShaderMaterial, r: number, g: number, b: number): void {
  material.uniforms.uContourColor.value.set(r, g, b);
}

/**
 * Check if a material is a terrain material (has our custom uniforms).
 */
export function isTerrainMaterial(material: unknown): material is ShaderMaterial {
  return material instanceof ShaderMaterial && 'uMode' in (material.uniforms ?? {});
}
