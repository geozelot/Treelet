// ============================================================================
// Tests for the compass and layer panel controls: opening and closing with
// the mouse, touch and keyboard, and what the panel renders.
// ============================================================================

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { defineTreeletElements } from '../../src/ui/elements';
import { registerBuiltinAnalyses } from '../../src/analysis/builtins';
import { getAnalysis } from '../../src/analysis/registry';
import type { TreeletCompass } from '../../src/ui/TreeletCompass';
import type { TreeletPanel } from '../../src/ui/TreeletPanel';
import type { TreeletLegend } from '../../src/ui/TreeletLegend';
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
    id: `base-${i}`, layerName: `Base ${i}`, visible: i === 0,
  }));
  const drapes = [{ id: 'osm', layerName: 'OpenStreetMap' }];
  const stack = opts.stack ?? [fakeAnalysis('analysis-0', 'hillshade'), fakeAnalysis('analysis-1', 'elevation')];
  const camera = {
    getState: () => ({ zoom: 10, pitch: 0, rotation: 0 }),
    resetOrientation: vi.fn(),
    setZoomLevel: vi.fn(),
    setAzimuth: vi.fn(),
    setPitch: vi.fn(),
  };
  const handlers = new Map<string, Array<() => void>>();
  const map = {
    camera,
    on: vi.fn((event: string, fn: () => void) => { handlers.set(event, [...(handlers.get(event) ?? []), fn]); }),
    off: vi.fn(),
    emit: (event: string) => handlers.get(event)?.forEach((fn) => fn()),
    getCameraController: () => camera,
    getCenter: () => ({ lng: 11, lat: 47 }),
    getBounds: () => ({ sw: { lng: 10, lat: 46 }, ne: { lng: 12, lat: 48 } }),
    getBaseLayers: () => baseLayers,
    getDrapeLayers: () => drapes,
    getLayerStack: () => stack,
    getActiveDrapeId: () => null,
    getLegend: () => ({ domain: [0, 4000] }),
    getLegends: () => opts.legends ?? [],
    getVisibleElevationRange: () => [800, 2600] as [number, number],
    getContainer: () => document.body,
    pick: vi.fn((x: number, y: number) => (x < 0 || y < 0 ? null : {
      lngLat: { lng: 11, lat: 47 }, elevation: 1234.6, slope: 31.26, aspect: 212.4, curvature: 0, normal: [0, 0, 1],
    })),
    getExaggeration: () => 1,
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
  };
  return map;
}

function pointer(el: Element, type: string, pointerType: 'mouse' | 'touch'): void {
  el.dispatchEvent(new PointerEvent(type, { pointerType, bubbles: true, composed: true }));
}

/** A tap or mouse click: pointerdown, then click (as browsers deliver them). */
function press(el: HTMLElement, pointerType: 'mouse' | 'touch'): void {
  pointer(el, 'pointerdown', pointerType);
  el.click();
}

function mount(map = fakeMap(), options = { compassPosition: 'top-right' as const, layerPosition: 'bottom-right' as const }) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const compass = document.createElement('treelet-compass') as TreeletCompass;
  container.appendChild(compass);
  compass.attach(map as unknown as Treelet, options);
  const root = compass.shadowRoot!;
  const panel = root.querySelector('treelet-panel') as TreeletPanel;
  return { map, compass, root, panel, proot: panel.shadowRoot! };
}

beforeAll(() => { defineTreeletElements(); registerBuiltinAnalyses(); });
afterEach(() => { document.body.innerHTML = ''; });

describe('layer panel', () => {
  it('renders a title with a single source as a plain label', () => {
    const { proot } = mount();
    const terrain = proot.querySelector('[data-col="terrain"] .layer-col-selector')!;
    expect(terrain.classList.contains('has-choices')).toBe(false);
    expect(terrain.querySelector('.layer-col-header')!.tagName).toBe('DIV');
    expect(terrain.querySelector('.header-chevron')).toBeNull();
  });

  it('offers other base layers when there are several', () => {
    const { proot } = mount(fakeMap({ baseLayers: 2 }));
    const terrain = proot.querySelector('.has-choices[data-col="terrain"]')!;
    expect(terrain.querySelector('.layer-btn')!.textContent).toBe('Base 1');
  });

  it('groups the overlay choices as Analysis (registered kinds) and Layers (inactive drapes)', () => {
    const { proot } = mount();
    const labels = [...proot.querySelectorAll('.dropdown-group-label')].map((l) => l.textContent);
    expect(labels).toEqual(['Analysis', 'Layers']);
    const kinds = [...proot.querySelectorAll('.layer-entry[data-layer-type="analysis"]')].map((e) => (e as HTMLElement).dataset.kind);
    expect(kinds).toEqual(['elevation', 'slope', 'aspect', 'contours', 'hillshade', 'curvature', 'water']);
    expect(proot.querySelector('[data-layer-type="drape"] .layer-btn')!.textContent).toBe('OpenStreetMap');
  });

  it('names the visible coats in the Overlay row, bottom first', () => {
    const { proot } = mount();
    expect(proot.querySelector('[data-col="overlay"] .active-name')!.textContent).toBe('Hillshade · Elevation');
  });

  it('opens a dropdown while the mouse is over it; mouse clicks do not pin it', () => {
    const { proot } = mount();
    const sel = proot.querySelector('.has-choices[data-col="overlay"]')!;
    const header = sel.querySelector('.layer-col-header') as HTMLElement;

    pointer(header, 'pointerover', 'mouse');
    expect(sel.classList.contains('open')).toBe(true);
    expect(header.getAttribute('aria-expanded')).toBe('true');

    press(header, 'mouse');
    expect(sel.classList.contains('open')).toBe(true);

    pointer(proot.querySelector('.active-row')!, 'pointerover', 'mouse');
    expect(sel.classList.contains('open')).toBe(false);
  });

  it('toggles a dropdown with taps and closes it on a tap elsewhere', () => {
    const { proot } = mount();
    const sel = proot.querySelector('.has-choices[data-col="overlay"]')!;
    const header = () => sel.querySelector('.layer-col-header') as HTMLElement;

    press(header(), 'touch');
    expect(sel.classList.contains('open')).toBe(true);
    press(header(), 'touch');
    expect(sel.classList.contains('open')).toBe(false);

    press(header(), 'touch');
    pointer(proot.querySelector('[data-col="terrain"] .active-row')!, 'pointerdown', 'touch');
    expect(sel.classList.contains('open')).toBe(false);
  });

  it('choosing an analysis adds a coat, closes the dropdown and opens the stack', () => {
    const { map, proot } = mount();
    press(proot.querySelector('[data-col="overlay"] .layer-col-header') as HTMLElement, 'touch');
    press(proot.querySelector('[data-kind="slope"] .layer-btn') as HTMLElement, 'touch');
    expect(map.addAnalysisLayer).toHaveBeenCalledWith({ analysis: 'slope' });
    expect(proot.querySelector('.has-choices.open')).toBeNull();
    map.emit('layerchange');
    expect(proot.querySelector('[data-col="overlay"] .active-row')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('choosing a drape activates it', () => {
    const { map, proot } = mount();
    press(proot.querySelector('[data-layer-type="drape"] .layer-btn') as HTMLElement, 'mouse');
    expect(map.activateDrapeLayer).toHaveBeenCalledWith('osm');
  });

  it('opens with Enter and closes with Escape, returning focus to the header', () => {
    const { proot } = mount();
    const header = proot.querySelector('[data-col="overlay"] .layer-col-header') as HTMLElement;
    header.focus();
    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    header.click();
    const sel = proot.querySelector('.has-choices[data-col="overlay"]')!;
    expect(sel.classList.contains('open')).toBe(true);

    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    expect(sel.classList.contains('open')).toBe(false);
    expect(proot.activeElement).toBe(header);
  });

  it('settings: the row is a toggle button and only fades in when opened', () => {
    const { map, panel, proot } = mount();
    const row = () => proot.querySelector('[data-col="overlay"] .active-row') as HTMLElement;
    expect(row().tagName).toBe('BUTTON');
    expect(row().getAttribute('aria-expanded')).toBe('false');

    press(row(), 'mouse');
    expect(row().getAttribute('aria-expanded')).toBe('true');
    const settings = () => proot.querySelector('[data-col="overlay"] .active-settings')!;
    expect(settings().classList.contains('entering')).toBe(true);

    // Stack rows, top first; expanding one shows its ramp list
    const names = [...proot.querySelectorAll('.stack-name')].map((b) => b.textContent);
    expect(names).toEqual(['Elevation', 'Hillshade']);
    press(proot.querySelector('.stack-row[data-layer-id="analysis-1"] .stack-name') as HTMLElement, 'mouse');
    press(proot.querySelector('.ramp-btn[data-value="viridis"]') as HTMLElement, 'mouse');
    expect(map.setAnalysisRamp).toHaveBeenCalledWith('analysis-1', 'viridis');
    // The map's 'layerchange' re-renders; the open settings must not fade in again
    map.emit('layerchange');
    expect(settings().classList.contains('hidden')).toBe(false);
    expect(settings().classList.contains('entering')).toBe(false);

    panel.resetSettings();
    expect(settings().classList.contains('hidden')).toBe(true);
  });

  it('stack rows: visibility, order and removal go to the map', () => {
    const { map, proot } = mount();
    press(proot.querySelector('[data-col="overlay"] .active-row') as HTMLElement, 'mouse');
    const row = (id: string) => proot.querySelector(`.stack-row[data-layer-id="${id}"]`)!;
    press(row('analysis-1').querySelector('[data-action="visible"]') as HTMLElement, 'mouse');
    expect(map.setLayerVisible).toHaveBeenCalledWith('analysis-1', false);
    press(row('analysis-0').querySelector('[data-action="up"]') as HTMLElement, 'mouse');
    expect(map.moveLayer).toHaveBeenCalledWith('analysis-0', 1);
    expect((row('analysis-1').querySelector('[data-action="up"]') as HTMLButtonElement).disabled).toBe(true);
    press(row('analysis-1').querySelector('[data-action="remove"]') as HTMLElement, 'mouse');
    expect(map.removeAnalysisLayer).toHaveBeenCalledWith('analysis-1');
  });

  it('coat settings render from the schema and send parameters', () => {
    const stack = [fakeAnalysis('analysis-2', 'contours', { params: { interval: 100, thickness: 1.5, index: 0, color: [0, 0, 0] } })];
    const { map, proot } = mount(fakeMap({ stack }));
    press(proot.querySelector('[data-col="overlay"] .active-row') as HTMLElement, 'mouse');
    press(proot.querySelector('.stack-name') as HTMLElement, 'mouse');

    const opacity = proot.querySelector('input[data-param="opacity"]') as HTMLInputElement;
    opacity.value = '0.4';
    opacity.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    expect(map.setLayerOpacity).toHaveBeenCalledWith('analysis-2', 0.4);

    const interval = proot.querySelector('input[data-param="interval"]') as HTMLInputElement;
    interval.value = '50';
    interval.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    expect(map.setAnalysisParams).toHaveBeenCalledWith('analysis-2', { interval: 50 });

    press(proot.querySelector('[data-action="select"][data-value="5"]') as HTMLElement, 'mouse');
    expect(map.setAnalysisParams).toHaveBeenCalledWith('analysis-2', { index: '5' });
    press(proot.querySelector('[data-action="color"][title="red"]') as HTMLElement, 'mouse');
    expect(map.setAnalysisParams).toHaveBeenCalledWith('analysis-2', { color: [0.8, 0.15, 0.1] });
    press(proot.querySelector('[data-action="blend"][data-value="multiply"]') as HTMLElement, 'mouse');
    expect(map.setLayerBlendMode).toHaveBeenCalledWith('analysis-2', 'multiply');
    expect(proot.querySelector('.ramp-list')).toBeNull(); // contours have no ramp
  });

  it('an elevation span offers Auto / Manual', () => {
    const { map, proot } = mount();
    press(proot.querySelector('[data-col="overlay"] .active-row') as HTMLElement, 'mouse');
    press(proot.querySelector('.stack-row[data-layer-id="analysis-1"] .stack-name') as HTMLElement, 'mouse');
    expect(proot.querySelectorAll('input[data-param="range"]')).toHaveLength(2);
    press(proot.querySelector('[data-action="auto"][data-value="true"]') as HTMLElement, 'mouse');
    expect(map.setAnalysisParams).toHaveBeenCalledWith('analysis-1', { range: 'auto' });
  });

  it('keeps keyboard focus on the same control across a re-render', () => {
    const { map, proot } = mount();
    press(proot.querySelector('[data-col="overlay"] .active-row') as HTMLElement, 'mouse');
    press(proot.querySelector('.stack-row[data-layer-id="analysis-1"] .stack-name') as HTMLElement, 'mouse');
    const viridis = proot.querySelector('.ramp-btn[data-value="viridis"]') as HTMLElement;
    viridis.focus();
    viridis.click();
    map.emit('layerchange');
    const after = proot.querySelector('.ramp-btn[data-value="viridis"]');
    expect(after).not.toBe(viridis);
    expect(proot.activeElement).toBe(after);
  });
});

describe('legend', () => {
  function mountLegend(legends: unknown[]) {
    const map = fakeMap({ legends });
    const el = document.createElement('treelet-legend') as TreeletLegend;
    document.body.appendChild(el);
    el.attach(map as unknown as Treelet, { glass: true });
    return { map, el, root: el.shadowRoot! };
  }

  it('is hidden without legends and renders bars and classes otherwise', () => {
    const { el, root } = mountLegend([
      { id: 'a', title: 'Elevation', unit: 'm', type: 'continuous', domain: [100, 3000], stops: [[0, [0, 0, 0]], [1, [1, 1, 1]]] },
      { id: 'b', title: 'Slope', type: 'classes', domain: [0, 60], classes: [{ color: [1, 0, 0], label: '< 30°' }, { color: [0, 0, 1], label: '≥ 30°' }] },
    ]);
    expect(el.hidden).toBe(false);
    expect(el.hasAttribute('glass')).toBe(true);
    const titles = [...root.querySelectorAll('.legend-title')].map((t) => t.textContent);
    expect(titles).toEqual(['Elevation (m)', 'Slope']);
    expect(root.querySelector('.legend-range')!.textContent).toBe('1003000');
    // Classes listed highest first
    expect([...root.querySelectorAll('.legend-class span:last-child')].map((s) => s.textContent)).toEqual(['≥ 30°', '< 30°']);
  });

  it('re-renders on layerchange and rangechange', () => {
    const legends: unknown[] = [];
    const { map, el } = mountLegend(legends);
    expect(el.hidden).toBe(true);
    legends.push({ id: 'a', title: 'Elevation', type: 'continuous', domain: [0, 1], stops: [[0, [0, 0, 0]]] });
    map.emit('rangechange');
    expect(el.hidden).toBe(false);
    expect(map.on).toHaveBeenCalledWith('layerchange', expect.any(Function));
  });
});

describe('compass and layer rows', () => {
  it('opens on mouse hover and closes on leave, collapsing panel settings', () => {
    const { root, panel } = mount();
    const row = root.getElementById('layerRow')!;
    const reset = vi.spyOn(panel, 'resetSettings');

    pointer(row, 'pointerenter', 'mouse');
    expect(row.classList.contains('open')).toBe(true);
    expect(root.getElementById('layerBox')!.getAttribute('aria-expanded')).toBe('true');

    pointer(row, 'pointerleave', 'mouse');
    expect(row.classList.contains('open')).toBe(false);
    expect(reset).toHaveBeenCalled();
  });

  it('a mouse click on the compass resets the orientation', () => {
    const { map, root } = mount();
    press(root.getElementById('compassBox')!, 'mouse');
    expect(map.camera.resetOrientation).toHaveBeenCalledTimes(1);
  });

  it('on touch, the first tap on the compass opens it and the next one resets', () => {
    const { map, root } = mount();
    const box = root.getElementById('compassBox')!;
    const row = root.getElementById('compassRow')!;

    press(box, 'touch');
    expect(row.classList.contains('open')).toBe(true);
    expect(map.camera.resetOrientation).not.toHaveBeenCalled();

    press(box, 'touch');
    expect(map.camera.resetOrientation).toHaveBeenCalledTimes(1);
    expect(row.classList.contains('open')).toBe(true);

    pointer(document.body, 'pointerdown', 'touch');
    expect(row.classList.contains('open')).toBe(false);
  });

  it('a tap toggles the layer panel; tapping inside it keeps it open', () => {
    const { root, proot } = mount();
    const box = root.getElementById('layerBox')!;
    const row = root.getElementById('layerRow')!;

    press(box, 'touch');
    expect(row.classList.contains('open')).toBe(true);
    pointer(proot.querySelector('.active-row')!, 'pointerdown', 'touch');
    expect(row.classList.contains('open')).toBe(true);
    press(box, 'touch');
    expect(row.classList.contains('open')).toBe(false);
  });

  it('Escape closes an open row', () => {
    const { root } = mount();
    const row = root.getElementById('layerRow')!;
    press(root.getElementById('layerBox')!, 'touch');
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    expect(row.classList.contains('open')).toBe(false);
  });

  it('shows the tile count as it changes', () => {
    const { compass, root } = mount();
    compass.updateTileCount(42);
    expect(root.getElementById('infoTiles')!.textContent).toBe('42');
  });

  it('marks the host for the glass style only when asked', () => {
    const plain = mount().compass;
    expect(plain.hasAttribute('glass')).toBe(false);
    const glass = mount(fakeMap(), { compassPosition: 'top-right', layerPosition: 'top-right', glass: true } as never).compass;
    expect(glass.hasAttribute('glass')).toBe(true);
  });
});

describe('coat settings from the schema (Phase 1 parameters)', () => {
  function openCoat(stack: unknown[], id: string) {
    const { map, proot } = mount(fakeMap({ stack }));
    (proot.querySelector('.active-row[data-layer-id="__stack__"]') as HTMLElement).click();
    (proot.querySelector(`.stack-row[data-layer-id="${id}"] .stack-name`) as HTMLElement).click();
    return { map, proot };
  }

  it('an optional wrapping span renders All / Sector and from → to sliders', () => {
    const { map, proot } = openCoat([fakeAnalysis('analysis-5', 'slope')], 'analysis-5');
    const all = proot.querySelector('[data-action="optional"][data-value="false"]') as HTMLElement;
    const sector = proot.querySelector('[data-action="optional"][data-value="true"]') as HTMLElement;
    expect(all.classList.contains('active')).toBe(true);
    expect(proot.querySelector('input[data-param="aspectMask"]')).toBeNull();
    sector.click();
    expect(map.setAnalysisParams).toHaveBeenCalledWith('analysis-5', { aspectMask: [315, 45] });

    const { proot: open } = openCoat([fakeAnalysis('analysis-6', 'slope', { params: { range: [0, 60], aspectMask: [315, 45] } })], 'analysis-6');
    const inputs = open.querySelectorAll<HTMLInputElement>('input[data-param="aspectMask"]');
    expect(inputs).toHaveLength(2);
    expect(inputs[0].dataset.wrap).toBe('');
    expect(open.querySelector('[data-value-for="analysis-6:aspectMask"]')!.textContent).toBe('315° → 45°');
  });

  it('a from → to slider keeps its order when the input moves', () => {
    const { map, proot } = openCoat([fakeAnalysis('analysis-7', 'slope', { params: { range: [0, 60], aspectMask: [315, 45] } })], 'analysis-7');
    const to = proot.querySelectorAll<HTMLInputElement>('input[data-param="aspectMask"]')[1];
    to.value = '90';
    to.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    expect(map.setAnalysisParams).toHaveBeenLastCalledWith('analysis-7', { aspectMask: [315, 90] });
  });

  it("the water level slider spans the visible elevation range", () => {
    const { proot } = openCoat([fakeAnalysis('analysis-8', 'water', { params: { level: 1300, color: [0.14, 0.44, 0.7], depthFade: 100, shoreline: 2 } })], 'analysis-8');
    const level = proot.querySelector<HTMLInputElement>('input[data-param="level"]')!;
    expect([level.min, level.max, level.value]).toEqual(['800', '2600', '1300']);
  });

  it('lists class presets only for their analysis', () => {
    const { proot } = openCoat([fakeAnalysis('analysis-9', 'slope')], 'analysis-9');
    const names = [...proot.querySelectorAll('.ramp-btn[data-value]')].map((b) => b.getAttribute('data-value'));
    expect(names).toContain('avalanche');
    expect(names).not.toContain('aspect8');
    const { proot: elev } = openCoat([fakeAnalysis('analysis-10', 'elevation')], 'analysis-10');
    const elevNames = [...elev.querySelectorAll('.ramp-btn[data-value]')].map((b) => b.getAttribute('data-value'));
    expect(elevNames).not.toContain('avalanche');
  });
});

describe('readout', () => {
  function mountReadout() {
    const map = fakeMap();
    const el = document.createElement('treelet-readout') as TreeletReadout;
    document.body.appendChild(el);
    el.attach(map as unknown as Treelet, { glass: true });
    return { map, el, root: el.shadowRoot! };
  }

  it('formats elevation, slope and aspect with a compass point', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(212)).toBe('SW');
    expect(compassPoint(359)).toBe('N');
    const rows = formatReadout({ lngLat: { lng: 0, lat: 0 }, elevation: 1234.6, slope: 31.26, aspect: 212.4, curvature: 0, normal: [0, 0, 1] });
    expect(rows.map((r) => r[1])).toEqual(['1\u2009235 m', '31.3°', '212° SW']);
    expect(formatReadout({ lngLat: { lng: 0, lat: 0 }, elevation: 5, slope: 0, aspect: null, curvature: 0, normal: [0, 0, 1] })[2][1]).toBe('flat');
  });

  it('is hidden until shown, renders the pick and hides again without one', () => {
    const { el, root } = mountReadout();
    expect(el.hidden).toBe(true);
    expect(el.hasAttribute('glass')).toBe(true);
    el.showAt(10, 10);
    expect(el.hidden).toBe(false);
    expect([...root.querySelectorAll('.readout-value')].map((v) => v.textContent)).toEqual(['1\u2009235 m', '31.3°', '212° SW']);
    el.showAt(-1, -1);
    expect(el.hidden).toBe(true);
  });

  it('a tap samples the terrain and pins the readout; a drag does not', () => {
    const { map, el } = mountReadout();
    const down = (x: number, y: number) => document.body.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y, bubbles: true }));
    const up = (x: number, y: number) => document.body.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y, bubbles: true }));
    down(20, 20); up(60, 20); // a drag
    expect(map.pick).not.toHaveBeenCalled();
    down(20, 20); up(22, 21); // a tap
    expect(map.pick).toHaveBeenCalledTimes(1);
    expect(el.hidden).toBe(false);
    document.body.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse', bubbles: true }));
    expect(el.hidden).toBe(false); // pinned by the tap
  });
});
