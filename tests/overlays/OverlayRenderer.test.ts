// ============================================================================
// Tests for src/overlays/OverlayRenderer.ts with stand-ins for the map:
// geometry built per overlay, heights updated in place where the terrain
// changed, exaggeration as a scale, opacity without rebuilding, visibility,
// fills as owned coats, labels.
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { PerspectiveCamera, Points, Scene, Vector2 } from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { OverlayRenderer, type OverlayRendererDeps, type WorldRect } from '../../src/overlays/OverlayRenderer';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { FeatureCollection } from '../../src/overlays/types';
import { createLineMaterial } from '../../src/overlays/materials';

function setup(overrides: Partial<OverlayRendererDeps> = {}) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 10000);
  camera.position.set(0, 0, 500);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  let version = 1;
  let changes: WorldRect[] | null = [];
  let zoom = 10;
  let exaggeration = 1;
  const labels = { show: vi.fn() };
  const fills = { add: vi.fn(() => 'analysis-7'), update: vi.fn(() => true), remove: vi.fn() };
  const deps: OverlayRendererDeps = {
    scene,
    camera,
    renderer: { getSize: (v: Vector2) => v.set(800, 600), getPixelRatio: () => 2 } as never,
    labels: labels as never,
    // lng/lat degrees → world units (1 unit per 0.01°), small enough to be in view
    toWorld: (p) => ({ x: p.lng * 100, y: p.lat * 100 }),
    groundHeight: vi.fn((x: number, y: number) => (x + y) * 0.01),
    exaggeration: () => exaggeration,
    texelWorld: () => 1,
    terrainVersion: () => version,
    changesSince: vi.fn(() => changes),
    zoom: () => zoom,
    requestRender: vi.fn(),
    isOccluded: vi.fn(() => false),
    fills,
    ...overrides,
  };
  return {
    r: new OverlayRenderer(deps), deps, scene, labels, fills,
    terrainChanged: (rects: WorldRect[] | null) => { version++; changes = rects; },
    setZoom: (z: number) => { zoom = z; },
    setExaggeration: (e: number) => { exaggeration = e; },
  };
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
    const [name, raster, owner] = fills.add.mock.calls[0] as unknown as [string, { width: number; height: number; bounds: Record<string, number>; data: Uint8Array }, string];
    expect(name).toBe('Test');
    expect([raster.width, raster.height]).toEqual([2048, 2048]);
    expect(raster.bounds).toEqual({ west: 0, south: 0, east: 100, north: 100 });
    expect(raster.data[(1024 * 2048 + 1024) * 4 + 3]).toBe(Math.round(0.3 * 255));
    expect(owner).toBe('o1'); // the overlay owns its fill coat
    // Labels: both points and the trail (polygon has no name) are placed
    const placed = labels.show.mock.calls.at(-1)![0] as Array<{ text: string }>;
    expect(placed.map((l) => l.text).sort()).toEqual(['A', 'B', 'Trail']);
  });

  it('updates heights in place where the terrain changed, at most every 200 ms', () => {
    const { r, deps, scene, terrainChanged } = setup();
    const height = deps.groundHeight as ReturnType<typeof vi.fn>;
    r.set('o1', { name: 'T', data });
    r.update(false, 0);
    const [line] = objects(scene).lines;
    const geometry = line.geometry;
    expect(r.update(false, 50)).toBe(false); // nothing changed
    // A tile over the eastern half of the trail (x 0…100) loaded
    terrainChanged([{ west: 10, south: -10, east: 120, north: 10 }]);
    expect(r.update(false, 100)).toBe(false); // too soon
    height.mockClear();
    height.mockImplementation(() => 7);
    expect(r.update(false, 250)).toBe(true);
    // Only ends inside the changed area were sampled, and the geometry was kept
    expect(height.mock.calls.length).toBeGreaterThan(0);
    for (const [x, y] of height.mock.calls as Array<[number, number]>) {
      expect(x).toBeGreaterThanOrEqual(10);
      expect(Math.abs(y)).toBeLessThanOrEqual(10);
    }
    expect(objects(scene).lines[0]).toBe(line);
    expect(line.geometry).toBe(geometry);
    const start = geometry.getAttribute('instanceStart');
    const heights = Array.from({ length: start.count }, (_, i) => start.getZ(i));
    expect(heights).toContain(7);
    // Unknown changes (a cleared atlas): everything again
    height.mockClear();
    terrainChanged(null);
    r.update(false, 500);
    expect(height.mock.calls.length).toBeGreaterThan(300);
  });

  it('exaggeration scales the overlay; opacity changes materials without rebuilding', () => {
    const { r, deps, scene, setExaggeration } = setup();
    r.set('o1', { name: 'T', data });
    r.update(false, 0);
    const [line] = objects(scene).lines;
    const height = deps.groundHeight as ReturnType<typeof vi.fn>;
    height.mockClear();
    setExaggeration(2.5);
    expect(r.update(false, 10)).toBe(true);
    expect(line.parent!.scale.z).toBe(2.5);
    expect(height).not.toHaveBeenCalled();
    r.setOpacity('o1', 0.5);
    r.update(false, 20);
    expect(objects(scene).lines[0]).toBe(line);
    const m = line.material as LineMaterial;
    expect(m.opacity).toBe(0.5);
    expect(m.transparent).toBe(true);
    // Translucent lines cover each pixel once: a stencil test per line object
    expect(m.stencilWrite).toBe(true);
    expect(m.stencilRef).toBeGreaterThan(0);
    r.setOpacity('o1', 1);
    expect(m.transparent).toBe(false);
    expect(m.stencilWrite).toBe(false);
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

  it('the fill coat keeps its id across style and data changes and goes when there is nothing to fill', () => {
    const { r, fills } = setup();
    r.set('o1', { name: 'T', data });
    expect(r.getFillCoat('o1')).toBe('analysis-7');
    r.setStyle('o1', { fillColor: '#ff0000' });
    r.set('o1', { name: 'T', data });
    expect(fills.add).toHaveBeenCalledTimes(1);
    expect(fills.update).toHaveBeenCalledTimes(2);
    expect((fills.update.mock.calls[0] as unknown[])[0]).toBe('analysis-7');
    r.set('o1', { name: 'T', data: { type: 'Point', coordinates: [0, 0] } });
    expect(fills.remove).toHaveBeenCalledWith('analysis-7');
    expect(r.getFillCoat('o1')).toBeNull();
  });

  it('a fill coat removed from outside turns the fills off', () => {
    const { r, fills } = setup();
    r.set('o1', { name: 'T', data });
    r.fillRemoved('o1');
    r.setStyle('o1', { fillColor: '#00ff00' });
    expect(fills.add).toHaveBeenCalledTimes(1);
    expect(fills.update).not.toHaveBeenCalled();
    r.setFills('o1', true);
    expect(fills.add).toHaveBeenCalledTimes(2);
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

  it('a redrape sends only the changed part of the line buffer to the GPU', () => {
    const { r, scene, terrainChanged } = setup({ texelWorld: () => 0.05 }); // densified into many chunks
    r.set('o1', { name: 'T', data: { type: 'FeatureCollection', features: [data.features[2]] } });
    r.update(false, 0);
    const [line] = objects(scene).lines;
    const buffer = (line.geometry.attributes.instanceStart as unknown as { data: { array: Float32Array; updateRanges: Array<{ start: number; count: number }> } }).data;
    buffer.updateRanges.length = 0;
    terrainChanged([{ west: 90, south: -1, east: 100, north: 1 }]); // the trail's east end
    r.update(false, 250);
    expect(buffer.updateRanges.length).toBeGreaterThan(0);
    const sent = buffer.updateRanges.reduce((n, u) => n + u.count, 0);
    expect(sent).toBeLessThan(buffer.array.length / 2);
  });

  it('many changed tiles: every vertex is sampled again, without testing each against each tile', () => {
    const { r, deps, terrainChanged } = setup();
    const height = deps.groundHeight as ReturnType<typeof vi.fn>;
    r.set('o1', { name: 'T', data });
    r.update(false, 0);
    // 100 tiles far from the overlay (testing them one by one would skip every vertex)
    terrainChanged(Array.from({ length: 100 }, (_, i) => ({ west: 5000 + i * 10, south: 5000, east: 5005 + i * 10, north: 5005 })));
    height.mockClear();
    r.update(false, 250);
    expect(height.mock.calls.length).toBeGreaterThan(300);
  });

  it('densifies the lines again when the terrain in view gets finer without new tiles (zooming over loaded ones)', () => {
    let texel = 16;
    const { r, scene } = setup({ texelWorld: () => texel });
    r.set('o1', { name: 'T', data: { type: 'FeatureCollection', features: [data.features[2]] } });
    r.update(false, 0);
    const segments = () => objects(scene).lines[0].geometry.getAttribute('instanceStart').count;
    const coarse = segments();
    texel = 1; // same terrain version
    r.update(false, 100);
    expect(segments()).toBe(coarse); // at most every 200 ms
    r.update(false, 300);
    expect(segments()).toBeGreaterThan(coarse * 4);
  });

  it('keeps line materials across rebuilds (the rubber band is rebuilt on every move)', () => {
    const { r, scene } = setup();
    const band = { type: 'FeatureCollection' as const, features: [data.features[2]] };
    r.set('band', { name: 'Band', data: band, style: { opacity: 0.55 } });
    r.update(false, 0);
    const material = objects(scene).lines[0].material as LineMaterial;
    const dispose = vi.spyOn(material, 'dispose');
    const ref = material.stencilRef;
    expect(ref).toBeGreaterThan(0); // translucent: drawn with a stencil value
    for (let i = 1; i <= 300; i++) {
      r.set('band', { name: 'Band', data: band, style: { opacity: 0.55 } });
      r.update(false, i * 1000);
    }
    expect(objects(scene).lines[0].material).toBe(material);
    expect(material.stencilRef).toBe(ref);
    expect(dispose).not.toHaveBeenCalled();
    r.remove('band');
    expect(dispose).toHaveBeenCalled();
  });

  it('translucent lines get stencil values no live line has (freed when a material goes)', () => {
    const res = new Vector2(800, 600);
    const kept = createLineMaterial(2, 0.5, res);
    for (let i = 0; i < 600; i++) createLineMaterial(2, 0.5, res).dispose();
    const other = createLineMaterial(3, 0.4, res);
    expect(other.stencilRef).not.toBe(kept.stencilRef);
    expect(other.stencilRef).toBeGreaterThan(0);
    const ref = kept.stencilRef;
    kept.dispose();
    expect(createLineMaterial(2, 0.5, res).stencilRef).toBe(ref);
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
