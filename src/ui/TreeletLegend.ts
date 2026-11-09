// ============================================================================
// treelet.js - TreeletLegend Web Component
//
// <treelet-legend> - legends of the visible value analyses (elevation,
// slope…): a ramp bar with its range, or class swatches with labels. Sits
// in a corner container the map provides (stacked with the readout when
// they share a corner). Re-renders on 'layerchange' and when an 'auto'
// range follows the view.
// ============================================================================

import { BaseElement, escapeHtml } from './dom';
import { cornerCardStyles } from './cornerStyles';
import type { Treelet } from '../core/Treelet';
import type { LegendSpec } from '../analysis/types';
import { cssColor, formatValue } from '../analysis/ramps';

const legendStyles = /* css */ `
  ${cornerCardStyles}

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

  /** Attach to a Treelet instance (the map places the element in its corner). */
  attach(map: Treelet, options: { glass?: boolean } = {}): void {
    this.map = map;
    if (options.glass) this.setAttribute('glass', '');
    else this.removeAttribute('glass');
    if (!this.bodyEl) {
      this.shadow.innerHTML = `<style>${legendStyles}</style><div class="card legend" role="list" aria-label="Legend"></div>`;
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
    const title = `<div class="card-title legend-title" title="${escapeHtml(l.title)}">${escapeHtml(l.title)}${unit}</div>`;
    if (l.type === 'classes') {
      const rows = (l.classes ?? []).map((c) =>
        `<div class="legend-class"><span class="legend-swatch" style="background:${cssColor(c.color)}"></span><span>${escapeHtml(c.label)}</span></div>`,
      ).reverse().join('');
      return `<div class="legend-item" role="listitem">${title}${rows}</div>`;
    }
    const stops = (l.stops ?? []).map(([t, c]) => `${cssColor(c)} ${(t * 100).toFixed(1)}%`).join(', ');
    return `<div class="legend-item" role="listitem">${title}
      <div class="legend-bar" style="background:linear-gradient(to right, ${stops})"></div>
      <div class="legend-range"><span>${formatValue(l.domain[0])}</span><span>${formatValue(l.domain[1])}</span></div>
    </div>`;
  }
}
