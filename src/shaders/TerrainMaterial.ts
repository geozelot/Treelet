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
  FrontSide,
  Vector3,
  type IUniform,
  type Texture,
} from 'three';
import type { ShaderMode, BlendMode, ColorRamp } from '../core/types';

// ==== Import modular GLSL ====
import declarations from './glsl/includes/declarations.glsl?raw';
import elevationSampling from './glsl/includes/elevation_sampling.glsl?raw';
import surface from './glsl/includes/surface.glsl?raw';
import colorRamps from './glsl/includes/color_ramps.glsl?raw';
import shaderModes from './glsl/includes/shader_modes.glsl?raw';
import drapeBlending from './glsl/includes/drape_blending.glsl?raw';
import isolineOverlay from './glsl/includes/isoline_overlay.glsl?raw';
import vertexMain from './glsl/terrain.vert.glsl?raw';
import fragmentMain from './glsl/terrain.frag.glsl?raw';

// ==== Assemble shaders from modular GLSL ====
// Fragment includes reference uniforms/varyings directly, so declarations
// must come first to satisfy GLSL declaration-before-use.

const vertexShader = [
  elevationSampling,
  vertexMain,
].join('\n');

const fragmentShader = [
  declarations,
  elevationSampling,
  surface,
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
  cyclic: 4,
};

const BLEND_MODE_INDEX: Record<BlendMode, number> = {
  normal: 0,
  hillshade: 1,
  softlight: 2,
};

/** Default sun: from the north-west (cartographic convention), 45° altitude. */
const DEFAULT_SUN = new Vector3(-0.5, 0.5, 0.7071).normalize();

// ==== Public API ====

export interface TerrainMaterialOptions {
  metersToScene: number;
  worldScale: number;
  slotSize: number;
  gridSize: number;
  mode?: ShaderMode;
  colorRamp?: ColorRamp;
  minElevation?: number;
  maxElevation?: number;
}

/**
 * Create the instanced terrain ShaderMaterial.
 */
export function createTerrainMaterial(options: TerrainMaterialOptions): ShaderMaterial {
  const uniforms: Record<string, IUniform> = UniformsUtils.merge([
    UniformsLib.fog,
    {
      // Elevation atlas + geometry
      uElevAtlas: { value: null },
      uSlotSize: { value: options.slotSize },
      uGridSize: { value: options.gridSize },
      uElevationScale: { value: options.metersToScene },
      uExaggeration: { value: 1.0 },
      uWorldScale: { value: options.worldScale },
      uOriginY: { value: 0.0 },
      uCameraLocal: { value: new Vector3() },
      uRefZ: { value: 0.0 },
      // Mode/ramp
      uMode: { value: SHADER_MODE_INDEX[options.mode ?? 'elevation'] },
      uColorRamp: { value: COLOR_RAMP_INDEX[options.colorRamp ?? 'hypsometric'] },
      uMinElevation: { value: options.minElevation ?? 0 },
      uMaxElevation: { value: options.maxElevation ?? 4000 },
      uSlopeMin: { value: 0 },
      uSlopeMax: { value: 60 },
      uSunDirection: { value: DEFAULT_SUN.clone() },
      uBaseWhite: { value: false },
      // Isoline
      uIsolineEnabled: { value: false },
      uIsolineInterval: { value: 100 },
      uIsolineThickness: { value: 1.5 },
      uIsolineColor: { value: new Vector3(0.12, 0.08, 0.04) },
      // Drape
      uDrapeAtlas: { value: null },
      uDrapeOpacity: { value: 1.0 },
      uHasDrape: { value: 0 },
      uDrapeBlendMode: { value: BLEND_MODE_INDEX.hillshade },
      uHillshadeStrength: { value: 0.5 },
      uDrapePlaceholder: { value: new Vector3(1.0, 1.0, 1.0) },
    },
  ]);

  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    side: FrontSide,
    fog: true,
  });
}

// ==== Setter functions ====
// Each returns true when a value actually changed, so callers can request a
// render only when needed.

export function setTerrainMode(material: ShaderMaterial, mode: ShaderMode): boolean {
  const v = SHADER_MODE_INDEX[mode];
  if (material.uniforms.uMode.value === v) return false;
  material.uniforms.uMode.value = v;
  return true;
}

export function setTerrainColorRamp(material: ShaderMaterial, ramp: ColorRamp): boolean {
  const v = COLOR_RAMP_INDEX[ramp] ?? 0;
  if (material.uniforms.uColorRamp.value === v) return false;
  material.uniforms.uColorRamp.value = v;
  return true;
}

export function setTerrainIsolineEnabled(material: ShaderMaterial, enabled: boolean): boolean {
  if (material.uniforms.uIsolineEnabled.value === enabled) return false;
  material.uniforms.uIsolineEnabled.value = enabled;
  return true;
}

export function setTerrainWireframe(material: ShaderMaterial, enabled: boolean): boolean {
  if (material.wireframe === enabled) return false;
  material.wireframe = enabled;
  return true;
}

export function setTerrainElevationRange(material: ShaderMaterial, min: number, max: number): boolean {
  const u = material.uniforms;
  if (u.uMinElevation.value === min && u.uMaxElevation.value === max) return false;
  u.uMinElevation.value = min;
  u.uMaxElevation.value = max;
  return true;
}

export function setTerrainSlopeRange(material: ShaderMaterial, min: number, max: number): boolean {
  const u = material.uniforms;
  if (u.uSlopeMin.value === min && u.uSlopeMax.value === max) return false;
  u.uSlopeMin.value = min;
  u.uSlopeMax.value = max;
  return true;
}

export function setTerrainExaggeration(material: ShaderMaterial, exaggeration: number): boolean {
  if (material.uniforms.uExaggeration.value === exaggeration) return false;
  material.uniforms.uExaggeration.value = exaggeration;
  return true;
}

export function setTerrainSunDirection(material: ShaderMaterial, dir: Vector3): boolean {
  const cur = material.uniforms.uSunDirection.value as Vector3;
  if (cur.equals(dir)) return false;
  cur.copy(dir).normalize();
  return true;
}

export function setTerrainIsolineSettings(material: ShaderMaterial, interval: number, thickness?: number): boolean {
  const u = material.uniforms;
  let changed = false;
  if (u.uIsolineInterval.value !== interval) {
    u.uIsolineInterval.value = interval;
    changed = true;
  }
  if (thickness !== undefined && u.uIsolineThickness.value !== thickness) {
    u.uIsolineThickness.value = thickness;
    changed = true;
  }
  return changed;
}

export function setTerrainIsolineColor(material: ShaderMaterial, r: number, g: number, b: number): boolean {
  const v = material.uniforms.uIsolineColor.value as Vector3;
  if (v.x === r && v.y === g && v.z === b) return false;
  v.set(r, g, b);
  return true;
}

export function setTerrainBaseWhite(material: ShaderMaterial, white: boolean): boolean {
  if (material.uniforms.uBaseWhite.value === white) return false;
  material.uniforms.uBaseWhite.value = white;
  return true;
}

export function setTerrainAtlas(material: ShaderMaterial, texture: Texture | null): void {
  material.uniforms.uElevAtlas.value = texture;
}

export function setTerrainDrape(material: ShaderMaterial, texture: Texture | null, opacity: number = 1.0): boolean {
  const u = material.uniforms;
  const has = texture ? 1 : 0;
  if (u.uDrapeAtlas.value === texture && u.uDrapeOpacity.value === opacity && u.uHasDrape.value === has) return false;
  u.uDrapeAtlas.value = texture;
  u.uDrapeOpacity.value = opacity;
  u.uHasDrape.value = has;
  return true;
}

export function setTerrainDrapeBlendMode(material: ShaderMaterial, mode: BlendMode): boolean {
  const v = BLEND_MODE_INDEX[mode] ?? 0;
  if (material.uniforms.uDrapeBlendMode.value === v) return false;
  material.uniforms.uDrapeBlendMode.value = v;
  return true;
}

export function setTerrainHillshadeStrength(material: ShaderMaterial, strength: number): boolean {
  const v = Math.max(0, Math.min(1, strength));
  if (material.uniforms.uHillshadeStrength.value === v) return false;
  material.uniforms.uHillshadeStrength.value = v;
  return true;
}

export function setTerrainDrapePlaceholder(material: ShaderMaterial, r: number, g: number, b: number): boolean {
  const v = material.uniforms.uDrapePlaceholder.value as Vector3;
  if (v.x === r && v.y === g && v.z === b) return false;
  v.set(r, g, b);
  return true;
}

/** Per-frame view uniforms (render origin, camera, LOD reference plane). */
export function setTerrainView(
  material: ShaderMaterial,
  originY: number,
  cameraLocalX: number,
  cameraLocalY: number,
  cameraZ: number,
  refZ: number,
): void {
  const u = material.uniforms;
  u.uOriginY.value = originY;
  (u.uCameraLocal.value as Vector3).set(cameraLocalX, cameraLocalY, cameraZ);
  u.uRefZ.value = refZ;
}
