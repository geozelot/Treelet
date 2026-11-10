// ============================================================================
// treelet.js - Instanced Terrain Material
//
// ShaderMaterial for the instanced terrain renderer. Assembles modular GLSL
// includes plus the registered analyses into vertex/fragment shaders. One
// shared grid mesh is instanced across all visible tiles via per-instance
// attributes. The ground's color is a stack of coats (imagery, analyses)
// described by uniform arrays, see includes/coats.glsl.
// ============================================================================

import {
  ShaderMaterial,
  FrontSide,
  Matrix4,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
  type Texture,
} from 'three';
import type { CoatBlendMode, Vec4 } from '../analysis/types';
import { MAX_COATS, IMAGERY_KIND, BLEND_MODES } from '../analysis/registry';
import { RASTER_NODATA_THRESHOLD } from '../analysis/grid';
import { SHADOW_NIGHT_SUN_Z } from '../terrain/ShadowMap';

// ==== Import modular GLSL ====
import declarations from './glsl/includes/declarations.glsl?raw';
import elevationSampling from './glsl/includes/elevation_sampling.glsl?raw';
import surface from './glsl/includes/surface.glsl?raw';
import coats from './glsl/includes/coats.glsl?raw';
import rasters from './glsl/includes/rasters.glsl?raw';
import shadows from './glsl/includes/shadows.glsl?raw';
import vertexMain from './glsl/terrain.vert.glsl?raw';
import fragmentMain from './glsl/terrain.frag.glsl?raw';

// ==== Assemble shaders from modular GLSL ====
// Fragment includes reference uniforms/varyings directly, so declarations
// must come first to satisfy GLSL declaration-before-use. The analyses
// (from the registry) need Surface and precede the coat loop that calls them.

const vertexShader = [
  elevationSampling,
  vertexMain,
].join('\n');

/** A GLSL float literal. */
function glslFloat(v: number): string {
  const s = String(v);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

/** Shader constants generated from their TypeScript sources, so the two can't drift apart. */
export function shaderConstants(): string {
  return [
    `#define MAX_COATS ${MAX_COATS}`,
    `#define MAX_RASTERS ${MAX_RASTERS}`,
    `#define IMAGERY_KIND ${IMAGERY_KIND}`,
    ...BLEND_MODES.map((mode, i) => `#define BLEND_${mode.toUpperCase()} ${i}`),
    `#define RASTER_NODATA_THRESHOLD ${glslFloat(RASTER_NODATA_THRESHOLD)}`,
    `#define SHADOW_NIGHT_SUN_Z ${glslFloat(SHADOW_NIGHT_SUN_Z)}`,
  ].join('\n');
}

const slots = (): number[] => Array.from({ length: MAX_RASTERS }, (_, i) => i);

/** One sampler uniform per raster slot. */
function rasterSamplers(): string {
  return slots().map((i) => `uniform highp sampler2D uRaster${i};`).join('\n');
}

/** rasterTexel / rasterColor with one branch per raster slot. */
function rasterAccessors(): string {
  const last = MAX_RASTERS - 1;
  const branches = (call: (i: number) => string) => [
    ...slots().slice(0, last).map((i) => `  if (slot == ${i}) return ${call(i)};`),
    `  return ${call(last)};`,
  ].join('\n');
  return [
    'float rasterTexel(int slot, ivec2 p) {',
    branches((i) => `texelFetch(uRaster${i}, p, 0).r`),
    '}',
    'vec4 rasterColor(int slot, vec2 uv) {',
    branches((i) => `textureLod(uRaster${i}, uv, 0.0)`),
    '}',
  ].join('\n');
}

export function buildFragmentShader(analysisGlsl: string): string {
  return [
    shaderConstants(),
    declarations.replace('// @RASTER_SAMPLERS', rasterSamplers()),
    elevationSampling,
    surface,
    rasters.replace('// @RASTER_ACCESSORS', rasterAccessors()),
    shadows,
    analysisGlsl,
    coats,
    fragmentMain,
  ].join('\n');
}

/** Blend code of a coat blend mode in the shader (BLEND_* above); unknown modes draw normally. */
function blendIndex(mode: CoatBlendMode): number {
  return Math.max(0, BLEND_MODES.indexOf(mode));
}

/** One coat as the shader receives it. */
export interface PackedCoat {
  kind: number;
  blendMode: CoatBlendMode;
  opacity: number;
  /** Ramp texture row, or -1 for kinds that produce a color. */
  rampRow: number;
  /** Raster slot the coat draws (coatRaster() in GLSL), or -1. */
  raster: number;
  p0: Vec4;
  p1: Vec4;
}

/** Rasters the shader can sample at once (MAX_RASTERS in declarations.glsl). */
export const MAX_RASTERS = 4;

/** One bound raster as the shader receives it. */
export interface RasterUniform {
  texture: Texture;
  /** NW corner relative to the render origin, world units. */
  offsetX: number;
  offsetY: number;
  /** Texels per world unit. */
  scaleX: number;
  scaleY: number;
  width: number;
  height: number;
  color: boolean;
}

/** Default sun: from the north-west (cartographic convention), 45° altitude. */
const DEFAULT_SUN = new Vector3(-0.5, 0.5, 0.7071).normalize();

// ==== Public API ====

export interface TerrainMaterialOptions {
  metersToScene: number;
  worldScale: number;
  slotSize: number;
  gridSize: number;
  /** GLSL of the registered analyses (analysisShaderSource()). */
  analysisGlsl: string;
}

/**
 * Create the instanced terrain ShaderMaterial.
 */
export function createTerrainMaterial(options: TerrainMaterialOptions): ShaderMaterial {
  const uniforms: Record<string, IUniform> = {
    // Elevation atlas + geometry
    uElevAtlas: { value: null },
    uElevHalo: { value: null },
    uSlotSize: { value: options.slotSize },
    uGridSize: { value: options.gridSize },
    uElevationScale: { value: options.metersToScene },
    uExaggeration: { value: 1.0 },
    uWorldScale: { value: options.worldScale },
    uOriginY: { value: 0.0 },
    uCameraLocal: { value: new Vector3() },
    uRefZ: { value: 0.0 },
    uSkirtRelief: { value: 0.0 },
    // Lighting / wireframe
    uSunDirection: { value: DEFAULT_SUN.clone() },
    uBaseWhite: { value: false },
    // Coat stack
    uCoatCount: { value: 0 },
    uCoatKind: { value: new Array<number>(MAX_COATS).fill(0) },
    uCoatBlend: { value: new Array<number>(MAX_COATS).fill(0) },
    uCoatOpacity: { value: new Array<number>(MAX_COATS).fill(1) },
    uCoatRamp: { value: new Array<number>(MAX_COATS).fill(-1) },
    uCoatP0: { value: Array.from({ length: MAX_COATS }, () => new Vector4()) },
    uCoatP1: { value: Array.from({ length: MAX_COATS }, () => new Vector4()) },
    uCoatRaster: { value: new Array<number>(MAX_COATS).fill(-1) },
    // Rasters
    ...Object.fromEntries(slots().map((i) => [`uRaster${i}`, { value: null }])),
    uRasterXform: { value: Array.from({ length: MAX_RASTERS }, () => new Vector4()) },
    uRasterInfo: { value: Array.from({ length: MAX_RASTERS }, () => new Vector4(1, 1, 0, 0)) },
    // Terrain-cast shadows
    uShadowMap: { value: null },
    uShadowMatrix: { value: new Matrix4() },
    uShadowOn: { value: 0 },
    uShadowParams: { value: new Vector4(0, 0, 1e20, 2e20) },
    uRampTex: { value: null },
    uRampSize: { value: new Vector2(1, 1) },
    // Drape
    uDrapeAtlas: { value: null },
    uHasDrape: { value: 0 },
    uDrapePlaceholder: { value: new Vector3(1.0, 1.0, 1.0) },
    // Distance haze toward the horizon (sRGB color; camera distances)
    uFogColor: { value: new Vector3(1.0, 1.0, 1.0) },
    uFogRange: { value: new Vector2(1e20, 2e20) },
  };

  return new ShaderMaterial({
    vertexShader,
    fragmentShader: buildFragmentShader(options.analysisGlsl),
    uniforms,
    side: FrontSide,
  });
}

/** Recompile with a new set of analyses (after a registration). */
export function setTerrainAnalysisSource(material: ShaderMaterial, analysisGlsl: string): void {
  material.fragmentShader = buildFragmentShader(analysisGlsl);
  material.needsUpdate = true;
}

// ==== Setter functions ====
// Each returns true when a value actually changed, so callers can request a
// render only when needed.

/** Upload the coat stack (bottom first; at most MAX_COATS). */
export function setTerrainCoats(material: ShaderMaterial, stack: readonly PackedCoat[]): boolean {
  const u = material.uniforms;
  const n = Math.min(stack.length, MAX_COATS);
  let changed = false;
  if (u.uCoatCount.value !== n) { u.uCoatCount.value = n; changed = true; }
  const kind = u.uCoatKind.value as number[];
  const blend = u.uCoatBlend.value as number[];
  const opacity = u.uCoatOpacity.value as number[];
  const ramp = u.uCoatRamp.value as number[];
  const p0 = u.uCoatP0.value as Vector4[];
  const p1 = u.uCoatP1.value as Vector4[];
  const raster = u.uCoatRaster.value as number[];
  for (let i = 0; i < n; i++) {
    const c = stack[i];
    if (raster[i] !== c.raster) { raster[i] = c.raster; changed = true; }
    const b = blendIndex(c.blendMode);
    const o = Math.max(0, Math.min(1, c.opacity));
    if (kind[i] !== c.kind) { kind[i] = c.kind; changed = true; }
    if (blend[i] !== b) { blend[i] = b; changed = true; }
    if (opacity[i] !== o) { opacity[i] = o; changed = true; }
    if (ramp[i] !== c.rampRow) { ramp[i] = c.rampRow; changed = true; }
    if (!vec4Equals(p0[i], c.p0)) { p0[i].fromArray(c.p0); changed = true; }
    if (!vec4Equals(p1[i], c.p1)) { p1[i].fromArray(c.p1); changed = true; }
  }
  return changed;
}

/**
 * Bind rasters to their slots (null = empty slot). Offsets are relative to
 * the render origin, so call again whenever the origin moves.
 */
export function setTerrainRasters(material: ShaderMaterial, slots: ReadonlyArray<RasterUniform | null>): boolean {
  const u = material.uniforms;
  const xform = u.uRasterXform.value as Vector4[];
  const info = u.uRasterInfo.value as Vector4[];
  let changed = false;
  for (let i = 0; i < MAX_RASTERS; i++) {
    const r = slots[i] ?? null;
    const sampler = u[`uRaster${i}`];
    const tex = r ? r.texture : null;
    if (sampler.value !== tex) { sampler.value = tex; changed = true; }
    if (!r) continue;
    if (xform[i].x !== r.offsetX || xform[i].y !== r.offsetY || xform[i].z !== r.scaleX || xform[i].w !== r.scaleY) {
      xform[i].set(r.offsetX, r.offsetY, r.scaleX, r.scaleY);
      changed = true;
    }
    const c = r.color ? 1 : 0;
    if (info[i].x !== r.width || info[i].y !== r.height || info[i].z !== c) {
      info[i].set(r.width, r.height, c, 0);
      changed = true;
    }
  }
  return changed;
}

/**
 * Shadow map for the shadows coat: its depth texture, the terrain-local →
 * shadow-map matrix and [texel uv, depth per texel, fade start, fade end];
 * null turns shadows off.
 */
export function setTerrainShadows(
  material: ShaderMaterial,
  shadow: { texture: Texture; matrix: Matrix4; params: readonly number[] } | null,
): void {
  const u = material.uniforms;
  if (!shadow) {
    u.uShadowOn.value = 0;
    u.uShadowMap.value = null;
    return;
  }
  u.uShadowOn.value = 1;
  u.uShadowMap.value = shadow.texture;
  (u.uShadowMatrix.value as Matrix4).copy(shadow.matrix);
  (u.uShadowParams.value as Vector4).fromArray(shadow.params as number[]);
}

function vec4Equals(v: Vector4, a: Vec4): boolean {
  return v.x === a[0] && v.y === a[1] && v.z === a[2] && v.w === a[3];
}

export function setTerrainRampTexture(material: ShaderMaterial, texture: Texture | null, width: number, height: number): void {
  material.uniforms.uRampTex.value = texture;
  (material.uniforms.uRampSize.value as Vector2).set(width, height);
}

export function setTerrainWireframe(material: ShaderMaterial, enabled: boolean): boolean {
  if (material.wireframe === enabled) return false;
  material.wireframe = enabled;
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

export function setTerrainBaseWhite(material: ShaderMaterial, white: boolean): boolean {
  if (material.uniforms.uBaseWhite.value === white) return false;
  material.uniforms.uBaseWhite.value = white;
  return true;
}

/** The elevation atlas and its halo (the neighbours' texels past each slot border). */
export function setTerrainAtlas(material: ShaderMaterial, texture: Texture | null, halo: Texture | null): void {
  material.uniforms.uElevAtlas.value = texture;
  material.uniforms.uElevHalo.value = halo;
}

/**
 * Elevation range in meters that the skirts must cover: the range of the
 * data in view while some tile is drawn from stand-in data, 0 when every
 * tile has exact data (skirts then only follow the tile size).
 */
export function setTerrainSkirtRelief(material: ShaderMaterial, meters: number): boolean {
  if (material.uniforms.uSkirtRelief.value === meters) return false;
  material.uniforms.uSkirtRelief.value = meters;
  return true;
}

export function setTerrainDrape(material: ShaderMaterial, texture: Texture | null): boolean {
  const u = material.uniforms;
  const has = texture ? 1 : 0;
  if (u.uDrapeAtlas.value === texture && u.uHasDrape.value === has) return false;
  u.uDrapeAtlas.value = texture;
  u.uHasDrape.value = has;
  return true;
}

export function setTerrainDrapePlaceholder(material: ShaderMaterial, r: number, g: number, b: number): boolean {
  const v = material.uniforms.uDrapePlaceholder.value as Vector3;
  if (v.x === r && v.y === g && v.z === b) return false;
  v.set(r, g, b);
  return true;
}

/**
 * Haze toward the horizon: terrain blends into `color` (sRGB) between camera
 * distances `start` and `end`, and is fully hidden beyond `end`.
 */
export function setTerrainFog(material: ShaderMaterial, color: readonly number[], start: number, end: number): boolean {
  const u = material.uniforms;
  const c = u.uFogColor.value as Vector3;
  const r = u.uFogRange.value as Vector2;
  if (c.x === color[0] && c.y === color[1] && c.z === color[2] && r.x === start && r.y === end) return false;
  c.set(color[0], color[1], color[2]);
  r.set(start, end);
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
