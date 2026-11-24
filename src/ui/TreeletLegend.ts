// ============================================================================
// treelet.js - TreeletLegend Web Component
//
// <treelet-legend> - legends of the visible value analyses (elevation,
// slope…), as rows of the info column's Legend page: a group header with
// the title, then a ramp bar with its range, or one row per class with its
// swatch. Legends follow layer changes, value updates, the visible range
// and the zoom (coats with a zoom range), at most once per frame; unchanged
// legends aren't rebuilt.
// (Running region analyses show in the hub's column, <treelet-jobs>.)
// ============================================================================

import { BaseElement, escapeHtml } from './dom';
import { kitStyles } from './kit';
import type { Treelet } from '../core/Treelet';
import type { LegendSpec } from '../analysis/types';
import { cssColor, formatValue } from '../analysis/ramps';

const legendStyles = /* css */ `
  ${kitStyles}
  :host { display: flex; flex-direction: column; gap: 2px; }
  .list { display: flex; flex-direction: column; gap: 2px; }
  /* Units keep their case (m, not M) */
  .grp .u { text-transform: none; letter-spacing: 0; }
`;

/**
 * <treelet-legend> - legends for the visible analyses.
 */
export class TreeletLegend extends BaseElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;
  private listEl: HTMLDivElement | null = null;
  /** Markup of the legends last shown (unchanged legends aren't rebuilt). */
  private legendsHtml = '';
  private legendFrame = 0;
  private subscribed = false;
  /** Rendered only while shown (the info column sets this); changes meanwhile wait. */
  private shown = true;
  private stale = false;
  /** Legends follow layers, values and the visible range, at most once per frame. */
  private readonly scheduleLegends = (): void => {
    if (!this.shown) {
      this.stale = true;
      return;
    }
    if (this.legendFrame || typeof requestAnimationFrame === 'undefined') {
      if (!this.legendFrame) this.renderLegends();
      return;
    }
    this.legendFrame = requestAnimationFrame(() => {
      this.legendFrame = 0;
      this.renderLegends();
    });
  };

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  /** Attach to a Treelet instance (the info column places the element on its Legend page). */
  attach(map: Treelet, options: { glass?: boolean } = {}): void {
    if (this.map !== map) this.unsubscribe();
    this.map = map;
    this.toggleAttribute('glass', options.glass === true);
    if (!this.listEl) {
      this.shadow.innerHTML = `<style>${legendStyles}</style><div class="list" role="list" aria-label="Legend"></div>`;
      this.listEl = this.shadow.querySelector('.list') as HTMLDivElement;
    }
    if (this.isConnected) this.subscribe();
    this.renderLegends();
  }

  connectedCallback(): void {
    // Moved in the page (disconnected, then connected): listen again
    if (this.map && this.listEl) {
      this.subscribe();
      this.renderLegends();
    }
  }

  disconnectedCallback(): void {
    this.unsubscribe();
  }

  private subscribe(): void {
    const map = this.map;
    if (!map || this.subscribed) return;
    this.subscribed = true;
    map.on('layerchange', this.scheduleLegends);
    map.on('layerupdate', this.scheduleLegends);
    map.on('rangechange', this.scheduleLegends);
    map.on('zoom', this.scheduleLegends); // coats with a zoom range come and go
  }

  private unsubscribe(): void {
    const map = this.map;
    if (!map || !this.subscribed) return;
    this.subscribed = false;
    map.off('layerchange', this.scheduleLegends);
    map.off('layerupdate', this.scheduleLegends);
    map.off('rangechange', this.scheduleLegends);
    map.off('zoom', this.scheduleLegends);
    if (this.legendFrame) cancelAnimationFrame(this.legendFrame);
    this.legendFrame = 0;
  }

  refresh(): void {
    this.renderLegends();
  }

  /** Whether the legend is on screen; while it is not, it waits to render until it is again. */
  set active(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    if (on && this.stale) {
      this.stale = false;
      this.renderLegends();
    }
  }

  get active(): boolean {
    return this.shown;
  }

  private renderLegends(): void {
    if (!this.map || !this.listEl) return;
    const legends = this.map.getLegends();
    const html = legends.length
      ? legends.map((l) => this.renderLegend(l)).join('')
      : '<div class="hint" role="listitem">No legend for the visible layers</div>';
    if (html !== this.legendsHtml) {
      this.legendsHtml = html;
      this.listEl.innerHTML = html;
    }
  }

  private renderLegend(l: LegendSpec): string {
    const unit = l.unit ? `<span class="u"> · ${escapeHtml(l.unit)}</span>` : '';
    const title = `<div class="grp" title="${escapeHtml(l.title)}"><span class="t">${escapeHtml(l.title)}${unit}</span></div>`;
    if (l.type === 'classes') {
      const rows = (l.classes ?? []).map((c) =>
        `<div class="row"><span class="sw" style="background:${cssColor(c.color)}"></span><span class="t">${escapeHtml(c.label)}</span></div>`,
      ).reverse().join('');
      return `<div class="list" role="listitem">${title}${rows}</div>`;
    }
    const stops = (l.stops ?? []).map(([t, c]) => `${cssColor(c)} ${(t * 100).toFixed(1)}%`).join(', ');
    return `<div class="list" role="listitem">${title}
      <div class="leg"><div class="bar" style="background:linear-gradient(to right, ${stops})"></div>
      <div class="rng"><span>${formatValue(l.domain[0])}</span><span>${formatValue(l.domain[1])}</span></div></div>
    </div>`;
  }
}
