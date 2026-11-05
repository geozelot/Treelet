// ============================================================================
// Tests for src/scene/CameraTerrain.ts: the orbit target stays on the terrain,
// the camera keeps its height and only rises where it would touch it.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { CameraController } from '../../src/scene/CameraController';
import { CameraTerrain, marchToTerrain, type GroundSampler } from '../../src/scene/CameraTerrain';

const W = 40075.016686;
const RANGE = 100;
const DT = 1 / 60;
// Settling stops within 0.1% of the zoom's distance (a few meters here).

function make(opts: { polar?: number; maxPitch?: number } = {}) {
  const camera = new PerspectiveCamera(70, 4 / 3, 0.01, 1e6);
  camera.up.set(0, 0, 1);
  const cc = new CameraController(camera, document.createElement('div'), W, 0, 20, 25, opts.maxPitch ?? 90, 600);
  cc.setView(0, 0, 14); // ≈ 4 km from the target
  cc.setPitch(opts.polar ?? 50);
  const terrain = new CameraTerrain(cc, 0.002);
  return { cc, camera, cam: camera.position, target: cc.controls.target, terrain };
}

const flat = (z: number): GroundSampler => () => z;
const hill = (x0: number, y0: number, h: number, s: number): GroundSampler =>
  (x, y) => h * Math.exp(-((x - x0) ** 2 + (y - y0) ** 2) / (s * s));

/** Pan as OrbitControls does: camera and target move together. */
function pan(cc: CameraController, dx: number, dy: number): void {
  cc.controls.target.x += dx;
  cc.controls.target.y += dy;
  cc.camera.position.x += dx;
  cc.camera.position.y += dy;
  cc.update();
}

function viewDir(camera: PerspectiveCamera): Vector3 {
  return camera.getWorldDirection(new Vector3());
}

/** Polar angle of the camera around the target (0 = top-down). */
function polar(cam: Vector3, target: Vector3): number {
  return Math.acos((cam.z - target.z) / cam.distanceTo(target));
}

/** The near plane's corners are above the terrain. */
function nearPlaneClear(camera: PerspectiveCamera, ground: GroundSampler, near: number): boolean {
  camera.near = near;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1]]) {
    const p = new Vector3(x, y, -1).unproject(camera);
    if (p.z <= ground(p.x, p.y)!) return false;
  }
  return true;
}

describe('CameraTerrain', () => {
  it('rides the orbit onto the terrain once its height is known', () => {
    const { cam, target, terrain } = make();
    const d0 = cam.distanceTo(target);
    const z0 = cam.z;
    expect(terrain.update(() => null, false, RANGE, DT)).toBe(false);
    expect(terrain.update(flat(1), false, RANGE, DT)).toBe(true);
    expect(target.z).toBeCloseTo(1, 9);
    expect(cam.z).toBeCloseTo(z0 + 1, 9);
    expect(cam.distanceTo(target)).toBeCloseTo(d0, 9);
  });

  it('idles without adjustments', () => {
    const { cc, cam, target, terrain } = make();
    const ground = hill(0, 2, 1, 1);
    terrain.update(ground, false, RANGE, DT);
    const c = cam.clone(), t = target.clone();
    for (let i = 0; i < 5; i++) {
      cc.update();
      expect(terrain.update(ground, false, RANGE, DT)).toBe(false);
    }
    expect(cam.distanceTo(c)).toBeLessThan(1e-9);
    expect(target.distanceTo(t)).toBeLessThan(1e-9);
  });

  it('pans keep the camera height and view direction; the target is the terrain at the screen center', () => {
    const { cc, camera, cam, target, terrain } = make();
    const ground = hill(0, 3, 1, 1); // well below the camera
    terrain.update(ground, false, RANGE, DT);
    const z0 = cam.z;
    const dir0 = viewDir(camera);
    let minDist = Infinity;
    for (let i = 0; i < 60; i++) {
      pan(cc, 0, 0.05);
      terrain.update(ground, false, RANGE, DT);
      expect(cam.z).toBeCloseTo(z0, 9);
      expect(viewDir(camera).angleTo(dir0)).toBeLessThan(1e-6);
      expect(target.z).toBeCloseTo(ground(target.x, target.y)!, 6);
      // the target lies on the line of sight
      expect(target.clone().sub(cam).normalize().angleTo(dir0)).toBeLessThan(1e-6);
      minDist = Math.min(minDist, cam.distanceTo(target));
    }
    // Over the hill the terrain is closer: the zoom follows it.
    expect(minDist).toBeLessThan(3.6);
  });

  it('remembers the zoom: zooming changes it, terrain at the screen center does not', () => {
    const { cc, cam, target, terrain } = make();
    const ground = hill(0, 3, 1, 1);
    terrain.update(ground, false, RANGE, DT);
    const zoomDist = terrain.zoomDistance;
    expect(zoomDist).toBeCloseTo(cam.distanceTo(target), 9);
    for (let i = 0; i < 60; i++) {
      pan(cc, 0, 0.05);
      terrain.update(ground, false, RANGE, DT);
    }
    expect(cam.distanceTo(target)).not.toBeCloseTo(zoomDist, 2); // the screen center moved over the hill
    expect(terrain.zoomDistance).toBeCloseTo(zoomDist, 9);
    cc.setZoomLevel(cc.deriveZoom() + 1);
    terrain.update(ground, false, RANGE, DT);
    expect(terrain.zoomDistance).toBeCloseTo(zoomDist / 2, 6);
  });

  it('glides up over a slope ahead, keeping the pitch, and settles back to the zoom past it', () => {
    const { cc, camera, cam, target, terrain } = make();
    const ground = hill(0, 2, 4, 0.8); // taller than the camera's height
    terrain.update(ground, false, RANGE, DT);
    const z0 = cam.z;
    const zoomDist = cam.distanceTo(target);
    const polar0 = polar(cam, target);
    let lastZ = z0;
    let rose = 0;
    for (let i = 0; i < 400; i++) {
      pan(cc, 0, 0.02);
      terrain.update(ground, false, RANGE, DT);
      const d = cam.distanceTo(target);
      expect(cam.z - ground(cam.x, cam.y)!).toBeGreaterThanOrEqual(terrain.clearance * (1 - 1e-9));
      expect(polar(cam, target)).toBeCloseTo(polar0, 6);
      expect(nearPlaneClear(camera, ground, terrain.clearance * 0.5)).toBe(true);
      // The slope never comes much closer than half the zoom's distance.
      expect(d).toBeGreaterThan(zoomDist * 0.3);
      if (target.y < 2) {
        // Approaching: height is kept while the terrain ahead stays at least
        // half the zoom's distance away, and the camera only rises.
        expect(cam.z).toBeGreaterThanOrEqual(lastZ - 1e-9);
        if (d >= zoomDist * 0.5) expect(cam.z).toBeCloseTo(lastZ, 9);
        else rose++;
      }
      lastZ = cam.z;
    }
    expect(rose).toBeGreaterThan(10);
    // Past the hill, over level ground again: back at the zoom (and height) it had.
    for (let i = 0; i < 200; i++) terrain.update(ground, false, RANGE, DT);
    expect(Math.abs(cam.z - z0)).toBeLessThan(zoomDist * 1.5e-3);
    expect(cam.distanceTo(target) / zoomDist).toBeCloseTo(1, 2);
    expect(terrain.update(ground, false, RANGE, DT)).toBe(false);
  });

  it('beyond a range, it settles to the remembered zoom over higher ground', () => {
    const { cc, cam, target, terrain } = make();
    const plateau = (y: number) => 1 / (1 + Math.exp(-(y - 4) * 3));
    const ground: GroundSampler = (x, y) => hill(0, 2, 4, 0.8)(x, y)! + plateau(y);
    terrain.update(ground, false, RANGE, DT);
    const z0 = cam.z;
    const zoomDist = cam.distanceTo(target);
    for (let i = 0; i < 450; i++) {
      pan(cc, 0, 0.02);
      terrain.update(ground, false, RANGE, DT);
    }
    for (let i = 0; i < 200; i++) terrain.update(ground, false, RANGE, DT);
    expect(cam.distanceTo(target) / zoomDist).toBeCloseTo(1, 2);
    expect(Math.abs(cam.z - (z0 + 1))).toBeLessThan(0.02);
  });

  it('but never settles below its own height (it does not dive into valleys)', () => {
    const { cc, cam, target, terrain } = make();
    const valley = (y: number) => -1 / (1 + Math.exp(-(y - 4) * 3));
    const ground: GroundSampler = (x, y) => hill(0, 2, 4, 0.8)(x, y)! + valley(y);
    terrain.update(ground, false, RANGE, DT);
    const z0 = cam.z;
    const zoomDist = cam.distanceTo(target);
    for (let i = 0; i < 450; i++) {
      pan(cc, 0, 0.02);
      terrain.update(ground, false, RANGE, DT);
    }
    for (let i = 0; i < 200; i++) terrain.update(ground, false, RANGE, DT);
    expect(Math.abs(cam.z - z0)).toBeLessThan(zoomDist * 1.5e-3);
    expect(cam.distanceTo(target)).toBeGreaterThan(zoomDist * 1.2);
  });

  it('the clearance sphere lifts the camera at once where terrain beside it rises', () => {
    const { cc, camera, cam, target, terrain } = make();
    // Looking north over flat ground; a tall hill east of the camera's path.
    const ground: GroundSampler = (x, y) => (y > -1 ? 0 : hill(1.5, cam.y, 4, 0.5)(x, y));
    terrain.update(ground, false, RANGE, DT);
    const z0 = cam.z;
    for (let i = 0; i < 75; i++) { // up to the ridge line
      pan(cc, 0.02, 0);
      terrain.update(ground, false, RANGE, DT);
      expect(cam.z - ground(cam.x, cam.y)!).toBeGreaterThanOrEqual(terrain.clearance * (1 - 1e-9));
      expect(nearPlaneClear(camera, ground, terrain.clearance * 0.5)).toBe(true);
    }
    expect(cam.z).toBeGreaterThan(z0 + 1);
    expect(target.z).toBeCloseTo(0, 6);
  });

  it('a fast pan carries the camera over a ridge instead of through it', () => {
    const { cc, cam, terrain } = make();
    const ridge: GroundSampler = (_x, y) => (Math.abs(y - 1) < 0.05 ? 5 : 0);
    terrain.update(ridge, false, RANGE, DT);
    let crossed = false;
    for (let i = 0; i < 12 && !crossed; i++) {
      pan(cc, 0, 0.5); // far more than the ridge's width per frame
      terrain.update(ridge, false, RANGE, DT);
      crossed = cam.y > 1;
      if (crossed) expect(cam.z).toBeGreaterThan(5);
    }
    expect(crossed).toBe(true);
  });

  it('rotation keeps the target and lifts the camera over terrain in its way', () => {
    const { cc, camera, cam, target, terrain } = make({ polar: 70 });
    const r0 = cam.distanceTo(target) * Math.sin((70 * Math.PI) / 180);
    const ground: GroundSampler = (x, y) => (Math.hypot(x, y) < 0.3 ? 0 : hill(r0, 0, 2.5, 0.6)(x, y));
    terrain.update(ground, false, RANGE, DT);
    const t0 = target.clone();
    for (let az = 0; az <= 90; az += 3) {
      cc.setAzimuth(az);
      terrain.update(ground, false, RANGE, DT);
      expect(target.distanceTo(t0)).toBeLessThan(1e-9);
      expect(cam.z - ground(cam.x, cam.y)!).toBeGreaterThanOrEqual(terrain.clearance * (1 - 1e-9));
      expect(target.clone().sub(cam).normalize().angleTo(viewDir(camera))).toBeLessThan(1e-6);
      // OrbitControls accepts the lifted pose (no fight over its limits).
      const before = cam.clone();
      cc.update();
      expect(cam.distanceTo(before)).toBeLessThan(1e-9);
    }
    expect(polar(cam, target)).toBeLessThan((70 * Math.PI) / 180 - 0.1);
  });

  it('rotating past the hill, the camera comes back down to its orbit', () => {
    const { cc, camera, cam, target, terrain } = make({ polar: 70 });
    const r0 = cam.distanceTo(target) * Math.sin((70 * Math.PI) / 180);
    const ground: GroundSampler = (x, y) => (Math.hypot(x, y) < 0.3 ? 0 : hill(r0, 0, 2.5, 0.6)(x, y));
    terrain.update(ground, false, RANGE, DT);
    const z0 = cam.z;
    const d0 = cam.distanceTo(target);
    const polar0 = polar(cam, target);
    let maxZ = z0;
    for (let az = 0; az <= 180; az += 3) {
      cc.setAzimuth(az);
      terrain.update(ground, false, RANGE, DT);
      maxZ = Math.max(maxZ, cam.z);
      expect(target.clone().sub(cam).normalize().angleTo(viewDir(camera))).toBeLessThan(1e-6);
      const before = cam.clone();
      cc.update();
      expect(cam.distanceTo(before)).toBeLessThan(1e-9);
    }
    for (let i = 0; i < 200; i++) terrain.update(ground, false, RANGE, DT);
    expect(maxZ).toBeGreaterThan(z0 + 0.5);
    expect(Math.abs(cam.z - z0)).toBeLessThan(d0 * 1.5e-3);
    expect(cam.distanceTo(target) / d0).toBeCloseTo(1, 2);
    expect(polar(cam, target)).toBeCloseTo(polar0, 2);
  });

  it('at the steepest allowed pitch the camera backs out instead of steepening', () => {
    const { cc, cam, target, terrain } = make({ polar: 40, maxPitch: 60 });
    const rh = cam.distanceTo(target) * Math.sin((40 * Math.PI) / 180);
    const ground: GroundSampler = (x, y) => (Math.hypot(x, y) < 0.2 ? 0 : hill(rh, 0, 12, 1.5)(x, y));
    terrain.update(ground, false, RANGE, DT);
    for (let az = 0; az <= 90; az += 3) {
      cc.setAzimuth(az);
      terrain.update(ground, false, RANGE, DT);
      expect(polar(cam, target)).toBeGreaterThanOrEqual((30 * Math.PI) / 180 - 1e-9);
      expect(cam.z - ground(cam.x, cam.y)!).toBeGreaterThanOrEqual(terrain.clearance * (1 - 1e-9));
      const before = cam.clone();
      cc.update();
      expect(cam.distanceTo(before)).toBeLessThan(1e-9);
    }
  });

  it('new terrain data moves the target along the line of sight, not the camera', () => {
    const { camera, cam, target, terrain } = make();
    terrain.update(flat(0), false, RANGE, DT);
    const c = cam.clone();
    const dir = viewDir(camera);
    expect(terrain.update(flat(0.5), true, RANGE, DT)).toBe(true);
    expect(cam.distanceTo(c)).toBeLessThan(1e-9);
    expect(target.z).toBeCloseTo(0.5, 6);
    expect(target.clone().sub(cam).normalize().angleTo(dir)).toBeLessThan(1e-6);
  });

  it('snapToTerrain rides the orbit onto the terrain at a new view', () => {
    const { cc, cam, target, terrain } = make();
    terrain.update(flat(0), false, RANGE, DT);
    cc.setView(5, 5, 14, target.z);
    terrain.snapToTerrain();
    const d0 = cam.distanceTo(target);
    terrain.update(flat(2), false, RANGE, DT);
    expect(target.x).toBe(5);
    expect(target.z).toBeCloseTo(2, 9);
    expect(cam.distanceTo(target)).toBeCloseTo(d0, 9);
  });
});

describe('marchToTerrain', () => {
  it('finds the first surface along the ray, in front of anything behind it', () => {
    const ground: GroundSampler = (x) => (x > 2 && x < 3 ? 1 : x > 6 ? 0.5 : null);
    const o = new Vector3(0, 0, 1.5);
    const d = new Vector3(1, 0, -0.2).normalize();
    const t = marchToTerrain(ground, o, d, 0.01, 50, 1.01, 0.01, 2000)!;
    const x = o.x + d.x * t, z = o.z + d.z * t;
    expect(x).toBeGreaterThan(2);
    expect(x).toBeLessThan(3);
    expect(z).toBeCloseTo(1, 6);
    expect(marchToTerrain(() => null, o, d, 0.01, 50, 1.01, 0.01, 2000)).toBeNull();
  });
});
