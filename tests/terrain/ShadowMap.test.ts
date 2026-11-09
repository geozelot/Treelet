// ============================================================================
// Tests for src/terrain/ShadowMap.ts (fitting; the depth pass itself needs
// WebGL and is checked in the browser) and the shadow-related shader parts.
// ============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { frustumSphere, fitLight, shadowReach } from '../../src/terrain/ShadowMap';
import { buildFragmentShader, createTerrainMaterial, setTerrainShadows } from '../../src/shaders/TerrainMaterial';
import { registerBuiltinAnalyses, hillshadeLight } from '../../src/analysis/builtins';
import { getAnalysis, analysisShaderSource } from '../../src/analysis/registry';

beforeAll(() => registerBuiltinAnalyses());

function camera(pitchDeg: number) {
  // Looking north and down at `pitchDeg` below the horizon from 1000 units up
  const cam = new PerspectiveCamera(60, 4 / 3, 1, 1e6);
  cam.up.set(0, 0, 1);
  cam.position.set(0, 0, 1000);
  const p = (pitchDeg * Math.PI) / 180;
  cam.lookAt(0, Math.cos(p) * 1000, 1000 - Math.sin(p) * 1000);
  cam.updateMatrixWorld();
  return cam;
}

describe('shadow fitting', () => {
  it('the frustum sphere holds every corner of the view slice', () => {
    const cam = camera(45);
    const { center, radius } = frustumSphere(cam, 1, 3000);
    const tan = Math.tan((30 * Math.PI) / 180);
    for (const d of [1, 3000]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const c = new Vector3(sx * d * tan * (4 / 3), sy * d * tan, -d).applyMatrix4(cam.matrixWorld);
      expect(c.distanceTo(center)).toBeLessThanOrEqual(radius + 1e-6);
    }
  });

  it('reach stops where the view meets the ground, or at the cap above the horizon', () => {
    const down = shadowReach(camera(90), 0, 1e5);
    // Straight down from 1000: the corners meet the ground at 1000 / cos(diagonal half-angle)
    expect(down.depth).toBeCloseTo(1000 * 1.02, 0);
    expect(down.distance).toBeGreaterThan(1000 * 1.02);
    expect(down.distance).toBeLessThan(1600 * 1.02);
    // Looking at the horizon: the upper corners never meet the ground
    expect(shadowReach(camera(10), 0, 5000).distance).toBeCloseTo(5000 * 1.02, 6);
  });

  it('the light looks from the sun at the region, and its box reaches taller casters', () => {
    const sun = new Vector3(0.3, -0.8, 0.5).normalize();
    const fit = fitLight(new Vector3(100, 200, 0), 500, sun, 300, 2048);
    const dir = fit.target.clone().sub(fit.position).normalize();
    expect(dir.dot(sun)).toBeCloseTo(-1, 9);
    expect(fit.halfSize).toBeGreaterThanOrEqual(500);
    expect(fit.halfSize).toBeLessThan(550);
    expect(fit.far).toBeCloseTo(fit.position.distanceTo(fit.target) + fit.halfSize, 6);
    expect(fit.position.distanceTo(fit.target)).toBeCloseTo(fit.halfSize + 300 / sun.z, 6);
    expect(fit.texel).toBeCloseTo((2 * fit.halfSize) / 2048, 12);
  });

  it('snapping keeps the same fit for moves smaller than a texel', () => {
    const sun = new Vector3(-0.5, 0.5, 0.7).normalize();
    // From a point on the texel grid, moves under half a texel snap back to it
    const a = fitLight(new Vector3(1234.567, 5678.9, 12), 800, sun, 100, 2048);
    const on = a.target.clone();
    const b = fitLight(on.clone().add(new Vector3(a.texel * 0.2, -a.texel * 0.1, a.texel * 0.05)), 801, sun, 100, 2048);
    expect(b.halfSize).toBe(a.halfSize);
    expect(b.target.distanceTo(a.target)).toBeLessThan(1e-6);
    const far = fitLight(on.clone().add(new Vector3(a.texel * 3, 0, 0)), 800, sun, 100, 2048);
    expect(far.target.distanceTo(a.target)).toBeGreaterThan(a.texel);
  });
});

describe('shadow shading', () => {
  it('the fragment shader samples the shadow map before the coats; the shadows kind reads it', () => {
    const fs = buildFragmentShader(analysisShaderSource());
    expect(fs.indexOf('float terrainShadow(Surface s)')).toBeGreaterThan(-1);
    expect(fs.indexOf('float terrainShadow')).toBeLessThan(fs.indexOf('vec4 analysis_shadows'));
    expect(fs).toContain('if (uShadowOn != 0) gShadowLit = terrainShadow(s);');
    const d = getAnalysis('shadows')!;
    expect(d.shadowMap).toBe(true);
    expect(d.blendMode).toBe('multiply');
    expect(d.pack({ darkness: 0.7 }, [0, 1]).p0[0]).toBe(0.7);
  });

  it('setTerrainShadows turns the map on and off', () => {
    const m = createTerrainMaterial({ metersToScene: 1, worldScale: 40075, slotSize: 256, gridSize: 64, analysisGlsl: analysisShaderSource() });
    expect(m.uniforms.uShadowOn.value).toBe(0);
    const texture = {} as never;
    const matrix = new (m.uniforms.uShadowMatrix.value.constructor)().makeScale(2, 2, 2);
    setTerrainShadows(m, { texture, matrix, params: [1, 2, 3, 4] });
    expect(m.uniforms.uShadowOn.value).toBe(1);
    expect(m.uniforms.uShadowMap.value).toBe(texture);
    expect(m.uniforms.uShadowMatrix.value.elements[0]).toBe(2);
    expect(m.uniforms.uShadowParams.value.toArray()).toEqual([1, 2, 3, 4]);
    setTerrainShadows(m, null);
    expect(m.uniforms.uShadowOn.value).toBe(0);
    expect(m.vertexShader).toContain('vShadowCoord = uShadowMatrix * vec4(world, z, 1.0);');
  });
});

describe('multidirectional hillshade', () => {
  const flat = { h: 0, n: [0, 0, 1] as [number, number, number] };
  const tilt = (aspectDeg: number, slopeDeg: number) => {
    const a = (aspectDeg * Math.PI) / 180;
    const s = (slopeDeg * Math.PI) / 180;
    return { h: 0, n: [Math.sin(a) * Math.sin(s), Math.cos(a) * Math.sin(s), Math.cos(s)] as [number, number, number] };
  };

  it('flat ground gets sin(altitude) in both modes', () => {
    expect(hillshadeLight(flat, 315, 45, 'single')).toBeCloseTo(Math.SQRT1_2, 9);
    expect(hillshadeLight(flat, 315, 45, 'multi')).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it('multi evens the light out: slopes facing away keep some, slopes facing the sun get less', () => {
    // Sun in the north-west at 30°; 40° slopes facing every way
    const aspects = [0, 45, 90, 135, 180, 225, 270, 315];
    const single = aspects.map((a) => hillshadeLight(tilt(a, 40), 315, 30, 'single'));
    const multi = aspects.map((a) => hillshadeLight(tilt(a, 40), 315, 30, 'multi'));
    // Facing away (south-east, 135°): dark with one sun, modelled with four
    expect(single[3]).toBe(0);
    expect(multi[3]).toBeGreaterThan(0.1);
    // Facing the sun (north-west, 315°): less than the single sun gives
    expect(multi[7]).toBeLessThan(single[7]);
    // Smaller spread over all aspects
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
    expect(spread(multi)).toBeLessThan(spread(single) * 0.8);
  });

  it('the descriptor packs the mode', () => {
    const d = getAnalysis('hillshade')!;
    expect(d.pack({ ambient: 0.4, mode: 'multi' }, [0, 1]).p0).toEqual([0.4, 1, 0, 0]);
    expect(d.pack({ ambient: 0.4, mode: 'single' }, [0, 1]).p0).toEqual([0.4, 0, 0, 0]);
  });
});
