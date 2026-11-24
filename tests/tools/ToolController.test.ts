// ============================================================================
// Tests for src/tools/ToolController.ts: clicks, drags, double-click,
// keyboard and long press, with a stand-in map (screen px = lng/lat × 1000);
// live results while the pointer moves (only the moving part measured, the
// committed geometry not drawn again).
// ============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ToolController, type ToolDeps, type ToolResult } from '../../src/tools/ToolController';
import { measurePath, geodesicAreaOf, type PathMeasure, type AreaMeasure } from '../../src/tools/measure';
import { formatDistance } from '../../src/tools/format';
import { normalizeGeoJSON } from '../../src/overlays/geojson';
import type { LngLat, LineOfSightResult, TerrainPick } from '../../src/core/types';
import type { GeoJSON, OverlayStyleSpec } from '../../src/overlays/types';

const tools: ToolController[] = [];
afterEach(() => {
  for (const t of tools.splice(0)) t.dispose(); // no document listeners left behind
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Rolling stand-in terrain. */
const terrain = (p: LngLat) => 500 + 300 * Math.sin(p.lng * 200) + 200 * Math.cos(p.lat * 150);

const pickAt = (x: number, y: number): TerrainPick => ({
  lngLat: { lng: x / 1000, lat: y / 1000 }, elevation: 100, slope: 0, aspect: null, curvature: 0, normal: [0, 0, 1],
});

function mockDeps(canvas: HTMLElement, container: HTMLElement) {
  return {
    canvas,
    container,
    pick: vi.fn((x: number, y: number): TerrainPick | null => pickAt(x, y)),
    project: (p: { lng: number; lat: number }) => ({ x: p.lng * 1000, y: p.lat * 1000 }),
    setOverlay: vi.fn((_id: string, _data: GeoJSON | null, _style: OverlayStyleSpec) => {}),
    setControlsEnabled: vi.fn((_enabled: boolean) => {}),
    measureDistance: vi.fn((pts: LngLat[]) => measurePath(pts, () => 100, 100)),
    measureArea: vi.fn((_ring: LngLat[], _cells: number): AreaMeasure => ({ area: 1, surfaceArea: 1, perimeter: 4, minElevation: 0, maxElevation: 0 })),
    lineOfSight: vi.fn((_from: LngLat, _to: LngLat): LineOfSightResult | null => null),
    report: vi.fn((_result: ToolResult | null, _final: boolean) => {}),
    changed: vi.fn(() => {}),
  } satisfies ToolDeps;
}
type Deps = ReturnType<typeof mockDeps>;

function setup(overrides: Partial<Deps> = {}) {
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  document.body.appendChild(container);
  const deps: Deps = { ...mockDeps(canvas, container), ...overrides };
  const tool = new ToolController(deps);
  tools.push(tool);
  return { tool, deps, canvas };
}

/** Animation frames run by hand. */
function frames() {
  let next = 1;
  const queue = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.set(next, cb); return next++; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue.delete(id); });
  return {
    flush() { const cbs = [...queue.values()]; queue.clear(); for (const cb of cbs) cb(performance.now()); },
    get pending() { return queue.size; },
  };
}

function pointer(canvas: HTMLElement, type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, bubbles: true, ...extra }));
}
const click = (canvas: HTMLElement, x: number, y: number) => { pointer(canvas, 'pointerdown', x, y); pointer(canvas, 'pointerup', x, y); };
const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

const callsTo = (deps: Deps, id: string) => deps.setOverlay.mock.calls.filter((c) => c[0] === id);
const lastTo = (deps: Deps, id: string) => callsTo(deps, id).at(-1);
const pathOf = (r: ToolResult | null): PathMeasure => {
  if (r?.mode !== 'distance' && r?.mode !== 'profile') throw new Error('not a path result');
  return r.path;
};
const endLabel = (geo: GeoJSON | null) => (geo as { features: Array<{ properties: { label?: string } }> }).features.at(-1)!.properties.label;

/** A live path result equals the full measurement of its points, up to sampling. */
function expectSamePath(live: PathMeasure, full: PathMeasure) {
  expect(live.distance).toBeCloseTo(full.distance, 6);
  expect(Math.abs(live.surfaceDistance - full.surfaceDistance) / full.surfaceDistance).toBeLessThan(1e-4);
  expect(live.gain).toBeCloseTo(full.gain, 6);
  expect(live.loss).toBeCloseTo(full.loss, 6);
  expect(live.minElevation).toBeCloseTo(full.minElevation!, 9);
  expect(live.maxElevation).toBeCloseTo(full.maxElevation!, 9);
  expect(live.vertexDistances).toHaveLength(full.vertexDistances.length);
  live.vertexDistances.forEach((d, i) => expect(d).toBeCloseTo(full.vertexDistances[i], 6));
  expect(live.profile).toHaveLength(full.profile.length);
  expect(live.profile.at(-1)!.distance).toBeCloseTo(full.profile.at(-1)!.distance, 6);
}

describe('ToolController', () => {
  it('clicks add points; a double-click finishes without adding the second click', () => {
    const { tool, deps, canvas } = setup();
    tool.start('distance');
    expect(tool.active).toBe(true);
    click(canvas, 10, 10);
    click(canvas, 50, 10);
    click(canvas, 50, 10); // second click of a double-click, on the last point
    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(tool.points).toEqual([{ lng: 0.01, lat: 0.01 }, { lng: 0.05, lat: 0.01 }]);
    expect(tool.finished).toBe(true);
    expect(tool.result?.mode).toBe('distance');
    expect(deps.report).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'distance' }), true);
    // The line and the vertices were drawn, with the length on the last point
    const [, geo] = lastTo(deps, '__tool__')!;
    expect(endLabel(geo)).toBe(formatDistance(pathOf(tool.result).distance));
    // Finished: further clicks do nothing
    click(canvas, 90, 90);
    expect(tool.points).toHaveLength(2);
  });

  it('a press that moves (a pan) adds nothing', () => {
    const { tool, canvas } = setup();
    tool.start('area');
    pointer(canvas, 'pointerdown', 10, 10);
    pointer(canvas, 'pointermove', 40, 40);
    pointer(canvas, 'pointerup', 40, 40);
    expect(tool.points).toHaveLength(0);
  });

  it('keyboard: Backspace removes the last point, Enter finishes, Escape clears', () => {
    const { tool, deps, canvas } = setup();
    tool.start('area');
    for (const [x, y] of [[0, 0], [100, 0], [100, 100], [0, 100]]) click(canvas, x, y);
    key('Backspace');
    expect(tool.points).toHaveLength(3);
    key('Enter');
    expect(tool.finished).toBe(true);
    expect(deps.measureArea).toHaveBeenLastCalledWith(tool.points, 256);
    tool.start('distance');
    click(canvas, 5, 5);
    key('Escape');
    expect(tool.mode).toBeNull();
    expect(deps.report).toHaveBeenLastCalledWith(null, true);
    expect(deps.setOverlay).toHaveBeenLastCalledWith('__tool_preview__', null, {});
  });

  it('finishing with too few points clears; the sight tool finishes after its second point', () => {
    const { tool, deps, canvas } = setup();
    tool.start('area');
    click(canvas, 0, 0);
    click(canvas, 50, 0);
    tool.finish();
    expect(tool.mode).toBeNull();
    tool.start('sight');
    click(canvas, 0, 0);
    expect(tool.finished).toBe(false);
    click(canvas, 80, 30);
    expect(tool.finished).toBe(true);
    expect(deps.lineOfSight).toHaveBeenCalledWith({ lng: 0, lat: 0 }, { lng: 0.08, lat: 0.03 });
  });

  it('dragging a point moves it with the map controls off', async () => {
    const { tool, deps, canvas } = setup();
    tool.start('distance');
    click(canvas, 10, 10);
    click(canvas, 60, 10);
    pointer(canvas, 'pointerdown', 62, 12); // within reach of the second point
    expect(deps.setControlsEnabled).toHaveBeenLastCalledWith(false);
    pointer(canvas, 'pointermove', 80, 40);
    await new Promise((r) => setTimeout(r, 40)); // the move is applied on the next frame
    pointer(canvas, 'pointerup', 80, 40);
    expect(deps.setControlsEnabled).toHaveBeenLastCalledWith(true);
    expect(tool.points[1]).toEqual({ lng: 0.08, lat: 0.04 });
    expect(tool.points).toHaveLength(2);
  });

  it('a long touch press finishes', () => {
    vi.useFakeTimers();
    const { tool, canvas } = setup();
    tool.start('distance');
    const tap = (x: number) => {
      pointer(canvas, 'pointerdown', x, 0, { pointerType: 'touch' });
      pointer(canvas, 'pointerup', x, 0, { pointerType: 'touch' });
    };
    tap(0);
    tap(100);
    pointer(canvas, 'pointerdown', 200, 0, { pointerType: 'touch' });
    vi.advanceTimersByTime(700);
    expect(tool.finished).toBe(true);
    expect(tool.points).toHaveLength(2);
  });

  it('starting another tool replaces the geometry; dispose stops listening', () => {
    const { tool, canvas } = setup();
    tool.start('distance');
    click(canvas, 1, 1);
    tool.start('area');
    expect(tool.points).toHaveLength(0);
    tool.dispose();
    click(canvas, 5, 5);
    expect(tool.points).toHaveLength(0);
    expect(tool.mode).toBeNull();
  });
});

describe('ToolController: live results', () => {
  const hover = (canvas: HTMLElement, f: ReturnType<typeof frames>, x: number, y: number) => { pointer(canvas, 'pointermove', x, y); f.flush(); };

  it('hover measures only the new segment, joined to the committed path, and equals a full measurement', () => {
    const f = frames();
    const measure = vi.fn((pts: LngLat[]) => measurePath(pts, terrain, 20));
    const { tool, deps, canvas } = setup({ measureDistance: measure });
    tool.start('distance');
    click(canvas, 10, 10);
    click(canvas, 60, 20);
    click(canvas, 90, 70);
    measure.mockClear();
    hover(canvas, f, 40, 95);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(measure.mock.calls[0][0]).toEqual([{ lng: 0.09, lat: 0.07 }, { lng: 0.04, lat: 0.095 }]);
    const r = tool.result!;
    expect(r.points).toHaveLength(4);
    expectSamePath(pathOf(r), measurePath(r.points, terrain, 20));
    expect(deps.report).toHaveBeenLastCalledWith(r, false);
    // A second hover: again one segment, still equal to the whole
    hover(canvas, f, 120, 30);
    expect(measure).toHaveBeenCalledTimes(2);
    expectSamePath(pathOf(tool.result), measurePath(tool.result!.points, terrain, 20));
  });

  it('hover redraws the preview only, not the committed geometry', () => {
    const f = frames();
    const { tool, deps, canvas } = setup();
    tool.start('distance');
    click(canvas, 10, 10);
    click(canvas, 60, 20);
    deps.setOverlay.mockClear();
    hover(canvas, f, 70, 40); // the end label gives way to the pointer: drawn once
    hover(canvas, f, 80, 50);
    hover(canvas, f, 90, 60);
    expect(callsTo(deps, '__tool__')).toHaveLength(1);
    expect(callsTo(deps, '__tool_preview__')).toHaveLength(3);
    expect(lastTo(deps, '__tool_preview__')![1]).toEqual({ type: 'LineString', coordinates: [[0.06, 0.02], [0.09, 0.06]] });
    // The same spot again changes nothing and reports nothing
    const reports = deps.report.mock.calls.length;
    hover(canvas, f, 90, 60);
    expect(deps.setOverlay.mock.calls).toHaveLength(4);
    expect(deps.report.mock.calls).toHaveLength(reports);
  });

  it('when the pointer leaves or misses the terrain, the end label shows the committed result', () => {
    const f = frames();
    const { tool, deps, canvas } = setup();
    deps.pick.mockImplementation((x: number, y: number) => (x > 500 ? null : pickAt(x, y)));
    tool.start('distance');
    click(canvas, 10, 10);
    click(canvas, 40, 10);
    const committed = pathOf(tool.result).distance;
    hover(canvas, f, 300, 10); // far away: the live length is much longer
    expect(pathOf(tool.result).distance).toBeGreaterThan(committed * 5);
    pointer(canvas, 'pointerleave', 300, 10);
    expect(tool.result!.points).toHaveLength(2);
    expect(endLabel(lastTo(deps, '__tool__')![1])).toBe(formatDistance(committed));
    expect(lastTo(deps, '__tool_preview__')![1]).toBeNull();
    // Off the terrain (no pick) behaves the same
    hover(canvas, f, 300, 10);
    hover(canvas, f, 900, 10);
    expect(tool.result!.points).toHaveLength(2);
    expect(endLabel(lastTo(deps, '__tool__')![1])).toBe(formatDistance(committed));
    // A move still waiting for its frame does not bring the hover back after leaving
    pointer(canvas, 'pointermove', 300, 10);
    pointer(canvas, 'pointerleave', 300, 10);
    f.flush();
    expect(tool.result!.points).toHaveLength(2);
  });

  it('sight: the live sight line and target follow the pointer', () => {
    const f = frames();
    const lineOfSight = vi.fn((from: LngLat, to: LngLat): LineOfSightResult => ({
      visible: false, distance: 1000, clearance: -3, eyeElevation: 101.7, targetElevation: 100,
      obstruction: { lngLat: { lng: (from.lng + to.lng) / 2, lat: (from.lat + to.lat) / 2 }, distance: 500, elevation: 120 },
      profile: [],
    }));
    const { tool, deps, canvas } = setup({ lineOfSight });
    const warn = vi.spyOn(console, 'warn');
    tool.start('sight');
    click(canvas, 10, 10);
    expect(lastTo(deps, '__tool__')![1]).toEqual({ type: 'FeatureCollection', features: [expect.objectContaining({ properties: { label: 'Observer' } })] });
    deps.setOverlay.mockClear();
    hover(canvas, f, 50, 40);
    hover(canvas, f, 70, 60);
    expect(tool.result!.points).toEqual([{ lng: 0.01, lat: 0.01 }, { lng: 0.07, lat: 0.06 }]);
    const preview = lastTo(deps, '__tool_preview__')![1]!;
    const n = normalizeGeoJSON(preview);
    expect(n.lines).toHaveLength(2);
    expect(n.points.map((p) => p.lngLat)).toContainEqual({ lng: 0.07, lat: 0.06 });
    const target = (preview as { features: Array<{ geometry: { coordinates: unknown }; properties: { label?: string } }> }).features.at(-1)!;
    expect(target.geometry.coordinates).toEqual([0.07, 0.06]);
    expect(target.properties.label).toBe('Hidden');
    expect(warn).not.toHaveBeenCalled();
    // The committed layer holds the observer alone and is not redrawn per move
    expect(callsTo(deps, '__tool__')).toHaveLength(0);
    // The second click finishes: the sight line moves to the committed layer
    click(canvas, 70, 60);
    expect(tool.finished).toBe(true);
    expect(normalizeGeoJSON(lastTo(deps, '__tool__')![1]).lines).toHaveLength(2);
    expect(lastTo(deps, '__tool_preview__')![1]).toBeNull();
  });

  it('area: hover computes the geodesic figures, the surface area follows (throttled)', () => {
    vi.useFakeTimers();
    const f = frames();
    const measureArea = vi.fn((ring: LngLat[], _cells: number) => {
      const g = geodesicAreaOf(ring);
      return { area: g.area, perimeter: g.perimeter, surfaceArea: g.area * 1.25, minElevation: 100, maxElevation: 300 };
    });
    const { tool, deps, canvas } = setup({ measureArea });
    tool.start('area');
    for (const [x, y] of [[0, 0], [100, 0], [100, 100]]) click(canvas, x, y);
    expect(measureArea).toHaveBeenCalledTimes(1);
    measureArea.mockClear();
    hover(canvas, f, 10, 90);
    hover(canvas, f, 0, 100);
    expect(measureArea).not.toHaveBeenCalled();
    const live = tool.result!;
    if (live.mode !== 'area') throw new Error('area result');
    const g = geodesicAreaOf(live.points);
    expect(live.points).toHaveLength(4);
    expect(live.area.area).toBeCloseTo(g.area, 6);
    expect(live.area.perimeter).toBeCloseTo(g.perimeter, 6);
    expect(live.area.surfaceArea).toBeCloseTo(g.area * 1.25, 3); // the committed slope ratio
    expect(live.area.minElevation).toBe(100);
    vi.advanceTimersByTime(200);
    expect(measureArea).toHaveBeenCalledTimes(1);
    expect(measureArea).toHaveBeenLastCalledWith(live.points, 64);
    expect(deps.report).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'area', points: live.points }), false);
    // While the pointer keeps moving the surface area is measured now and then, not per frame
    measureArea.mockClear();
    for (let i = 0; i < 12; i++) {
      hover(canvas, f, 10 + i * 5, 90 + i);
      vi.advanceTimersByTime(50);
    }
    expect(measureArea.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(measureArea.mock.calls.length).toBeLessThanOrEqual(5);
    key('Enter');
    expect(measureArea).toHaveBeenLastCalledWith(tool.points, 256);
  });

  it('dragging a point measures around it only and ends with a full measurement', () => {
    const f = frames();
    const measure = vi.fn((pts: LngLat[]) => measurePath(pts, terrain, 20));
    const { tool, canvas } = setup({ measureDistance: measure });
    tool.start('distance');
    for (const [x, y] of [[10, 10], [60, 20], [90, 70], [140, 60], [180, 90]]) click(canvas, x, y);
    measure.mockClear();
    pointer(canvas, 'pointerdown', 90, 70);
    pointer(canvas, 'pointermove', 100, 80);
    f.flush();
    // The parts before and after once, then the dragged point's two segments
    expect(measure.mock.calls.map((c) => c[0].length)).toEqual([2, 2, 3]);
    expectSamePath(pathOf(tool.result), measurePath(tool.points, terrain, 20));
    pointer(canvas, 'pointermove', 110, 85);
    f.flush();
    expect(measure.mock.calls.map((c) => c[0].length)).toEqual([2, 2, 3, 3]);
    expectSamePath(pathOf(tool.result), measurePath(tool.points, terrain, 20));
    pointer(canvas, 'pointerup', 110, 85);
    expect(measure.mock.calls.at(-1)![0]).toHaveLength(5);
    expect(tool.points[2]).toEqual({ lng: 0.11, lat: 0.085 });
  });
});

describe('ToolController: input', () => {
  it('tool keys leave interactive controls alone, also inside shadow roots', () => {
    const { tool, canvas } = setup();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<button type="button">Go</button><input type="date"><div role="slider" tabindex="0"></div><span contenteditable="true">x</span><a href="#x">link</a><select><option>a</option></select><span tabindex="0">plain</span>';
    const keyOn = (el: Element, k: string, extra: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...extra });
      el.dispatchEvent(e);
      return e;
    };
    tool.start('distance');
    for (const [x, y] of [[10, 10], [60, 20], [90, 70]]) click(canvas, x, y);
    for (const sel of ['button', 'input', '[role="slider"]', '[contenteditable]', 'a', 'select']) {
      const el = root.querySelector(sel)!;
      for (const k of ['Enter', 'Backspace', 'Escape']) expect(keyOn(el, k).defaultPrevented).toBe(false);
    }
    expect(tool.points).toHaveLength(3);
    expect(tool.active).toBe(true);
    // Keys with a modifier are someone else's
    key('Backspace');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', ctrlKey: true, bubbles: true }));
    expect(tool.points).toHaveLength(2);
    // Outside a control (a plain focusable element, the canvas, the page) the keys work
    expect(keyOn(root.querySelector('span[tabindex]')!, 'Backspace').defaultPrevented).toBe(true);
    expect(tool.points).toHaveLength(1);
    click(canvas, 60, 20);
    keyOn(canvas, 'Enter');
    expect(tool.finished).toBe(true);
  });

  it('the end of a touch drag applies the waiting move and leaves no hover', () => {
    const f = frames();
    const { tool, deps, canvas } = setup();
    tool.start('distance');
    click(canvas, 10, 10);
    click(canvas, 60, 10);
    const touch = { pointerType: 'touch', pointerId: 7, isPrimary: true };
    pointer(canvas, 'pointerdown', 61, 11, touch);
    expect(deps.setControlsEnabled).toHaveBeenLastCalledWith(false);
    pointer(canvas, 'pointermove', 80, 40, touch);
    pointer(canvas, 'pointerup', 80, 40, touch); // before the frame
    expect(tool.points[1]).toEqual({ lng: 0.08, lat: 0.04 });
    expect(f.pending).toBe(0);
    f.flush();
    expect(tool.result!.points).toEqual(tool.points);
    expect(callsTo(deps, '__tool_preview__').every((c) => c[1] === null)).toBe(true);
    expect(deps.setControlsEnabled).toHaveBeenLastCalledWith(true);
    // A frame that runs after the drag ended changes nothing either
    pointer(canvas, 'pointerdown', 80, 40, touch);
    pointer(canvas, 'pointermove', 90, 50, touch);
    pointer(canvas, 'pointercancel', 90, 50, touch);
    f.flush();
    expect(tool.points).toEqual([{ lng: 0.01, lat: 0.01 }, { lng: 0.08, lat: 0.04 }]);
    expect(tool.result!.points).toEqual(tool.points);
    expect(deps.setControlsEnabled).toHaveBeenLastCalledWith(true);
  });

  it('a second finger cancels the long press (pinch or rotate does not finish)', () => {
    vi.useFakeTimers();
    const { tool, canvas } = setup();
    tool.start('distance');
    const tap = (x: number) => {
      pointer(canvas, 'pointerdown', x, 0, { pointerType: 'touch', isPrimary: true });
      pointer(canvas, 'pointerup', x, 0, { pointerType: 'touch', isPrimary: true });
    };
    tap(0);
    tap(100);
    // One finger held still, the other one pinching
    pointer(canvas, 'pointerdown', 200, 0, { pointerType: 'touch', pointerId: 1, isPrimary: true });
    vi.advanceTimersByTime(300);
    pointer(canvas, 'pointerdown', 300, 50, { pointerType: 'touch', pointerId: 2, isPrimary: false });
    pointer(canvas, 'pointermove', 340, 90, { pointerType: 'touch', pointerId: 2, isPrimary: false });
    vi.advanceTimersByTime(1000);
    expect(tool.active).toBe(true);
    expect(tool.points).toHaveLength(2);
    // Lifting them neither adds a point nor arms a long press
    pointer(canvas, 'pointerup', 340, 90, { pointerType: 'touch', pointerId: 2, isPrimary: false });
    vi.advanceTimersByTime(1000);
    pointer(canvas, 'pointerup', 200, 0, { pointerType: 'touch', pointerId: 1, isPrimary: true });
    expect(tool.active).toBe(true);
    expect(tool.points).toHaveLength(2);
    // Both fingers down at once: no long press either
    pointer(canvas, 'pointerdown', 200, 0, { pointerType: 'touch', pointerId: 3, isPrimary: true });
    pointer(canvas, 'pointerdown', 260, 0, { pointerType: 'touch', pointerId: 4, isPrimary: false });
    vi.advanceTimersByTime(1000);
    expect(tool.active).toBe(true);
  });
});
