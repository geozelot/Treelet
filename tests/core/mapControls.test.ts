// ============================================================================
// Tests for map methods that work with the controls, on a bare map (no
// renderer): line-of-sight sampling, Escape during a pick, one column at a
// time on a narrow map, and the profile of the measuring tool's result.
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { Treelet } from '../../src/core/Treelet';
import type { LngLat } from '../../src/core/types';
import type { ToolResult } from '../../src/tools/ToolController';
import { pathStats, sightStats } from '../../src/tools/format';

type Bare = Treelet & Record<string, unknown>;

function bareMap(fields: Record<string, unknown> = {}): Bare {
  const map = Object.create(Treelet.prototype) as Bare;
  Object.assign(map, { emit: vi.fn(), ...fields });
  return map;
}

describe('line of sight', () => {
  // A 30 m ridge halfway along a line about 111 m long, on flat 100 m ground
  const from: LngLat = { lng: 0, lat: 0 };
  const to: LngLat = { lng: 0.001, lat: 0 };
  const elevation = (p: LngLat) => (Math.abs(p.lng - 0.0005) < 0.00004 ? 130 : 100);

  it('samples a line shorter than the terrain spacing at least 64 times', () => {
    // Zoomed out, the loaded terrain's spacing (150 m) is longer than the line
    const map = bareMap({ sampleSpacing: () => 150, getElevation: elevation });
    const r = map.lineOfSight(from, to)!;
    expect(r.profile.length).toBeGreaterThanOrEqual(65);
    expect(r.visible).toBe(false);
    expect(r.obstruction!.elevation).toBe(130);
  });

  it('keeps the terrain spacing when it is finer', () => {
    const map = bareMap({ sampleSpacing: () => 0.5, getElevation: () => 100 });
    expect(map.lineOfSight(from, to)!.profile.length).toBeGreaterThan(200);
  });
});

describe('the sun', () => {
  it('a non-finite direction or altitude is ignored (the sun time stays)', () => {
    const time = new Date(2024, 11, 21, 10, 30);
    const display = { setSunAzimuth: vi.fn(), setSunAltitude: vi.fn() };
    const map = bareMap({ sunTime: time, displayController: display });
    map.setSunAzimuth(NaN).setSunAltitude(Infinity);
    expect(map.getSunTime()).toEqual(time);
    expect(display.setSunAzimuth).not.toHaveBeenCalled();
    expect(display.setSunAltitude).not.toHaveBeenCalled();
  });
});

describe('display events', () => {
  it("exaggeration is reported as the base layer's 'layerupdate', the mesh as 'meshchange'", () => {
    const display = {
      setExaggeration: vi.fn(() => 'base-0'),
      setWireframe: vi.fn(), setWireframeWhite: vi.fn(),
      getWireframe: () => true, getWireframeWhite: () => false,
    };
    const map = bareMap({ displayController: display });
    map.setExaggeration(2);
    expect(map.emit).toHaveBeenCalledWith('layerupdate', { id: 'base-0' });
    map.setWireframe(true);
    expect(map.emit).toHaveBeenLastCalledWith('meshchange', { wireframe: true, white: false });
    display.setExaggeration.mockReturnValue(null as never); // no base layer
    (map.emit as ReturnType<typeof vi.fn>).mockClear();
    map.setExaggeration(3);
    expect(map.emit).not.toHaveBeenCalled();
  });
});

describe('pickLocation', () => {
  it('Escape cancels the pick and nothing else (the key is marked used)', async () => {
    const container = document.createElement('div');
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    document.body.appendChild(container);
    const map = bareMap({
      destroyed: false,
      picking: null,
      tools: { mode: null },
      container,
      sceneManager: { renderer: { domElement: canvas } },
    });
    const pending = map.pickLocation({ prompt: 'Place a marker' });
    expect(map.emit).toHaveBeenCalledWith('pickstart', { prompt: 'Place a marker' });
    const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    await expect(pending).resolves.toBeNull();
    container.remove();
  });
});

describe('narrow maps', () => {
  function dock(open: boolean, h: 'left' | 'right') {
    const d = {
      isOpen: open,
      hidden: false,
      dataset: { v: 'bottom', h },
      style: { setProperty: vi.fn() },
      toggleAttribute: vi.fn(),
      close: vi.fn(() => { d.isOpen = false; }),
    };
    return d;
  }
  function layout(hubOpen: boolean, infoOpen: boolean) {
    const hub = dock(hubOpen, 'right');
    const info = dock(infoOpen, 'left');
    const map = bareMap({
      options: { guiDisplay: { compassPosition: 'top-right', navigation: true } },
      compass: null,
      compact: false,
      hub,
      info,
    });
    return { map, hub, info, resize: (w: number) => (map as unknown as { layoutControls(w: number, h: number): void }).layoutControls(w, 800) };
  }

  it('turning narrow with the hub open: the info box steps aside', () => {
    const { hub, info, resize } = layout(true, false);
    resize(400);
    expect([hub.hidden, info.hidden]).toEqual([false, true]);
    resize(900);
    expect([hub.hidden, info.hidden]).toEqual([false, false]);
  });

  it('with both columns open, the hub stays and the info column closes and steps aside', () => {
    const { hub, info, resize } = layout(true, true);
    resize(400);
    expect(info.close).toHaveBeenCalled();
    expect([hub.isOpen, hub.hidden, info.hidden]).toEqual([true, false, true]);
  });

  it("a full-width column on the compass's edge starts past it", () => {
    const hub = dock(true, 'right');
    hub.dataset.v = 'top';
    const map = bareMap({
      options: { guiDisplay: { compassPosition: 'top-right', navigation: true } },
      compass: {}, compact: true, hub, info: null,
    });
    (map as unknown as { layoutControls(w: number, h: number): void }).layoutControls(400, 800);
    expect(hub.style.setProperty).toHaveBeenCalledWith('--dock-inset', '78px'); // 12 + the compass (60) and its gap (6)
    expect(hub.style.setProperty).toHaveBeenCalledWith('--dock-max', '710px');
  });

  it('with only the info column open, the tree box steps aside', () => {
    const { hub, info, resize } = layout(false, true);
    resize(400);
    expect([hub.hidden, info.hidden]).toEqual([true, false]);
  });
});

describe('the profile of the measuring tool', () => {
  const points: LngLat[] = [{ lng: 0, lat: 0 }, { lng: 0.01, lat: 0 }];
  const path = { distance: 1110, surfaceDistance: 1130, gain: 20, loss: 5, minElevation: 100, maxElevation: 120, vertexDistances: [0, 1110], profile: [] };

  function mapWithTool(result: ToolResult | null) {
    const hub = { hasTools: true, showProfile: vi.fn(() => true), hideProfile: vi.fn() };
    const map = bareMap({
      tools: { result, mode: result?.mode ?? null },
      hub,
      profile: null,
      toolProfile: false,
      measureDistance: () => path,
      setInternalOverlay: vi.fn(),
    });
    return { map, hub };
  }

  it("is marked as the tool's when it shows the tool's path (and only then)", () => {
    const { map, hub } = mapWithTool({ mode: 'distance', points, path });
    map.showProfile(points.map((p) => ({ ...p })));
    expect(hub.showProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ stats: pathStats(path) }),
      expect.objectContaining({ ofTool: true }),
    );
    map.showProfile([points[0], { lng: 0.02, lat: 0 }]);
    expect(hub.showProfile).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ ofTool: false }));
  });

  it("closes with the tool's result (cleared, drawn anew), and leaves another profile open", () => {
    const { map, hub } = mapWithTool({ mode: 'distance', points, path });
    const report = (r: ToolResult | null, final: boolean) =>
      (map as unknown as { onToolReport(r: ToolResult | null, f: boolean): void }).onToolReport(r, final);
    map.showProfile(points);
    report(null, true);
    expect(hub.hideProfile).toHaveBeenCalledTimes(1);
    report(null, true);
    expect(hub.hideProfile).toHaveBeenCalledTimes(1); // already closed
    map.showProfile([points[0], { lng: 0.02, lat: 0 }]);
    report({ mode: 'distance', points, path }, false);
    expect(hub.hideProfile).toHaveBeenCalledTimes(1);
  });

  it('a line of sight gives the same statistics to the tool and the profile', () => {
    const sight = { visible: false, distance: 8450, clearance: -2, eyeElevation: 576, targetElevation: 2244, obstruction: { lngLat: { lng: 0, lat: 0 }, distance: 8400, elevation: 2240 }, profile: [] };
    expect(sightStats(sight)).toEqual([
      ['Result', 'Hidden'], ['Blocked at', '8.40 km'], ['Distance', '8.45 km'],
      ['Clearance', '-2 m'], ['Eye', '576 m'], ['Target', '2\u2009244 m'],
    ]);
    const { map, hub } = mapWithTool({ mode: 'sight', points, sight });
    map.showProfile(sight);
    expect(hub.showProfile).toHaveBeenLastCalledWith(expect.objectContaining({ stats: sightStats(sight) }), expect.objectContaining({ ofTool: true }));
  });
});
