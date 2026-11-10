// ============================================================================
// GLSL check of the library's own shaders, run in CI without a GPU.
//
// Each shader is assembled as three.js assembles it (a stand-in for three's
// prefix: version, precision, built-in uniforms and attributes, the
// WebGL2 aliases), preprocessed and parsed as GLSL ES 3.00 with warnings
// as errors, so syntax errors and undeclared identifiers or functions fail
// the build. Types are not checked: the browser compiles the shaders for
// real (see the demo checks).
// ============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { parser } from '@shaderfrog/glsl-parser';
import preprocess from '@shaderfrog/glsl-parser/preprocessor';
import { createTerrainMaterial, buildFragmentShader, setTerrainAtlas, setTerrainSkirtRelief } from '../../src/shaders/TerrainMaterial';
import { registerBuiltinAnalyses } from '../../src/analysis/builtins';
import { analysisShaderSource, registerAnalysis } from '../../src/analysis/registry';
import { createPointMaterial } from '../../src/overlays/materials';

const VERTEX_PREFIX = `#version 300 es
#define attribute in
#define varying out
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
in vec3 position;
in vec3 normal;
in vec2 uv;
`;

const FRAGMENT_PREFIX = `#version 300 es
#define varying in
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
vec4 sRGBTransferOETF(in vec4 value) {
  return vec4(mix(pow(value.rgb, vec3(0.41666)) * 1.055 - vec3(0.055), value.rgb * 12.92, vec3(lessThanEqual(value.rgb, vec3(0.0031308)))), value.a);
}
`;

/** Preprocess and parse; throws on syntax errors and on warnings (undeclared names). */
function check(source: string, stage: 'vertex' | 'fragment'): void {
  const pre = preprocess((stage === 'vertex' ? VERTEX_PREFIX : FRAGMENT_PREFIX) + source, {
    preserve: { version: () => true },
  });
  parser.parse(pre, { quiet: true, failOnWarn: true, stage });
}

beforeAll(() => registerBuiltinAnalyses());

describe('GLSL check', () => {
  it('terrain vertex shader', () => {
    const m = createTerrainMaterial({ metersToScene: 1, worldScale: 40075, slotSize: 256, gridSize: 64, analysisGlsl: analysisShaderSource() });
    expect(() => check(m.vertexShader, 'vertex')).not.toThrow();
  });

  it('terrain fragment shader with every built-in analysis', () => {
    expect(() => check(buildFragmentShader(analysisShaderSource()), 'fragment')).not.toThrow();
  });

  it('shadow depth pass and overlay points', () => {
    expect(() => check('void main() { gl_FragColor = vec4(1.0); }', 'fragment')).not.toThrow();
    const points = createPointMaterial(1, 1);
    expect(() => check(points.vertexShader, 'vertex')).not.toThrow();
    expect(() => check(points.fragmentShader, 'fragment')).not.toThrow();
  });

  it('catches syntax errors and undeclared names', () => {
    const fs = buildFragmentShader(analysisShaderSource());
    expect(() => check(fs.replace('float lit = 0.0;', 'float lit = 0.0'), 'fragment')).toThrow();
    expect(() => check(fs.replace('return mix(lit / 9.0, 1.0, fade);', 'return mixx(lit / 9.0, 1.0, fade);'), 'fragment')).toThrow();
    expect(() => check(fs.replace('float d = textureLod(uShadowMap,', 'float d = textureLod(uShadowMapp,'), 'fragment')).toThrow();
  });

  it('a registered analysis is checked with the rest', () => {
    registerAnalysis({
      id: 'glsl_check_probe',
      label: 'Probe',
      glsl: 'vec4 analysis_glsl_check_probe(Surface s, vec4 p0, vec4 p1) { return vec4(s.h * p0.x, s.fw, gShadowLit, 1.0); }',
      params: [],
      defaults: {},
      pack: () => ({ p0: [1, 0, 0, 0], p1: [0, 0, 0, 0] }),
    });
    expect(() => check(buildFragmentShader(analysisShaderSource()), 'fragment')).not.toThrow();
  });

  it('skirts reach the relief of the data in view; the surface reads the neighbours\' texels', () => {
    const m = createTerrainMaterial({ metersToScene: 1, worldScale: 40075, slotSize: 256, gridSize: 64, analysisGlsl: analysisShaderSource() });
    // Skirt depth: the tile-sized minimum, or the relief (meters → scene height like the surface itself)
    expect(m.vertexShader).toContain('z -= max(sized, uSkirtRelief * uElevationScale * k * uExaggeration);');
    expect(m.uniforms.uSkirtRelief.value).toBe(0);
    expect(setTerrainSkirtRelief(m, 800)).toBe(true);
    expect(setTerrainSkirtRelief(m, 800)).toBe(false);
    expect(m.uniforms.uSkirtRelief.value).toBe(800);
    // Taps past a slot border come from the halo texture, bound with the atlas
    const fs = buildFragmentShader(analysisShaderSource());
    expect(fs).toContain('uniform highp sampler2DArray uElevHalo;');
    expect(fs).toContain('texelFetch(uElevHalo, ivec3(p.y, HALO_LEFT, layer), 0).r');
    const atlas = {} as never;
    const halo = {} as never;
    setTerrainAtlas(m, atlas, halo);
    expect(m.uniforms.uElevAtlas.value).toBe(atlas);
    expect(m.uniforms.uElevHalo.value).toBe(halo);
  });
});
