// ============================================================================
// treelet.js - TreeletToolbar Web Component
//
// <treelet-toolbar> - the measuring tools: distance, area, profile, line of
// sight and viewshed. While a tool runs, a hint and its live result show
// below the buttons, with Profile, Finish and Clear actions. Buttons work
// with the mouse, touch and keyboard (Tab, Enter / Space; Escape stops the
// tool on the map).
// ============================================================================

import { runRegionAnalysis } from './regionAnalysis';
import { BaseElement, escapeHtml } from './dom';
import { cornerCardStyles } from './cornerStyles';
import type { Treelet } from '../core/Treelet';
import type { ToolMode, ToolResult } from '../tools/ToolController';
import { TOOL_HINTS } from '../tools/ToolController';
import { formatArea, formatDistance, formatElevation } from '../tools/format';

const icon = (d: string) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const TOOLS: Array<{ id: ToolMode | 'viewshed'; label: string; icon: string }> = [
  { id: 'distance', label: 'Measure distance', icon: icon('<path d="M2.5 11.5 11.5 2.5l2 2-9 9z"/><path d="M5 9l1 1M7 7l1.5 1.5M9 5l1 1"/>') },
  { id: 'area', label: 'Measure area', icon: icon('<path d="M3 4.5 9 2.5l4.5 4-2 6.5-7.5-1.5z"/>') },
  { id: 'profile', label: 'Elevation profile', icon: icon('<path d="M1.5 13.5 5 7l3 3 2.5-5.5 4 9"/><path d="M1.5 13.5h13"/>') },
  { id: 'sight', label: 'Line of sight', icon: icon('<circle cx="3.5" cy="11.5" r="1.5"/><circle cx="12.5" cy="4.5" r="1.5"/><path d="M5 10.3 11 5.7" stroke-dasharray="2 1.6"/>') },
  { id: 'viewshed', label: 'Viewshed from a point', icon: icon('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>') },
];

const toolbarStyles = /* css */ `
  ${cornerCardStyles}

  :host { max-width: min(300px, 100%); }
  .card { gap: 6px; padding: 5px; }
  .tools { display: flex; gap: 3px; }
  .tool {
    width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: 7px; padding: 0; cursor: pointer;
    color: var(--text); background: transparent;
  }
  .tool:hover { background: var(--border); }
  .tool[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); }
  .tool:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .status { display: flex; flex-direction: column; gap: 3px; padding: 0 4px 3px; }
  .status[hidden] { display: none; }
  .hint { color: var(--text-dim); }
  .result { font-variant-numeric: tabular-nums; }
  .result b { font-weight: 600; }
  .actions { display: flex; gap: 4px; margin-top: 2px; }
  /* Read out by screen readers: the result when drawing ends, not every live update */
  .announce { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
`;

/** Result lines for the toolbar (also used by tests). */
export function describeResult(r: ToolResult | null): string[] {
  if (!r) return [];
  if (r.mode === 'distance' || r.mode === 'profile') {
    const p = r.path;
    const range = p.minElevation !== null ? ` · ${formatElevation(p.minElevation)} – ${formatElevation(p.maxElevation)}` : '';
    return [
      `<b>${formatDistance(p.distance)}</b> · terrain ${formatDistance(p.surfaceDistance)}`,
      `↑ ${formatElevation(p.gain)} ↓ ${formatElevation(p.loss)}${range}`,
    ];
  }
  if (r.mode === 'area') {
    return [
      `<b>${formatArea(r.area.area)}</b> · terrain ${formatArea(r.area.surfaceArea)}`,
      `Perimeter ${formatDistance(r.area.perimeter)}`,
    ];
  }
  if (r.mode !== 'sight') return [];
  const s = r.sight;
  if (!s) return ['No elevation data at the ends'];
  return s.visible
    ? [`<b>Visible</b> · ${formatDistance(s.distance)}`, `Clearance ${formatElevation(s.clearance)}`]
    : [`<b>Hidden</b> · blocked at ${formatDistance(s.obstruction!.distance)}`, `${formatDistance(s.distance)} apart`];
}

export class TreeletToolbar extends BaseElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;
  private statusEl: HTMLDivElement | null = null;
  private result: ToolResult | null = null;
  /** What the status block was built for (hint, actions); live results only patch its lines. */
  private statusKey = '';
  private subscribed = false;
  private readonly refresh = (): void => this.renderStatus();
  private readonly onMeasure = (e: { result: ToolResult | null; final?: boolean }): void => {
    this.result = e.result;
    this.renderStatus();
    if (e.final) this.announce(describeResult(e.result).map((l) => l.replace(/<[^>]+>/g, '')).join('. '));
  };

  /** Tell screen readers (once per finished result, not on every live update). */
  private announce(text: string): void {
    const el = this.shadow.querySelector<HTMLElement>('.announce');
    if (el) el.textContent = text;
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.addEventListener('click', this.onClick);
  }

  attach(map: Treelet, options: { glass?: boolean } = {}): void {
    if (this.map !== map) this.unsubscribe();
    this.map = map;
    if (options.glass) this.setAttribute('glass', ''); else this.removeAttribute('glass');
    if (!this.statusEl) {
      this.shadow.innerHTML = `<style>${toolbarStyles}</style>
        <div class="card">
          <div class="tools" role="toolbar" aria-label="Tools">
            ${TOOLS.map((t) => `<button type="button" class="tool" data-tool="${t.id}" title="${escapeHtml(t.label)}" aria-label="${escapeHtml(t.label)}" aria-pressed="false">${t.icon}</button>`).join('')}
          </div>
          <div class="status" hidden></div>
          <div class="announce" aria-live="polite"></div>
        </div>`;
      this.statusEl = this.shadow.querySelector('.status');
    }
    if (this.isConnected) this.subscribe();
    this.renderStatus();
  }

  connectedCallback(): void {
    // Moved in the page (disconnected, then connected): listen again
    if (this.map && this.statusEl) {
      this.subscribe();
      this.renderStatus();
    }
  }

  disconnectedCallback(): void {
    this.unsubscribe();
  }

  private subscribe(): void {
    const map = this.map;
    if (!map || this.subscribed) return;
    this.subscribed = true;
    map.on('toolchange', this.refresh);
    map.on('measure', this.onMeasure);
    map.on('pickstart', this.refresh);
    map.on('pickend', this.refresh);
  }

  private unsubscribe(): void {
    const map = this.map;
    if (!map || !this.subscribed) return;
    this.subscribed = false;
    map.off('toolchange', this.refresh);
    map.off('measure', this.onMeasure);
    map.off('pickstart', this.refresh);
    map.off('pickend', this.refresh);
  }

  private onClick = (e: Event): void => {
    const map = this.map;
    if (!map) return;
    const target = e.target as HTMLElement;
    const tool = target.closest<HTMLElement>('[data-tool]')?.dataset.tool;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (tool) {
      e.stopPropagation();
      const current = map.getTool().mode;
      if (tool === 'viewshed') {
        // A second press while waiting for the observer cancels (picking stops any tool)
        if (map.isPicking()) { map.cancelPick(); return; }
        runRegionAnalysis(map, 'viewshed');
      } else if (current === tool) {
        map.clearTool();
      } else {
        map.cancelPick();
        map.startTool(tool as ToolMode);
      }
    } else if (action) {
      e.stopPropagation();
      if (action === 'finish') map.finishTool();
      else if (action === 'clear') map.clearTool();
      else if (action === 'profile' && this.result && this.result.mode !== 'area') {
        if (this.result.mode === 'sight') { if (this.result.sight) map.showProfile(this.result.sight); }
        else map.showProfile(this.result.points);
      }
    }
  };

  private renderStatus(): void {
    if (!this.map || !this.statusEl) return;
    const t = this.map.getTool();
    const picking = this.map.isPicking();
    this.shadow.querySelectorAll<HTMLElement>('.tool').forEach((b) => {
      const on = b.dataset.tool === t.mode || (b.dataset.tool === 'viewshed' && picking);
      b.setAttribute('aria-pressed', String(on));
    });
    if (!t.mode) {
      this.statusEl.hidden = true;
      this.statusEl.innerHTML = '';
      this.statusKey = '';
      return;
    }
    if (!t.result) this.result = null;
    const lines = describeResult(this.result);
    const canProfile = !!this.result && this.result.mode !== 'area' && !(this.result.mode === 'sight' && !this.result.sight);
    const canFinish = t.drawing && t.mode !== 'sight';
    const key = `${t.mode}|${t.drawing}|${canProfile}|${canFinish}`;
    const results = lines.map((l) => `<div class="result">${l}</div>`).join('');
    if (key === this.statusKey) {
      // Live results while drawing: only the lines change (buttons keep focus and clicks)
      const el = this.statusEl.querySelector<HTMLElement>('.results');
      if (el) {
        if (el.innerHTML !== results) el.innerHTML = results;
        return;
      }
    }
    this.statusKey = key;
    const hint = t.drawing ? `<div class="hint">${escapeHtml(TOOL_HINTS[t.mode])}</div>` : '';
    const actions = [
      canProfile ? '<button type="button" class="card-btn" data-action="profile">Profile</button>' : '',
      canFinish ? '<button type="button" class="card-btn" data-action="finish">Finish</button>' : '',
      '<button type="button" class="card-btn" data-action="clear">Clear</button>',
    ].join('');
    this.statusEl.innerHTML = `${hint}<div class="results">${results}</div><div class="actions">${actions}</div>`;
    this.statusEl.hidden = false;
  }
}
