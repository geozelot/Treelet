// ============================================================================
// treelet.js - TreeletToolbar Web Component
//
// <treelet-toolbar> - the measuring tools, as the hub's Measure page: a row
// of tools (distance, area, profile, line of sight, viewshed); while a tool
// runs, a hint, its live result as label / value pairs, and Profile, Finish
// and Clear. Buttons work with the mouse, touch and keyboard (Tab, Enter /
// Space; Escape stops the tool on the map).
// ============================================================================

import { runRegionAnalysis } from './regionAnalysis';
import { BaseElement, escapeHtml } from './dom';
import { kitStyles } from './kit';
import { TOOL_ICONS } from './icons';
import type { Treelet } from '../core/Treelet';
import type { ToolMode, ToolResult } from '../tools/ToolController';
import { TOOL_HINTS } from '../tools/ToolController';
import { formatArea, formatDistance, pathStats, sightStats } from '../tools/format';

const TOOLS: Array<{ id: ToolMode | 'viewshed'; label: string; title: string }> = [
  { id: 'distance', label: 'Measure distance', title: 'Distance' },
  { id: 'area', label: 'Measure area', title: 'Area' },
  { id: 'profile', label: 'Elevation profile', title: 'Profile' },
  { id: 'sight', label: 'Line of sight', title: 'Line of sight' },
  { id: 'viewshed', label: 'Viewshed from a point', title: 'Viewshed' },
];

const toolbarStyles = /* css */ `
  ${kitStyles}
  :host { display: flex; flex-direction: column; gap: 2px; }
  .status { display: flex; flex-direction: column; gap: 2px; }
  .results { display: flex; flex-direction: column; gap: 2px; }
`;

/** A tool result as label / value pairs (two to a row). */
export function resultPairs(r: ToolResult | null): Array<[label: string, value: string]> {
  if (!r) return [];
  if (r.mode === 'distance' || r.mode === 'profile') return pathStats(r.path);
  if (r.mode === 'area') {
    return [
      ['Area', formatArea(r.area.area)],
      ['Terrain', formatArea(r.area.surfaceArea)],
      ['Perimeter', formatDistance(r.area.perimeter)],
    ];
  }
  if (r.mode !== 'sight') return [];
  if (!r.sight) return [['Result', 'No data']];
  return sightStats(r.sight).slice(0, 3);
}

/** Label / value pairs as `.pair` rows. */
export function pairRows(pairs: ReadonlyArray<readonly [string, string]>): string {
  const rows: string[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const cell = (p?: readonly [string, string]) =>
      p ? `<span><span class="k">${escapeHtml(p[0])}</span><span class="v">${escapeHtml(p[1])}</span></span>` : '<span></span>';
    rows.push(`<div class="pair">${cell(pairs[i])}${cell(pairs[i + 1])}</div>`);
  }
  return rows.join('');
}

export class TreeletToolbar extends BaseElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;
  private statusEl: HTMLDivElement | null = null;
  private result: ToolResult | null = null;
  /** What the status block was built for (hint, actions); live results only patch its pairs. */
  private statusKey = '';
  private subscribed = false;
  private readonly refresh = (): void => this.renderStatus();
  /** The pending pick is the viewshed's, started here (not the app's). */
  private ownPick = false;
  private readonly onPickEnd = (): void => {
    this.ownPick = false;
    this.renderStatus();
  };
  private readonly onMeasure = (e: { result: ToolResult | null; final?: boolean }): void => {
    this.result = e.result;
    this.renderStatus();
    if (e.final) this.announce(resultPairs(e.result).map(([k, v]) => `${k} ${v}`).join(', '));
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
    this.toggleAttribute('glass', options.glass === true);
    if (!this.statusEl) {
      this.shadow.innerHTML = `<style>${toolbarStyles}</style>
        <div class="grp"><span class="t">Measure</span></div>
        <div class="trow" role="toolbar" aria-label="Tools">
          ${TOOLS.map((t) => `<button type="button" class="ic tool" data-tool="${t.id}" title="${escapeHtml(t.label)}" aria-label="${escapeHtml(t.label)}" aria-pressed="false">${TOOL_ICONS[t.id]}</button>`).join('')}
        </div>
        <div class="status" hidden></div>
        <div class="announce sr" aria-live="polite"></div>`;
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
    map.on('pickend', this.onPickEnd);
  }

  private unsubscribe(): void {
    const map = this.map;
    if (!map || !this.subscribed) return;
    this.subscribed = false;
    map.off('toolchange', this.refresh);
    map.off('measure', this.onMeasure);
    map.off('pickstart', this.refresh);
    map.off('pickend', this.onPickEnd);
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
        // A second press while waiting for the observer cancels (picking stops any tool);
        // another pick (the app's) is replaced by the viewshed's
        if (map.isPicking() && this.ownPick) { map.cancelPick(); return; }
        runRegionAnalysis(map, 'viewshed');
        this.ownPick = map.isPicking();
        this.renderStatus();
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
      const on = b.dataset.tool === t.mode || (b.dataset.tool === 'viewshed' && picking && this.ownPick);
      b.setAttribute('aria-pressed', String(on));
    });
    if (!t.mode) {
      // (A pending pick's prompt shows with the running jobs, at the page's foot)
      this.result = null;
      this.statusEl.hidden = true;
      this.statusEl.innerHTML = '';
      this.statusKey = '';
      return;
    }
    if (!t.result) this.result = null;
    const pairs = pairRows(resultPairs(this.result));
    const canProfile = !!this.result && this.result.mode !== 'area' && !(this.result.mode === 'sight' && !this.result.sight);
    const canFinish = t.drawing && t.mode !== 'sight';
    const key = `${t.mode}|${t.drawing}|${canProfile}|${canFinish}`;
    if (key === this.statusKey) {
      // Live results while drawing: only the pairs change (buttons keep focus and clicks)
      const el = this.statusEl.querySelector<HTMLElement>('.results');
      if (el) {
        if (el.innerHTML !== pairs) el.innerHTML = pairs;
        return;
      }
    }
    this.statusKey = key;
    const title = TOOLS.find((x) => x.id === t.mode)?.title ?? '';
    const hint = t.drawing ? `<div class="hint">${escapeHtml(TOOL_HINTS[t.mode])}</div>` : '';
    const actions = [
      canProfile ? '<button type="button" class="btn" data-action="profile">Profile</button>' : '',
      canFinish ? '<button type="button" class="btn" data-action="finish">Finish</button>' : '',
      '<span class="sp"></span><button type="button" class="btn" data-action="clear">Clear</button>',
    ].join('');
    this.statusEl.innerHTML = `<div class="grp"><span class="t">${escapeHtml(title)}</span></div>${hint}`
      + `<div class="results">${pairs}</div><div class="acts">${actions}</div>`;
    this.statusEl.hidden = false;
  }
}
