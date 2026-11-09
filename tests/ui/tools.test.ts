// ============================================================================
// Tests for the tools' UI: the profile chart (src/ui/profileChart.ts), the
// profile panel, the toolbar and measurement formatting.
// ============================================================================

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { defineTreeletElements } from '../../src/ui/elements';
import { niceTicks, nearestIndex, chartSvg, profileCsv, chartScales, CSS_PALETTE, type ProfilePoint } from '../../src/ui/profileChart';
import { formatDistance, formatArea, formatElevation } from '../../src/tools/format';
import { describeResult, type TreeletToolbar } from '../../src/ui/TreeletToolbar';
import type { TreeletProfile } from '../../src/ui/TreeletProfile';
import type { Treelet } from '../../src/core/Treelet';
import type { ToolResult } from '../../src/tools/ToolController';

beforeAll(() => defineTreeletElements());
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

const points: ProfilePoint[] = Array.from({ length: 11 }, (_, i) => ({
  distance: i * 500, elevation: i === 4 ? null : 600 + i * 120, lngLat: { lng: 11 + i * 0.01, lat: 47 },
}));

describe('format', () => {
  it('distances, areas and elevations', () => {
    expect(formatDistance(850.4)).toBe('850 m');
    expect(formatDistance(2412)).toBe('2.41 km');
    expect(formatDistance(23_456)).toBe('23.5 km');
    expect(formatDistance(156_000)).toBe('156 km');
    expect(formatArea(850)).toBe('850 m²');
    expect(formatArea(24_000)).toBe('2.40 ha');
    expect(formatArea(3_210_000)).toBe('3.21 km²');
    expect(formatElevation(2334.4)).toBe('2 334 m');
    expect(formatElevation(null)).toBe('–');
  });
});

describe('profile chart', () => {
  it('round ticks cover the range', () => {
    expect(niceTicks(0, 5000, 4)).toEqual([0, 2000, 4000]);
    expect(niceTicks(0, 5000, 6)).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    expect(niceTicks(575, 2334, 4)).toEqual([1000, 1500, 2000]);
    expect(niceTicks(3, 3)).toEqual([3]);
  });

  it('finds the nearest sample and maps distances to pixels', () => {
    expect(nearestIndex(points, 1240)).toBe(2);
    expect(nearestIndex(points, 1260)).toBe(3);
    expect(nearestIndex(points, 99999)).toBe(10);
    const s = chartScales(points, 500, 150);
    expect(s.x(0)).toBe(46);
    expect(s.x(5000)).toBe(500 - 12);
    expect(s.invertX(s.x(2500))).toBeCloseTo(2500, 6);
    expect(s.y(s.hMax)).toBe(10);
  });

  it('draws the terrain (broken where there is no data), a sight line and the obstruction', () => {
    const svg = chartSvg(points, 500, 150, CSS_PALETTE);
    // Area and line: two runs around the gap at sample 4
    expect((svg.match(/<path d="M/g) ?? []).length).toBe(2);
    expect(svg.split('<path')[1].match(/Z/g)).toHaveLength(2);
    expect(svg).toContain('5 km');
    expect(svg).not.toContain('stroke-dasharray');
    const sight = points.map((p) => ({ ...p, sight: 2000 }));
    const blocked = chartSvg(sight, 500, 150, CSS_PALETTE, { obstructionIndex: 9, hoverIndex: 3 });
    expect(blocked).toContain('stroke-dasharray="5 3"');
    expect(blocked).toContain('var(--chart-blocked)');
    expect((blocked.match(/<circle/g) ?? []).length).toBe(2); // obstruction and hover
  });

  it('exports CSV with a sight column when there is one', () => {
    const csv = profileCsv(points.slice(3, 5)).split('\n');
    expect(csv[0]).toBe('distance_m,lng,lat,elevation_m');
    expect(csv[1]).toBe('1500.00,11.0300000,47.0000000,960.00');
    expect(csv[2]).toBe('2000.00,11.0400000,47.0000000,');
    expect(profileCsv([{ ...points[0], sight: 700 }]).split('\n')[1]).toBe('0.00,11.0000000,47.0000000,600.00,700.00');
  });
});

describe('<treelet-profile>', () => {
  it('shows a profile, reports the hovered sample and hides on close', () => {
    const onHover = vi.fn();
    const onClose = vi.fn();
    const el = document.createElement('treelet-profile') as TreeletProfile;
    document.body.appendChild(el);
    el.attach({ onHover, onClose });
    expect(el.hidden).toBe(true);
    el.show({ title: 'Elevation profile', points, stats: [['Length', '5.00 km']] });
    const root = el.shadowRoot!;
    expect(el.hidden).toBe(false);
    expect(root.querySelector('.title')!.textContent).toBe('Elevation profile');
    expect(root.querySelector('.stats')!.textContent).toContain('5.00 km');
    expect(root.querySelector('svg')).not.toBeNull();
    const chart = root.querySelector('.chart') as HTMLElement;
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    chart.dispatchEvent(new PointerEvent('pointermove', { clientX: 46 + 300, clientY: 40, bubbles: true }));
    expect(onHover).not.toHaveBeenCalled(); // on the next frame
    frames.splice(0).forEach((cb) => cb(0));
    expect(onHover).toHaveBeenCalledWith(expect.objectContaining({ lngLat: expect.any(Object) }));
    expect(root.querySelector('.tip')!.textContent).toMatch(/km · /);
    chart.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    expect(onHover).toHaveBeenLastCalledWith(null);
    (root.querySelector('[data-action="close"]') as HTMLElement).click();
    expect(el.hidden).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('<treelet-toolbar>', () => {
  function fakeMap() {
    const handlers = new Map<string, Array<(d: unknown) => void>>();
    let tool: { mode: string | null; drawing: boolean; points: unknown[]; result: ToolResult | null } = { mode: null, drawing: false, points: [], result: null };
    const map = {
      on: vi.fn((e: string, fn: (d: unknown) => void) => { handlers.set(e, [...(handlers.get(e) ?? []), fn]); }),
      off: vi.fn(),
      emit: (e: string, d?: unknown) => handlers.get(e)?.forEach((fn) => fn(d)),
      getTool: () => tool,
      setTool: (t: typeof tool) => { tool = t; },
      startTool: vi.fn((mode: string) => { tool = { mode, drawing: true, points: [], result: null }; map.emit('toolchange', {}); }),
      clearTool: vi.fn(() => { tool = { mode: null, drawing: false, points: [], result: null }; map.emit('toolchange', {}); }),
      finishTool: vi.fn(),
      showProfile: vi.fn(),
      isPicking: () => false,
      cancelPick: vi.fn(),
      pickLocation: vi.fn(() => Promise.resolve(null)),
      computeViewshed: vi.fn(),
      getLayerStack: () => [],
    };
    return map;
  }

  function mount() {
    const map = fakeMap();
    const el = document.createElement('treelet-toolbar') as TreeletToolbar;
    document.body.appendChild(el);
    el.attach(map as unknown as Treelet);
    return { map, root: el.shadowRoot! };
  }

  it('starts and stops tools, shows the hint and live result with actions', () => {
    const { map, root } = mount();
    expect(root.querySelectorAll('.tool')).toHaveLength(5);
    expect((root.querySelector('.status') as HTMLElement).hidden).toBe(true);
    (root.querySelector('[data-tool="distance"]') as HTMLElement).click();
    expect(map.startTool).toHaveBeenCalledWith('distance');
    expect(root.querySelector('[data-tool="distance"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.hint')!.textContent).toMatch(/Click to add points/);
    const path = { distance: 2412, surfaceDistance: 2600, gain: 300, loss: 20, minElevation: 575, maxElevation: 880, vertexDistances: [], profile: [] };
    const result: ToolResult = { mode: 'distance', points: [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }], path };
    map.setTool({ mode: 'distance', drawing: true, points: result.points, result });
    map.emit('measure', { result });
    expect(root.querySelector('.result')!.textContent).toBe('2.41 km · terrain 2.60 km');
    (root.querySelector('[data-action="profile"]') as HTMLElement).click();
    expect(map.showProfile).toHaveBeenCalledWith(result.points);
    (root.querySelector('[data-action="finish"]') as HTMLElement).click();
    expect(map.finishTool).toHaveBeenCalled();
    // Clicking the active tool again stops it
    (root.querySelector('[data-tool="distance"]') as HTMLElement).click();
    expect(map.clearTool).toHaveBeenCalled();
    expect((root.querySelector('.status') as HTMLElement).hidden).toBe(true);
  });

  it('the viewshed button asks for the observer', () => {
    const { map, root } = mount();
    (root.querySelector('[data-tool="viewshed"]') as HTMLElement).click();
    expect(map.pickLocation).toHaveBeenCalledWith({ prompt: 'Click the terrain to place the observer' });
  });

  it('describes results of every tool', () => {
    expect(describeResult(null)).toEqual([]);
    expect(describeResult({ mode: 'area', points: [], area: { area: 3_210_000, surfaceArea: 3_650_000, perimeter: 7800, minElevation: 0, maxElevation: 0 } }))
      .toEqual(['<b>3.21 km²</b> · terrain 3.65 km²', 'Perimeter 7.80 km']);
    const sight = { visible: false, distance: 8450, clearance: -2, eyeElevation: 576, targetElevation: 2244, obstruction: { lngLat: { lng: 0, lat: 0 }, distance: 8400, elevation: 2240 }, profile: [] };
    expect(describeResult({ mode: 'sight', points: [], sight })[0]).toBe('<b>Hidden</b> · blocked at 8.40 km');
    expect(describeResult({ mode: 'sight', points: [], sight: { ...sight, visible: true, obstruction: null, clearance: 12 } }))
      .toEqual(['<b>Visible</b> · 8.45 km', 'Clearance 12 m']);
    expect(describeResult({ mode: 'sight', points: [], sight: null })).toEqual(['No elevation data at the ends']);
  });
});
