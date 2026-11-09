// ============================================================================
// Tests for src/overlays/OverlayRenderer.ts with stand-ins for the map:
// geometry built per overlay, draping again when the terrain changes,
// visibility, fills as coats, labels.
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { PerspectiveCamera, Points, Scene, Vector2 } from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { OverlayRenderer, type OverlayRendererDeps } from '../../src/overlays/OverlayRenderer';
import type { FeatureCollection } from '../../src/overlays/types';

function setup(overrides: Partial<OverlayRendererDeps> = {}) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 10000);
  camera.position.set(0, 0, 500);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  let key = 'a';
  let zoom = 10;
  const labels = { show: vi.fn() };
  const fills = { add: vi.fn(() => 'analysis-7'), remove: vi.fn(), setVisible: vi.fn(), setOpacity: vi.fn() };
  const deps: OverlayRendererDeps = {
    scene,
    camera,
    renderer: { getSize: (v: Vector2) => v.set(800, 600), getPixelRatio: () => 2 } as never,
    labels: labels as never,
    // lng/lat degrees → world units (1 unit per 0.01°), small enough to be in view
    toWorld: (p) => ({ x: p.lng * 100, y: p.lat * 100 }),
    groundZ: vi.fn((x: number, y: number) => (x + y) * 0.01),
    texelWorld: () => 1,
    terrainKey: () => key,
    zoom: () => zoom,
    requestRender: vi.fn(),
    isOccluded: vi.fn(() => false),
    fills,
    ...overrides,
  };
  return { r: new OverlayRenderer(deps), deps, scene, labels, fills, setKey: (k: string) => { key = k; }, setZoom: (z: number) => { zoom = z; } };
}

const data: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'A' }, geometry: { type: 'Point', coordinates: [0.5, 0.5] } },
    { type: 'Feature', properties: { name: 'B' }, geometry: { type: 'Point', coordinates: [-0.5, -0.5] } },
    { type: 'Feature', properties: { name: 'Trail', w: 6 }, geometry: { type: 'LineString', coordinates: [[-1, 0], [1, 0]] } },
    { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
  ],
};

function objects(scene: Scene) {
  const lines: LineSegments2[] = [];
  const points: Points[] = [];
  scene.traverse((o) => {
    if (o instanceof LineSegments2) lines.push(o);
    if (o instanceof Points) points.push(o);
  });
  return { lines, points };
}

describe('OverlayRenderer', () => {
  it('builds lines, points, a fill coat and labels relative to an anchor near the data', () => {
    const { r, scene, fills, labels } = setup();
    r.set('o1', { name: 'Test', data, style: { label: 'name' } });
    expect(r.update(false, 0)).toBe(true);
    const { lines, points } = objects(scene);
    // The trail and the polygon outline share one width: one line object
    expect(lines).toHaveLength(1);
    // Densified at 2 world units: trail 200 units → 100 segments; outline 400 → 200
    expect(lines[0].geometry.getAttribute('instanceStart').count).toBe(300);
    expect(points).toHaveLength(1);
    expect(points[0].geometry.getAttribute('position').count).toBe(2);
    // Geometry is relative to the data's center; heights come from the terrain
    const group = lines[0].parent!;
    // (the data spans x −100…100, y −50…100: the anchor is (0, 25))
    expect([group.position.x, group.position.y]).toEqual([0, 25]);
    const pos = points[0].geometry.getAttribute('position');
    expect([pos.getX(0), pos.getY(0), pos.getZ(0)]).toEqual([50, 25, 1]);
    // Fill: one image coat over the polygon's bounds, 2048 px on the long side
    expect(fills.add).toHaveBeenCalledTimes(1);
    const [name, raster, opacity] = fills.add.mock.calls[0] as unknown as [string, { width: number; height: number; bounds: Record<string, number>; data: Uint8Array }, number];
    expect(name).toBe('Test');
    expect([raster.width, raster.height]).toEqual([2048, 2048]);
    expect(raster.bounds).toEqual({ west: 0, south: 0, east: 100, north: 100 });
    expect(raster.data[(1024 * 2048 + 1024) * 4 + 3]).toBe(Math.round(0.3 * 255));
    expect(opacity).toBe(1);
    // Labels: both points and the trail (polygon has no name) are placed
    const placed = labels.show.mock.calls.at(-1)![0] as Array<{ text: string }>;
    expect(placed.map((l) => l.text).sort()).toEqual(['A', 'B', 'Trail']);
  });

  it('drapes again when the terrain changes, at most every 200 ms', () => {
    const { r, deps, setKey } = setup();
    r.set('o1', { name: 'T', data });
    r.update(false, 0);
    const calls = (deps.groundZ as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(r.update(false, 50)).toBe(false); // nothing changed
    setKey('b');
    expect(r.update(false, 100)).toBe(false); // too soon
    expect(r.update(false, 250)).toBe(true);
    expect((deps.groundZ as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls);
  });

  it('groups lines by width, hides by visibility and zoom, and cleans up on remove', () => {
    const { r, scene, fills, labels, setZoom } = setup();
    r.set('o1', { name: 'T', data, style: (f) => ({ lineWidth: (f.properties?.w as number) ?? 2, fillColor: null }), minZoom: 8, maxZoom: 12 });
    r.update(false, 0);
    expect(objects(scene).lines).toHaveLength(2);
    expect(fills.add).not.toHaveBeenCalled(); // no fill color
    r.setVisible('o1', false);
    r.update(false, 10);
    expect(objects(scene).lines[0].parent!.visible).toBe(false);
    expect((labels.show.mock.calls.at(-1)![0] as unknown[]).length).toBe(0);
    r.setVisible('o1', true);
    setZoom(14);
    r.update(false, 20);
    expect(objects(scene).lines[0].parent!.visible).toBe(false);
    setZoom(10);
    r.update(false, 30);
    expect(objects(scene).lines[0].parent!.visible).toBe(true);
    expect(r.remove('o1')).toBe(true);
    expect(objects(scene).lines).toHaveLength(0);
    expect(r.remove('o1')).toBe(false);
  });

  it('fill coats follow visibility and opacity and go away with the overlay', () => {
    const { r, fills } = setup();
    r.set('o1', { name: 'T', data });
    r.setOpacity('o1', 0.5);
    expect(fills.setOpacity).toHaveBeenCalledWith('analysis-7', 0.5);
    r.setVisible('o1', false);
    expect(fills.setVisible).toHaveBeenCalledWith('analysis-7', false);
    r.set('o1', { name: 'T', data: { type: 'Point', coordinates: [0, 0] } });
    expect(fills.remove).toHaveBeenCalledWith('analysis-7');
  });

  it('labels behind terrain or overlapping an earlier one are left out', () => {
    const occluded = vi.fn((x: number) => x < 0);
    const { r, labels } = setup({ isOccluded: occluded });
    const twins: FeatureCollection = { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { n: 'One' }, geometry: { type: 'Point', coordinates: [0.1, 0.1] } },
      { type: 'Feature', properties: { n: 'Two' }, geometry: { type: 'Point', coordinates: [0.1001, 0.1] } },
      { type: 'Feature', properties: { n: 'Hidden' }, geometry: { type: 'Point', coordinates: [-0.5, 0.1] } },
    ] };
    r.set('o', { name: 'T', data: twins, style: { label: 'n' } });
    r.update(true, 1000);
    const placed = labels.show.mock.calls.at(-1)![0] as Array<{ text: string }>;
    expect(placed.map((l) => l.text)).toEqual(['One']);
  });

  it('dispose removes everything', () => {
    const { r, scene } = setup();
    r.set('o1', { name: 'T', data });
    r.update(false, 0);
    r.dispose();
    expect(scene.children).toHaveLength(0);
    expect(r.update(true, 1)).toBe(false);
  });
});
