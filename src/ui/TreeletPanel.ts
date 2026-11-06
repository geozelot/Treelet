// ============================================================================
// treelet.js - TreeletPanel Web Component
//
// <treelet-panel> - layer/overlay selection panel (slides out from layer box).
//
// Layout:
//   Each column: active section (name + gear → settings) + selector header
//
//   Terrain  - active base layer with gear → exaggeration slider
//              header → dropdown of other base layers (header is a
//              plain label when there is only one)
//
//   Overlay  - active overlay with gear → settings:
//                Terrain modes:
//                  Wireframe  (gear → normals/white toggle)
//                  separator
//                  Elevation  (gear → color ramp picker)
//                  Slope      (gear → color ramp picker)
//                  Aspect     (gear → color ramp picker)
//                  Contours   (gear → color, thickness, interval)
//                External drape → opacity slider
//              header → dropdown:
//                Analysis group (terrain modes, always first)
//                Layers group (external drapes, if present)
//
// A dropdown opens while the mouse is over its header or list, or after a
// tap / Enter on the header (until a tap elsewhere, Escape, or focus leaves).
// ============================================================================

import { panelStyles } from './styles';
import { BASE_DRAPE_ID } from '../core/DisplayController';
import { BaseElement, escapeHtml } from './dom';
import type { Treelet } from '../core/Treelet';
import type { BaseDrapeMode, BlendMode, ColorRamp } from '../core/types';
import type { BaseLayer } from '../layers/BaseLayer';
import type { DrapeLayer } from '../layers/DrapeLayer';

/** Drape blend mode metadata for the toggle buttons. */
const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal',    label: 'Flat' },
  { id: 'hillshade', label: 'Hillshade' },
  { id: 'softlight', label: 'Soft Light' },
];

/** Color ramp metadata with CSS gradient for the indicator strip. */
const RAMP_META: { id: ColorRamp; label: string; gradient: string }[] = [
  { id: 'hypsometric', label: 'Hypsometric', gradient: 'linear-gradient(to right, #264d1e, #8fa35a, #d4b06a, #f5e6c8, #fff)' },
  { id: 'viridis',     label: 'Viridis',     gradient: 'linear-gradient(to right, #440154, #31688e, #35b779, #fde725)' },
  { id: 'inferno',     label: 'Inferno',     gradient: 'linear-gradient(to right, #000004, #57106e, #bc3754, #f98e09, #fcffa4)' },
  { id: 'grayscale',   label: 'Grayscale',   gradient: 'linear-gradient(to right, #000, #fff)' },
  { id: 'cyclic',      label: 'Cyclic',      gradient: 'linear-gradient(to right, #f26b6b, #c7c25a, #5ad16f, #5ab7c7, #8a6bf2, #f26b6b)' },
];

/** Contour color presets: label → [r, g, b] in 0–1 range. */
const CONTOUR_COLORS: { label: string; rgb: [number, number, number]; hex: string }[] = [
  { label: 'brown',  rgb: [0.12, 0.08, 0.04], hex: '#1f140a' },
  { label: 'black',  rgb: [0.0,  0.0,  0.0],  hex: '#000000' },
  { label: 'white',  rgb: [1.0,  1.0,  1.0],  hex: '#ffffff' },
  { label: 'red',    rgb: [0.8,  0.15, 0.1],  hex: '#cc2619' },
  { label: 'blue',   rgb: [0.1,  0.3,  0.7],  hex: '#1a4db3' },
  { label: 'gray',   rgb: [0.45, 0.45, 0.45], hex: '#737373' },
];

/** Slider element ID prefixes - used in delegated input handler. */
const EXAG_PREFIX = 'exag-slider-';
const OPACITY_PREFIX = 'opacity-slider-';

/** SVG gear icon (14×14). */
const GEAR_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M13.3 10a1.2 1.2 0 0 0 .2 1.3l.1.1a1.4 1.4 0 1 1-2 2l-.1-.1a1.2 1.2 0 0 0-1.3-.2 1.2 1.2 0 0 0-.7 1.1v.2a1.4 1.4 0 1 1-2.9 0v-.1a1.2 1.2 0 0 0-.8-1.1 1.2 1.2 0 0 0-1.3.2l-.1.1a1.4 1.4 0 1 1-2-2l.1-.1a1.2 1.2 0 0 0 .2-1.3 1.2 1.2 0 0 0-1.1-.7h-.2a1.4 1.4 0 1 1 0-2.9h.1a1.2 1.2 0 0 0 1.1-.8 1.2 1.2 0 0 0-.2-1.3l-.1-.1a1.4 1.4 0 1 1 2-2l.1.1a1.2 1.2 0 0 0 1.3.2h.1a1.2 1.2 0 0 0 .7-1.1v-.2a1.4 1.4 0 1 1 2.9 0v.1a1.2 1.2 0 0 0 .7 1.1 1.2 1.2 0 0 0 1.3-.2l.1-.1a1.4 1.4 0 1 1 2 2l-.1.1a1.2 1.2 0 0 0-.2 1.3v.1a1.2 1.2 0 0 0 1.1.7h.2a1.4 1.4 0 1 1 0 2.9h-.1a1.2 1.2 0 0 0-1.1.7Z"/></svg>`;

/** SVG chevron (10×10, pointing down; CSS turns it toward where the list opens). */
const CHEVRON_SVG = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.75 5 6.25 7.5 3.75"/></svg>`;

/**
 * <treelet-panel> - Main UI panel for treelet.js.
 *
 * Uses event delegation: listeners on the shadow root handle all
 * interactions. No per-element listeners are registered, so innerHTML
 * replacement (render) doesn't incur re-binding overhead.
 */
export class TreeletPanel extends BaseElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;

  /** Vertical position for direction-aware expansion. */
  private vPos: 'top' | 'bottom' = 'top';

  /** Horizontal position - controls column order (from box outwards). */
  private hPos: 'left' | 'right' = 'right';

  /** Which layer has its settings gear open (id or BASE_DRAPE_ID). */
  private settingsOpen: string | null = null;

  /** Which mode entry inside Terrain overlay has its gear open. */
  private modeSettingsOpen: BaseDrapeMode | null = null;

  /** Settings were just opened: the next render fades them in. */
  private settingsEntering = false;

  /** Column whose dropdown the mouse is over / that a tap or Enter opened. */
  private hoverCol: string | null = null;
  private pinnedCol: string | null = null;

  /** How the latest interaction inside the panel started. */
  private lastInput: 'mouse' | 'touch' | 'keyboard' = 'mouse';

  /** Whether delegated listeners have been bound. */
  private delegated = false;

  /** Persistent panel container - only its innerHTML is replaced on re-render,
   *  avoiding repeated CSS re-parse from full shadow DOM innerHTML replacement. */
  private panelEl: HTMLDivElement | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  attach(map: Treelet, vPos?: 'top' | 'bottom', hPos?: 'left' | 'right'): void {
    this.map = map;
    if (vPos) this.vPos = vPos;
    if (hPos) this.hPos = hPos;
    this.setAttribute('data-v', this.vPos);

    // Bind delegated handlers ONCE - they survive innerHTML replacements
    if (!this.delegated) {
      this.delegated = true;
      this.shadow.addEventListener('click', this.handleClick);
      this.shadow.addEventListener('input', this.handleInput);
      this.shadow.addEventListener('pointerover', this.handlePointerOver);
      this.shadow.addEventListener('pointerdown', this.handlePointerDown, true);
      this.shadow.addEventListener('keydown', this.handleKeyDown);
      this.shadow.addEventListener('focusout', this.handleFocusOut);
      this.addEventListener('pointerleave', this.handlePointerLeave);
    }

    // Inject style and persistent panel container once
    if (!this.panelEl) {
      this.shadow.innerHTML = `<style>${panelStyles}</style><div class="panel"></div>`;
      this.panelEl = this.shadow.querySelector('.panel') as HTMLDivElement;
    }

    this.render();
  }

  refresh(): void {
    if (this.map) this.render();
  }

  /** Close open settings and dropdowns (called when the layer row closes). */
  resetSettings(): void {
    this.settingsOpen = null;
    this.modeSettingsOpen = null;
    this.hoverCol = null;
    this.pinnedCol = null;
    this.render();
  }

  /** Apply hoverCol / pinnedCol to the rendered selectors. */
  private syncSelectors(): void {
    this.panelEl?.querySelectorAll<HTMLElement>('.has-choices').forEach((el) => {
      const col = el.dataset.col;
      const open = col === this.hoverCol || col === this.pinnedCol;
      el.classList.toggle('open', open);
      el.querySelector('.layer-col-header')?.setAttribute('aria-expanded', String(open));
    });
  }

  // =========================================================================
  // Delegated event handlers (arrow functions for stable `this`)
  // =========================================================================

  private handleClick = (e: Event): void => {
    if (!this.map) return;
    const target = e.target as HTMLElement;

    // === Sliders: just stop propagation ===
    if (target.tagName === 'INPUT') {
      e.stopPropagation();
      return;
    }

    // === Dropdown header: a tap or Enter toggles it (the mouse opens it by hovering) ===
    const header = target.closest('.has-choices > .layer-col-header') as HTMLElement | null;
    if (header) {
      e.stopPropagation();
      if (this.lastInput !== 'mouse') {
        const col = (header.parentElement as HTMLElement).dataset.col!;
        this.pinnedCol = this.pinnedCol === col ? null : col;
        this.syncSelectors();
      }
      return;
    }

    // === Active row click → toggle settings panel ===
    const activeRow = target.closest('.active-row[data-layer-id]') as HTMLElement | null;
    if (activeRow) {
      e.stopPropagation();
      const layerId = activeRow.dataset.layerId!;
      const opening = this.settingsOpen !== layerId;
      this.settingsOpen = opening ? layerId : null;
      this.settingsEntering = opening;
      this.modeSettingsOpen = null;
      this.pinnedCol = null;
      this.render();
      return;
    }

    // === Dropdown layer button → activate layer ===
    const layerBtn = target.closest('.layer-col-body .layer-btn[data-action="activate"]') as HTMLElement | null;
    if (layerBtn) {
      e.stopPropagation();
      const entry = layerBtn.closest('.layer-entry') as HTMLElement | null;
      if (!entry) return;

      const layerId = entry.dataset.layerId!;
      const layerType = entry.dataset.layerType!;
      const col = (entry.closest('.has-choices') as HTMLElement | null)?.dataset.col;

      this.settingsOpen = null;
      this.modeSettingsOpen = null;
      this.pinnedCol = null;
      this.hoverCol = null;

      if (layerType === 'base') {
        this.map.setActiveBaseLayer(layerId);
      } else if (layerType === 'base-drape') {
        this.map.activateBaseDrape();
      } else if (layerType === 'base-drape-mode') {
        const mode = entry.dataset.mode as BaseDrapeMode;
        this.map.activateBaseDrape();
        this.map.setBaseDrapeMode(mode);
      } else if (layerType === 'drape') {
        this.map.activateDrapeLayer(layerId);
      }
      // The map's 'layerchange' re-renders; close now in case nothing changed
      this.syncSelectors();
      // The chosen entry is gone from the new list: keep keyboard focus on its column
      if (this.lastInput === 'keyboard' && col) {
        this.focusSelector(`.has-choices[data-col="${col}"] > .layer-col-header`);
      }
      return;
    }

    // === Wireframe mode toggle ===
    const wireBtn = target.closest('[data-action="wireframe-mode"]') as HTMLElement | null;
    if (wireBtn) {
      e.stopPropagation();
      this.map.setWireframeWhite(wireBtn.dataset.value === 'white');
      this.render();
      return;
    }

    // === Color ramp button ===
    const rampBtn = target.closest('.ramp-btn') as HTMLElement | null;
    if (rampBtn) {
      e.stopPropagation();
      this.map.setColorRamp(rampBtn.dataset.value as ColorRamp);
      this.render();
      return;
    }

    // === Contour color swatch ===
    const swatch = target.closest('.color-swatch') as HTMLElement | null;
    if (swatch) {
      e.stopPropagation();
      const r = parseFloat(swatch.dataset.r!);
      const g = parseFloat(swatch.dataset.g!);
      const b = parseFloat(swatch.dataset.b!);
      this.map.setIsolineColor(r, g, b);
      this.render();
      return;
    }

    // === Blend mode toggle ===
    const blendBtn = target.closest('[data-action="blend-mode"]') as HTMLElement | null;
    if (blendBtn) {
      e.stopPropagation();
      this.map.setDrapeBlendMode(blendBtn.dataset.value as BlendMode);
      this.render();
      return;
    }
  };

  /** Mouse over a selector (header or list) opens it; anywhere else closes it. */
  private handlePointerOver = (ev: Event): void => {
    const e = ev as PointerEvent;
    if (e.pointerType !== 'mouse') return;
    const sel = (e.target as HTMLElement).closest('.has-choices') as HTMLElement | null;
    const col = sel?.dataset.col ?? null;
    if (col === this.hoverCol) return;
    this.hoverCol = col;
    this.syncSelectors();
  };

  private handlePointerLeave = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || this.hoverCol === null) return;
    this.hoverCol = null;
    this.syncSelectors();
  };

  /** Record the input kind; a tap outside the open dropdown closes it. */
  private handlePointerDown = (ev: Event): void => {
    const e = ev as PointerEvent;
    this.lastInput = e.pointerType === 'touch' || e.pointerType === 'pen' ? 'touch' : 'mouse';
    if (this.pinnedCol === null) return;
    const sel = (e.target as HTMLElement).closest('.has-choices') as HTMLElement | null;
    if (sel?.dataset.col !== this.pinnedCol) {
      this.pinnedCol = null;
      this.syncSelectors();
    }
  };

  /** Escape closes the open dropdown, then the open settings (focus returns to their button). */
  private handleKeyDown = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    this.lastInput = 'keyboard';
    if (e.key !== 'Escape') return;
    if (this.pinnedCol !== null || this.hoverCol !== null) {
      const col = this.pinnedCol ?? this.hoverCol;
      this.pinnedCol = null;
      this.hoverCol = null;
      this.syncSelectors();
      this.focusSelector(`.has-choices[data-col="${col}"] > .layer-col-header`);
      e.stopPropagation();
    } else if (this.settingsOpen !== null) {
      const id = this.settingsOpen;
      this.settingsOpen = null;
      this.modeSettingsOpen = null;
      this.render();
      this.focusSelector(`.active-row[data-layer-id="${CSS.escape(id)}"]`);
      e.stopPropagation();
    }
  };

  /**
   * Keyboard focus leaving an open dropdown closes it. Checked once focus has
   * settled: a re-render briefly removes the focused button and refocuses it.
   */
  private handleFocusOut = (): void => {
    if (this.lastInput !== 'keyboard' || this.pinnedCol === null) return;
    setTimeout(() => {
      if (this.pinnedCol === null) return;
      const sel = this.panelEl?.querySelector(`.has-choices[data-col="${this.pinnedCol}"]`);
      if (!sel || !sel.contains(this.shadow.activeElement)) {
        this.pinnedCol = null;
        this.syncSelectors();
      }
    }, 0);
  };

  private focusSelector(selector: string): void {
    (this.panelEl?.querySelector(selector) as HTMLElement | null)?.focus();
  }

  private handleInput = (e: Event): void => {
    if (!this.map) return;
    const target = e.target as HTMLInputElement;
    if (target.tagName !== 'INPUT') return;
    e.stopPropagation();
    const val = parseFloat(target.value);
    const id = target.id;

    if (id.startsWith(EXAG_PREFIX)) {
      const layerId = id.slice(EXAG_PREFIX.length);
      const label = this.shadow.getElementById(`exag-value-${layerId}`);
      if (label) label.textContent = `${val.toFixed(1)}x`;
      this.map.setExaggeration(val);
    } else if (id.startsWith(OPACITY_PREFIX)) {
      const layerId = id.slice(OPACITY_PREFIX.length);
      const label = this.shadow.getElementById(`opacity-value-${layerId}`);
      if (label) label.textContent = `${Math.round(val * 100)}%`;
      this.map.setDrapeOpacity(layerId, val);
    } else if (id === 'thickness-slider') {
      const label = this.shadow.getElementById('thickness-value');
      if (label) label.textContent = val.toFixed(1);
      this.map.setIsolineThickness(val);
    } else if (id === 'contour-slider') {
      const label = this.shadow.getElementById('contour-value');
      if (label) label.textContent = `${val}m`;
      this.map.setIsolineInterval(val);
    } else if (id === 'strength-slider') {
      const label = this.shadow.getElementById('strength-value');
      if (label) label.textContent = `${Math.round(val * 100)}%`;
      this.map.setHillshadeStrength(val);
    } else if (id === 'azimuth-slider') {
      const label = this.shadow.getElementById('azimuth-value');
      if (label) label.textContent = `${Math.round(val)}°`;
      this.map.setSunAzimuth(val);
    } else if (id === 'altitude-slider') {
      const label = this.shadow.getElementById('altitude-value');
      if (label) label.textContent = `${Math.round(val)}°`;
      this.map.setSunAltitude(val);
    }
  };

  // =========================================================================
  // Render (HTML generation - no event binding needed)
  // =========================================================================

  private render(): void {
    if (!this.map) return;

    const baseLayers = this.map.getBaseLayers();
    const drapeLayers = this.map.getDrapeLayers();

    const activeDrapeId = this.map.getActiveDrapeId();
    const isBaseDrape = this.map.isBaseDrapeActive();
    const activeBase = baseLayers.find((l) => l.visible);

    // Build each column: active section (button → settings) + selector (header hover → dropdown)
    const terrainCol = `
      <div class="layer-col" data-col="terrain">
        <div class="layer-col-active">
          ${this.renderActiveBaseLayer(activeBase)}
        </div>
        ${this.renderSelector('terrain', 'Terrain', baseLayers
          .filter((l) => !l.visible)
          .map((l) => this.renderBaseLayerButton(l))
          .join(''))}
      </div>`;

    const overlayCol = `
      <div class="layer-col" data-col="overlay">
        <div class="layer-col-active">
          ${this.renderActiveOverlay(isBaseDrape, activeDrapeId, drapeLayers)}
        </div>
        ${this.renderSelector('overlay', 'Overlay', this.renderOverlayDropdown(isBaseDrape, activeDrapeId, drapeLayers))}
      </div>`;

    // Order: from box outwards - Terrain nearest to icon
    const columns = this.hPos === 'right'
      ? overlayCol + terrainCol
      : terrainCol + overlayCol;

    // Only replace panel content - style tag and panel container persist.
    // Keep focus on the same control across the rebuild (keyboard users).
    if (this.panelEl) {
      const focused = this.shadow.activeElement as HTMLElement | null;
      const focusKey = focused?.id || focused?.dataset.focusKey;
      this.panelEl.innerHTML = columns;
      this.settingsEntering = false;
      this.syncSelectors();
      if (focusKey) {
        const el = this.panelEl.querySelector(focused!.id ? `#${CSS.escape(focusKey)}` : `[data-focus-key="${CSS.escape(focusKey)}"]`);
        (el as HTMLElement | null)?.focus();
      }
    }
  }

  /** Class list for a settings panel: hidden, or fading in right after opening. */
  private settingsClass(isOpen: boolean): string {
    if (!isOpen) return 'active-settings hidden';
    return this.settingsEntering ? 'active-settings entering' : 'active-settings';
  }

  /** Column title; with alternatives it is a chevron button for their dropdown. */
  private renderSelector(col: string, title: string, choices: string): string {
    if (!choices) {
      return `
        <div class="layer-col-selector">
          <div class="layer-col-header"><span class="layer-col-title">${title}</span></div>
        </div>`;
    }
    return `
      <div class="layer-col-selector has-choices" data-col="${col}">
        <button type="button" class="layer-col-header" aria-expanded="false" aria-label="Choose ${title.toLowerCase()}" data-focus-key="header-${col}">
          <span class="layer-col-title">${title}</span>
          <span class="header-chevron">${CHEVRON_SVG}</span>
        </button>
        <div class="layer-col-body">${choices}</div>
      </div>`;
  }

  // =========================================================================
  // Active section renderers (name + gear icon + expandable settings)
  // =========================================================================

  /** Render the active base layer row with gear → exaggeration slider. */
  private renderActiveBaseLayer(layer: BaseLayer | undefined): string {
    if (!layer) {
      return `<div class="active-btn-wrap"><div class="active-row is-empty"><span class="active-name">None</span></div></div>`;
    }

    const isOpen = this.settingsOpen === layer.id;
    const exag = this.map!.getExaggeration();

    return `
      <div class="active-btn-wrap">
        <button type="button" class="active-row" data-layer-id="${escapeHtml(layer.id)}" data-layer-type="base"
          data-focus-key="active-terrain" aria-expanded="${isOpen}" title="${escapeHtml(layer.layerName)} settings">
          <span class="active-name">${escapeHtml(layer.layerName)}</span>
          <span class="gear-icon" aria-hidden="true">${GEAR_SVG}</span>
        </button>
        <div class="${this.settingsClass(isOpen)}" data-layer-id="${escapeHtml(layer.id)}">
          <div class="control-row">
            <span class="control-label">Exaggeration</span>
            <span class="control-value" id="exag-value-${layer.id}">${exag.toFixed(1)}x</span>
          </div>
          <input type="range" id="exag-slider-${layer.id}" min="0.5" max="5.0" step="0.1"
            value="${exag}">
          ${this.renderLightSettings()}
        </div>
      </div>
    `;
  }

  /** Delegate to the appropriate active overlay renderer. */
  private renderActiveOverlay(
    isBaseDrape: boolean,
    activeDrapeId: string | null,
    drapeLayers: DrapeLayer[],
  ): string {
    if (isBaseDrape) {
      return this.renderActiveBaseDrape();
    }
    if (activeDrapeId) {
      const drape = drapeLayers.find((l: DrapeLayer) => l.id === activeDrapeId);
      if (drape) return this.renderActiveExternalDrape(drape);
    }
    return `<div class="active-btn-wrap"><div class="active-row is-empty"><span class="active-name">None</span></div></div>`;
  }

  /** Render the active Terrain mode: mode name + gear → mode-specific settings. */
  private renderActiveBaseDrape(): string {
    const mode = this.map!.getBaseDrapeMode();
    const isOpen = this.settingsOpen === BASE_DRAPE_ID;
    const label = mode.charAt(0).toUpperCase() + mode.slice(1);

    return `
      <div class="active-btn-wrap">
        <button type="button" class="active-row" data-layer-id="${BASE_DRAPE_ID}" data-layer-type="base-drape"
          data-focus-key="active-overlay" aria-expanded="${isOpen}" title="${label} settings">
          <span class="active-name">${label}</span>
          <span class="gear-icon" aria-hidden="true">${GEAR_SVG}</span>
        </button>
        <div class="${this.settingsClass(isOpen)}" data-layer-id="${BASE_DRAPE_ID}">
          ${this.renderModeSettings(mode)}
        </div>
      </div>
    `;
  }

  /** Render the active external drape: name + gear → opacity, blend mode, strength. */
  private renderActiveExternalDrape(drape: DrapeLayer): string {
    const isOpen = this.settingsOpen === drape.id;
    const opacity = this.map!.getDrapeOpacity(drape.id);
    const blendMode = this.map!.getDrapeBlendMode();
    const strength = this.map!.getHillshadeStrength();
    const showStrength = blendMode !== 'normal';

    return `
      <div class="active-btn-wrap">
        <button type="button" class="active-row" data-layer-id="${escapeHtml(drape.id)}" data-layer-type="drape"
          data-focus-key="active-overlay" aria-expanded="${isOpen}" title="${escapeHtml(drape.layerName)} settings">
          <span class="active-name">${escapeHtml(drape.layerName)}</span>
          <span class="gear-icon" aria-hidden="true">${GEAR_SVG}</span>
        </button>
        <div class="${this.settingsClass(isOpen)}" data-layer-id="${escapeHtml(drape.id)}">
          <div class="control-row">
            <span class="control-label">Opacity</span>
            <span class="control-value" id="opacity-value-${drape.id}">${Math.round(opacity * 100)}%</span>
          </div>
          <input type="range" id="opacity-slider-${drape.id}" min="0" max="1" step="0.05"
            value="${opacity}">

          <div class="setting-label">Terrain Blend</div>
          <div class="toggle-row" data-action-type="blend-mode">
            ${BLEND_MODES.map((m) =>
              `<button type="button" class="toggle-btn${blendMode === m.id ? ' active' : ''}" data-action="blend-mode" data-value="${m.id}"
                data-focus-key="blend-${m.id}" aria-pressed="${blendMode === m.id}">${m.label}</button>`
            ).join('')}
          </div>

          <div class="control-row${showStrength ? '' : ' hidden'}" id="strength-row">
            <span class="control-label">Strength</span>
            <span class="control-value" id="strength-value">${Math.round(strength * 100)}%</span>
          </div>
          <input type="range" id="strength-slider" class="${showStrength ? '' : 'hidden'}" min="0" max="1" step="0.05"
            value="${strength}">
        </div>
      </div>
    `;
  }

  // =========================================================================
  // Dropdown renderers (simple buttons, no gear icons)
  // =========================================================================

  /** Render a base layer as a simple selectable button (for dropdown). */
  private renderBaseLayerButton(layer: BaseLayer): string {
    return `
      <div class="layer-entry" data-layer-id="${escapeHtml(layer.id)}" data-layer-type="base">
        <button type="button" class="layer-btn" data-action="activate">${escapeHtml(layer.layerName)}</button>
      </div>
    `;
  }

  /** Build the overlay dropdown: Analysis group (terrain modes) then Layers group (external drapes). */
  private renderOverlayDropdown(
    isBaseDrape: boolean,
    activeDrapeId: string | null,
    drapeLayers: DrapeLayer[],
  ): string {
    const parts: string[] = [];
    const activeMode = isBaseDrape ? this.map!.getBaseDrapeMode() : null;

    // Wireframe mode available programmatically but hidden from the dropdown
    const visibleModes: BaseDrapeMode[] = ['elevation', 'slope', 'aspect', 'contours'];

    // Always show the Analysis group
    parts.push('<div class="dropdown-group-label">Analysis</div>');

    // Mode buttons (exclude active mode when base drape is active)
    for (const m of visibleModes) {
      if (m === activeMode) continue;
      const label = m.charAt(0).toUpperCase() + m.slice(1);
      parts.push(`
        <div class="layer-entry" data-layer-id="${BASE_DRAPE_ID}" data-layer-type="base-drape-mode" data-mode="${m}">
          <button type="button" class="layer-btn" data-action="activate">${label}</button>
        </div>
      `);
    }

    // External drape layers (excluding the active one)
    const inactiveDrapes = drapeLayers.filter((l: DrapeLayer) => l.id !== activeDrapeId);
    if (inactiveDrapes.length > 0) {
      parts.push('<div class="overlay-separator"></div>');
      parts.push('<div class="dropdown-group-label">Layers</div>');
      for (const drape of inactiveDrapes) {
        parts.push(`
          <div class="layer-entry" data-layer-id="${escapeHtml(drape.id)}" data-layer-type="drape">
            <button type="button" class="layer-btn" data-action="activate">${escapeHtml(drape.layerName)}</button>
          </div>
        `);
      }
    }

    return parts.join('');
  }

  // =========================================================================
  // Mode-specific settings (used within active-settings for Terrain overlay)
  // =========================================================================

  /**
   * Render the settings panel for a specific mode.
   */
  private renderModeSettings(mode: BaseDrapeMode): string {
    if (mode === 'wireframe') {
      return this.renderWireframeSettings();
    } else if (mode === 'contours') {
      return this.renderContourSettings();
    } else {
      // elevation, slope, aspect - color ramp picker
      return this.renderColorRampSettings();
    }
  }

  private renderWireframeSettings(): string {
    const isWhite = this.map!.getWireframeWhite();
    return `
      <div class="toggle-row">
        <span class="toggle-label">Coloring</span>
        <button type="button" class="toggle-btn${!isWhite ? ' active' : ''}" data-action="wireframe-mode" data-value="normals"
          data-focus-key="wire-normals" aria-pressed="${!isWhite}">Normals</button>
        <button type="button" class="toggle-btn${isWhite ? ' active' : ''}" data-action="wireframe-mode" data-value="white"
          data-focus-key="wire-white" aria-pressed="${isWhite}">White</button>
      </div>
    `;
  }

  private renderRampList(): string {
    const ramp = this.map!.getColorRamp();
    return `
      <div class="ramp-list" data-action-type="ramp">
        ${RAMP_META.map((r) =>
          `<button type="button" class="ramp-btn${ramp === r.id ? ' active' : ''}" data-value="${r.id}"
            data-focus-key="ramp-${r.id}" aria-pressed="${ramp === r.id}">
            <span>${r.label}</span>
            <span class="ramp-indicator" style="background:${r.gradient}"></span>
          </button>`
        ).join('')}
      </div>
    `;
  }

  private renderColorRampSettings(): string {
    return `
      <div class="setting-label">Color Ramp</div>
      ${this.renderRampList()}
    `;
  }

  private renderLightSettings(): string {
    const azimuth = this.map!.getSunAzimuth();
    const altitude = this.map!.getSunAltitude();

    return `
      <div class="setting-label">Light Direction</div>
      <div class="control-row">
        <span class="control-label">Direction</span>
        <span class="control-value" id="azimuth-value">${Math.round(azimuth)}°</span>
      </div>
      <input type="range" id="azimuth-slider" min="0" max="360" step="1" value="${azimuth}">
      <div class="control-row">
        <span class="control-label">Altitude</span>
        <span class="control-value" id="altitude-value">${Math.round(altitude)}°</span>
      </div>
      <input type="range" id="altitude-slider" min="5" max="90" step="1" value="${altitude}">
    `;
  }

  private renderContourSettings(): string {
    const interval = this.map!.getIsolineInterval();
    const thickness = this.map!.getIsolineThickness();
    const currentColor = this.map!.getIsolineColor();

    return `
      <div class="setting-label">Color Ramp</div>
      ${this.renderRampList()}

      <div class="setting-label">Line Color</div>
      <div class="swatch-row" data-action-type="contour-color">
        ${CONTOUR_COLORS.map((c) => {
          const active = Math.abs(c.rgb[0] - currentColor[0]) < 0.02
            && Math.abs(c.rgb[1] - currentColor[1]) < 0.02
            && Math.abs(c.rgb[2] - currentColor[2]) < 0.02;
          return `<button type="button" class="color-swatch${active ? ' active' : ''}"
            style="background:${c.hex}" data-r="${c.rgb[0]}" data-g="${c.rgb[1]}" data-b="${c.rgb[2]}"
            data-focus-key="swatch-${c.label}" title="${c.label}" aria-label="${c.label} lines" aria-pressed="${active}"></button>`;
        }).join('')}
      </div>

      <div class="control-row">
        <span class="control-label">Thickness</span>
        <span class="control-value" id="thickness-value">${thickness.toFixed(1)}</span>
      </div>
      <input type="range" id="thickness-slider" min="0.5" max="4.0" step="0.1" value="${thickness}">

      <div class="control-row">
        <span class="control-label">Interval</span>
        <span class="control-value" id="contour-value">${interval}m</span>
      </div>
      <input type="range" id="contour-slider" min="10" max="500" step="10" value="${interval}">
    `;
  }
}

