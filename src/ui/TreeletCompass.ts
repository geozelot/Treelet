// ============================================================================
// treelet.js - TreeletCompass Web Component
//
// <treelet-compass> - corner-anchored floating control with:
//   - Compass SVG that rotates/tilts in sync with the camera
//   - Slide-out nav panel: map coords (copy), viewport stats, D-pad, zoom
//   - Click compass to reset orientation (azimuth + tilt)
//   - Layer box with slide-out panel for layer/overlay selection
// ============================================================================

import { compassStyles } from './compassStyles';
import { COMPASS_SVG } from './compassSvg';
import { TREE_SVG } from './treeSvg';
import { TreeletPanel } from './TreeletPanel';
import type { Treelet } from '../core/Treelet';
import type { CameraController, CameraState } from '../scene/CameraController';
import type { UICorner } from '../core/types';
import { WebMercator } from '../crs/WebMercator';

// ---------------------------------------------------------------------------
// Inline SVGs for navigation buttons and copy icon
// ---------------------------------------------------------------------------

const ARROW_UP = `<svg viewBox="0 0 10 10" fill="currentColor"><path d="M5 1.5 L9 8.5 H1Z"/></svg>`;
const ARROW_DOWN = `<svg viewBox="0 0 10 10" fill="currentColor"><path d="M5 8.5 L9 1.5 H1Z"/></svg>`;
const ARROW_LEFT = `<svg viewBox="0 0 10 10" fill="currentColor"><path d="M1.5 5 L8.5 1 V9Z"/></svg>`;
const ARROW_RIGHT = `<svg viewBox="0 0 10 10" fill="currentColor"><path d="M8.5 5 L1.5 1 V9Z"/></svg>`;
const COPY_ICON = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="7" height="7.5" rx="1"/><path d="M3.5 9.5V3a1 1 0 0 1 1-1H9"/></svg>`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a bearing value: 0-360 range with degree symbol. */
function formatBearing(rotation: number): string {
  return `${(((rotation % 360) + 360) % 360).toFixed(1)}°`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class TreeletCompass extends HTMLElement {
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

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
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

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  attach(
    map: Treelet,
    positions?: { compassPosition: UICorner; layerPosition: UICorner },
  ): void {
    this.map = map;
    this.cc = map.getCameraController();
    if (positions) {
      this.compassPos = positions.compassPosition;
      this.layerPos = positions.layerPosition;
    }
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
    if (this.zoomEl) this.zoomEl.textContent = `${state.zoom}`;
    if (this.pitchEl) this.pitchEl.textContent = `${(90 - state.pitch).toFixed(1)}°`;
    if (this.bearingEl) this.bearingEl.textContent = formatBearing(state.rotation);
    if (this.tileCountEl && this.map) {
      this.tileCountEl.textContent = `${this.map.getTileCount()}`;
    }
  }

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  private render(): void {
    const cp = this.parseCorner(this.compassPos);
    const lp = this.parseCorner(this.layerPos);

    const compassRowHtml = `
      <div class="compass-row" id="compassRow" data-h="${cp.h}">
        <div class="nav-panel">
          <div class="nav-section nav-copy-section">
            <div class="nav-label">Map</div>
            <div class="info-body">
              <div class="info-group">
                <span class="info-group-label">Center</span>
                <button class="info-copy-btn" id="copyCenterWgs">${COPY_ICON}<span>EPSG:4326</span></button>
                <button class="info-copy-btn" id="copyCenterMerc">${COPY_ICON}<span>EPSG:3857</span></button>
              </div>
              <div class="info-group">
                <span class="info-group-label">Extent</span>
                <button class="info-copy-btn" id="copyExtentWgs">${COPY_ICON}<span>EPSG:4326</span></button>
                <button class="info-copy-btn" id="copyExtentMerc">${COPY_ICON}<span>EPSG:3857</span></button>
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
              <button class="nav-btn" id="rotLeft">${ARROW_LEFT}</button>
              <button class="nav-btn" id="tiltUp">${ARROW_UP}</button>
              <button class="nav-btn" id="tiltDown">${ARROW_DOWN}</button>
              <button class="nav-btn" id="rotRight">${ARROW_RIGHT}</button>
            </div>
          </div>
          <div class="nav-divider"></div>
          <div class="nav-section">
            <div class="nav-label">Zoom</div>
            <div class="nav-zoom">
              <button class="nav-btn" id="zoomIn">+</button>
              <button class="nav-btn" id="zoomOut">\u2212</button>
            </div>
          </div>
        </div>
        <div class="compass-box" id="compassBox">
          <div class="compass-svg" id="compassSvg">${COMPASS_SVG}</div>
        </div>
      </div>`;

    const layerRowHtml = `
      <div class="layer-row" id="layerRow" data-h="${lp.h}" data-v="${lp.v}">
        <div class="layer-slide" id="layerSlide"></div>
        <div class="layer-box">
          ${TREE_SVG}
        </div>
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
  }

  // -----------------------------------------------------------------------
  // Copy helpers
  // -----------------------------------------------------------------------

  /** Copy text to clipboard and flash the icon on a button. */
  private copyToClipboard(btn: HTMLElement, text: string): void {
    navigator.clipboard.writeText(text).then(() => {
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 800);
    });
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

  // -----------------------------------------------------------------------
  // Event binding
  // -----------------------------------------------------------------------

  private bindEvents(): void {
    // Compass click - reset orientation
    this.shadow.getElementById('compassBox')!.addEventListener('click', () => {
      this.cc?.resetOrientation();
    });

    // Helper: bind a button by ID with stopPropagation
    const bind = (id: string, handler: () => void) => {
      this.shadow.getElementById(id)!.addEventListener('click', (e) => {
        e.stopPropagation();
        handler();
      });
    };

    // Zoom ±1
    bind('zoomIn',  () => this.cc && this.cc.setZoomLevel(this.cc.getState().zoom + 1));
    bind('zoomOut', () => this.cc && this.cc.setZoomLevel(this.cc.getState().zoom - 1));

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

    // Layer row - reset panel settings when mouse leaves
    this.shadow.getElementById('layerRow')!.addEventListener('mouseleave', () => {
      this.panel?.resetSettings();
    });
  }
}

// Register the custom element
if (!customElements.get('treelet-compass')) {
  customElements.define('treelet-compass', TreeletCompass);
}
