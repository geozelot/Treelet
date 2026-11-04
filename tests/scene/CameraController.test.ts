// ============================================================================
// Tests for src/scene/CameraController.ts (zoom ↔ distance mapping)
// ============================================================================

import { describe, it, expect } from 'vitest';
import { PerspectiveCamera } from 'three';
import { CameraController } from '../../src/scene/CameraController';

const W = 40075.016686;

function make(height = 600) {
  const camera = new PerspectiveCamera(70, 4 / 3, 0.01, 1e6);
  camera.up.set(0, 0, 1);
  const el = document.createElement('div');
  const cc = new CameraController(camera, el, W, 0, 20, 25, 90, height);
  cc.setView(0, 0, 10);
  return cc;
}

describe('CameraController zoom', () => {
  it('maps zoom to the standard web-map scale (256·2^z px per world)', () => {
    const cc = make(600);
    // At the target, one CSS pixel covers W / (256·2^z) world units.
    const unitsPerPx = (2 * cc.getDistanceForZoom(10) * Math.tan((70 * Math.PI) / 360)) / 600;
    expect(unitsPerPx).toBeCloseTo(W / (256 * 1024), 9);
  });

  it('round-trips fractional zoom through orbit distance', () => {
    const cc = make();
    for (const z of [0, 3.25, 10, 17.5, 20]) {
      cc.setZoomLevel(z);
      expect(cc.deriveZoom()).toBeCloseTo(z, 9);
    }
  });

  it('clamps to the configured zoom bounds', () => {
    const cc = make();
    cc.setZoomLevel(50);
    expect(cc.deriveZoom()).toBeCloseTo(20, 9);
    cc.setZoomLevel(-5);
    expect(cc.deriveZoom()).toBeCloseTo(0, 9);
  });

  it('keeps the zoom (scale) when the viewport is resized', () => {
    const cc = make(600);
    cc.setZoomLevel(12.3);
    cc.setViewportHeight(1200);
    expect(cc.deriveZoom()).toBeCloseTo(12.3, 9);
  });
});
