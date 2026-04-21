// ============================================================================
// treelet.js - Instanced Terrain Material
//
// ShaderMaterial for the instanced terrain renderer. Assembles modular GLSL
// includes into vertex/fragment shaders. One shared grid mesh is instanced
// across all visible tiles via per-instance attributes.
// ============================================================================

import {
  ShaderMaterial,
  UniformsUtils,
  UniformsLib,
  DoubleSide,
  Vector3,
  type IUniform,
  type Texture,
} from 'three';
import type { ShaderMode, BlendMode, ColorRamp } from '../core/types';

// ==== Import modular GLSL ====
import declarations from './glsl/includes/declarations.glsl?raw';
import atlasSampling from './glsl/includes/atlas_sampling.glsl?raw';
import geomorphing from './glsl/includes/geomorphing.glsl?raw';
import normals from './glsl/includes/normals.glsl?raw';
import colorRamps from './glsl/includes/color_ramps.glsl?raw';
import shaderModes from './glsl/includes/shader_modes.glsl?raw';
import drapeBlending from './glsl/includes/drape_blending.glsl?raw';
import isolineOverlay from './glsl/includes/isoline_overlay.glsl?raw';
import vertexMain from './glsl/terrain.vert.glsl?raw';
import fragmentMain from './glsl/terrain.frag.glsl?raw';

// ==== Assemble shaders from modular GLSL ====
// Vertex: atlas helpers + geomorphing helpers are self-contained (take explicit
// parameters), so they can precede the declarations in vertexMain.
// Fragment: includes reference uniforms/varyings directly, so the declarations
// include MUST come first to satisfy GLSL declaration-before-use.

const vertexShader = [
  atlasSampling,
  geomorphing,
  vertexMain,
].join('\n');

const fragmentShader = [
  declarations,
  atlasSampling,
  normals,
  colorRamps,
  shaderModes,
  drapeBlending,
  isolineOverlay,
  fragmentMain,
].join('\n');

// ==== Mode / ramp indices ====

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

const BLEND_MODE_INDEX: Record<BlendMode, number> = {
  normal: 0,
  hillshade: 1,
  softlight: 2,
};

const DEFAULT_SUN = new Vector3(0.0, 0.4, 1.0).normalize();

// ==== Public API ====

export interface TerrainMaterialOptions {
  mode?: ShaderMode;
  colorRamp?: ColorRamp;
  minElevation?: number;
  maxElevation?: number;
  metersToScene?: number;
  atlasSize?: number;
  sunDirection?: Vector3;
  baseWhite?: boolean;
  isolineEnabled?: boolean;
  isolineInterval?: number;
  isolineThickness?: number;
  isolineColor?: Vector3;
  wireframe?: boolean;
  /** Geomorph zone width as fraction of tile edge [0..0.5]. 0 = disabled. Default: 0.15 */
  morphWidth?: number;
}

/**
 * Create the instanced terrain ShaderMaterial with VTF displacement.
 */
export function createTerrainMaterial(options: TerrainMaterialOptions = {}): ShaderMaterial {
  const uniforms: Record<string, IUniform> = UniformsUtils.merge([
    UniformsLib.fog,
    {
      // Atlas
      uAtlas: { value: null },
      uAtlasSize: { value: options.atlasSize ?? 4096 },
      uElevationScale: { value: options.metersToScene ?? 0.001 },
      // Geomorphing
      uMorphWidth: { value: options.morphWidth ?? 0.25 },
      // Mode/ramp
      uMode: { value: SHADER_MODE_INDEX[options.mode ?? 'elevation'] },
      uColorRamp: { value: COLOR_RAMP_INDEX[options.colorRamp ?? 'hypsometric'] },
      uMinElevation: { value: options.minElevation ?? 0 },
      uMaxElevation: { value: options.maxElevation ?? 4000 },
      uSunDirection: { value: options.sunDirection ?? DEFAULT_SUN.clone() },
      uBaseWhite: { value: options.baseWhite ?? false },
      // Isoline
      uIsolineEnabled: { value: options.isolineEnabled ?? false },
      uIsolineInterval: { value: options.isolineInterval ?? 100 },
      uIsolineThickness: { value: options.isolineThickness ?? 1.5 },
      uIsolineColor: { value: options.isolineColor ?? new Vector3(0.12, 0.08, 0.04) },
      // Drape
      uDrapeAtlas: { value: null },
      uDrapeOpacity: { value: 1.0 },
      uHasDrape: { value: 0 },
      uDrapeBlendMode: { value: BLEND_MODE_INDEX['hillshade'] },
      uHillshadeStrength: { value: 0.5 },
      uDrapePlaceholder: { value: new Vector3(1.0, 1.0, 1.0) },
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

// ==== Setter functions ====
// Guards skip redundant uniform writes. Three.js ShaderMaterial re-uploads
// all uniforms each draw, so these guards mainly prevent unnecessary JS work
// (value comparison + object property writes) on the per-frame hot path.

export function setTerrainMode(material: ShaderMaterial, mode: ShaderMode): void {
  const v = SHADER_MODE_INDEX[mode];
  if (material.uniforms.uMode.value !== v) material.uniforms.uMode.value = v;
}

export function setTerrainColorRamp(material: ShaderMaterial, ramp: ColorRamp): void {
  const v = COLOR_RAMP_INDEX[ramp];
  if (material.uniforms.uColorRamp.value !== v) material.uniforms.uColorRamp.value = v;
}

export function setTerrainIsolineEnabled(material: ShaderMaterial, enabled: boolean): void {
  if (material.uniforms.uIsolineEnabled.value !== enabled) material.uniforms.uIsolineEnabled.value = enabled;
}

export function setTerrainWireframe(material: ShaderMaterial, enabled: boolean): void {
  if (material.wireframe !== enabled) material.wireframe = enabled;
}

export function setTerrainElevationRange(material: ShaderMaterial, min: number, max: number): void {
  const u = material.uniforms;
  if (u.uMinElevation.value !== min) u.uMinElevation.value = min;
  if (u.uMaxElevation.value !== max) u.uMaxElevation.value = max;
}

export function setTerrainElevationScale(material: ShaderMaterial, metersToScene: number): void {
  if (material.uniforms.uElevationScale.value !== metersToScene) material.uniforms.uElevationScale.value = metersToScene;
}

export function setTerrainSunDirection(material: ShaderMaterial, dir: Vector3): void {
  const cur = material.uniforms.uSunDirection.value as Vector3;
  if (!cur.equals(dir)) cur.copy(dir).normalize();
}

export function setTerrainIsolineSettings(
  material: ShaderMaterial,
  interval: number,
  thickness?: number,
): void {
  const u = material.uniforms;
  if (u.uIsolineInterval.value !== interval) u.uIsolineInterval.value = interval;
  if (thickness !== undefined && u.uIsolineThickness.value !== thickness) {
    u.uIsolineThickness.value = thickness;
  }
}

export function setTerrainIsolineColor(material: ShaderMaterial, r: number, g: number, b: number): void {
  const v = material.uniforms.uIsolineColor.value as Vector3;
  if (v.x !== r || v.y !== g || v.z !== b) v.set(r, g, b);
}

export function setTerrainBaseWhite(material: ShaderMaterial, white: boolean): void {
  if (material.uniforms.uBaseWhite.value !== white) material.uniforms.uBaseWhite.value = white;
}

export function setTerrainAtlas(material: ShaderMaterial, texture: Texture | null): void {
  if (material.uniforms.uAtlas.value !== texture) material.uniforms.uAtlas.value = texture;
}

export function setTerrainMorphWidth(material: ShaderMaterial, width: number): void {
  const v = Math.max(0, Math.min(0.5, width));
  if (material.uniforms.uMorphWidth.value !== v) material.uniforms.uMorphWidth.value = v;
}

export function setTerrainDrape(
  material: ShaderMaterial,
  texture: Texture | null,
  opacity: number = 1.0,
): void {
  const u = material.uniforms;
  if (texture) {
    if (u.uDrapeAtlas.value !== texture) u.uDrapeAtlas.value = texture;
    if (u.uDrapeOpacity.value !== opacity) u.uDrapeOpacity.value = opacity;
    if (u.uHasDrape.value !== 1) u.uHasDrape.value = 1;
  } else {
    if (u.uHasDrape.value !== 0) u.uHasDrape.value = 0;
    if (u.uDrapeAtlas.value !== null) u.uDrapeAtlas.value = null;
  }
}

export function setTerrainDrapeBlendMode(material: ShaderMaterial, mode: BlendMode): void {
  const v = BLEND_MODE_INDEX[mode] ?? 0;
  if (material.uniforms.uDrapeBlendMode.value !== v) material.uniforms.uDrapeBlendMode.value = v;
}

export function setTerrainHillshadeStrength(material: ShaderMaterial, strength: number): void {
  const v = Math.max(0, Math.min(1, strength));
  if (material.uniforms.uHillshadeStrength.value !== v) material.uniforms.uHillshadeStrength.value = v;
}

export function setTerrainDrapePlaceholder(material: ShaderMaterial, r: number, g: number, b: number): void {
  const v = material.uniforms.uDrapePlaceholder.value as Vector3;
  if (v.x !== r || v.y !== g || v.z !== b) v.set(r, g, b);
}
