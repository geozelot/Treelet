// ============================================================================
// treelet.js - TreeletPanel Web Component
//
// <treelet-panel> - layer selection panel (slides out from layer box).
//
// Layout:
//   Each column: active section (name + gear → settings) + selector header
//
//   Terrain  - active base layer with gear → exaggeration, light, mesh
//              header → dropdown of other base layers (header is a
//              plain label when there is only one)
//
//   Overlay  - the coat stack (imagery + analyses) with gear → stack manager:
//                one row per coat, top first: visibility, name (→ its
//                settings), move up/down, remove
//                coat settings: opacity, blend, the analysis' parameters
//                (rendered from its schema) and ramp
//              header → dropdown:
//                Analysis group (registered analyses; adds a coat)
//                Layers group (drapes not active; swaps the imagery)
//
// A dropdown opens while the mouse is over its header or list, or after a
// tap / Enter on the header (until a tap elsewhere, Escape, or focus leaves).
// ============================================================================

import { panelStyles } from './styles';
import { BaseElement, escapeHtml } from './dom';
import type { Treelet } from '../core/Treelet';
import type { BlendMode } from '../core/types';
import type { BaseLayer } from '../layers/BaseLayer';
import type { DrapeLayer } from '../layers/DrapeLayer';
import type { AnalysisLayer } from '../layers/AnalysisLayer';
import type { StackLayer } from '../layers/LayerRegistry';
import type { ParamSpec, RGB } from '../analysis/types';
import { listAnalyses } from '../analysis/registry';
import { BUILTIN_RAMPS, isRampName, rampGradientCss, rampNamesFor } from '../analysis/ramps';

/** Settings-row id of the coat stack (the Overlay column's active row). */
const STACK_ID = '__stack__';

const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal',    label: 'Normal' },
  { id: 'multiply',  label: 'Multiply' },
  { id: 'screen',    label: 'Screen' },
  { id: 'softlight', label: 'Soft Light' },
];

/** SVG gear icon (14×14). */
const GEAR_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M13.3 10a1.2 1.2 0 0 0 .2 1.3l.1.1a1.4 1.4 0 1 1-2 2l-.1-.1a1.2 1.2 0 0 0-1.3-.2 1.2 1.2 0 0 0-.7 1.1v.2a1.4 1.4 0 1 1-2.9 0v-.1a1.2 1.2 0 0 0-.8-1.1 1.2 1.2 0 0 0-1.3.2l-.1.1a1.4 1.4 0 1 1-2-2l.1-.1a1.2 1.2 0 0 0 .2-1.3 1.2 1.2 0 0 0-1.1-.7h-.2a1.4 1.4 0 1 1 0-2.9h.1a1.2 1.2 0 0 0 1.1-.8 1.2 1.2 0 0 0-.2-1.3l-.1-.1a1.4 1.4 0 1 1 2-2l.1.1a1.2 1.2 0 0 0 1.3.2h.1a1.2 1.2 0 0 0 .7-1.1v-.2a1.4 1.4 0 1 1 2.9 0v.1a1.2 1.2 0 0 0 .7 1.1 1.2 1.2 0 0 0 1.3-.2l.1-.1a1.4 1.4 0 1 1 2 2l-.1.1a1.2 1.2 0 0 0-.2 1.3v.1a1.2 1.2 0 0 0 1.1.7h.2a1.4 1.4 0 1 1 0 2.9h-.1a1.2 1.2 0 0 0-1.1.7Z"/></svg>`;

/** SVG chevron (10×10, pointing down; CSS turns it toward where the list opens). */
const CHEVRON_SVG = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.75 5 6.25 7.5 3.75"/></svg>`;

/** Eye (visible) and eye-off icons (12×12). */
const EYE_SVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/></svg>`;
const EYE_OFF_SVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 2.5l11 11"/><path d="M6.3 6.4A2 2 0 0 0 9.6 9.7"/><path d="M4.4 4.9C2.6 6.1 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.2 0 2.3-.4 3.2-1"/><path d="M7 3.6c.3 0 .7-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.7 1.3-2 2.5"/></svg>`;
const UP_SVG = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.25 5 3.75l2.5 2.5"/></svg>`;
const DOWN_SVG = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.75 5 6.25l2.5-2.5"/></svg>`;
const CLOSE_SVG = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5"/></svg>`;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isAnalysis(layer: StackLayer): layer is AnalysisLayer {
  return 'descriptor' in layer;
}

function sameColor(a: RGB, b: RGB): boolean {
  return Math.abs(a[0] - b[0]) < 0.02 && Math.abs(a[1] - b[1]) < 0.02 && Math.abs(a[2] - b[2]) < 0.02;
}

function hex(c: RGB): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

function formatNumber(v: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  return v.toFixed(decimals);
}

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

  /** Which active row has its settings gear open (base layer id or STACK_ID). */
  private settingsOpen: string | null = null;

  /** Which coat in the stack manager has its settings expanded. */
  private coatOpen: string | null = null;

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
    this.setAttribute('data-h', this.hPos);

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
    this.coatOpen = null;
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
    const map = this.map;
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
      this.pinnedCol = null;
      this.render();
      return;
    }

    // === Dropdown entry → add an analysis, swap the imagery, or switch the base layer ===
    const layerBtn = target.closest('.layer-col-body .layer-btn[data-action="activate"]') as HTMLElement | null;
    if (layerBtn) {
      e.stopPropagation();
      const entry = layerBtn.closest('.layer-entry') as HTMLElement | null;
      if (!entry) return;

      const layerId = entry.dataset.layerId!;
      const layerType = entry.dataset.layerType!;
      const col = (entry.closest('.has-choices') as HTMLElement | null)?.dataset.col;

      this.pinnedCol = null;
      this.hoverCol = null;

      if (layerType === 'base') {
        this.settingsOpen = null;
        map.setActiveBaseLayer(layerId);
      } else if (layerType === 'analysis') {
        const handle = map.addAnalysisLayer({ analysis: entry.dataset.kind! });
        this.settingsOpen = STACK_ID;
        this.coatOpen = handle.id;
      } else if (layerType === 'drape') {
        map.activateDrapeLayer(layerId);
      }
      // The map's 'layerchange' re-renders; close now in case nothing changed
      this.syncSelectors();
      // The chosen entry is gone from the new list: keep keyboard focus on its column
      if (this.lastInput === 'keyboard' && col) {
        this.focusSelector(`.has-choices[data-col="${col}"] > .layer-col-header`);
      }
      return;
    }

    // === Stack rows ===
    const stackRow = target.closest('.stack-row[data-layer-id]') as HTMLElement | null;
    if (stackRow) {
      e.stopPropagation();
      const id = stackRow.dataset.layerId!;
      const action = (target.closest('[data-action]') as HTMLElement | null)?.dataset.action;
      if (action === 'visible') {
        map.setLayerVisible(id, stackRow.dataset.visible !== 'true');
      } else if (action === 'up' || action === 'down') {
        const index = parseInt(stackRow.dataset.index!, 10);
        map.moveLayer(id, action === 'up' ? index + 1 : index - 1);
      } else if (action === 'remove') {
        if (this.coatOpen === id) this.coatOpen = null;
        if (stackRow.dataset.layerType === 'drape') map.deactivateDrapeLayer();
        else map.removeAnalysisLayer(id);
      } else {
        this.coatOpen = this.coatOpen === id ? null : id;
        this.render();
      }
      return;
    }

    // === Coat settings controls (inside an expanded stack row) ===
    const control = target.closest('[data-action][data-layer-id]') as HTMLElement | null;
    if (control) {
      e.stopPropagation();
      const id = control.dataset.layerId!;
      const key = control.dataset.param ?? '';
      const value = control.dataset.value ?? '';
      switch (control.dataset.action) {
        case 'blend':
          map.setLayerBlendMode(id, value as BlendMode);
          break;
        case 'ramp':
          map.setAnalysisRamp(id, value as never);
          break;
        case 'color':
          map.setAnalysisParams(id, { [key]: [
            parseFloat(control.dataset.r!), parseFloat(control.dataset.g!), parseFloat(control.dataset.b!),
          ] });
          break;
        case 'select':
          map.setAnalysisParams(id, { [key]: value });
          break;
        case 'toggle':
          map.setAnalysisParams(id, { [key]: value === 'true' });
          break;
        case 'auto':
          if (value === 'true') {
            map.setAnalysisParams(id, { [key]: 'auto' });
          } else {
            const domain = map.getLegend(id)?.domain ?? [parseFloat(control.dataset.min!), parseFloat(control.dataset.max!)];
            map.setAnalysisParams(id, { [key]: [domain[0], domain[1]] });
          }
          break;
        case 'optional':
          // An optional span: off = null, on = the pair the button carries
          map.setAnalysisParams(id, {
            [key]: value === 'true' ? [parseFloat(control.dataset.min!), parseFloat(control.dataset.max!)] : null,
          });
          break;
        case 'wireframe':
          map.setWireframe(value !== 'solid');
          map.setWireframeWhite(value === 'white');
          this.render();
          break;
      }
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
      this.coatOpen = null;
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

  /** Sliders: `data-layer-id` + `data-param` say what they set. */
  private handleInput = (e: Event): void => {
    if (!this.map) return;
    const map = this.map;
    const target = e.target as HTMLInputElement;
    if (target.tagName !== 'INPUT') return;
    e.stopPropagation();
    const val = parseFloat(target.value);
    const id = target.dataset.layerId ?? '';
    const param = target.dataset.param ?? '';
    const label = this.panelEl?.querySelector<HTMLElement>(`[data-value-for="${CSS.escape(`${id}:${param}`)}"]`);

    if (param === 'exaggeration') {
      if (label) label.textContent = `${val.toFixed(1)}x`;
      map.setExaggeration(val);
    } else if (param === 'azimuth') {
      if (label) label.textContent = `${Math.round(val)}°`;
      map.setSunAzimuth(val);
    } else if (param === 'altitude') {
      if (label) label.textContent = `${Math.round(val)}°`;
      map.setSunAltitude(val);
    } else if (param === 'opacity') {
      if (label) label.textContent = `${Math.round(val * 100)}%`;
      map.setLayerOpacity(id, val);
    } else if (target.dataset.span !== undefined) {
      // One end of a [low, high] pair: read both sliders
      const other = this.panelEl?.querySelector<HTMLInputElement>(
        `input[data-layer-id="${CSS.escape(id)}"][data-param="${CSS.escape(param)}"][data-span="${target.dataset.span === '0' ? '1' : '0'}"]`,
      );
      const step = parseFloat(target.step) || 1;
      const a = target.dataset.span === '0' ? val : parseFloat(other?.value ?? '0');
      const b = target.dataset.span === '1' ? val : parseFloat(other?.value ?? '0');
      const unit = target.dataset.unit ?? '';
      if (target.dataset.wrap !== undefined) {
        // A circular range runs clockwise from a to b (a > b passes through north)
        if (label) label.textContent = `${formatNumber(a, step)}${unit} → ${formatNumber(b, step)}${unit}`;
        map.setAnalysisParams(id, { [param]: [a, b] });
      } else {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b, lo + step);
        if (label) label.textContent = `${formatNumber(lo, step)}–${formatNumber(hi, step)}${unit}`;
        map.setAnalysisParams(id, { [param]: [lo, hi] });
      }
    } else if (param) {
      const step = parseFloat(target.step) || 1;
      if (label) label.textContent = `${formatNumber(val, step)}${target.dataset.unit ?? ''}`;
      map.setAnalysisParams(id, { [param]: val });
    }
  };

  // =========================================================================
  // Render (HTML generation - no event binding needed)
  // =========================================================================

  private render(): void {
    if (!this.map) return;

    const baseLayers = this.map.getBaseLayers();
    const drapeLayers = this.map.getDrapeLayers();
    const stack = this.map.getLayerStack();
    const activeDrapeId = this.map.getActiveDrapeId();
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
          ${this.renderActiveStack(stack)}
        </div>
        ${this.renderSelector('overlay', 'Overlay', this.renderOverlayDropdown(activeDrapeId, drapeLayers))}
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
  private settingsClass(isOpen: boolean, extra = ''): string {
    if (!isOpen) return `active-settings hidden${extra}`;
    return (this.settingsEntering ? 'active-settings entering' : 'active-settings') + extra;
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

  /** Render the active base layer row with gear → exaggeration, light, mesh. */
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
          ${this.renderSlider(layer.id, 'exaggeration', 'Exaggeration', exag, 0.5, 5, 0.1, `${exag.toFixed(1)}x`)}
          ${this.renderLightSettings()}
          ${this.renderMeshSettings()}
        </div>
      </div>
    `;
  }

  /** The Overlay column's active row: the visible coats, and the stack manager behind the gear. */
  private renderActiveStack(stack: StackLayer[]): string {
    const isOpen = this.settingsOpen === STACK_ID;
    const names = stack.filter((l) => l.visible).map((l) => escapeHtml(l.layerName));
    const label = names.length ? names.join(' · ') : 'None';

    return `
      <div class="active-btn-wrap">
        <button type="button" class="active-row" data-layer-id="${STACK_ID}" data-layer-type="stack"
          data-focus-key="active-overlay" aria-expanded="${isOpen}" title="Overlay stack">
          <span class="active-name">${label}</span>
          <span class="gear-icon" aria-hidden="true">${GEAR_SVG}</span>
        </button>
        <div class="${this.settingsClass(isOpen, ' stack-settings')}" data-layer-id="${STACK_ID}">
          ${stack.length ? this.renderStackRows(stack) : '<div class="stack-empty">No overlays. Add one from the list.</div>'}
        </div>
      </div>
    `;
  }

  /** One row per coat, top of the stack first. */
  private renderStackRows(stack: StackLayer[]): string {
    const parts: string[] = [];
    for (let index = stack.length - 1; index >= 0; index--) {
      const layer = stack[index];
      const id = escapeHtml(layer.id);
      const open = this.coatOpen === layer.id;
      const type = isAnalysis(layer) ? 'analysis' : 'drape';
      parts.push(`
        <div class="stack-row${open ? ' open' : ''}${layer.visible ? '' : ' is-hidden'}" data-layer-id="${id}" data-layer-type="${type}"
          data-index="${index}" data-visible="${layer.visible}">
          <button type="button" class="stack-btn stack-eye" data-action="visible" data-focus-key="eye-${id}"
            aria-pressed="${layer.visible}" title="${layer.visible ? 'Hide' : 'Show'}">${layer.visible ? EYE_SVG : EYE_OFF_SVG}</button>
          <button type="button" class="stack-name" data-action="open" data-focus-key="coat-${id}" aria-expanded="${open}"
            title="${escapeHtml(layer.layerName)} settings">${escapeHtml(layer.layerName)}</button>
          <button type="button" class="stack-btn" data-action="up" data-focus-key="up-${id}" title="Move up"
            ${index === stack.length - 1 ? 'disabled' : ''}>${UP_SVG}</button>
          <button type="button" class="stack-btn" data-action="down" data-focus-key="down-${id}" title="Move down"
            ${index === 0 ? 'disabled' : ''}>${DOWN_SVG}</button>
          <button type="button" class="stack-btn stack-remove" data-action="remove" data-focus-key="remove-${id}"
            title="${type === 'drape' ? 'Remove imagery' : 'Remove'}">${CLOSE_SVG}</button>
        </div>
        ${open ? `<div class="coat-settings" data-layer-id="${id}">${this.renderCoatSettings(layer)}</div>` : ''}
      `);
    }
    return parts.join('');
  }

  /** Opacity, blend mode, then the analysis' parameters and ramp. */
  private renderCoatSettings(layer: StackLayer): string {
    const id = layer.id;
    const opacity = layer.display.opacity;
    const blend = layer.display.blendMode;
    const parts: string[] = [
      this.renderSlider(id, 'opacity', 'Opacity', opacity, 0, 1, 0.05, `${Math.round(opacity * 100)}%`),
      `<div class="setting-label">Blend</div>
      <div class="toggle-row wrap">
        ${BLEND_MODES.map((m) =>
          `<button type="button" class="toggle-btn${blend === m.id ? ' active' : ''}" data-action="blend" data-layer-id="${escapeHtml(id)}"
            data-value="${m.id}" data-focus-key="blend-${escapeHtml(id)}-${m.id}" aria-pressed="${blend === m.id}">${m.label}</button>`,
        ).join('')}
      </div>`,
    ];
    if (isAnalysis(layer)) {
      for (const spec of layer.descriptor.params) parts.push(this.renderParam(layer, spec));
      if (layer.isValueKind) parts.push(this.renderRampList(layer));
    }
    return parts.join('');
  }

  /** A labelled slider; `param` and the layer id ride on the input for the delegated handler. */
  private renderSlider(
    id: string, param: string, label: string, value: number, min: number, max: number, step: number, text: string, unit = '',
  ): string {
    const key = escapeHtml(`${id}:${param}`);
    return `
      <div class="control-row">
        <span class="control-label">${escapeHtml(label)}</span>
        <span class="control-value" data-value-for="${key}">${escapeHtml(text)}</span>
      </div>
      <input type="range" data-layer-id="${escapeHtml(id)}" data-param="${escapeHtml(param)}" data-unit="${escapeHtml(unit)}"
        min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${escapeHtml(label)}">`;
  }

  /** One parameter control from the analysis' schema. */
  private renderParam(layer: AnalysisLayer, spec: ParamSpec): string {
    const id = layer.id;
    const eid = escapeHtml(id);
    const value = layer.params[spec.key];
    const unit = 'unit' in spec ? spec.unit ?? '' : '';
    switch (spec.type) {
      case 'range': {
        const v = typeof value === 'number' ? value : spec.min;
        let [min, max] = [spec.min, spec.max];
        if (spec.bounds === 'elevation') {
          // The slider spans what is on screen (the value may lie outside it)
          const [lo, hi] = this.map!.getVisibleElevationRange();
          min = Math.max(spec.min, Math.floor(Math.min(lo, v) / spec.step) * spec.step);
          max = Math.min(spec.max, Math.ceil(Math.max(hi, v, min + spec.step) / spec.step) * spec.step);
        }
        return this.renderSlider(id, spec.key, spec.label, v, min, max, spec.step, `${formatNumber(v, spec.step)}${unit}`, unit);
      }
      case 'span': {
        const auto = value === 'auto';
        const off = value === null;
        const parts: string[] = [];
        if (spec.optional) {
          // Default sector when switched on: through north for bearings, else the full range
          const on: [number, number] = spec.wrap ? [315, 45] : [spec.min, spec.max];
          parts.push(`
            <div class="toggle-row">
              <span class="toggle-label">${escapeHtml(spec.label)}</span>
              <span class="toggle-group">
                <button type="button" class="toggle-btn${off ? ' active' : ''}" data-action="optional" data-layer-id="${eid}" data-param="${spec.key}"
                  data-value="false" data-focus-key="off-${eid}-${spec.key}" aria-pressed="${off}">All</button>
                <button type="button" class="toggle-btn${off ? '' : ' active'}" data-action="optional" data-layer-id="${eid}" data-param="${spec.key}"
                  data-value="true" data-min="${on[0]}" data-max="${on[1]}" data-focus-key="on-${eid}-${spec.key}" aria-pressed="${!off}">${spec.wrap ? 'Sector' : 'Range'}</button>
              </span>
            </div>`);
          if (off) return parts.join('');
        }
        if (spec.auto) {
          parts.push(`
            <div class="toggle-row">
              <span class="toggle-label">${escapeHtml(spec.label)}</span>
              <span class="toggle-group">
                <button type="button" class="toggle-btn${auto ? ' active' : ''}" data-action="auto" data-layer-id="${eid}" data-param="${spec.key}"
                  data-value="true" data-focus-key="auto-${eid}-${spec.key}" aria-pressed="${auto}">Auto</button>
                <button type="button" class="toggle-btn${auto ? '' : ' active'}" data-action="auto" data-layer-id="${eid}" data-param="${spec.key}"
                  data-value="false" data-min="${spec.min}" data-max="${spec.max}" data-focus-key="manual-${eid}-${spec.key}" aria-pressed="${!auto}">Manual</button>
              </span>
            </div>`);
        }
        if (auto) {
          const d = this.map!.getLegend(id)?.domain;
          if (d) parts.push(`<div class="control-row"><span class="control-label">Visible</span><span class="control-value">${formatNumber(d[0], spec.step)}–${formatNumber(d[1], spec.step)}${unit}</span></div>`);
        } else {
          const [lo, hi] = Array.isArray(value) ? value as [number, number] : [spec.min, spec.max];
          const key = escapeHtml(`${id}:${spec.key}`);
          const wrap = spec.wrap ? ' data-wrap=""' : '';
          const text = spec.wrap
            ? `${formatNumber(lo, spec.step)}${unit} → ${formatNumber(hi, spec.step)}${unit}`
            : `${formatNumber(lo, spec.step)}–${formatNumber(hi, spec.step)}${unit}`;
          parts.push(`
            <div class="control-row">
              <span class="control-label">${spec.auto || spec.optional ? (spec.wrap ? 'From → to' : 'Range') : escapeHtml(spec.label)}</span>
              <span class="control-value" data-value-for="${key}">${text}</span>
            </div>
            <input type="range" data-layer-id="${eid}" data-param="${spec.key}" data-span="0" data-unit="${escapeHtml(unit)}"${wrap}
              min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${lo}" aria-label="${escapeHtml(spec.label)} ${spec.wrap ? 'from' : 'low'}">
            <input type="range" data-layer-id="${eid}" data-param="${spec.key}" data-span="1" data-unit="${escapeHtml(unit)}"${wrap}
              min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${hi}" aria-label="${escapeHtml(spec.label)} ${spec.wrap ? 'to' : 'high'}">`);
        }
        return parts.join('');
      }
      case 'select':
        return `
          <div class="toggle-row">
            <span class="toggle-label">${escapeHtml(spec.label)}</span>
            <span class="toggle-group">
              ${spec.options.map((o) => {
                const active = String(value) === o.value;
                return `<button type="button" class="toggle-btn${active ? ' active' : ''}" data-action="select" data-layer-id="${eid}"
                  data-param="${spec.key}" data-value="${escapeHtml(o.value)}" data-focus-key="sel-${eid}-${spec.key}-${escapeHtml(o.value)}"
                  aria-pressed="${active}">${escapeHtml(o.label)}</button>`;
              }).join('')}
            </span>
          </div>`;
      case 'color': {
        const current = Array.isArray(value) ? value as RGB : [0, 0, 0] as RGB;
        const presets = spec.presets ?? [];
        return `
          <div class="setting-label">${escapeHtml(spec.label)}</div>
          <div class="swatch-row">
            ${presets.map((p) => {
              const active = sameColor(p.color, current);
              return `<button type="button" class="color-swatch${active ? ' active' : ''}" data-action="color" data-layer-id="${eid}"
                data-param="${spec.key}" style="background:${hex(p.color)}" data-r="${p.color[0]}" data-g="${p.color[1]}" data-b="${p.color[2]}"
                data-focus-key="swatch-${eid}-${spec.key}-${escapeHtml(p.label)}" title="${escapeHtml(p.label)}" aria-label="${escapeHtml(p.label)}" aria-pressed="${active}"></button>`;
            }).join('')}
          </div>`;
      }
      case 'boolean': {
        const on = value === true;
        return `
          <div class="toggle-row">
            <span class="toggle-label">${escapeHtml(spec.label)}</span>
            <span class="toggle-group">
              <button type="button" class="toggle-btn${on ? ' active' : ''}" data-action="toggle" data-layer-id="${eid}" data-param="${spec.key}"
                data-value="true" data-focus-key="on-${eid}-${spec.key}" aria-pressed="${on}">On</button>
              <button type="button" class="toggle-btn${on ? '' : ' active'}" data-action="toggle" data-layer-id="${eid}" data-param="${spec.key}"
                data-value="false" data-focus-key="off-${eid}-${spec.key}" aria-pressed="${!on}">Off</button>
            </span>
          </div>`;
      }
    }
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

  /** Build the overlay dropdown: Analysis group (adds a coat) then Layers group (drapes not active). */
  private renderOverlayDropdown(activeDrapeId: string | null, drapeLayers: DrapeLayer[]): string {
    const parts: string[] = [];

    parts.push('<div class="dropdown-group-label">Analysis</div>');
    for (const d of listAnalyses()) {
      parts.push(`
        <div class="layer-entry" data-layer-id="${escapeHtml(d.id)}" data-layer-type="analysis" data-kind="${escapeHtml(d.id)}">
          <button type="button" class="layer-btn" data-action="activate">${escapeHtml(d.label)}</button>
        </div>
      `);
    }

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
  // Settings pieces
  // =========================================================================

  private renderRampList(layer: AnalysisLayer): string {
    const eid = escapeHtml(layer.id);
    const current = layer.ramp ?? layer.descriptor.ramp;
    const custom = current !== undefined && !isRampName(current);
    // Class presets place their breaks on the layer's value range
    const domain = this.map!.getLegend(layer.id)?.domain ?? [0, 1];
    return `
      <div class="setting-label">Color Ramp</div>
      <div class="ramp-list">
        ${rampNamesFor(layer.descriptor.id).map((name) => {
          const active = current === name;
          const spec = BUILTIN_RAMPS[name];
          return `<button type="button" class="ramp-btn${active ? ' active' : ''}" data-action="ramp" data-layer-id="${eid}" data-value="${name}"
            data-focus-key="ramp-${eid}-${name}" aria-pressed="${active}">
            <span>${capitalize(name)}</span>
            <span class="ramp-indicator" style="background:${rampGradientCss(spec, spec.type === 'classes' ? domain : [0, 1])}"></span>
          </button>`;
        }).join('')}
        ${custom ? `<div class="ramp-btn active" aria-current="true"><span>Custom</span>
          <span class="ramp-indicator" style="background:${rampGradientCss(current, domain)}"></span></div>` : ''}
      </div>
    `;
  }

  private renderLightSettings(): string {
    const azimuth = this.map!.getSunAzimuth();
    const altitude = this.map!.getSunAltitude();
    return `
      <div class="setting-label">Light Direction</div>
      ${this.renderSlider('sun', 'azimuth', 'Direction', azimuth, 0, 360, 1, `${Math.round(azimuth)}°`)}
      ${this.renderSlider('sun', 'altitude', 'Altitude', altitude, 5, 90, 1, `${Math.round(altitude)}°`)}
    `;
  }

  private renderMeshSettings(): string {
    const wire = this.map!.getWireframe();
    const white = this.map!.getWireframeWhite();
    const mode = !wire ? 'solid' : white ? 'white' : 'wire';
    const options: Array<[string, string]> = [['solid', 'Solid'], ['wire', 'Wireframe'], ['white', 'White']];
    return `
      <div class="toggle-row">
        <span class="toggle-label">Mesh</span>
        <span class="toggle-group">
          ${options.map(([v, label]) =>
            `<button type="button" class="toggle-btn${mode === v ? ' active' : ''}" data-action="wireframe" data-layer-id="mesh"
              data-value="${v}" data-focus-key="mesh-${v}" aria-pressed="${mode === v}">${label}</button>`,
          ).join('')}
        </span>
      </div>
    `;
  }
}
