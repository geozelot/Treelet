// ============================================================================
// treelet.js - TreeletHub Web Component
//
// <treelet-hub> - the tree box. It opens into a column with these pages:
//
//   Layers  - the coat stack and the terrain (<treelet-panel>)
//   Themes  - the thematic maps of `map.setThemes()` (only while there
//             are any)
//   Measure - the measuring tools and their results (<treelet-toolbar>),
//             and the elevation profile (<treelet-profile>)
//
// Running analyses, a pending pick and failures (<treelet-jobs>) show in
// the Layers page's Overlay group, and at the foot of the other pages.
//
// The page buttons sit on the rail by the box's corner (Measure, Themes,
// then Layers by the corner); the tree at the rail's far end closes the
// column. While region analyses run, the box at rest shows their progress
// as a thin line.
// ============================================================================

import { BaseElement, escapeHtml } from './dom';
import { DockFrame } from './dock';
import { TREE_SVG } from './treeSvg';
import { LAYERS_SVG, MEASURE_SVG, THEMES_SVG } from './icons';
import type { TreeletPanel } from './TreeletPanel';
import type { TreeletJobs } from './TreeletJobs';
import { resultPairs, type TreeletToolbar } from './TreeletToolbar';
import type { TreeletProfile, ProfileData } from './TreeletProfile';
import type { ProfilePoint } from './profileChart';
import type { Treelet } from '../core/Treelet';
import type { UICorner } from '../core/types';

/** Pages of the hub. */
export type HubPage = 'layers' | 'themes' | 'measure';

const hubStyles = /* css */ `
  .box > svg { width: 34px; height: 28px; }
  .rb.home > svg { width: 24px; height: 20px; }
  .tool-on { fill: transparent; transition: fill .15s; }
  /* The jobs at the foot of a page (hidden with nothing to show) */
  .foot { padding-top: 0; }
  .foot > treelet-jobs { margin-top: 4px; }
  :host([tool-active]) .tool-on { fill: var(--accent); }
`;

export class TreeletHub extends BaseElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;
  private dock: DockFrame | null = null;
  private panel: TreeletPanel | null = null;
  private toolbar: TreeletToolbar | null = null;
  private profile: TreeletProfile | null = null;
  /** The jobs at the foot of the pages other than Layers (which has its own). */
  private jobs: TreeletJobs | null = null;
  private subscribed = false;
  private wasOpen = false;
  private profileHover: ((p: ProfilePoint | null) => void) | null = null;
  private profileClose: (() => void) | null = null;
  private readonly onJobs = (): void => this.showJobs();
  private readonly onThemes = (): void => this.renderThemes();
  private readonly onTool = (): void => {
    this.toggleAttribute('tool-active', !!this.map && (this.map.getTool().mode !== null || this.map.isPicking()));
  };

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  /**
   * Attach to a map and build the column.
   *
   * @param options.corner - corner of the box (default 'bottom-right')
   * @param options.tools  - the Measure page (default true)
   * @param options.glass  - frosted surfaces
   */
  attach(map: Treelet, options: { corner?: UICorner; tools?: boolean; glass?: boolean } = {}): void {
    if (this.map !== map) this.unsubscribe();
    this.map = map;
    this.toggleAttribute('glass', options.glass === true);
    const glass = { glass: options.glass === true };
    if (!this.dock) {
      const tools = options.tools !== false;
      this.dock = new DockFrame(this, this.shadow, {
        label: 'Layers and measuring',
        boxIcon: TREE_SVG,
        railIcon: TREE_SVG,
        pages: [
          ...(tools ? [{ id: 'measure', label: 'Measure', icon: MEASURE_SVG }] : []),
          { id: 'themes', label: 'Themes', icon: THEMES_SVG, hidden: true },
          { id: 'layers', label: 'Layers', icon: LAYERS_SVG },
        ],
        footer: true,
      }, (open, page) => this.onDockChange(open, page), hubStyles);
      this.jobs = document.createElement('treelet-jobs') as TreeletJobs;
      this.dock.foot!.appendChild(this.jobs);
      this.dock.foot!.hidden = this.dock.page === 'layers';

      this.dock.pageEl('themes').addEventListener('click', (e) => {
        const row = (e.target as Element).closest<HTMLElement>('[data-theme]');
        if (row && this.map) this.map.applyTheme(row.dataset.theme!);
      });

      this.panel = document.createElement('treelet-panel') as TreeletPanel;
      this.dock.pageEl('layers').appendChild(this.panel);
      if (tools) {
        const page = this.dock.pageEl('measure');
        this.toolbar = document.createElement('treelet-toolbar') as TreeletToolbar;
        page.appendChild(this.toolbar);
        this.profile = document.createElement('treelet-profile') as TreeletProfile;
        page.appendChild(this.profile);
        this.profile.attach({
          glass: glass.glass,
          embedded: true,
          onHover: (p) => this.profileHover?.(p),
          onClose: () => this.profileClose?.(),
        });
      }
    }
    this.dock.place(options.corner ?? 'bottom-right');
    this.panel!.attach(map, glass);
    this.jobs!.attach(map, glass);
    this.toolbar?.attach(map, glass);
    if (this.isConnected) this.subscribe();
    this.showJobs();
    this.onTool();
    this.renderThemes();
  }

  connectedCallback(): void {
    if (this.map && this.dock) {
      this.subscribe();
      this.showJobs();
      this.renderThemes();
    }
  }

  disconnectedCallback(): void {
    this.unsubscribe();
  }

  /** Open the column, on `page` or the page shown last. */
  open(page?: HubPage): void {
    this.dock?.open(page);
  }

  /** Close the column back into its box. */
  close(): void {
    this.dock?.close();
  }

  /** Whether the column is open. */
  get isOpen(): boolean {
    return this.dock?.isOpen ?? false;
  }

  /** The page shown (or shown last). */
  get page(): HubPage {
    return (this.dock?.page ?? 'layers') as HubPage;
  }

  /** Whether the hub has a Measure page (and shows profiles there). */
  get hasTools(): boolean {
    return this.profile !== null;
  }

  /**
   * Show a profile on the Measure page (opening it). The map calls this from
   * `showProfile`; `onHover` / `onClose` let it mark the hovered sample.
   * A profile of the tool's own result (`ofTool`; the map closes it when
   * that result changes) leaves out the statistics the tool shows above it.
   * @internal
   */
  showProfile(data: ProfileData, hooks: { ofTool?: boolean; onHover: (p: ProfilePoint | null) => void; onClose: () => void }): boolean {
    if (!this.profile || !this.dock) return false;
    this.profileHover = hooks.onHover;
    this.profileClose = hooks.onClose;
    this.dock.open('measure');
    const shown = hooks.ofTool ? new Set(resultPairs(this.map?.getTool().result ?? null).map(([label]) => label)) : null;
    this.profile.show(shown ? { ...data, stats: data.stats.filter(([label]) => !shown.has(label)) } : data);
    return true;
  }

  /** Close the profile on the Measure page. @internal */
  hideProfile(): void {
    this.profile?.hide();
  }

  private onDockChange(open: boolean, page: string): void {
    if (!open) this.panel?.resetSettings();
    if (this.dock?.foot) this.dock.foot.hidden = page === 'layers';
    if (open !== this.wasOpen) {
      this.wasOpen = open;
      this.dispatchEvent(new Event(open ? 'open' : 'close'));
    }
  }

  private subscribe(): void {
    const map = this.map;
    if (!map || this.subscribed) return;
    this.subscribed = true;
    map.on('analysisstart', this.onJobs);
    map.on('analysisprogress', this.onJobs);
    map.on('analysisend', this.onJobs);
    map.on('toolchange', this.onTool);
    map.on('pickstart', this.onTool);
    map.on('pickend', this.onTool);
    map.on('themechange', this.onThemes);
  }

  private unsubscribe(): void {
    const map = this.map;
    if (!map || !this.subscribed) return;
    this.subscribed = false;
    map.off('analysisstart', this.onJobs);
    map.off('analysisprogress', this.onJobs);
    map.off('analysisend', this.onJobs);
    map.off('toolchange', this.onTool);
    map.off('pickstart', this.onTool);
    map.off('pickend', this.onTool);
    map.off('themechange', this.onThemes);
  }

  /**
   * The Themes page: one row per theme, the applied one selected (a row
   * applies its theme, again when it is selected). The page and its rail
   * button are hidden while there are no themes.
   */
  private renderThemes(): void {
    const dock = this.dock;
    if (!dock || !this.map) return;
    const themes = this.map.getThemes?.() ?? [];
    const active = this.map.getActiveTheme?.() ?? null;
    dock.setPageHidden('themes', themes.length === 0);
    const page = dock.pageEl('themes');
    let focused: string | undefined;
    try {
      focused = (this.shadow.activeElement as HTMLElement | null)?.dataset?.theme;
    } catch { /* focus moved while the page was rebuilt */ }
    page.innerHTML = themes.length === 0 ? '' : '<div class="grp"><span class="t">Themes</span></div>'
      + themes.map((t) => {
        const on = t.id === active;
        const tip = t.description ? ` title="${escapeHtml(t.description)}"` : '';
        return `<button type="button" class="row${on ? ' sel' : ''}" data-theme="${escapeHtml(t.id)}" aria-pressed="${on}"${tip}>`
          + `<span class="t">${escapeHtml(t.name)}</span></button>`;
      }).join('');
    // A row that had focus keeps it
    if (focused !== undefined) {
      [...page.querySelectorAll<HTMLElement>('[data-theme]')].find((b) => b.dataset.theme === focused)?.focus();
    }
  }

  /** The mean progress of the running jobs on the box at rest. */
  private showJobs(): void {
    const jobs = this.map?.getAnalysisJobs?.() ?? [];
    if (!jobs.length) { this.dock?.setProgress(null); return; }
    this.dock?.setProgress(jobs.reduce((s, j) => s + j.progress, 0) / jobs.length);
  }
}
