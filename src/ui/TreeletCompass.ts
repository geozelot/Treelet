// ============================================================================
// treelet.js - TreeletCompass Web Component
//
// <treelet-compass> - corner-anchored floating control with:
//   - Compass SVG that rotates/tilts in sync with the camera
//   - Slide-out nav panel: map coords (copy), viewport stats, D-pad, zoom
//   - Click compass to reset orientation (azimuth + tilt)
//   - Layer box with slide-out panel for layer/overlay selection
//
// Each corner row opens while the mouse is over it, after a tap on its box
// (until a tap elsewhere), or while it holds keyboard focus; Escape closes it.
// On touch, the first tap on the compass opens its panel, the next one resets.
// ============================================================================

import { compassStyles } from './compassStyles';
import { COMPASS_SVG } from './compassSvg';
import { TREE_SVG } from './treeSvg';
import { TreeletPanel } from './TreeletPanel';
import type { Treelet } from '../core/Treelet';
import type { CameraController, CameraState } from '../scene/CameraController';
import type { UICorner } from '../core/types';
import { WebMercator } from '../crs/WebMercator';
import { BaseElement } from './dom';

// ===========================================================================
// Inline SVGs for navigation buttons and copy icon
// ===========================================================================

const ARROW_UP = `<svg viewBox="0 0 10 10" fill="currentColor"><path d="M5 1.5 L9 8.5 H1Z"/></svg>`;
const ARROW_DOWN = `<svg viewBox="0 0 10 10" fill="currentColor"><path d="M5 8.5 L9 1.5 H1Z"/></svg>`;
const ARROW_LEFT = `<svg viewBox="0 0 10 10" fill="currentColor"><path d="M1.5 5 L8.5 1 V9Z"/></svg>`;
const ARROW_RIGHT = `<svg viewBox="0 0 10 10" fill="currentColor"><path d="M8.5 5 L1.5 1 V9Z"/></svg>`;
const COPY_ICON = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="7" height="7.5" rx="1"/><path d="M3.5 9.5V3a1 1 0 0 1 1-1H9"/></svg>`;

// ===========================================================================
// Helpers
// ===========================================================================

/** Format a bearing value: 0-360 range with degree symbol. */
function formatBearing(rotation: number): string {
  return `${(((rotation % 360) + 360) % 360).toFixed(1)}°`;
}

/** How the latest interaction started. */
type InputKind = 'mouse' | 'touch' | 'keyboard';

type OpenReason = 'hover' | 'tap' | 'focus';

/**
 * Open state of a corner row (box + slide-out). The row is open while any
 * reason holds; closing runs `onClose` (e.g. to collapse panel settings).
 */
class RowDisclosure {
  private readonly reasons = new Set<OpenReason>();

  constructor(
    readonly row: HTMLElement,
    readonly box: HTMLElement,
    private readonly onClose?: () => void,
  ) {}

  get isOpen(): boolean { return this.reasons.size > 0; }

  has(reason: OpenReason): boolean { return this.reasons.has(reason); }

  set(reason: OpenReason, on: boolean): void {
    const was = this.isOpen;
    if (on) this.reasons.add(reason);
    else this.reasons.delete(reason);
    this.sync(was);
  }

  close(): void {
    const was = this.isOpen;
    this.reasons.clear();
    this.sync(was);
  }

  private sync(was: boolean): void {
    const open = this.isOpen;
    if (open === was) return;
    this.row.classList.toggle('open', open);
    // Only boxes whose activation toggles the panel announce it
    if (this.box.hasAttribute('aria-expanded')) this.box.setAttribute('aria-expanded', String(open));
    if (!open) this.onClose?.();
  }
}

// ===========================================================================
// Component
// ===========================================================================

export class TreeletCompass extends BaseElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;
  private cc: CameraController | null = null;
  panel: TreeletPanel | null = null;

  /** Corner positions for compass and layer controls. */
  private compassPos: UICorner = 'top-right';
  private layerPos: UICorner = 'top-right';

  /** Cached DOM references for fast per-frame updates. */
  private svgEl: HTMLElement | null = null;
  private tileCountEl: HTMLElement | null = null;
  private zoomEl: HTMLElement | null = null;
  private pitchEl: HTMLElement | null = null;
  private bearingEl: HTMLElement | null = null;
  private tileCount = -1;

  private compassRow: RowDisclosure | null = null;
  private layerRow: RowDisclosure | null = null;
  private lastInput: InputKind = 'mouse';
  /** Set while Escape returns focus to a box, so that focus doesn't reopen it. */
  private refocusing = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    document.addEventListener('pointerdown', this.onDocPointerDown, true);
    document.addEventListener('keydown', this.onDocKeyDown, true);
  }

  disconnectedCallback(): void {
    document.removeEventListener('pointerdown', this.onDocPointerDown, true);
    document.removeEventListener('keydown', this.onDocKeyDown, true);
  }

  /** Whether compass and layer box occupy the same corner. */
  private get isCombined(): boolean {
    return this.compassPos === this.layerPos;
  }

  /** Split a UICorner string into horizontal and vertical components. */
  private parseCorner(corner: UICorner): { h: 'left' | 'right'; v: 'top' | 'bottom' } {
    const [v, h] = corner.split('-') as ['top' | 'bottom', 'left' | 'right'];
    return { h, v };
  }

  // =======================================================================
  // Lifecycle
  // =======================================================================

  attach(
    map: Treelet,
    options?: { compassPosition: UICorner; layerPosition: UICorner; glass?: boolean },
  ): void {
    this.map = map;
    this.cc = map.getCameraController();
    if (options) {
      this.compassPos = options.compassPosition;
      this.layerPos = options.layerPosition;
    }
    this.toggleAttribute('glass', options?.glass === true);
    this.render();
    this.cacheElements();
    this.bindEvents();

    map.on('layerchange', () => this.panel?.refresh());
  }

  /** Called on every camera change (non-debounced) for smooth visual sync. */
  updateCamera(state: CameraState): void {
    if (!this.svgEl) return;

    // Rotate and tilt the compass SVG in sync with the camera
    const svg = this.svgEl.querySelector('svg');
    if (svg) {
      svg.style.transform = `rotateX(${state.pitch}deg) rotateZ(${state.rotation}deg)`;
    }

    // Update live stats in the info box
    if (this.zoomEl) this.zoomEl.textContent = state.zoom.toFixed(1);
    if (this.pitchEl) this.pitchEl.textContent = `${(90 - state.pitch).toFixed(1)}°`;
    if (this.bearingEl) this.bearingEl.textContent = formatBearing(state.rotation);
  }

  /** Called every rendered frame (tiles load while the camera rests). */
  updateTileCount(count: number): void {
    if (count === this.tileCount || !this.tileCountEl) return;
    this.tileCount = count;
    this.tileCountEl.textContent = `${count}`;
  }

  // =======================================================================
  // Rendering
  // =======================================================================

  private render(): void {
    const cp = this.parseCorner(this.compassPos);
    const lp = this.parseCorner(this.layerPos);

    // Boxes come first in the DOM (slide-outs are absolutely positioned), so
    // Tab reaches a box, which opens its panel, before the panel's buttons.
    const compassRowHtml = `
      <div class="row compass-row" id="compassRow" data-h="${cp.h}">
        <button type="button" class="box compass-box" id="compassBox" title="Reset orientation" aria-label="Reset orientation">
          <span class="compass-svg" id="compassSvg">${COMPASS_SVG}</span>
        </button>
        <div class="slide nav-panel">
          <div class="nav-section nav-copy-section">
            <div class="nav-label">Map</div>
            <div class="info-body">
              <div class="info-group">
                <span class="info-group-label">Center</span>
                <button type="button" class="info-copy-btn" id="copyCenterWgs" title="Copy center as [lng, lat]">${COPY_ICON}<span>EPSG:4326</span></button>
                <button type="button" class="info-copy-btn" id="copyCenterMerc" title="Copy center as Web Mercator [x, y]">${COPY_ICON}<span>EPSG:3857</span></button>
              </div>
              <div class="info-group">
                <span class="info-group-label">Extent</span>
                <button type="button" class="info-copy-btn" id="copyExtentWgs" title="Copy extent as [[west, south], [east, north]]">${COPY_ICON}<span>EPSG:4326</span></button>
                <button type="button" class="info-copy-btn" id="copyExtentMerc" title="Copy extent as Web Mercator [[minX, minY], [maxX, maxY]]">${COPY_ICON}<span>EPSG:3857</span></button>
              </div>
            </div>
          </div>
          <div class="nav-divider"></div>
          <div class="nav-section nav-info-section">
            <div class="nav-label">Viewport</div>
            <div class="info-body">
              <div class="info-stats">
                <div class="info-stats-col">
                  <span class="info-stat-label">Tiles</span><span class="info-stat-value" id="infoTiles">0</span>
                  <span class="info-stat-label">Zoom</span><span class="info-stat-value" id="infoZoom">0</span>
                </div>
                <div class="info-stats-col">
                  <span class="info-stat-label">Pitch</span><span class="info-stat-value" id="infoPitch">90°</span>
                  <span class="info-stat-label">Bearing</span><span class="info-stat-value" id="infoBearing">0°</span>
                </div>
              </div>
            </div>
          </div>
          <div class="nav-divider"></div>
          <div class="nav-section">
            <div class="nav-label">Navigation</div>
            <div class="nav-grid">
              <button type="button" class="nav-btn" id="rotLeft" title="Rotate left" aria-label="Rotate left">${ARROW_LEFT}</button>
              <button type="button" class="nav-btn" id="tiltUp" title="Tilt up" aria-label="Tilt up">${ARROW_UP}</button>
              <button type="button" class="nav-btn" id="tiltDown" title="Tilt down" aria-label="Tilt down">${ARROW_DOWN}</button>
              <button type="button" class="nav-btn" id="rotRight" title="Rotate right" aria-label="Rotate right">${ARROW_RIGHT}</button>
            </div>
          </div>
          <div class="nav-divider"></div>
          <div class="nav-section">
            <div class="nav-label">Zoom</div>
            <div class="nav-zoom">
              <button type="button" class="nav-btn" id="zoomIn" title="Zoom in" aria-label="Zoom in">+</button>
              <button type="button" class="nav-btn" id="zoomOut" title="Zoom out" aria-label="Zoom out">−</button>
            </div>
          </div>
        </div>
      </div>`;

    const layerRowHtml = `
      <div class="row layer-row" id="layerRow" data-h="${lp.h}" data-v="${lp.v}">
        <button type="button" class="box layer-box" id="layerBox" aria-label="Layers" aria-expanded="false">
          ${TREE_SVG}
        </button>
        <div class="slide layer-slide" id="layerSlide"></div>
      </div>`;

    if (this.isCombined) {
      this.shadow.innerHTML = `
        <style>${compassStyles}</style>
        <div class="anchor" data-h="${cp.h}" data-v="${cp.v}">
          <div class="compass-wrapper" data-v="${cp.v}">
            ${compassRowHtml}
            ${layerRowHtml}
          </div>
        </div>`;
    } else {
      this.shadow.innerHTML = `
        <style>${compassStyles}</style>
        <div class="anchor" data-h="${cp.h}" data-v="${cp.v}">
          ${compassRowHtml}
        </div>
        <div class="anchor" data-h="${lp.h}" data-v="${lp.v}">
          ${layerRowHtml}
        </div>`;
    }

    // Insert layer panel into the slide-out container
    this.panel = document.createElement('treelet-panel') as TreeletPanel;
    this.shadow.getElementById('layerSlide')!.appendChild(this.panel);
    if (this.map) {
      this.panel.attach(this.map, lp.v, lp.h);
    }
  }

  private cacheElements(): void {
    this.svgEl = this.shadow.getElementById('compassSvg');
    this.tileCountEl = this.shadow.getElementById('infoTiles');
    this.zoomEl = this.shadow.getElementById('infoZoom');
    this.pitchEl = this.shadow.getElementById('infoPitch');
    this.bearingEl = this.shadow.getElementById('infoBearing');
    this.tileCount = -1;
  }

  // =======================================================================
  // Copy helpers
  // =======================================================================

  /** Copy text to clipboard and flash the icon on a button. */
  private copyToClipboard(btn: HTMLElement, text: string): void {
    // Clipboard API is unavailable on insecure origins; fail quietly.
    navigator.clipboard?.writeText(text).then(() => {
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 800);
    }).catch(() => {});
  }

  /** Build a JSON coordinate array string for the current center. */
  private getCenterWgs(): string {
    const c = this.map?.getCenter();
    if (!c) return '[]';
    return JSON.stringify([+c.lng.toFixed(6), +c.lat.toFixed(6)]);
  }

  private getCenterMerc(): string {
    const c = this.map?.getCenter();
    if (!c) return '[]';
    const m = WebMercator.project(c);
    return JSON.stringify([+m.x.toFixed(2), +m.y.toFixed(2)]);
  }

  /** Build a JSON array-of-arrays string for the current extent. */
  private getExtentWgs(): string {
    const b = this.map?.getBounds();
    if (!b) return '[]';
    return JSON.stringify([
      [+b.sw.lng.toFixed(6), +b.sw.lat.toFixed(6)],
      [+b.ne.lng.toFixed(6), +b.ne.lat.toFixed(6)],
    ]);
  }

  private getExtentMerc(): string {
    const b = this.map?.getBounds();
    if (!b) return '[]';
    const sw = WebMercator.project(b.sw);
    const ne = WebMercator.project(b.ne);
    return JSON.stringify([
      [+sw.x.toFixed(2), +sw.y.toFixed(2)],
      [+ne.x.toFixed(2), +ne.y.toFixed(2)],
    ]);
  }

  // =======================================================================
  // Open / close (hover, tap, keyboard)
  // =======================================================================

  /** Record the input kind; a tap outside a row closes what a tap opened. */
  private onDocPointerDown = (e: PointerEvent): void => {
    this.lastInput = e.pointerType === 'touch' || e.pointerType === 'pen' ? 'touch' : 'mouse';
    const path = e.composedPath();
    for (const d of [this.compassRow, this.layerRow]) {
      if (d && !path.includes(d.row)) d.set('tap', false);
    }
  };

  private onDocKeyDown = (): void => {
    this.lastInput = 'keyboard';
  };

  /** Whether a focus change came from keyboard navigation (not a click or tap). */
  private isKeyboardFocus(e: FocusEvent): boolean {
    const el = e.composedPath()[0];
    try {
      return el instanceof Element && el.matches(':focus-visible');
    } catch {
      return this.lastInput === 'keyboard'; // no :focus-visible support
    }
  }

  private bindDisclosure(d: RowDisclosure): void {
    const { row, box } = d;
    row.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') d.set('hover', true); });
    row.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') d.set('hover', false); });
    row.addEventListener('focusin', (e) => {
      if (!this.refocusing && this.isKeyboardFocus(e)) d.set('focus', true);
    });
    // Checked once focus has settled: the panel's re-renders briefly remove
    // the focused button and refocus its replacement.
    row.addEventListener('focusout', () => {
      setTimeout(() => {
        const active = this.shadow.activeElement;
        if (!active || !row.contains(active)) d.set('focus', false);
      }, 0);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !d.isOpen) return;
      e.stopPropagation();
      d.close();
      this.refocusing = true;
      box.focus();
      this.refocusing = false;
    });
  }

  // =======================================================================
  // Event binding
  // =======================================================================

  private bindEvents(): void {
    const compassBox = this.shadow.getElementById('compassBox')!;
    const layerBox = this.shadow.getElementById('layerBox')!;
    const compassRow = new RowDisclosure(this.shadow.getElementById('compassRow')!, compassBox);
    const layerRow = new RowDisclosure(
      this.shadow.getElementById('layerRow')!,
      layerBox,
      () => this.panel?.resetSettings(),
    );
    this.compassRow = compassRow;
    this.layerRow = layerRow;
    this.bindDisclosure(compassRow);
    this.bindDisclosure(layerRow);

    // Compass click resets orientation; on touch the first tap only opens the panel
    compassBox.addEventListener('click', () => {
      if (this.lastInput === 'touch' && !compassRow.isOpen) {
        compassRow.set('tap', true);
        return;
      }
      this.cc?.resetOrientation();
    });

    // Layer box: a tap toggles the panel, Enter reopens it after Escape
    // (mouse hover and keyboard focus already open it)
    layerBox.addEventListener('click', () => {
      if (this.lastInput === 'touch') layerRow.set('tap', !layerRow.has('tap'));
      else if (this.lastInput === 'keyboard') layerRow.set('focus', true);
    });

    // Helper: bind a button by ID with stopPropagation
    const bind = (id: string, handler: () => void) => {
      this.shadow.getElementById(id)!.addEventListener('click', (e) => {
        e.stopPropagation();
        handler();
      });
    };

    // Zoom ±1
    bind('zoomIn',  () => this.cc && this.cc.setZoomLevel(Math.round(this.cc.getState().zoom) + 1));
    bind('zoomOut', () => this.cc && this.cc.setZoomLevel(Math.round(this.cc.getState().zoom) - 1));

    // Rotation ±15°
    bind('rotLeft',  () => this.cc && this.cc.setAzimuth(this.cc.getState().rotation - 15));
    bind('rotRight', () => this.cc && this.cc.setAzimuth(this.cc.getState().rotation + 15));

    // Tilt ±5° (clamped by CameraController's pitch limits)
    bind('tiltUp',   () => this.cc && this.cc.setPitch(this.cc.getState().pitch - 5));
    bind('tiltDown', () => this.cc && this.cc.setPitch(this.cc.getState().pitch + 5));

    // Copy buttons in info panel
    const bindCopy = (id: string, getData: () => string) => {
      const btn = this.shadow.getElementById(id)!;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.copyToClipboard(btn, getData());
      });
    };

    bindCopy('copyCenterWgs',  () => this.getCenterWgs());
    bindCopy('copyCenterMerc', () => this.getCenterMerc());
    bindCopy('copyExtentWgs',  () => this.getExtentWgs());
    bindCopy('copyExtentMerc', () => this.getExtentMerc());
  }
}
