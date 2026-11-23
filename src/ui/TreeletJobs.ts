// ============================================================================
// treelet.js - TreeletJobs Web Component
//
// <treelet-jobs> - what the map is busy with, as rows of the hub: running
// region analyses (progress, cancel), a pending pick (its prompt, cancel)
// and failures (listed for a few seconds, or until dismissed). The Layers
// page shows them in its Overlay group, the hub's other pages at their
// foot. Hidden while there is nothing to show.
// ============================================================================

import { BaseElement, escapeHtml } from './dom';
import { kitStyles, progressHtml } from './kit';
import { CLOSE_SVG } from './icons';
import type { Treelet } from '../core/Treelet';

/** How long a failed analysis stays listed (ms). */
const ERROR_MS = 8000;

const jobsStyles = /* css */ `
  ${kitStyles}
  :host { display: flex; flex-direction: column; gap: 2px; }
  :host(:not([busy])) { display: none; }
  .list { display: flex; flex-direction: column; gap: 2px; }
`;

function stageText(stage: 'loading' | 'computing', progress: number): string {
  return `${stage === 'loading' ? 'Loading' : 'Computing'} ${Math.round(progress * 100)}%`;
}

export class TreeletJobs extends BaseElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;
  private listEl: HTMLDivElement;
  private pickPrompt: string | null = null;
  private readonly errors = new Map<string, { label: string; message: string; timer: ReturnType<typeof setTimeout> }>();
  private subscribed = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `<style>${jobsStyles}</style><div class="list" role="list" aria-label="Running analyses"></div>`;
    this.listEl = this.shadow.querySelector('.list') as HTMLDivElement;
    this.shadow.addEventListener('click', this.onClick);
  }

  /** Attach to a map. */
  attach(map: Treelet, options: { glass?: boolean } = {}): void {
    if (this.map !== map) {
      this.unsubscribe();
      this.clearErrors();
      this.pickPrompt = null;
    }
    this.map = map;
    this.toggleAttribute('glass', options.glass === true);
    if (this.isConnected) this.subscribe();
    this.render();
  }

  connectedCallback(): void {
    // Moved (the panel places it on every rebuild of its page): listen again
    if (!this.map) return;
    this.subscribe();
    if (!this.map.isPicking()) this.pickPrompt = null;
    this.render();
  }

  disconnectedCallback(): void {
    // Failures stay listed: a move is a disconnect and a connect
    this.unsubscribe();
  }

  private subscribe(): void {
    const map = this.map;
    if (!map || this.subscribed) return;
    this.subscribed = true;
    map.on('analysisstart', this.onChange);
    map.on('analysisprogress', this.onProgress);
    map.on('analysisend', this.onEnd);
    map.on('pickstart', this.onPickStart);
    map.on('pickend', this.onPickEnd);
  }

  private unsubscribe(): void {
    const map = this.map;
    if (!map || !this.subscribed) return;
    this.subscribed = false;
    map.off('analysisstart', this.onChange);
    map.off('analysisprogress', this.onProgress);
    map.off('analysisend', this.onEnd);
    map.off('pickstart', this.onPickStart);
    map.off('pickend', this.onPickEnd);
  }

  private clearErrors(): void {
    for (const e of this.errors.values()) clearTimeout(e.timer);
    this.errors.clear();
  }

  private readonly onChange = (): void => this.render();
  private readonly onPickStart = (e: { prompt: string }): void => { this.pickPrompt = e.prompt; this.render(); };
  private readonly onPickEnd = (): void => { this.pickPrompt = null; this.render(); };

  private readonly onProgress = (e: { id: string; stage: 'loading' | 'computing'; progress: number }): void => {
    const row = this.listEl.querySelector<HTMLElement>(`[data-job="${CSS.escape(e.id)}"] .scrub`);
    if (!row) { this.render(); return; }
    const fill = row.querySelector<HTMLElement>('.fl');
    const text = row.querySelector<HTMLElement>('.v');
    if (fill) fill.style.width = `${Math.round(e.progress * 100)}%`;
    if (text) text.textContent = stageText(e.stage, e.progress);
    row.setAttribute('aria-valuenow', String(Math.round(e.progress * 100)));
  };

  private readonly onEnd = (e: { id: string; label: string; status: string; error?: string }): void => {
    if (e.status === 'error') {
      const timer = setTimeout(() => { this.errors.delete(e.id); this.render(); }, ERROR_MS);
      this.errors.set(e.id, { label: e.label, message: e.error ?? 'failed', timer });
    }
    this.render();
  };

  /** Cancel a run or the pick, dismiss a failure. */
  private readonly onClick = (e: Event): void => {
    const cancel = (e.target as Element).closest<HTMLElement>('[data-job-cancel]');
    if (!cancel || !this.map) return;
    e.stopPropagation();
    const id = cancel.dataset.jobCancel!;
    if (id === 'pick') {
      this.map.cancelPick();
    } else if (this.errors.has(id)) {
      clearTimeout(this.errors.get(id)!.timer);
      this.errors.delete(id);
      this.render();
    } else {
      this.map.cancelAnalysis(id);
    }
  };

  /** The rows (rebuilt when a job or the pick starts or ends; progress is patched). */
  private render(): void {
    if (!this.map) return;
    const rows: string[] = [];
    const cancel = (id: string, label: string, verb = 'Cancel') =>
      `<button type="button" class="ib" data-job-cancel="${escapeHtml(id)}" aria-label="${verb} ${escapeHtml(label)}" title="${verb}">${CLOSE_SVG}</button>`;
    if (this.pickPrompt) {
      rows.push(`<div class="row wrap tight" data-job="pick" role="listitem"><span class="t dim" style="flex: 1; padding: 0 6px">${escapeHtml(this.pickPrompt)} · Esc</span>${cancel('pick', 'the pick')}</div>`);
    }
    for (const j of this.map.getAnalysisJobs?.() ?? []) {
      rows.push(`<div class="duo" data-job="${escapeHtml(j.id)}" role="listitem">${progressHtml(j.label, stageText(j.stage, j.progress), j.progress)}${cancel(j.id, j.label)}</div>`);
    }
    for (const [id, e] of this.errors) {
      rows.push(`<div class="row wrap tight" data-job="${escapeHtml(id)}" role="listitem"><span class="t" style="flex: 1; padding: 0 6px">${escapeHtml(e.label)} <span class="err">${escapeHtml(e.message)}</span></span>${cancel(id, e.label, 'Dismiss')}</div>`);
    }
    this.listEl.innerHTML = rows.join('');
    this.toggleAttribute('busy', rows.length > 0);
  }
}
