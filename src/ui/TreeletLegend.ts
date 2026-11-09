// ============================================================================
// treelet.js - TreeletLegend Web Component
//
// <treelet-legend> - legends of the visible value analyses (elevation,
// slope…): a ramp bar with its range, or class swatches with labels. Sits
// in a corner container the map provides (stacked with the readout when
// they share a corner). Legends follow layer changes, value updates and the
// visible range, at most once per frame. Running region analyses show above
// them with their progress and a cancel button (so does a pending location
// pick); those rows are rebuilt only when a job starts or ends, so a click
// on cancel is never lost to a re-render.
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

  .job { display: flex; flex-direction: column; gap: 3px; }
  .job-row { display: flex; align-items: center; gap: 6px; }
  .job-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .job-pct { color: var(--text-dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .job-bar { height: 3px; border-radius: 2px; background: var(--border); overflow: hidden; }
  .job-fill { height: 100%; width: 0; background: var(--accent); transition: width 120ms linear; }
  .job.error .job-pct { color: light-dark(#b42318, #ff8a7a); white-space: normal; }
  .job-cancel {
    flex-shrink: 0;
    width: 18px; height: 18px;
    display: inline-flex; align-items: center; justify-content: center;
    padding: 0; border: 0; border-radius: 5px;
    font: inherit; font-size: 13px; line-height: 1;
    color: var(--text-dim); background: transparent; cursor: pointer;
  }
  .job-cancel:hover { color: var(--text); background: var(--border); }
  .job-cancel:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .jobs:empty, .legends:empty { display: none; }
  .jobs:not(:empty) + .legends:not(:empty) { margin-top: 6px; }
`;

/** How long a failed analysis stays listed (ms). */
const ERROR_MS = 8000;

function stageText(stage: 'loading' | 'computing', progress: number): string {
  return `${stage === 'loading' ? 'Loading' : 'Computing'} ${Math.round(progress * 100)}%`;
}

/**
 * <treelet-legend> - legends for the visible analyses.
 */
export class TreeletLegend extends BaseElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;
  private bodyEl: HTMLDivElement | null = null;
  private jobsEl: HTMLDivElement | null = null;
  private legendsEl: HTMLDivElement | null = null;
  /** Markup of the legends last shown (unchanged legends aren't rebuilt). */
  private legendsHtml = '';
  private legendFrame = 0;
  private subscribed = false;
  /** Legends follow layers, values and the visible range, at most once per frame. */
  private readonly scheduleLegends = (): void => {
    if (this.legendFrame || typeof requestAnimationFrame === 'undefined') {
      if (!this.legendFrame) this.renderLegends();
      return;
    }
    this.legendFrame = requestAnimationFrame(() => {
      this.legendFrame = 0;
      this.renderLegends();
    });
  };
  private readonly rerenderJobs = (): void => this.renderJobs();
  /** Prompt of a pending location pick. */
  private pickPrompt: string | null = null;
  /** Failed analyses, listed for a while. */
  private readonly errors = new Map<string, { label: string; message: string; timer: ReturnType<typeof setTimeout> }>();

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.addEventListener('click', this.onClick);
  }

  private readonly onProgress = (e: { id: string; stage: 'loading' | 'computing'; progress: number }): void => {
    const row = this.jobsEl?.querySelector<HTMLElement>(`.job[data-job="${CSS.escape(e.id)}"]`);
    if (!row) { this.renderJobs(); return; }
    const fill = row.querySelector<HTMLElement>('.job-fill');
    const pct = row.querySelector<HTMLElement>('.job-pct');
    if (fill) fill.style.width = `${Math.round(e.progress * 100)}%`;
    if (pct) pct.textContent = stageText(e.stage, e.progress);
  };

  private readonly onEnd = (e: { id: string; label: string; status: string; error?: string }): void => {
    if (e.status === 'error') {
      const timer = setTimeout(() => { this.errors.delete(e.id); this.renderJobs(); }, ERROR_MS);
      this.errors.set(e.id, { label: e.label, message: e.error ?? 'failed', timer });
    }
    this.renderJobs();
  };

  private readonly onPickStart = (e: { prompt: string }): void => {
    this.pickPrompt = e.prompt;
    this.renderJobs();
  };

  private readonly onPickEnd = (): void => {
    this.pickPrompt = null;
    this.renderJobs();
  };

  private readonly onClick = (ev: Event): void => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('.job-cancel');
    if (!btn || !this.map) return;
    ev.stopPropagation();
    const id = btn.dataset.job!;
    if (id === 'pick') {
      this.map.cancelPick();
    } else if (this.errors.has(id)) {
      clearTimeout(this.errors.get(id)!.timer);
      this.errors.delete(id);
      this.renderJobs();
    } else {
      this.map.cancelAnalysis(id);
    }
  };

  /** Attach to a Treelet instance (the map places the element in its corner). */
  attach(map: Treelet, options: { glass?: boolean } = {}): void {
    if (this.map !== map) this.unsubscribe();
    this.map = map;
    if (options.glass) this.setAttribute('glass', '');
    else this.removeAttribute('glass');
    if (!this.bodyEl) {
      this.shadow.innerHTML = `<style>${legendStyles}</style><div class="card legend" role="list" aria-label="Legend"><div class="jobs"></div><div class="legends"></div></div>`;
      this.bodyEl = this.shadow.querySelector('.legend') as HTMLDivElement;
      this.jobsEl = this.shadow.querySelector('.jobs') as HTMLDivElement;
      this.legendsEl = this.shadow.querySelector('.legends') as HTMLDivElement;
    }
    if (this.isConnected) this.subscribe();
    this.render();
  }

  connectedCallback(): void {
    // Moved in the page (disconnected, then connected): listen again
    if (this.map && this.bodyEl) {
      this.subscribe();
      this.render();
    }
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    for (const e of this.errors.values()) clearTimeout(e.timer);
    this.errors.clear();
  }

  private subscribe(): void {
    const map = this.map;
    if (!map || this.subscribed) return;
    this.subscribed = true;
    map.on('layerchange', this.scheduleLegends);
    map.on('layerupdate', this.scheduleLegends);
    map.on('rangechange', this.scheduleLegends);
    map.on('analysisstart', this.rerenderJobs);
    map.on('analysisprogress', this.onProgress);
    map.on('analysisend', this.onEnd);
    map.on('pickstart', this.onPickStart);
    map.on('pickend', this.onPickEnd);
  }

  private unsubscribe(): void {
    const map = this.map;
    if (!map || !this.subscribed) return;
    this.subscribed = false;
    map.off('layerchange', this.scheduleLegends);
    map.off('layerupdate', this.scheduleLegends);
    map.off('rangechange', this.scheduleLegends);
    map.off('analysisstart', this.rerenderJobs);
    map.off('analysisprogress', this.onProgress);
    map.off('analysisend', this.onEnd);
    map.off('pickstart', this.onPickStart);
    map.off('pickend', this.onPickEnd);
    if (this.legendFrame) cancelAnimationFrame(this.legendFrame);
    this.legendFrame = 0;
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    this.renderJobs();
    this.renderLegends();
  }

  /** Running jobs, failures and a pending pick (rebuilt only when one starts or ends). */
  private renderJobs(): void {
    if (!this.map || !this.jobsEl) return;
    const jobs = this.map.getAnalysisJobs?.() ?? [];
    const rows: string[] = [];
    if (this.pickPrompt) {
      rows.push(this.renderJob('pick', this.pickPrompt, 'Esc to cancel', null, 'pick'));
    }
    for (const j of jobs) rows.push(this.renderJob(j.id, j.label, stageText(j.stage, j.progress), j.progress));
    for (const [id, e] of this.errors) rows.push(this.renderJob(id, e.label, e.message, null, 'error'));
    this.jobsEl.innerHTML = rows.join('');
    this.updateHidden();
  }

  private renderLegends(): void {
    if (!this.map || !this.legendsEl) return;
    const html = this.map.getLegends().map((l) => this.renderLegend(l)).join('');
    if (html !== this.legendsHtml) {
      this.legendsHtml = html;
      this.legendsEl.innerHTML = html;
    }
    this.updateHidden();
  }

  private updateHidden(): void {
    this.hidden = !this.jobsEl?.hasChildNodes() && !this.legendsEl?.hasChildNodes();
  }

  private renderJob(id: string, label: string, status: string, progress: number | null, variant = ''): string {
    const eid = escapeHtml(id);
    const action = variant === 'error' ? 'Dismiss' : 'Cancel';
    return `<div class="job${variant ? ` ${variant}` : ''}" data-job="${eid}" role="listitem">
      <div class="job-row">
        <span class="job-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
        <span class="job-pct">${escapeHtml(status)}</span>
        <button type="button" class="job-cancel" data-job="${eid}" aria-label="${action} ${escapeHtml(label)}" title="${action}">×</button>
      </div>
      ${progress === null ? '' : `<div class="job-bar"><div class="job-fill" style="width:${Math.round(progress * 100)}%"></div></div>`}
    </div>`;
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
