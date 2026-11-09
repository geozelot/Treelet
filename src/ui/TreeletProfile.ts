// ============================================================================
// treelet.js - TreeletProfile Web Component
//
// <treelet-profile> - an elevation profile at the bottom of the map: the
// chart, statistics, CSV and PNG export. Hovering the chart reports the
// sample under the pointer (the map marks it on the terrain).
// ============================================================================

import { BaseElement, escapeHtml } from './dom';
import { cornerCardStyles } from './cornerStyles';
import {
  CSS_PALETTE, chartSvg, chartScales, nearestIndex, profileCsv,
  type ChartPalette, type ProfilePoint,
} from './profileChart';
import { formatDistance, formatElevation } from '../tools/format';

export interface ProfileData {
  title: string;
  points: ProfilePoint[];
  /** Statistics as label / value pairs. */
  stats: Array<[string, string]>;
  /** Sample where terrain blocks a sight line, or −1. */
  obstructionIndex?: number;
}

const CHART_HEIGHT = 150;

const profileStyles = /* css */ `
  ${cornerCardStyles}

  :host {
    position: absolute;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    z-index: 997;
    width: min(640px, calc(100% - 24px));
    max-width: none;
    --chart-line: light-dark(#1c7ed6, #4dabf7);
    --chart-fill: light-dark(rgba(28, 126, 214, 0.18), rgba(77, 171, 247, 0.22));
    --chart-sight: light-dark(#2f9e44, #69db7c);
    --chart-blocked: light-dark(#e03131, #ff8787);
  }

  .card { gap: 4px; padding: 8px 10px 8px; }
  .head { display: flex; align-items: center; gap: 8px; }
  .title { flex: 1; min-width: 0; font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .head button {
    font: inherit; font-size: 11px; border: 0; border-radius: 6px; padding: 3px 7px; cursor: pointer;
    color: var(--text); background: var(--border);
  }
  .head button:hover { filter: brightness(0.95); }
  .head button:focus-visible { outline: 2px solid light-dark(#7a9400, #a5c500); outline-offset: 1px; }
  .head .close { padding: 3px 6px; background: transparent; color: var(--text-dim); font-size: 14px; line-height: 1; }
  .stats { display: flex; flex-wrap: wrap; gap: 2px 14px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
  .stats b { color: var(--text); font-weight: 600; }
  .chart { position: relative; height: ${CHART_HEIGHT}px; touch-action: none; }
  .chart svg { display: block; }
  .tip {
    position: absolute; top: 2px; pointer-events: none; white-space: nowrap;
    font-variant-numeric: tabular-nums; color: var(--text); background: var(--surface-bg);
    border: 1px solid var(--border); border-radius: 5px; padding: 1px 5px;
  }
  .tip[hidden] { display: none; }
`;

export class TreeletProfile extends BaseElement {
  private shadow: ShadowRoot;
  private data: ProfileData | null = null;
  private chartEl: HTMLDivElement | null = null;
  private tipEl: HTMLDivElement | null = null;
  private hoverIndex = -1;
  private resize: ResizeObserver | null = null;
  private onHover: ((point: ProfilePoint | null) => void) | null = null;
  private onClose: (() => void) | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  attach(options: { glass?: boolean; onHover?: (point: ProfilePoint | null) => void; onClose?: () => void } = {}): void {
    if (options.glass) this.setAttribute('glass', ''); else this.removeAttribute('glass');
    this.onHover = options.onHover ?? null;
    this.onClose = options.onClose ?? null;
    this.hidden = true;
  }

  connectedCallback(): void {
    if (typeof ResizeObserver !== 'undefined' && !this.resize) {
      this.resize = new ResizeObserver(() => this.drawChart());
      this.resize.observe(this);
    }
  }

  disconnectedCallback(): void {
    this.resize?.disconnect();
    this.resize = null;
  }

  /** Show a profile (replacing the current one). */
  show(data: ProfileData): void {
    this.data = data;
    this.hoverIndex = -1;
    this.hidden = false;
    this.shadow.innerHTML = `<style>${profileStyles}</style>
      <div class="card" role="region" aria-label="Elevation profile">
        <div class="head">
          <span class="title">${escapeHtml(data.title)}</span>
          <button type="button" data-action="csv" title="Download the profile as CSV">CSV</button>
          <button type="button" data-action="png" title="Download the chart as PNG">PNG</button>
          <button type="button" class="close" data-action="close" aria-label="Close the profile" title="Close">×</button>
        </div>
        <div class="stats">${data.stats.map(([k, v]) => `<span>${escapeHtml(k)} <b>${escapeHtml(v)}</b></span>`).join('')}</div>
        <div class="chart"><div class="tip" hidden></div></div>
      </div>`;
    this.chartEl = this.shadow.querySelector('.chart');
    this.tipEl = this.shadow.querySelector('.tip');
    this.shadow.querySelector('.head')!.addEventListener('click', this.onClick);
    this.chartEl!.addEventListener('pointermove', this.onMove);
    this.chartEl!.addEventListener('pointerleave', this.onLeave);
    this.drawChart();
  }

  hide(): void {
    if (this.hidden) return;
    this.hidden = true;
    this.data = null;
    this.setHover(-1);
  }

  /** The profile shown, or null. */
  get current(): ProfileData | null {
    return this.data;
  }

  private width(): number {
    return Math.max(160, Math.round(this.chartEl?.clientWidth || 600));
  }

  private drawChart(): void {
    if (!this.data || !this.chartEl) return;
    const svg = chartSvg(this.data.points, this.width(), CHART_HEIGHT, CSS_PALETTE, {
      obstructionIndex: this.data.obstructionIndex,
      hoverIndex: this.hoverIndex,
    });
    const old = this.chartEl.querySelector('svg');
    const holder = document.createElement('div');
    holder.innerHTML = svg;
    const el = holder.firstElementChild!;
    if (old) old.replaceWith(el); else this.chartEl.prepend(el);
  }

  private setHover(index: number): void {
    if (index === this.hoverIndex) return;
    this.hoverIndex = index;
    this.drawChart();
    const p = this.data && index >= 0 ? this.data.points[index] : null;
    if (this.tipEl) {
      if (p && this.data) {
        const s = chartScales(this.data.points, this.width(), CHART_HEIGHT);
        this.tipEl.textContent = `${formatDistance(p.distance)} · ${formatElevation(p.elevation)}`;
        this.tipEl.hidden = false;
        const x = s.x(p.distance);
        const w = this.tipEl.offsetWidth || 90;
        this.tipEl.style.left = `${Math.min(Math.max(0, x - w / 2), this.width() - w)}px`;
      } else {
        this.tipEl.hidden = true;
      }
    }
    this.onHover?.(p);
  }

  private onMove = (e: PointerEvent): void => {
    if (!this.data || !this.chartEl) return;
    const r = this.chartEl.getBoundingClientRect();
    const s = chartScales(this.data.points, this.width(), CHART_HEIGHT);
    this.setHover(nearestIndex(this.data.points, s.invertX(e.clientX - r.left)));
  };

  private onLeave = (): void => this.setHover(-1);

  private onClick = (e: Event): void => {
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (!action || !this.data) return;
    e.stopPropagation();
    if (action === 'close') {
      this.hide();
      this.onClose?.();
    } else if (action === 'csv') {
      this.download(new Blob([profileCsv(this.data.points)], { type: 'text/csv' }), 'profile.csv');
    } else if (action === 'png') {
      void this.exportPng();
    }
  };

  /** Concrete colors for the exported image (it has no stylesheet). */
  private palette(): ChartPalette {
    const dark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
    return dark
      ? { text: '#b8b8b8', grid: '#3a3a3a', fill: 'rgba(77, 171, 247, 0.22)', line: '#4dabf7', sight: '#69db7c', blocked: '#ff8787', hover: '#e8e8e8', background: '#181818' }
      : { text: '#555555', grid: '#e3e3e3', fill: 'rgba(28, 126, 214, 0.18)', line: '#1c7ed6', sight: '#2f9e44', blocked: '#e03131', hover: '#333333', background: '#ffffff' };
  }

  private async exportPng(): Promise<void> {
    if (!this.data) return;
    const w = this.width();
    const svg = chartSvg(this.data.points, w, CHART_HEIGHT, this.palette(), { obstructionIndex: this.data.obstructionIndex });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('could not render the chart')); img.src = url; });
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = CHART_HEIGHT * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) this.download(blob, 'profile.png');
    } catch (err) {
      console.warn('treelet: PNG export failed:', (err as Error).message);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    this.shadow.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
