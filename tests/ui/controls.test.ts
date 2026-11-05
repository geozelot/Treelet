// ============================================================================
// Tests for the compass and layer panel controls: opening and closing with
// the mouse, touch and keyboard, and what the panel renders.
// ============================================================================

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { defineTreeletElements } from '../../src/ui/elements';
import type { TreeletCompass } from '../../src/ui/TreeletCompass';
import type { TreeletPanel } from '../../src/ui/TreeletPanel';
import type { Treelet } from '../../src/core/Treelet';

/** The parts of Treelet the controls use, with spies for actions. */
function fakeMap(opts: { baseLayers?: number } = {}) {
  const baseLayers = Array.from({ length: opts.baseLayers ?? 1 }, (_, i) => ({
    id: `base-${i}`, layerName: `Base ${i}`, visible: i === 0,
  }));
  const drapes = [{ id: 'osm', layerName: 'OpenStreetMap' }];
  const camera = {
    getState: () => ({ zoom: 10, pitch: 0, rotation: 0 }),
    resetOrientation: vi.fn(),
    setZoomLevel: vi.fn(),
    setAzimuth: vi.fn(),
    setPitch: vi.fn(),
  };
  const map = {
    camera,
    on: vi.fn(),
    getCameraController: () => camera,
    getCenter: () => ({ lng: 11, lat: 47 }),
    getBounds: () => ({ sw: { lng: 10, lat: 46 }, ne: { lng: 12, lat: 48 } }),
    getBaseLayers: () => baseLayers,
    getDrapeLayers: () => drapes,
    getActiveDrapeId: () => null,
    isBaseDrapeActive: () => true,
    getBaseDrapeMode: () => 'elevation',
    getColorRamp: () => 'hypsometric',
    getExaggeration: () => 1,
    getSunAzimuth: () => 315,
    getSunAltitude: () => 45,
    getIsolineColor: () => [0, 0, 0],
    getIsolineInterval: () => 100,
    getIsolineThickness: () => 1,
    getWireframeWhite: () => false,
    getDrapeOpacity: () => 1,
    getDrapeBlendMode: () => 'normal',
    getHillshadeStrength: () => 0.5,
    setColorRamp: vi.fn(),
    setBaseDrapeMode: vi.fn(),
    activateBaseDrape: vi.fn(),
    activateDrapeLayer: vi.fn(),
    setActiveBaseLayer: vi.fn(),
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

beforeAll(() => defineTreeletElements());
afterEach(() => { document.body.innerHTML = ''; });

describe('layer panel', () => {
  it('renders a title with a single source as a plain label', () => {
    const { proot } = mount();
    const terrain = proot.querySelector('[data-col="terrain"]')!;
    expect(terrain.querySelector('.header-chevron')).toBeNull();
    expect(terrain.querySelector('.layer-col-body')).toBeNull();
    expect(terrain.querySelector('button.layer-col-header')).toBeNull();

    const overlay = proot.querySelector('.has-choices[data-col="overlay"] > button.layer-col-header')!;
    expect(overlay.getAttribute('aria-expanded')).toBe('false');
    expect(overlay.querySelector('.header-chevron')).not.toBeNull();
  });

  it('offers other base layers when there are several', () => {
    const { proot } = mount(fakeMap({ baseLayers: 2 }));
    const terrain = proot.querySelector('.has-choices[data-col="terrain"]')!;
    expect(terrain.querySelector('.layer-btn')!.textContent).toBe('Base 1');
  });

  it('groups the overlay choices as Analysis and Layers', () => {
    const { proot } = mount();
    const labels = [...proot.querySelectorAll('.dropdown-group-label')].map((l) => l.textContent);
    expect(labels).toEqual(['Analysis', 'Layers']);
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

  it('activating a choice closes the dropdown', () => {
    const { map, proot } = mount();
    press(proot.querySelector('[data-col="overlay"] .layer-col-header') as HTMLElement, 'touch');
    const slope = proot.querySelector('[data-mode="slope"] .layer-btn') as HTMLElement;
    press(slope, 'touch');
    expect(map.setBaseDrapeMode).toHaveBeenCalledWith('slope');
    expect(proot.querySelector('.has-choices.open')).toBeNull();
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

    // Picking a ramp re-renders; the open settings must not fade in again
    press(proot.querySelector('.ramp-btn[data-value="viridis"]') as HTMLElement, 'mouse');
    expect(map.setColorRamp).toHaveBeenCalledWith('viridis');
    expect(settings().classList.contains('hidden')).toBe(false);
    expect(settings().classList.contains('entering')).toBe(false);

    panel.resetSettings();
    expect(settings().classList.contains('hidden')).toBe(true);
  });

  it('keeps keyboard focus on the same control across a re-render', () => {
    const { proot } = mount();
    press(proot.querySelector('[data-col="overlay"] .active-row') as HTMLElement, 'mouse');
    const viridis = proot.querySelector('.ramp-btn[data-value="viridis"]') as HTMLElement;
    viridis.focus();
    viridis.click();
    const after = proot.querySelector('.ramp-btn[data-value="viridis"]');
    expect(after).not.toBe(viridis);
    expect(proot.activeElement).toBe(after);
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
