// ============================================================================
// Tests for src/tools/ToolController.ts: clicks, drags, double-click,
// keyboard and long press, with a stand-in map (screen px = lng/lat × 1000).
// ============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ToolController, type ToolDeps } from '../../src/tools/ToolController';
import { measurePath } from '../../src/tools/measure';

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });

function setup() {
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  document.body.appendChild(container);
  const deps = {
    canvas,
    container,
    pick: vi.fn((x: number, y: number) => ({ lngLat: { lng: x / 1000, lat: y / 1000 }, elevation: 100, slope: 0, aspect: null, curvature: 0, normal: [0, 0, 1] })),
    project: (p: { lng: number; lat: number }) => ({ x: p.lng * 1000, y: p.lat * 1000 }),
    setOverlay: vi.fn(),
    setControlsEnabled: vi.fn(),
    measureDistance: vi.fn((pts) => measurePath(pts, () => 100, 100)),
    measureArea: vi.fn(() => ({ area: 1, surfaceArea: 1, perimeter: 4, minElevation: 0, maxElevation: 0 })),
    lineOfSight: vi.fn(() => null),
    report: vi.fn(),
    changed: vi.fn(),
  } satisfies ToolDeps;
  return { tool: new ToolController(deps), deps, canvas };
}

function pointer(canvas: HTMLElement, type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, bubbles: true, ...extra }));
}
const click = (canvas: HTMLElement, x: number, y: number) => { pointer(canvas, 'pointerdown', x, y); pointer(canvas, 'pointerup', x, y); };
const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

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
    const [id, geo] = deps.setOverlay.mock.calls.at(-2)! as unknown as [string, { features: Array<{ properties: { label?: string } }> }];
    expect(id).toBe('__tool__');
    expect(geo.features.at(-1)!.properties.label).toMatch(/km|m/);
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
