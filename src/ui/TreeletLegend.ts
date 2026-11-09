// ============================================================================
// treelet.js - TreeletLegend Web Component
//
// <treelet-legend> - legends of the visible value analyses (elevation,
// slope…): a ramp bar with its range, or class swatches with labels. Sits
// in a corner of the map, above the attribution bar when both share one.
// Re-renders on 'layerchange' and when an 'auto' range follows the view.
// ============================================================================

import { BaseElement, escapeHtml } from './dom';
import type { Treelet } from '../core/Treelet';
import type { UICorner } from '../core/types';
import type { LegendSpec, RGB } from '../analysis/types';

function hex(c: RGB): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

function formatValue(v: number): string {
  const a = Math.abs(v);
  const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

const legendStyles = /* css */ `
  :host {
    position: absolute;
    z-index: 998;
    display: block;
    max-width: min(240px, calc(100% - 24px));
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 11px;
    line-height: 1.35;
    pointer-events: none;
    color-scheme: light dark;

    --bg: light-dark(#fafafa, #181818);
    --surface-bg: var(--bg);
    --surface-filter: none;
    --border: light-dark(rgba(0, 0, 0, 0.10), rgba(255, 255, 255, 0.08));
    --shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    --text: light-dark(#333333, #e8e8e8);
    --text-dim: light-dark(rgba(0, 0, 0, 0.55), rgba(255, 255, 255, 0.55));
    --radius: 10px;
    color: var(--text);
  }

  @media (prefers-color-scheme: light) {
    :host { --shadow: 0 4px 16px rgba(0, 0, 0, 0.10); }
  }

  :host([glass]) {
    --surface-bg: light-dark(rgba(250, 250, 250, 0.72), rgba(24, 24, 24, 0.66));
    --surface-filter: blur(14px) saturate(1.5);
  }

  :host([data-h="left"])  { left: 12px; }
  :host([data-h="right"]) { right: 12px; }
  :host([data-v="top"])    { top: 12px; }
  /* Above the attribution bar */
  :host([data-v="bottom"]) { bottom: 24px; }

  :host([hidden]) { display: none; }

  .legend {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 7px 9px 8px;
    background: var(--surface-bg);
    -webkit-backdrop-filter: var(--surface-filter);
    backdrop-filter: var(--surface-filter);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    pointer-events: auto;
  }

  .legend-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.6;
    margin-bottom: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .legend-bar {
    height: 8px;
    border-radius: 4px;
    border: 1px solid var(--border);
  }

  .legend-range {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 2px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  .legend-class {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 1px 0;
  }

  .legend-swatch {
    flex-shrink: 0;
    width: 14px;
    height: 10px;
    border-radius: 2px;
    border: 1px solid var(--border);
  }
`;

/**
 * <treelet-legend> - legends for the visible analyses.
 */
export class TreeletLegend extends BaseElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;
  private bodyEl: HTMLDivElement | null = null;
  private readonly rerender = (): void => this.render();

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  /**
   * Attach to a Treelet instance and render in the given corner.
   */
  attach(map: Treelet, corner: UICorner = 'bottom-left', options: { glass?: boolean } = {}): void {
    this.map = map;
    this.setAttribute('data-v', corner.startsWith('top') ? 'top' : 'bottom');
    this.setAttribute('data-h', corner.endsWith('left') ? 'left' : 'right');
    if (options.glass) this.setAttribute('glass', '');
    else this.removeAttribute('glass');
    if (!this.bodyEl) {
      this.shadow.innerHTML = `<style>${legendStyles}</style><div class="legend" role="list" aria-label="Legend"></div>`;
      this.bodyEl = this.shadow.querySelector('.legend') as HTMLDivElement;
      map.on('layerchange', this.rerender);
      map.on('rangechange', this.rerender);
    }
    this.render();
  }

  disconnectedCallback(): void {
    this.map?.off('layerchange', this.rerender);
    this.map?.off('rangechange', this.rerender);
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    if (!this.map || !this.bodyEl) return;
    const legends = this.map.getLegends();
    this.hidden = legends.length === 0;
    this.bodyEl.innerHTML = legends.map((l) => this.renderLegend(l)).join('');
  }

  private renderLegend(l: LegendSpec): string {
    const unit = l.unit ? ` (${escapeHtml(l.unit)})` : '';
    const title = `<div class="legend-title" title="${escapeHtml(l.title)}">${escapeHtml(l.title)}${unit}</div>`;
    if (l.type === 'classes') {
      const rows = (l.classes ?? []).map((c) =>
        `<div class="legend-class"><span class="legend-swatch" style="background:${hex(c.color)}"></span><span>${escapeHtml(c.label)}</span></div>`,
      ).reverse().join('');
      return `<div class="legend-item" role="listitem">${title}${rows}</div>`;
    }
    const stops = (l.stops ?? []).map(([t, c]) => `${hex(c)} ${(t * 100).toFixed(1)}%`).join(', ');
    return `<div class="legend-item" role="listitem">${title}
      <div class="legend-bar" style="background:linear-gradient(to right, ${stops})"></div>
      <div class="legend-range"><span>${formatValue(l.domain[0])}</span><span>${formatValue(l.domain[1])}</span></div>
    </div>`;
  }
}
