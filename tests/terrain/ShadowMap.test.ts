// ============================================================================
// Tests for src/terrain/ShadowMap.ts (fitting; the depth pass itself needs
// WebGL and is checked in the browser) and the shadow-related shader parts.
// ============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { BufferGeometry, Mesh, PerspectiveCamera, Vector3 } from 'three';
import { frustumSphere, fitLight, shadowReach, ShadowMap, SHADOW_DETAIL_INTERVAL_MS } from '../../src/terrain/ShadowMap';
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

  it('multi models a ridge pointing at the sun, whose flanks one sun lights alike', () => {
    // Sun in the north-west at 45°; a ridge running north-west to south-east
    // with 30° flanks facing north-east (45°) and south-west (225°)
    const ne = tilt(45, 30);
    const sw = tilt(225, 30);
    expect(hillshadeLight(ne, 315, 45, 'single')).toBeCloseTo(hillshadeLight(sw, 315, 45, 'single'), 9);
    // The 225° light, in line with both flanks, counts most: it lights the
    // south-west flank and leaves the north-east one in shade
    const multiNe = hillshadeLight(ne, 315, 45, 'multi');
    const multiSw = hillshadeLight(sw, 315, 45, 'multi');
    expect(multiSw - multiNe).toBeGreaterThan(0.2);
    expect(multiNe).toBeCloseTo(0.4436, 3);
    expect(multiSw).toBeCloseTo(0.7811, 3);
  });

  it('multi weights each light by cos² of its angle to the slope\'s aspect', () => {
    // Sun in the north-west at 30°; 40° slopes
    const light = (aspect: number, mode: 'single' | 'multi') => hillshadeLight(tilt(aspect, 40), 315, 30, mode);
    // Facing the sun (315°) or away from it (135°): the sun's own light counts
    // most, so the slope keeps its contrast, with a little less glare
    expect(light(315, 'multi')).toBeLessThan(light(315, 'single'));
    expect(light(315, 'multi')).toBeGreaterThan(0.8);
    expect(light(135, 'single')).toBe(0);
    expect(light(135, 'multi')).toBeLessThan(0.05);
    // Facing the 270° light: lit mostly by it, more than by the sun alone
    expect(light(270, 'multi')).toBeGreaterThan(light(270, 'single') + 0.05);
    // The weighted mean of the four lights, by hand (lights at −90°, −45°, 0°, +45°)
    const n = tilt(100, 40).n;
    const alt = Math.PI / 6;
    let sum = 0;
    let wsum = 0;
    for (const az of [225, 270, 315, 360]) {
      const a = (az * Math.PI) / 180;
      const l = Math.max(0, n[0] * Math.sin(a) * Math.cos(alt) + n[1] * Math.cos(a) * Math.cos(alt) + n[2] * Math.sin(alt));
      const w = Math.cos(((100 - az) * Math.PI) / 180) ** 2 + 0.05;
      sum += w * l;
      wsum += w;
    }
    expect(light(100, 'multi')).toBeCloseTo(sum / wsum, 9);
  });

  it('the descriptor packs the mode', () => {
    const d = getAnalysis('hillshade')!;
    expect(d.pack({ ambient: 0.4, mode: 'multi' }, [0, 1]).p0).toEqual([0.4, 1, 0, 0]);
    expect(d.pack({ ambient: 0.4, mode: 'single' }, [0, 1]).p0).toEqual([0.4, 0, 0, 0]);
  });
});

describe('shadow map reuse', () => {
  function setup() {
    const material = createTerrainMaterial({ metersToScene: 1, worldScale: 40075, slotSize: 256, gridSize: 64, analysisGlsl: analysisShaderSource() });
    const map = new ShadowMap(new BufferGeometry(), material, 512);
    let draws = 0;
    const renderer = {
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      clear: () => {},
      render: () => { draws++; },
    } as never;
    const terrain = new Mesh();
    terrain.updateMatrixWorld();
    const view = (cam: PerspectiveCamera, over: Record<string, unknown> = {}) => ({
      camera: cam, terrain, range: 3000, fadeDistance: 4000, heightSpan: 200,
      sun: new Vector3(0.3, -0.6, 0.7).normalize(), version: '1', detail: 'a', ...over,
    });
    return { map, renderer, view, draws: () => draws };
  }

  it('keeps the map while the view stays in the light box; redraws when it leaves, the sun moves or detail settles', () => {
    const { map, renderer, view, draws } = setup();
    const cam = camera(45);
    expect(map.update(renderer, view(cam), 0)).toBe(true);
    expect(draws()).toBe(1);
    // A small pan: inside the margin
    cam.position.x += 20;
    cam.updateMatrixWorld();
    expect(map.update(renderer, view(cam), 10)).toBe(false);
    expect(draws()).toBe(1);
    // Only the fade moved: uniforms change, no redraw
    expect(map.update(renderer, view(cam, { fadeDistance: 5000 }), 20)).toBe(true);
    expect(draws()).toBe(1);
    // Terrain detail changed: waits, then draws
    expect(map.update(renderer, view(cam, { fadeDistance: 5000, detail: 'b' }), 30)).toBe(false);
    expect(map.pending).toBe(true);
    map.update(renderer, view(cam, { fadeDistance: 5000, detail: 'b' }), 30 + SHADOW_DETAIL_INTERVAL_MS);
    expect(draws()).toBe(2);
    expect(map.pending).toBe(false);
    // A long pan leaves the box
    cam.position.x += 5000;
    cam.updateMatrixWorld();
    map.update(renderer, view(cam, { fadeDistance: 5000, detail: 'b' }), 400);
    expect(draws()).toBe(3);
    // The sun moved
    map.update(renderer, view(cam, { fadeDistance: 5000, detail: 'b', sun: new Vector3(0, -0.5, 0.8).normalize() }), 410);
    expect(draws()).toBe(4);
    map.dispose();
  });
});
