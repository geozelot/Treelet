// ============================================================================
// Tests for the controls: the hub (layers, measuring) and the info box
// (legend, readout, view, credits) opening into their columns, the layer
// panel's pages and scrub rows, the compass and its navigation wings.
// ============================================================================

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { defineTreeletElements } from '../../src/ui/elements';
import { registerBuiltinAnalyses } from '../../src/analysis/builtins';
import { getAnalysis, listAnalyses, registerAnalysis } from '../../src/analysis/registry';
import type { TreeletAttribution } from '../../src/ui/TreeletAttribution';
import type { TreeletToolbar } from '../../src/ui/TreeletToolbar';
import type { TreeletCompass } from '../../src/ui/TreeletCompass';
import type { TreeletPanel } from '../../src/ui/TreeletPanel';
import type { TreeletLegend } from '../../src/ui/TreeletLegend';
import type { TreeletHub } from '../../src/ui/TreeletHub';
import type { TreeletInfo } from '../../src/ui/TreeletInfo';
import { type TreeletReadout, compassPoint, formatReadout } from '../../src/ui/TreeletReadout';
import type { Treelet } from '../../src/core/Treelet';

/** A stack member as the panel reads it. */
function fakeAnalysis(id: string, analysis: string, over: Record<string, unknown> = {}) {
  const descriptor = getAnalysis(analysis)!;
  return {
    id, layerName: descriptor.label, visible: true, descriptor,
    params: { ...descriptor.defaults }, ramp: descriptor.ramp,
    isValueKind: descriptor.ramp !== undefined,
    display: { visible: true, opacity: descriptor.opacity ?? 1, blendMode: descriptor.blendMode ?? 'normal' },
    ...over,
  };
}

/** The parts of Treelet the controls use, with spies for actions. */
function fakeMap(opts: { baseLayers?: number; stack?: unknown[]; legends?: unknown[] } = {}) {
  const baseLayers = Array.from({ length: opts.baseLayers ?? 1 }, (_, i) => ({
    id: `base-${i}`, layerName: `Base ${i}`, visible: i === 0, attribution: i === 0 ? '© Base' : undefined,
  }));
  const drapes = [{ id: 'osm', layerName: 'OpenStreetMap' }];
  const stack = opts.stack ?? [fakeAnalysis('analysis-0', 'hillshade'), fakeAnalysis('analysis-1', 'elevation')];
  const camera = {
    getState: () => ({ zoom: 10.4, pitch: 30, rotation: 20, distance: 1 }),
    resetOrientation: vi.fn(),
    setZoomLevel: vi.fn(),
    setAzimuth: vi.fn(),
    setPitch: vi.fn(),
  };
  const handlers = new Map<string, Array<() => void>>();
  const map = {
    camera,
    on: vi.fn((event: string, fn: () => void) => { handlers.set(event, [...(handlers.get(event) ?? []), fn]); }),
    off: vi.fn((event: string, fn: () => void) => { handlers.set(event, (handlers.get(event) ?? []).filter((f) => f !== fn)); }),
    emit: (event: string, data?: unknown) => handlers.get(event)?.forEach((fn) => (fn as (d: unknown) => void)(data)),
    getCameraController: () => camera,
    getCenter: () => ({ lng: 11.39, lat: 47.27 }),
    getBounds: () => ({ sw: { lng: 10, lat: 46 }, ne: { lng: 12, lat: 48 } }),
    getBaseLayers: () => baseLayers,
    getDrapeLayers: () => drapes,
    getOverlayLayers: () => [] as unknown[],
    getLayerStack: () => stack,
    getActiveDrapeId: () => null,
    getLegend: () => ({ domain: [0, 4000] }),
    getLegends: () => opts.legends ?? [],
    getVisibleElevationRange: () => [800, 2600] as [number, number],
    getRegionAnalyses: () => ['viewshed', 'sunhours', 'skyview', 'tpi'],
    computeAnalysis: vi.fn(() => Promise.resolve({})),
    pickLocation: vi.fn(() => Promise.resolve({ lngLat: { lng: 11.4, lat: 47.3 }, elevation: 2000, slope: 0, aspect: null, curvature: 0, normal: [0, 0, 1] })),
    cancelPick: vi.fn(),
    getAnalysisJobs: vi.fn(() => [] as unknown[]),
    cancelAnalysis: vi.fn(),
    getRasterInfo: vi.fn(() => ({ range: [0.2, 7.9] })),
    sunTime: null as Date | null,
    getSunTime() { return this.sunTime; },
    setSunTime: vi.fn(function (this: { sunTime: Date | null }, d: Date | null) { this.sunTime = d; }),
    getContainer: () => document.body,
    pick: vi.fn((x: number, y: number) => (x < 0 || y < 0 ? null : {
      lngLat: { lng: 11, lat: 47 }, elevation: 1234.6, slope: 31.26, aspect: 212.4, curvature: 0, normal: [0, 0, 1],
    })),
    getExaggeration: () => 1.3,
    getSunAzimuth: () => 315,
    getSunAltitude: () => 45,
    getWireframe: () => false,
    getWireframeWhite: () => false,
    addAnalysisLayer: vi.fn(() => ({ id: 'analysis-9', layerName: 'Slope' })),
    removeAnalysisLayer: vi.fn(),
    activateDrapeLayer: vi.fn(),
    deactivateDrapeLayer: vi.fn(),
    setActiveBaseLayer: vi.fn(),
    setLayerVisible: vi.fn(),
    setLayerOpacity: vi.fn(),
    setLayerBlendMode: vi.fn(),
    moveLayer: vi.fn(),
    setAnalysisParams: vi.fn(),
    setAnalysisRamp: vi.fn(),
    setExaggeration: vi.fn(),
    setSunAzimuth: vi.fn(),
    setSunAltitude: vi.fn(),
    setWireframe: vi.fn(),
    setWireframeWhite: vi.fn(),
    getAnalysisValue: vi.fn(() => null),
    getTool: () => ({ mode: null, drawing: false, result: null }),
    isPicking: () => false,
    showProfile: vi.fn(),
  };
  return map;
}

type FakeMap = ReturnType<typeof fakeMap>;
const asMap = (map: FakeMap) => map as unknown as Treelet;
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true }));
const click = (root: ParentNode, selector: string) => {
  const el = root.querySelector(selector) as HTMLElement | null;
  expect(el, selector).not.toBeNull();
  el!.click();
};

/** Set a scrub row to `value` with a mouse press at that place in the row. */
function scrubTo(el: HTMLElement, value: number): void {
  const min = Number(el.dataset.min);
  const max = Number(el.dataset.max);
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 24, width: 1000, height: 24, x: 0, y: 0, toJSON: () => ({}) });
  const clientX = ((value - min) / (max - min)) * 1000;
  el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', pointerId: 1, clientX, bubbles: true, composed: true }));
  el.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', pointerId: 1, clientX, bubbles: true, composed: true }));
}

function mountPanel(map = fakeMap()) {
  const panel = document.createElement('treelet-panel') as TreeletPanel;
  document.body.appendChild(panel);
  panel.attach(asMap(map));
  return { map, panel, proot: panel.shadowRoot! };
}

function mountHub(map = fakeMap(), options: { tools?: boolean; glass?: boolean } = {}) {
  const hub = document.createElement('treelet-hub') as TreeletHub;
  document.body.appendChild(hub);
  hub.attach(asMap(map), { corner: 'bottom-right', ...options });
  const root = hub.shadowRoot!;
  const panel = root.querySelector('treelet-panel') as TreeletPanel;
  return { map, hub, root, panel, proot: panel.shadowRoot! };
}

function mountInfo(map = fakeMap(), options: { readout?: boolean } = {}) {
  const info = document.createElement('treelet-info') as TreeletInfo;
  document.body.appendChild(info);
  info.attach(asMap(map), { corner: 'bottom-left', ...options });
  return { map, info, root: info.shadowRoot! };
}

/** Open a coat's page in a mounted panel. */
function openCoat(proot: ShadowRoot, id: string): void {
  click(proot, `[data-view="coat"][data-layer-id="${id}"]`);
}

beforeAll(() => { defineTreeletElements(); registerBuiltinAnalyses(); });
afterEach(() => { document.body.innerHTML = ''; });

describe('layer panel', () => {
  it('lists the coats top first, then Add layer, and the terrain', () => {
    const { proot } = mountPanel();
    expect([...proot.querySelectorAll('.grp .t')].map((g) => g.textContent)).toEqual(['Overlay', 'Terrain']);
    expect([...proot.querySelectorAll('[data-view="coat"] .t')].map((n) => n.textContent)).toEqual(['Elevation', 'Hillshade']);
    expect(proot.querySelector('[data-view="add"]')!.textContent).toContain('Add layer');
    // One base layer: a plain Source row
    const source = [...proot.querySelectorAll('.row.fill')].find((r) => r.textContent!.includes('Source'))!;
    expect(source.tagName).toBe('DIV');
    expect(source.querySelector('.v')!.textContent).toBe('Base 0');
    expect(proot.querySelector('[data-action="exaggeration"] .v')!.textContent).toBe('1.3×');
    expect(proot.querySelector('[data-view="light"] .v')!.textContent).toBe('Manual · 315° · 45°');
    expect(proot.querySelector('[data-action="wireframe"][data-value="solid"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('offers the other base layers on the Source page', () => {
    const { map, proot } = mountPanel(fakeMap({ baseLayers: 2 }));
    click(proot, '[data-view="source"]');
    const rows = [...proot.querySelectorAll('[data-action="base"]')];
    expect(rows.map((r) => r.textContent!.trim())).toEqual(['Base 0', 'Base 1']);
    expect(rows[0].classList.contains('sel')).toBe(true);
    (rows[1] as HTMLElement).click();
    expect(map.setActiveBaseLayer).toHaveBeenCalledWith('base-1');
    expect(proot.querySelector('[data-view="source"]')).not.toBeNull(); // back on the layers
  });

  it('Add layer lists the analysis kinds and the imagery not shown', () => {
    const { map, proot } = mountPanel();
    click(proot, '[data-view="add"]');
    expect([...proot.querySelectorAll('.grp .t')].map((g) => g.textContent)).toEqual(['Analysis', 'Imagery']);
    const kinds = [...proot.querySelectorAll('[data-action="add"]')].map((e) => (e as HTMLElement).dataset.kind);
    const computable = new Set(map.getRegionAnalyses());
    expect(kinds).toEqual(listAnalyses().filter((d) => !d.raster || computable.has(d.id)).map((d) => d.id));
    expect(kinds).toContain('sunhours');
    expect(kinds).not.toContain('raster');
    expect(kinds).not.toContain('image');
    click(proot, '[data-action="drape"][data-layer-id="osm"]');
    expect(map.activateDrapeLayer).toHaveBeenCalledWith('osm');
    expect(proot.querySelector('[data-view="add"]')).not.toBeNull();
  });

  it('adding an analysis opens its page', () => {
    const map = fakeMap({ stack: [] });
    const stack = map.getLayerStack() as unknown[];
    map.addAnalysisLayer.mockImplementation(() => {
      stack.push(fakeAnalysis('analysis-9', 'slope'));
      map.emit('layerchange'); // the map re-renders the panel before returning the handle
      return { id: 'analysis-9', layerName: 'Slope' };
    });
    const { proot } = mountPanel(map);
    click(proot, '[data-view="add"]');
    click(proot, '[data-action="add"][data-kind="slope"]');
    expect(map.addAnalysisLayer).toHaveBeenCalledWith({ analysis: 'slope' });
    expect(proot.querySelector('.row.back .t')!.textContent).toBe('Slope');
    expect(proot.querySelector('[data-action="opacity"]')).not.toBeNull();
  });

  it('a sub-page goes back with its back row or Escape, focus on the row that opened it', () => {
    const { proot } = mountPanel();
    openCoat(proot, 'analysis-1');
    expect(proot.activeElement).toBe(proot.querySelector('.row.back'));
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true });
    proot.querySelector('.row.back')!.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true); // the dock leaves the column open
    expect(proot.querySelector('.row.back')).toBeNull();
    expect(proot.activeElement).toBe(proot.querySelector('[data-view="coat"][data-layer-id="analysis-1"]'));
    click(proot, '[data-view="light"]');
    click(proot, '.row.back');
    expect(proot.activeElement).toBe(proot.querySelector('[data-view="light"]'));
    // Escape on the layers is the dock's
    const esc2 = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true });
    proot.querySelector('[data-view="light"]')!.dispatchEvent(esc2);
    expect(esc2.defaultPrevented).toBe(false);
  });

  it('visibility, order and removal go to the map', () => {
    const { map, proot } = mountPanel();
    click(proot, '[data-layer-id="analysis-1"] [data-action="visible"]');
    expect(map.setLayerVisible).toHaveBeenCalledWith('analysis-1', false);
    openCoat(proot, 'analysis-0');
    click(proot, '[data-action="up"]');
    expect(map.moveLayer).toHaveBeenCalledWith('analysis-0', 1);
    expect((proot.querySelector('[data-action="down"]') as HTMLButtonElement).disabled).toBe(true);
    click(proot, '.row.back');
    openCoat(proot, 'analysis-1');
    expect((proot.querySelector('[data-action="up"]') as HTMLButtonElement).disabled).toBe(true);
    click(proot, '[data-action="remove"]');
    expect(map.removeAnalysisLayer).toHaveBeenCalledWith('analysis-1');
    expect(proot.querySelector('.row.back')).toBeNull();
  });

  it('coat settings render from the schema and send parameters', () => {
    const stack = [fakeAnalysis('analysis-2', 'contours', { params: { interval: 100, thickness: 1.5, index: 0, color: [0, 0, 0] } })];
    const { map, proot } = mountPanel(fakeMap({ stack }));
    openCoat(proot, 'analysis-2');

    scrubTo(proot.querySelector('[data-action="opacity"]') as HTMLElement, 0.4);
    expect(map.setLayerOpacity).toHaveBeenCalledWith('analysis-2', 0.4);
    expect(proot.querySelector('[data-action="opacity"] .v')!.textContent).toBe('40%');

    scrubTo(proot.querySelector('[data-param="interval"]') as HTMLElement, 50);
    expect(map.setAnalysisParams).toHaveBeenCalledWith('analysis-2', { interval: 50 });

    click(proot, '[data-action="select"][data-value="5"]');
    expect(map.setAnalysisParams).toHaveBeenCalledWith('analysis-2', { index: '5' });
    click(proot, '[data-action="color"][title="red"]');
    expect(map.setAnalysisParams).toHaveBeenCalledWith('analysis-2', { color: [0.8, 0.15, 0.1] });
    click(proot, '[data-action="blend"][data-value="multiply"]');
    expect(map.setLayerBlendMode).toHaveBeenCalledWith('analysis-2', 'multiply');
    expect(proot.querySelector('[data-action="ramp"]')).toBeNull(); // contours have no ramp
  });

  it('an elevation span offers Auto / Manual', () => {
    const { map, proot } = mountPanel();
    openCoat(proot, 'analysis-1');
    expect(proot.querySelectorAll('.scrub[data-param="range"]')).toHaveLength(2);
    click(proot, '[data-action="auto"][data-value="true"]');
    expect(map.setAnalysisParams).toHaveBeenCalledWith('analysis-1', { range: 'auto' });
  });

  it('keeps keyboard focus on the same control across a re-render', () => {
    const { map, proot } = mountPanel();
    openCoat(proot, 'analysis-1');
    const viridis = proot.querySelector('[data-action="ramp"][data-value="viridis"]') as HTMLElement;
    viridis.focus();
    viridis.click();
    expect(map.setAnalysisRamp).toHaveBeenCalledWith('analysis-1', 'viridis');
    map.emit('layerchange');
    const after = proot.querySelector('[data-action="ramp"][data-value="viridis"]');
    expect(after).not.toBe(viridis);
    expect(proot.activeElement).toBe(after);
  });

  it('a coat removed elsewhere returns the panel to the layers', () => {
    const map = fakeMap();
    const { proot } = mountPanel(map);
    openCoat(proot, 'analysis-1');
    (map.getLayerStack() as unknown[]).pop();
    map.emit('layerchange');
    expect(proot.querySelector('.row.back')).toBeNull();
  });
});

describe('scrub rows', () => {
  it('keys step, page and jump within the range', () => {
    const { map, proot } = mountPanel();
    const exag = proot.querySelector('[data-action="exaggeration"]') as HTMLElement;
    expect(exag.getAttribute('role')).toBe('slider');
    key(exag, 'ArrowRight');
    expect(map.setExaggeration).toHaveBeenLastCalledWith(1.4);
    key(exag, 'PageDown');
    expect(map.setExaggeration).toHaveBeenLastCalledWith(0.5); // ten steps down from 1.4, clamped at the minimum
    key(exag, 'End');
    expect(map.setExaggeration).toHaveBeenLastCalledWith(5);
    expect(exag.getAttribute('aria-valuenow')).toBe('5');
    expect(exag.querySelector('.v')!.textContent).toBe('5.0×');
  });

  it('on touch, a vertical drag scrolls, a sideways drag scrubs, a tap sets', () => {
    const { map, proot } = mountPanel();
    const exag = proot.querySelector('[data-action="exaggeration"]') as HTMLElement;
    exag.getBoundingClientRect = () => ({ left: 0, top: 0, right: 450, bottom: 24, width: 450, height: 24, x: 0, y: 0, toJSON: () => ({}) });
    const touch = (type: string, x: number, y: number) =>
      exag.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: 7, clientX: x, clientY: y, bubbles: true, composed: true }));
    touch('pointerdown', 100, 10);
    touch('pointermove', 102, 40); // a scroll
    touch('pointermove', 300, 40);
    touch('pointerup', 300, 40);
    expect(map.setExaggeration).not.toHaveBeenCalled();
    touch('pointerdown', 100, 10);
    touch('pointermove', 200, 12); // sideways: scrubs to 0.5 + 200/450 × 4.5 = 2.5
    expect(map.setExaggeration).toHaveBeenLastCalledWith(2.5);
    touch('pointerup', 200, 12);
    touch('pointerdown', 45, 10);
    touch('pointerup', 46, 10); // a tap: 0.5 + 46/450 × 4.5 = 0.96 → 1.0
    expect(map.setExaggeration).toHaveBeenLastCalledWith(1);
  });

  it("survives its own change (its 'layerupdate' doesn't re-render the panel)", () => {
    const map = fakeMap({ stack: [fakeAnalysis('analysis-1', 'elevation')] });
    map.setLayerOpacity.mockImplementation((id: string) => map.emit('layerupdate', { id }));
    const { proot } = mountPanel(map);
    openCoat(proot, 'analysis-1');
    const opacity = proot.querySelector('[data-action="opacity"]') as HTMLElement;
    scrubTo(opacity, 0.4);
    expect(map.setLayerOpacity).toHaveBeenCalledWith('analysis-1', 0.4);
    expect(opacity.isConnected).toBe(true);
  });

  it('a change from elsewhere (an animation) shows on the next frame', async () => {
    const layer = fakeAnalysis('analysis-1', 'water', { params: { level: 1000, depthFade: 100, shoreline: 2, color: [0, 0, 1] } });
    const map = fakeMap({ stack: [layer] });
    const { proot } = mountPanel(map);
    openCoat(proot, 'analysis-1');
    (layer.params as { level: number }).level = 1500;
    map.emit('layerupdate', { id: 'analysis-1' });
    await frame();
    expect((proot.querySelector('[data-param="level"]') as HTMLElement).dataset.value).toBe('1500');
  });

  it("a custom analysis' parameter named like a panel control (azimuth) goes to the layer", () => {
    registerAnalysis({
      id: 'review_probe', label: 'Probe', glsl: 'vec4 analysis_review_probe(Surface s, vec4 p0, vec4 p1) { return vec4(p0.x); }',
      params: [{ key: 'azimuth', label: 'Azimuth', type: 'range', min: 0, max: 360, step: 1 }],
      defaults: { azimuth: 90 }, pack: (p: { azimuth: number }) => ({ p0: [p.azimuth, 0, 0, 0], p1: [0, 0, 0, 0] }),
    });
    const map = fakeMap({ stack: [fakeAnalysis('analysis-3', 'review_probe')] });
    const { proot } = mountPanel(map);
    openCoat(proot, 'analysis-3');
    scrubTo(proot.querySelector('[data-action="param"][data-param="azimuth"]') as HTMLElement, 200);
    expect(map.setAnalysisParams).toHaveBeenCalledWith('analysis-3', { azimuth: 200 });
    expect(map.setSunAzimuth).not.toHaveBeenCalled();
  });

  it('a value set from code outside the range widens the scrub', () => {
    const map = fakeMap({ stack: [fakeAnalysis('analysis-4', 'contours', { params: { interval: 5, thickness: 1.5, index: 0, color: [0, 0, 0] } })] });
    const { proot } = mountPanel(map);
    openCoat(proot, 'analysis-4');
    expect(Number((proot.querySelector('[data-param="interval"]') as HTMLElement).dataset.min)).toBeLessThanOrEqual(5);
  });
});

describe('coat settings from the schema', () => {
  it('an optional wrapping span offers All / Sector and from → to scrubs', () => {
    const { map, proot } = mountPanel(fakeMap({ stack: [fakeAnalysis('analysis-5', 'slope')] }));
    openCoat(proot, 'analysis-5');
    expect(proot.querySelector('[data-action="optional"][data-value="false"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(proot.querySelector('[data-param="aspectMask"].scrub')).toBeNull();
    click(proot, '[data-action="optional"][data-value="true"]');
    expect(map.setAnalysisParams).toHaveBeenCalledWith('analysis-5', { aspectMask: [315, 45] });

    const { proot: open } = mountPanel(fakeMap({ stack: [fakeAnalysis('analysis-6', 'slope', { params: { range: [0, 60], aspectMask: [315, 45] } })] }));
    openCoat(open, 'analysis-6');
    const ends = open.querySelectorAll<HTMLElement>('.scrub[data-param="aspectMask"]');
    expect(ends).toHaveLength(2);
    expect(ends[0].dataset.wrap).toBe('');
    expect([...ends].map((e) => e.textContent)).toEqual(['From315°', 'To45°']);
  });

  it('a from → to sector keeps its ends as set (through north)', () => {
    const { map, proot } = mountPanel(fakeMap({ stack: [fakeAnalysis('analysis-7', 'slope', { params: { range: [0, 60], aspectMask: [315, 45] } })] }));
    openCoat(proot, 'analysis-7');
    scrubTo(proot.querySelectorAll<HTMLElement>('.scrub[data-param="aspectMask"]')[1], 90);
    expect(map.setAnalysisParams).toHaveBeenLastCalledWith('analysis-7', { aspectMask: [315, 90] });
  });

  it('a low / high span keeps its order: crossing moves the other end', () => {
    const map = fakeMap({ stack: [fakeAnalysis('analysis-8', 'slope', { params: { range: [10, 40], aspectMask: null } })] });
    const { proot } = mountPanel(map);
    openCoat(proot, 'analysis-8');
    const [lo, hi] = proot.querySelectorAll<HTMLElement>('.scrub[data-param="range"]');
    scrubTo(lo, 50);
    const [a, b] = (map.setAnalysisParams.mock.calls.at(-1)![1] as { range: [number, number] }).range;
    expect(a).toBe(50);
    expect(b).toBeGreaterThan(a);
    expect(Number(hi.dataset.value)).toBe(b);
  });

  it('the water level scrub spans the visible elevation range', () => {
    const { proot } = mountPanel(fakeMap({ stack: [fakeAnalysis('analysis-8', 'water', { params: { level: 1300, color: [0.14, 0.44, 0.7], depthFade: 100, shoreline: 2 } })] }));
    openCoat(proot, 'analysis-8');
    const level = proot.querySelector<HTMLElement>('.scrub[data-param="level"]')!;
    expect([level.dataset.min, level.dataset.max, level.dataset.value]).toEqual(['800', '2600', '1300']);
  });

  it('lists class presets only for their analysis', () => {
    const { proot } = mountPanel(fakeMap({ stack: [fakeAnalysis('analysis-9', 'slope')] }));
    openCoat(proot, 'analysis-9');
    const names = [...proot.querySelectorAll('[data-action="ramp"]')].map((b) => b.getAttribute('data-value'));
    expect(names).toContain('avalanche');
    expect(names).not.toContain('aspect8');
    const { proot: elev } = mountPanel(fakeMap({ stack: [fakeAnalysis('analysis-10', 'elevation')] }));
    openCoat(elev, 'analysis-10');
    expect([...elev.querySelectorAll('[data-action="ramp"]')].map((b) => b.getAttribute('data-value'))).not.toContain('avalanche');
  });

  it('a raster range spanning the data gets scrubs over the data', () => {
    const { proot } = mountPanel(fakeMap({ stack: [fakeAnalysis('analysis-5', 'raster', { params: { range: [1, 6] } })] }));
    openCoat(proot, 'analysis-5');
    const [lo, hi] = proot.querySelectorAll<HTMLElement>('.scrub[data-param="range"]');
    expect([lo.dataset.min, lo.dataset.max, lo.dataset.step, lo.dataset.value, hi.dataset.value]).toEqual(['0.2', '7.9', '0.05', '1', '6']);
  });
});

describe('region analyses in the panel', () => {
  it('a raster kind runs over the view, replacing an earlier result of that kind', () => {
    const map = fakeMap({ stack: [fakeAnalysis('analysis-0', 'hillshade'), fakeAnalysis('analysis-4', 'skyview')] });
    const { proot } = mountPanel(map);
    click(proot, '[data-view="add"]');
    click(proot, '[data-action="add"][data-kind="skyview"]');
    expect(map.addAnalysisLayer).not.toHaveBeenCalled();
    expect(map.computeAnalysis).toHaveBeenCalledWith('skyview', { replaceLayer: 'analysis-4' });
    expect(proot.querySelector('.row.back')).toBeNull();
  });

  it('the viewshed asks for the observer first, then computes from it', async () => {
    const map = fakeMap();
    const { proot } = mountPanel(map);
    click(proot, '[data-view="add"]');
    click(proot, '[data-action="add"][data-kind="viewshed"]');
    expect(map.pickLocation).toHaveBeenCalledWith({ prompt: 'Click the terrain to place the observer' });
    await Promise.resolve();
    await Promise.resolve();
    expect(map.computeAnalysis).toHaveBeenCalledWith('viewshed', { observer: { lng: 11.4, lat: 47.3 }, replaceLayer: undefined });
  });
});

describe('jobs in the panel', () => {
  it('shows running jobs with progress, updates them in place and cancels them', () => {
    const jobs = [{ id: 'job-1', kind: 'skyview', label: 'Sky view', stage: 'loading', progress: 0.25 }];
    const map = fakeMap();
    map.getAnalysisJobs.mockImplementation(() => jobs);
    const { proot } = mountPanel(map);
    const row = proot.querySelector('[data-job="job-1"]')!;
    expect(row.querySelector('.v')!.textContent).toBe('Loading 25%');
    map.emit('analysisprogress', { id: 'job-1', stage: 'computing', progress: 0.6 });
    expect(proot.querySelector('[data-job="job-1"]')).toBe(row); // same element: clicks keep working
    expect(row.querySelector('.v')!.textContent).toBe('Computing 60%');
    expect((row.querySelector('.fl') as HTMLElement).style.width).toBe('60%');
    (row.querySelector('[data-job-cancel]') as HTMLElement).click();
    expect(map.cancelAnalysis).toHaveBeenCalledWith('job-1');
    jobs.length = 0;
    map.emit('analysisend', { id: 'job-1', label: 'Sky view', status: 'cancelled' });
    expect(proot.querySelector('[data-job]')).toBeNull();
  });

  it('shows a pick prompt and a failed job until dismissed, across page changes', () => {
    const map = fakeMap();
    const { proot } = mountPanel(map);
    map.emit('pickstart', { prompt: 'Click the terrain to place the observer' });
    expect(proot.querySelector('[data-job="pick"]')!.textContent).toContain('Click the terrain to place the observer');
    click(proot, '[data-job-cancel="pick"]');
    expect(map.cancelPick).toHaveBeenCalled();
    map.emit('pickend');
    map.emit('analysisend', { id: 'job-2', label: 'Viewshed', status: 'error', error: 'no elevation data at the viewshed observer' });
    click(proot, '[data-view="light"]');
    expect(proot.querySelector('[data-job="job-2"]')).toBeNull(); // only on the layers
    click(proot, '.row.back');
    const err = proot.querySelector('[data-job="job-2"]')!;
    expect(err.querySelector('.err')!.textContent).toBe('no elevation data at the viewshed observer');
    (err.querySelector('[data-job-cancel]') as HTMLElement).click();
    expect(proot.querySelector('[data-job]')).toBeNull();
  });
});

describe('sun time on the light page', () => {
  it('switches to a date and time and back to the manual sun', () => {
    const map = fakeMap();
    const { proot } = mountPanel(map);
    click(proot, '[data-view="light"]');
    expect(proot.querySelector('.scrub[data-action="azimuth"]')).not.toBeNull();
    click(proot, '[data-action="suntime"][data-value="date"]');
    expect(map.setSunTime).toHaveBeenCalledWith(expect.any(Date));
    expect(proot.querySelector('.scrub[data-action="azimuth"]')).toBeNull();
    expect(proot.querySelector<HTMLInputElement>('input[data-action="sunday"]')!.type).toBe('date');
    expect(proot.querySelector('.scrub[data-action="sunhour"]')).not.toBeNull();
    click(proot, '[data-action="suntime"][data-value="manual"]');
    expect(map.setSunTime).toHaveBeenLastCalledWith(null);
  });

  it('the day and the time set the sun time, within the day', () => {
    const map = fakeMap();
    map.sunTime = new Date(2024, 11, 21, 9, 0);
    const { proot } = mountPanel(map);
    expect(proot.querySelector('[data-view="light"] .v')!.textContent).toBe('21 Dec · 9:00');
    click(proot, '[data-view="light"]');
    const hour = proot.querySelector<HTMLElement>('.scrub[data-action="sunhour"]')!;
    expect([hour.dataset.value, hour.dataset.max]).toEqual(['9', '23.75']);
    scrubTo(hour, 14.5);
    let set = map.setSunTime.mock.calls.at(-1)![0] as Date;
    expect([set.getFullYear(), set.getMonth(), set.getDate(), set.getHours(), set.getMinutes()]).toEqual([2024, 11, 21, 14, 30]);
    expect(hour.querySelector('.v')!.textContent).toBe('14:30');
    key(hour, 'End');
    set = map.setSunTime.mock.calls.at(-1)![0] as Date;
    expect([set.getDate(), set.getHours(), set.getMinutes()]).toEqual([21, 23, 45]);
    const day = proot.querySelector<HTMLInputElement>('input[data-action="sunday"]')!;
    day.value = '2025-06-21';
    day.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    const d = map.setSunTime.mock.calls.at(-1)![0] as Date;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2025, 5, 21, 23, 45]);
  });
});

describe('hub', () => {
  it('opens from its box into the column on the Layers page; the rail switches and closes', () => {
    const { hub, root } = mountHub();
    const box = root.querySelector('.box') as HTMLElement;
    const pane = root.querySelector('.pane') as HTMLElement;
    expect(pane.hidden).toBe(true);
    expect(box.getAttribute('aria-expanded')).toBe('false');
    const opened = vi.fn();
    hub.addEventListener('open', opened);
    box.click();
    expect(hub.isOpen).toBe(true);
    expect(hub.hasAttribute('open')).toBe(true);
    expect(pane.hidden).toBe(false);
    expect(opened).toHaveBeenCalledTimes(1);
    // The rail: the tree first (closes), then the pages, Layers by the corner
    const rail = [...root.querySelectorAll('.rail .rb')].map((b) => b.getAttribute('aria-label'));
    expect(rail).toEqual(['Close layers and measuring', 'Measure', 'Layers']);
    expect(hub.page).toBe('layers');
    expect((root.querySelector('#page-layers') as HTMLElement).hidden).toBe(false);
    click(root, '#tab-measure');
    expect(hub.page).toBe('measure');
    expect(root.querySelector('#tab-measure')!.getAttribute('aria-selected')).toBe('true');
    expect((root.querySelector('#page-layers') as HTMLElement).hidden).toBe(true);
    expect(root.querySelector('#page-measure treelet-toolbar')).not.toBeNull();
    click(root, '.rb.home');
    expect(hub.isOpen).toBe(false);
    expect(pane.hidden).toBe(true);
  });

  it('Escape closes the column (after the panel stepped back) and returns focus to the box', () => {
    const { hub, root, proot } = mountHub();
    hub.open('layers');
    openCoat(proot, 'analysis-1');
    const back = proot.querySelector('.row.back')!;
    key(back, 'Escape');
    expect(hub.isOpen).toBe(true);
    key(proot.querySelector('[data-view="add"]')!, 'Escape');
    expect(hub.isOpen).toBe(false);
    expect(root.activeElement).toBe(root.querySelector('.box'));
  });

  it('closing returns the panel to the layers', () => {
    const { hub, proot } = mountHub();
    hub.open();
    click(proot, '[data-view="light"]');
    hub.close();
    expect(proot.querySelector('.row.back')).toBeNull();
  });

  it('without tools it has only the Layers page', () => {
    const { hub, root } = mountHub(fakeMap(), { tools: false });
    hub.open('measure');
    expect(hub.hasTools).toBe(false);
    expect(root.querySelectorAll('.rail .rb')).toHaveLength(1);
    expect(root.querySelector('#page-measure')).toBeNull();
  });

  it('shows running jobs on the box at rest', () => {
    const map = fakeMap();
    const jobs = [{ id: 'job-1', label: 'Sky view', stage: 'computing', progress: 0.5 }];
    map.getAnalysisJobs.mockImplementation(() => jobs);
    const { root } = mountHub(map);
    const line = root.querySelector('.jobline') as HTMLElement;
    expect(line.hidden).toBe(false);
    expect((line.firstElementChild as HTMLElement).style.width).toBe('50%');
    jobs.length = 0;
    map.emit('analysisend', { id: 'job-1', label: 'Sky view', status: 'done' });
    expect(line.hidden).toBe(true);
  });

  it('a profile opens the Measure page with the chart', () => {
    const { hub, root } = mountHub();
    const onHover = vi.fn();
    const onClose = vi.fn();
    const points = Array.from({ length: 20 }, (_, i) => ({ distance: i * 100, elevation: 1000 + i, lngLat: { lng: 11, lat: 47 } }));
    expect(hub.showProfile({ title: 'Elevation profile', points, stats: [['Length', '1.90 km']] }, { onHover, onClose })).toBe(true);
    expect(hub.isOpen).toBe(true);
    expect(hub.page).toBe('measure');
    const profile = root.querySelector('treelet-profile')!;
    expect(profile.hasAttribute('embedded')).toBe(true);
    expect(profile.shadowRoot!.querySelector('.title')!.textContent).toBe('Elevation profile');
    (profile.shadowRoot!.querySelector('[data-action="close"]') as HTMLElement).click();
    expect(onClose).toHaveBeenCalled();
  });

  it('marks the host for the glass style only when asked', () => {
    expect(mountHub().hub.hasAttribute('glass')).toBe(false);
    expect(mountHub(fakeMap(), { glass: true }).hub.hasAttribute('glass')).toBe(true);
  });
});

describe('info box', () => {
  it('opens on the Legend page with the legend, the readout and the credits', () => {
    const map = fakeMap({ legends: [{ id: 'a', title: 'Elevation', unit: 'm', type: 'continuous', domain: [0, 4000], stops: [[0, [0, 0, 0]], [1, [1, 1, 1]]] }] });
    const { info, root } = mountInfo(map);
    info.open();
    expect(info.page).toBe('legend');
    const rail = [...root.querySelectorAll('.rail .rb')].map((b) => b.getAttribute('aria-label'));
    expect(rail).toEqual(['Close legend and map', 'Map', 'Legend']);
    const page = root.querySelector('#page-legend')!;
    expect(page.querySelector('treelet-legend')).not.toBeNull();
    expect(page.querySelector('treelet-readout')).not.toBeNull();
    expect(root.querySelector('.foot treelet-attribution')!.shadowRoot!.textContent).toContain('© Base');
  });

  it('samples the terrain only while the Legend page is shown', () => {
    const { info, root } = mountInfo();
    const readout = root.querySelector('treelet-readout') as TreeletReadout;
    expect(readout.active).toBe(false);
    info.open('legend');
    expect(readout.active).toBe(true);
    info.open('map');
    expect(readout.active).toBe(false);
    info.close();
    expect(readout.active).toBe(false);
    expect(mountInfo(fakeMap(), { readout: false }).root.querySelector('treelet-readout')).toBeNull();
  });

  it('the Map page shows the view and copies the center and extent', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { info, root } = mountInfo();
    info.updateCamera({ zoom: 11.42, pitch: 48, rotation: -28, distance: 1 });
    info.updateTileCount(84);
    const stat = (k: string) => root.querySelector(`[data-stat="${k}"]`)!.textContent;
    expect(stat('zoom')).toBe('–'); // not shown yet
    info.open('map');
    expect([stat('zoom'), stat('tiles'), stat('pitch'), stat('bearing'), stat('center')])
      .toEqual(['11.4', '84', '42.0°', '332.0°', '11.390, 47.270']);
    info.updateTileCount(90);
    expect(stat('tiles')).toBe('90');
    click(root, '[data-copy="center-4326"]');
    expect(writeText).toHaveBeenLastCalledWith('[11.39,47.27]');
    click(root, '[data-copy="extent-4326"]');
    expect(writeText).toHaveBeenLastCalledWith('[[10,46],[12,48]]');
    click(root, '[data-copy="center-3857"]');
    expect(JSON.parse((writeText.mock.calls.at(-1) as unknown as [string])[0])).toHaveLength(2);
  });
});

describe('compass', () => {
  function mountCompass(options: { navigation?: boolean; glass?: boolean } = {}) {
    const map = fakeMap();
    const compass = document.createElement('treelet-compass') as TreeletCompass;
    document.body.appendChild(compass);
    compass.attach(asMap(map), { compassPosition: 'top-right', ...options });
    return { map, compass, root: compass.shadowRoot! };
  }

  it('a click resets the orientation; the arrow follows the camera', () => {
    const { map, compass, root } = mountCompass();
    click(root, '[data-nav="reset"]');
    expect(map.camera.resetOrientation).toHaveBeenCalledTimes(1);
    compass.updateCamera({ zoom: 10, pitch: 40, rotation: 90, distance: 1 });
    expect((root.querySelector('.arrow svg') as SVGElement).style.transform).toBe('rotateX(40deg) rotateZ(90deg)');
    expect([compass.dataset.v, compass.dataset.h]).toEqual(['top', 'right']);
  });

  it('the wings zoom, rotate and tilt', () => {
    const { map, compass, root } = mountCompass();
    expect(compass.hasAttribute('navigation')).toBe(true);
    click(root, '[data-nav="zoom-in"]');
    expect(map.camera.setZoomLevel).toHaveBeenLastCalledWith(11);
    click(root, '[data-nav="zoom-out"]');
    expect(map.camera.setZoomLevel).toHaveBeenLastCalledWith(9);
    click(root, '[data-nav="rotate-left"]');
    expect(map.camera.setAzimuth).toHaveBeenLastCalledWith(5);
    click(root, '[data-nav="rotate-right"]');
    expect(map.camera.setAzimuth).toHaveBeenLastCalledWith(35);
    click(root, '[data-nav="tilt-up"]');
    expect(map.camera.setPitch).toHaveBeenLastCalledWith(25);
    click(root, '[data-nav="tilt-down"]');
    expect(map.camera.setPitch).toHaveBeenLastCalledWith(35);
  });

  it('wings and glass only when asked', () => {
    const plain = mountCompass({ navigation: false }).compass;
    expect(plain.hasAttribute('navigation')).toBe(false);
    expect(plain.hasAttribute('glass')).toBe(false);
    expect(mountCompass({ glass: true }).compass.hasAttribute('glass')).toBe(true);
  });
});

describe('legend', () => {
  function mountLegend(legends: unknown[]) {
    const map = fakeMap({ legends });
    const el = document.createElement('treelet-legend') as TreeletLegend;
    document.body.appendChild(el);
    el.attach(asMap(map), { glass: true });
    return { map, el, root: el.shadowRoot! };
  }

  it('renders bars with their range and classes highest first', () => {
    const { el, root } = mountLegend([
      { id: 'a', title: 'Elevation', unit: 'm', type: 'continuous', domain: [100, 3000], stops: [[0, [0, 0, 0]], [1, [1, 1, 1]]] },
      { id: 'b', title: 'Slope', type: 'classes', domain: [0, 60], classes: [{ color: [1, 0, 0], label: '< 30°' }, { color: [0, 0, 1], label: '≥ 30°' }] },
    ]);
    expect(el.hasAttribute('glass')).toBe(true);
    expect([...root.querySelectorAll('.grp .t')].map((t) => t.textContent)).toEqual(['Elevation · m', 'Slope']);
    expect(root.querySelector('.rng')!.textContent).toBe('1003000');
    expect([...root.querySelectorAll('.row .t')].map((s) => s.textContent)).toEqual(['≥ 30°', '< 30°']);
  });

  it('says so without legends, and follows layerchange and rangechange (once per frame)', async () => {
    const legends: unknown[] = [];
    const { map, root } = mountLegend(legends);
    expect(root.querySelector('.hint')!.textContent).toBe('No legend for the visible layers');
    legends.push({ id: 'a', title: 'Elevation', type: 'continuous', domain: [0, 1], stops: [[0, [0, 0, 0]]] });
    map.emit('rangechange');
    await frame();
    expect(root.querySelector('.hint')).toBeNull();
    expect(map.on).toHaveBeenCalledWith('layerchange', expect.any(Function));
  });
});

describe('readout', () => {
  function mountReadout() {
    const map = fakeMap();
    const el = document.createElement('treelet-readout') as TreeletReadout;
    document.body.appendChild(el);
    el.attach(asMap(map), { glass: true });
    const values = () => [...el.shadowRoot!.querySelectorAll('.row .v')].map((v) => v.textContent);
    const title = () => el.shadowRoot!.querySelector('.grp .t')!.textContent;
    return { map, el, values, title };
  }

  it('formats elevation, slope and aspect with a compass point', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(212)).toBe('SW');
    expect(compassPoint(359)).toBe('N');
    const rows = formatReadout({ lngLat: { lng: 0, lat: 0 }, elevation: 1234.6, slope: 31.26, aspect: 212.4, curvature: 0, normal: [0, 0, 1] });
    expect(rows.map((r) => r[1])).toEqual(['1 235 m', '31.3°', '212° SW']);
    expect(formatReadout({ lngLat: { lng: 0, lat: 0 }, elevation: 5, slope: 0, aspect: null, curvature: 0, normal: [0, 0, 1] })[2][1]).toBe('flat');
  });

  it('keeps its rows: dashes until a pick, the values, dashes again', () => {
    const { el, values, title } = mountReadout();
    expect(el.hasAttribute('glass')).toBe(true);
    expect(title()).toBe('Cursor');
    expect(values()).toEqual(['–', '–', '–']);
    el.showAt(10, 10);
    expect(values()).toEqual(['1 235 m', '31.3°', '212° SW']);
    el.showAt(-1, -1);
    expect(values()).toEqual(['–', '–', '–']);
  });

  it('a tap samples the terrain and pins it; a drag does not; nothing while not shown', () => {
    const { map, el, values, title } = mountReadout();
    const down = (x: number, y: number) => document.body.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y, bubbles: true }));
    const up = (x: number, y: number) => document.body.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y, bubbles: true }));
    down(20, 20); up(60, 20); // a drag
    expect(map.pick).not.toHaveBeenCalled();
    down(20, 20); up(22, 21); // a tap
    expect(map.pick).toHaveBeenCalledTimes(1);
    expect(title()).toBe('Tapped point');
    document.body.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse', bubbles: true }));
    expect(values()[0]).toBe('1 235 m'); // pinned by the tap
    el.active = false;
    document.body.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', bubbles: true }));
    expect(map.pick).toHaveBeenCalledTimes(1);
  });

  it('ignores pointers over the controls', async () => {
    const container = document.createElement('div');
    const canvas = document.createElement('canvas');
    const control = document.createElement('div');
    control.attachShadow({ mode: 'open' }).innerHTML = '<button>Zoom</button>';
    container.append(canvas, control);
    document.body.appendChild(container);
    const map = fakeMap();
    (map as { getContainer: () => HTMLElement }).getContainer = () => container;
    const readout = document.createElement('treelet-readout') as TreeletReadout;
    container.appendChild(readout);
    readout.attach(asMap(map));
    const values = () => [...readout.shadowRoot!.querySelectorAll('.row .v')].map((v) => v.textContent);
    control.shadowRoot!.querySelector('button')!.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', bubbles: true, composed: true }));
    await frame();
    expect(map.pick).not.toHaveBeenCalled();
    expect(values()[0]).toBe('–');
    canvas.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', bubbles: true, composed: true }));
    await frame();
    expect(map.pick).toHaveBeenCalled();
    expect(values()[0]).toBe('1 235 m');
  });
});

describe('page elements in the page', () => {
  it('legend and toolbar keep listening after the map container moves', () => {
    const map = fakeMap();
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.append(a, b);
    const legend = document.createElement('treelet-legend') as TreeletLegend;
    const toolbar = document.createElement('treelet-toolbar') as TreeletToolbar;
    a.append(legend, toolbar);
    legend.attach(asMap(map));
    toolbar.attach(asMap(map));
    const subscriptions = (event: string) => map.on.mock.calls.filter(([e]) => e === event).length;
    const before = [subscriptions('layerchange'), subscriptions('toolchange')];
    b.append(legend, toolbar); // disconnect + connect
    expect(map.off).toHaveBeenCalledWith('layerchange', expect.any(Function));
    expect([subscriptions('layerchange'), subscriptions('toolchange')]).toEqual([before[0] + 1, before[1] + 1]);
  });

  it('the credits name the base layer and visible overlays; on their own they are a corner tag', () => {
    const map = fakeMap();
    (map as { getOverlayLayers: () => unknown[] }).getOverlayLayers = () => [
      { visible: true, attribution: '© OpenStreetMap contributors' },
      { visible: false, attribution: 'hidden overlay' },
    ];
    const tag = document.createElement('treelet-attribution') as TreeletAttribution;
    document.body.appendChild(tag);
    tag.attach(asMap(map), 'right');
    const text = tag.shadowRoot!.textContent ?? '';
    expect(text).toContain('© Base · © OpenStreetMap contributors');
    expect(text).not.toContain('hidden overlay');
    expect(tag.dataset.side).toBe('right');
    tag.attach(asMap(map));
    expect(tag.dataset.side).toBeUndefined();
  });
});
