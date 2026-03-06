// ============================================================================
// treelet.js - TreeletPanel Web Component
//
// <treelet-panel> - layer/overlay selection panel (slides out from layer box).
//
// Layout:
//   Each column: active section (name + gear → settings) + selector header
//
//   Terrain  - active base layer with gear → exaggeration slider
//              header hover → dropdown of other base layers
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
//              header hover → dropdown:
//                Terrain group (modes, always first)
//                Layer group (external drapes, if present)
// ============================================================================

import { panelStyles } from './styles';
import type { Treelet } from '../core/Treelet';
import type { BaseDrapeMode, ColorRamp } from '../core/types';
import type { BaseLayer } from '../layers/base/BaseLayer';
import type { DrapeLayer } from '../layers/drape/DrapeLayer';

/** Color ramp metadata with CSS gradient for the indicator strip. */
const RAMP_META: { id: ColorRamp; label: string; gradient: string }[] = [
  { id: 'hypsometric', label: 'Hypsometric', gradient: 'linear-gradient(to right, #264d1e, #8fa35a, #d4b06a, #f5e6c8, #fff)' },
  { id: 'viridis',     label: 'Viridis',     gradient: 'linear-gradient(to right, #440154, #31688e, #35b779, #fde725)' },
  { id: 'inferno',     label: 'Inferno',     gradient: 'linear-gradient(to right, #000004, #57106e, #bc3754, #f98e09, #fcffa4)' },
  { id: 'grayscale',   label: 'Grayscale',   gradient: 'linear-gradient(to right, #000, #fff)' },
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

/** SVG gear icon (14×14). */
const GEAR_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M13.3 10a1.2 1.2 0 0 0 .2 1.3l.1.1a1.4 1.4 0 1 1-2 2l-.1-.1a1.2 1.2 0 0 0-1.3-.2 1.2 1.2 0 0 0-.7 1.1v.2a1.4 1.4 0 1 1-2.9 0v-.1a1.2 1.2 0 0 0-.8-1.1 1.2 1.2 0 0 0-1.3.2l-.1.1a1.4 1.4 0 1 1-2-2l.1-.1a1.2 1.2 0 0 0 .2-1.3 1.2 1.2 0 0 0-1.1-.7h-.2a1.4 1.4 0 1 1 0-2.9h.1a1.2 1.2 0 0 0 1.1-.8 1.2 1.2 0 0 0-.2-1.3l-.1-.1a1.4 1.4 0 1 1 2-2l.1.1a1.2 1.2 0 0 0 1.3.2h.1a1.2 1.2 0 0 0 .7-1.1v-.2a1.4 1.4 0 1 1 2.9 0v.1a1.2 1.2 0 0 0 .7 1.1 1.2 1.2 0 0 0 1.3-.2l.1-.1a1.4 1.4 0 1 1 2 2l-.1.1a1.2 1.2 0 0 0-.2 1.3v.1a1.2 1.2 0 0 0 1.1.7h.2a1.4 1.4 0 1 1 0 2.9h-.1a1.2 1.2 0 0 0-1.1.7Z"/></svg>`;

/**
 * <treelet-panel> - Main UI panel for treelet.js.
 */
export class TreeletPanel extends HTMLElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;

  /** Vertical position for direction-aware expansion. */
  private vPos: 'top' | 'bottom' = 'top';

  /** Horizontal position - controls column order (from box outwards). */
  private hPos: 'left' | 'right' = 'right';

  /** Which layer has its settings gear open (id or '__base_drape__'). */
  private settingsOpen: string | null = null;

  /** Which mode entry inside Terrain overlay has its gear open. */
  private modeSettingsOpen: BaseDrapeMode | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  attach(map: Treelet, vPos?: 'top' | 'bottom', hPos?: 'left' | 'right'): void {
    this.map = map;
    if (vPos) this.vPos = vPos;
    if (hPos) this.hPos = hPos;
    this.setAttribute('data-v', this.vPos);
    this.render();
  }

  refresh(): void {
    if (this.map) this.render();
  }

  /** Reset all open settings (called by compass on mouseleave). */
  resetSettings(): void {
    this.settingsOpen = null;
    this.modeSettingsOpen = null;
    this.render();
  }

  private render(): void {
    if (!this.map) return;

    const baseLayers = this.map.getBaseLayers();
    const drapeLayers = this.map.getDrapeLayers();

    const activeDrapeId = this.map.getActiveDrapeId();
    const isBaseDrape = this.map.isBaseDrapeActive();
    const activeBase = baseLayers.find((l) => l.active);

    // Build each column: active section (button → settings) + selector (header hover → dropdown)
    const terrainCol = `
      <div class="layer-col" data-col="terrain">
        <div class="layer-col-active">
          ${this.renderActiveBaseLayer(activeBase)}
        </div>
        <div class="layer-col-selector">
          <div class="layer-col-header">
            <div class="layer-col-title">Terrain</div>
            <span class="header-chevron"></span>
          </div>
          <div class="layer-col-body">
            ${baseLayers
              .filter((l) => !l.active)
              .map((l) => this.renderBaseLayerButton(l))
              .join('')}
          </div>
        </div>
      </div>`;

    const overlayCol = `
      <div class="layer-col" data-col="overlay">
        <div class="layer-col-active">
          ${this.renderActiveOverlay(isBaseDrape, activeDrapeId, drapeLayers)}
        </div>
        <div class="layer-col-selector">
          <div class="layer-col-header">
            <div class="layer-col-title">Overlay</div>
            <span class="header-chevron"></span>
          </div>
          <div class="layer-col-body">
            ${this.renderOverlayDropdown(isBaseDrape, activeDrapeId, drapeLayers)}
          </div>
        </div>
      </div>`;

    // Order: from box outwards - Terrain nearest to icon
    const columns = this.hPos === 'right'
      ? overlayCol + terrainCol
      : terrainCol + overlayCol;

    this.shadow.innerHTML = `
      <style>${panelStyles}</style>
      <div class="panel">${columns}</div>
    `;

    this.bindEvents();
  }

  // =========================================================================
  // Active section renderers (name + gear icon + expandable settings)
  // =========================================================================

  /** Render the active base layer row with gear → exaggeration slider. */
  private renderActiveBaseLayer(layer: BaseLayer | undefined): string {
    if (!layer) {
      return `<div class="active-btn-wrap"><div class="active-row"><span class="active-name">None</span></div></div>`;
    }

    const isOpen = this.settingsOpen === layer.id;
    const exag = this.map!.getExaggeration();

    return `
      <div class="active-btn-wrap">
        <div class="active-row" data-layer-id="${layer.id}" data-layer-type="base">
          <span class="active-name">${layer.name}</span>
          <span class="gear-icon${isOpen ? ' open' : ''}" data-action="gear">${GEAR_SVG}</span>
        </div>
        <div class="active-settings${isOpen ? '' : ' hidden'}" data-layer-id="${layer.id}">
          <div class="control-row">
            <span class="control-label">Exaggeration</span>
            <span class="control-value" id="exag-value-${layer.id}">${exag.toFixed(1)}x</span>
          </div>
          <input type="range" id="exag-slider-${layer.id}" min="0.5" max="5.0" step="0.1"
            value="${exag}">
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
    return `<div class="active-btn-wrap"><div class="active-row"><span class="active-name">None</span></div></div>`;
  }

  /** Render the active Terrain mode: mode name + gear → mode-specific settings. */
  private renderActiveBaseDrape(): string {
    const mode = this.map!.getBaseDrapeMode();
    const isOpen = this.settingsOpen === '__base_drape__';
    const label = mode.charAt(0).toUpperCase() + mode.slice(1);

    return `
      <div class="active-btn-wrap">
        <div class="active-row" data-layer-id="__base_drape__" data-layer-type="base-drape">
          <span class="active-name">${label}</span>
          <span class="gear-icon${isOpen ? ' open' : ''}" data-action="gear">${GEAR_SVG}</span>
        </div>
        <div class="active-settings${isOpen ? '' : ' hidden'}" data-layer-id="__base_drape__">
          ${this.renderModeSettings(mode)}
        </div>
      </div>
    `;
  }

  /** Render the active external drape: name + gear → opacity slider. */
  private renderActiveExternalDrape(drape: DrapeLayer): string {
    const isOpen = this.settingsOpen === drape.id;
    const opacity = this.map!.getDrapeOpacity(drape.id);

    return `
      <div class="active-btn-wrap">
        <div class="active-row" data-layer-id="${drape.id}" data-layer-type="drape">
          <span class="active-name">${drape.name}</span>
          <span class="gear-icon${isOpen ? ' open' : ''}" data-action="gear">${GEAR_SVG}</span>
        </div>
        <div class="active-settings${isOpen ? '' : ' hidden'}" data-layer-id="${drape.id}">
          <div class="control-row">
            <span class="control-label">Opacity</span>
            <span class="control-value" id="opacity-value-${drape.id}">${Math.round(opacity * 100)}%</span>
          </div>
          <input type="range" id="opacity-slider-${drape.id}" min="0" max="1" step="0.05"
            value="${opacity}">
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
      <div class="layer-entry" data-layer-id="${layer.id}" data-layer-type="base">
        <button class="layer-btn" data-action="activate">${layer.name}</button>
      </div>
    `;
  }

  /** Build the overlay dropdown: Terrain group (modes) then Layer group (external drapes). */
  private renderOverlayDropdown(
    isBaseDrape: boolean,
    activeDrapeId: string | null,
    drapeLayers: DrapeLayer[],
  ): string {
    const parts: string[] = [];
    const activeMode = isBaseDrape ? this.map!.getBaseDrapeMode() : null;

    // Wireframe mode available programmatically but hidden from the dropdown
    const visibleModes: BaseDrapeMode[] = ['elevation', 'slope', 'aspect', 'contours'];

    // Always show Terrain group
    parts.push('<div class="dropdown-group-label">Terrain</div>');

    // Mode buttons (exclude active mode when base drape is active)
    for (const m of visibleModes) {
      if (m === activeMode) continue;
      const label = m.charAt(0).toUpperCase() + m.slice(1);
      parts.push(`
        <div class="layer-entry" data-layer-id="__base_drape__" data-layer-type="base-drape-mode" data-mode="${m}">
          <button class="layer-btn" data-action="activate">${label}</button>
        </div>
      `);
    }

    // External drape layers (excluding the active one)
    const inactiveDrapes = drapeLayers.filter((l: DrapeLayer) => l.id !== activeDrapeId);
    if (inactiveDrapes.length > 0) {
      parts.push('<div class="overlay-separator"></div>');
      parts.push('<div class="dropdown-group-label">Layer</div>');
      for (const drape of inactiveDrapes) {
        parts.push(`
          <div class="layer-entry" data-layer-id="${drape.id}" data-layer-type="drape">
            <button class="layer-btn" data-action="activate">${drape.name}</button>
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
        <button class="toggle-btn${!isWhite ? ' active' : ''}" data-action="wireframe-mode" data-value="normals">Normals</button>
        <button class="toggle-btn${isWhite ? ' active' : ''}" data-action="wireframe-mode" data-value="white">White</button>
      </div>
    `;
  }

  private renderRampList(): string {
    const ramp = this.map!.getColorRamp();
    return `
      <div class="ramp-list" data-action-type="ramp">
        ${RAMP_META.map((r) =>
          `<button class="ramp-btn${ramp === r.id ? ' active' : ''}" data-value="${r.id}">
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

  private renderContourSettings(): string {
    const interval = this.map!.getContourInterval();
    const thickness = this.map!.getContourThickness();
    const currentColor = this.map!.getContourColor();

    return `
      <div class="setting-label">Color Ramp</div>
      ${this.renderRampList()}

      <div class="setting-label">Line Color</div>
      <div class="swatch-row" data-action-type="contour-color">
        ${CONTOUR_COLORS.map((c) => {
          const active = Math.abs(c.rgb[0] - currentColor[0]) < 0.02
            && Math.abs(c.rgb[1] - currentColor[1]) < 0.02
            && Math.abs(c.rgb[2] - currentColor[2]) < 0.02;
          return `<div class="color-swatch${active ? ' active' : ''}"
            style="background:${c.hex}" data-r="${c.rgb[0]}" data-g="${c.rgb[1]}" data-b="${c.rgb[2]}"
            title="${c.label}"></div>`;
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

  // =========================================================================
  // Event binding
  // =========================================================================

  private bindEvents(): void {
    if (!this.map) return;

    // Active row clicks - toggle settings panel (whole row is the button)
    this.shadow.querySelectorAll<HTMLElement>('.active-row[data-layer-id]').forEach((row) => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const layerId = row.dataset.layerId!;
        const opening = this.settingsOpen !== layerId;
        this.settingsOpen = opening ? layerId : null;
        this.modeSettingsOpen = null;      // close nested mode gear
        this.render();
      });
    });

    // Layer button clicks in dropdown - activate the layer & close all settings
    this.shadow.querySelectorAll<HTMLElement>('.layer-col-body .layer-btn[data-action="activate"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const entry = btn.closest('.layer-entry') as HTMLElement | null;
        if (!entry) return;

        const layerId = entry.dataset.layerId!;
        const layerType = entry.dataset.layerType!;

        // Close all open settings when switching layers
        this.settingsOpen = null;
        this.modeSettingsOpen = null;

        if (layerType === 'base') {
          this.map!.setActiveBaseLayer(layerId);
        } else if (layerType === 'base-drape') {
          this.map!.activateBaseDrape();
        } else if (layerType === 'base-drape-mode') {
          const mode = entry.dataset.mode as BaseDrapeMode;
          this.map!.activateBaseDrape();
          this.map!.setBaseDrapeMode(mode);
        } else if (layerType === 'drape') {
          this.map!.activateDrapeLayer(layerId);
        }
      });
    });

    // Wireframe normals/white toggle buttons
    this.shadow.querySelectorAll<HTMLElement>('[data-action="wireframe-mode"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = btn.dataset.value;
        this.map!.setWireframeWhite(val === 'white');
        this.render();
      });
    });

    // Color ramp buttons
    this.shadow.querySelectorAll<HTMLElement>('.ramp-list[data-action-type="ramp"] .ramp-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ramp = btn.dataset.value as ColorRamp;
        this.map!.setColorRamp(ramp);
        this.render();
      });
    });

    // Contour color swatches
    this.shadow.querySelectorAll<HTMLElement>('.swatch-row[data-action-type="contour-color"] .color-swatch').forEach((swatch) => {
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        const r = parseFloat(swatch.dataset.r!);
        const g = parseFloat(swatch.dataset.g!);
        const b = parseFloat(swatch.dataset.b!);
        this.map!.setContourColor(r, g, b);
        this.render();
      });
    });

    // Contour thickness slider
    const thicknessSlider = this.shadow.getElementById('thickness-slider') as HTMLInputElement | null;
    const thicknessValue = this.shadow.getElementById('thickness-value');
    thicknessSlider?.addEventListener('input', (e) => {
      e.stopPropagation();
      const val = parseFloat(thicknessSlider.value);
      if (thicknessValue) thicknessValue.textContent = val.toFixed(1);
      this.map!.setContourThickness(val);
    });
    thicknessSlider?.addEventListener('click', (e) => e.stopPropagation());

    // Contour interval slider
    const contourSlider = this.shadow.getElementById('contour-slider') as HTMLInputElement | null;
    const contourValue = this.shadow.getElementById('contour-value');
    contourSlider?.addEventListener('input', (e) => {
      e.stopPropagation();
      const val = parseFloat(contourSlider.value);
      if (contourValue) contourValue.textContent = `${val}m`;
      this.map!.setContourInterval(val);
    });
    contourSlider?.addEventListener('click', (e) => e.stopPropagation());

    // Exaggeration sliders (one per base layer)
    this.shadow.querySelectorAll<HTMLInputElement>('input[id^="exag-slider-"]').forEach((slider) => {
      const layerId = slider.id.replace('exag-slider-', '');
      const valueEl = this.shadow.getElementById(`exag-value-${layerId}`);

      slider.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = parseFloat(slider.value);
        if (valueEl) valueEl.textContent = `${val.toFixed(1)}x`;
        this.map!.setExaggeration(val);
      });
      slider.addEventListener('click', (e) => e.stopPropagation());
    });

    // Opacity sliders (one per external drape)
    this.shadow.querySelectorAll<HTMLInputElement>('input[id^="opacity-slider-"]').forEach((slider) => {
      const layerId = slider.id.replace('opacity-slider-', '');
      const valueEl = this.shadow.getElementById(`opacity-value-${layerId}`);

      slider.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = parseFloat(slider.value);
        if (valueEl) valueEl.textContent = `${Math.round(val * 100)}%`;
        this.map!.setDrapeOpacity(layerId, val);
      });
      slider.addEventListener('click', (e) => e.stopPropagation());
    });
  }
}

// Register the custom element
if (typeof customElements !== 'undefined' && !customElements.get('treelet-panel')) {
  customElements.define('treelet-panel', TreeletPanel);
}
