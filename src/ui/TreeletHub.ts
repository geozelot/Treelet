// ============================================================================
// treelet.js - TreeletHub Web Component
//
// <treelet-hub> - the tree box. It opens into a column with two pages:
//
//   Layers  - the coat stack and the terrain (<treelet-panel>)
//   Measure - the measuring tools and their results (<treelet-toolbar>),
//             and the elevation profile (<treelet-profile>)
//
// Running analyses, a pending pick and failures (<treelet-jobs>) show in
// the Layers page's Overlay group, at the foot of the Measure page, and
// beside the box while the column is closed.
//
// The page buttons sit on the rail by the box's corner (Measure above
// Layers); the tree at the rail's far end closes the column. While region
// analyses run, the box at rest shows their progress as a thin line.
// ============================================================================

import { BaseElement } from './dom';
import { DockFrame } from './dock';
import { TREE_SVG } from './treeSvg';
import { LAYERS_SVG, MEASURE_SVG } from './icons';
import type { TreeletPanel } from './TreeletPanel';
import type { TreeletJobs } from './TreeletJobs';
import { resultPairs, type TreeletToolbar } from './TreeletToolbar';
import type { TreeletProfile, ProfileData } from './TreeletProfile';
import type { ProfilePoint } from './profileChart';
import type { Treelet } from '../core/Treelet';
import type { UICorner } from '../core/types';

/** Pages of the hub. */
export type HubPage = 'layers' | 'measure';

const hubStyles = /* css */ `
  .box > svg { width: 34px; height: 28px; }
  .rb.home > svg { width: 24px; height: 20px; }
  .tool-on { fill: transparent; transition: fill .15s; }
  /* The jobs at the foot of a page (hidden with nothing to show) */
  .foot { padding-top: 0; }
  .foot > treelet-jobs { margin-top: 4px; }
  /* At rest, beside the box: a column-wide surface above it (below it in a top corner) */
  treelet-jobs.peek {
    position: absolute; width: 264px; max-width: calc(100vw - 24px); padding: 6px; pointer-events: auto;
    background: var(--surface-bg); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow);
    -webkit-backdrop-filter: var(--surface-filter); backdrop-filter: var(--surface-filter);
  }
  :host([data-v="bottom"]) treelet-jobs.peek { bottom: 62px; }
  :host([data-v="top"]) treelet-jobs.peek { top: 62px; }
  :host([data-h="right"]) treelet-jobs.peek { right: 0; }
  :host([data-h="left"]) treelet-jobs.peek { left: 0; }
  :host([tool-active]) .tool-on { fill: var(--accent); }
`;

export class TreeletHub extends BaseElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;
  private dock: DockFrame | null = null;
  private panel: TreeletPanel | null = null;
  private toolbar: TreeletToolbar | null = null;
  private profile: TreeletProfile | null = null;
  /** The jobs at the foot of the Measure page (the Layers page has its own), or beside the box at rest. */
  private jobs: TreeletJobs | null = null;
  private subscribed = false;
  private wasOpen = false;
  private profileHover: ((p: ProfilePoint | null) => void) | null = null;
  private profileClose: (() => void) | null = null;
  private readonly onJobs = (): void => this.showJobs();
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
    if (this.map !== map) {
      this.unsubscribe();
      // Another map's profile (and its hooks) goes
      this.profile?.hide();
      this.profileHover = null;
      this.profileClose = null;
    }
    this.map = map;
    this.toggleAttribute('glass', options.glass === true);
    const glass = { glass: options.glass === true };
    const tools = options.tools !== false;
    // The pages are built once; with or without a Measure page now, they are built again
    if (this.dock && tools !== (this.toolbar !== null)) this.rebuild();
    if (!this.dock) {
      this.dock = new DockFrame(this, this.shadow, {
        label: 'Layers and measuring',
        boxIcon: TREE_SVG,
        railIcon: TREE_SVG,
        pages: [
          ...(tools ? [{ id: 'measure', label: 'Measure', icon: MEASURE_SVG }] : []),
          { id: 'layers', label: 'Layers', icon: LAYERS_SVG },
        ],
        footer: true,
      }, (open, page) => this.onDockChange(open, page), hubStyles);
      this.jobs = document.createElement('treelet-jobs') as TreeletJobs;
      this.placeJobs(false, this.dock.page);

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
  }

  connectedCallback(): void {
    // Moved in the page: listen again, and catch up on what changed meanwhile
    if (this.map && this.dock) {
      this.subscribe();
      this.showJobs();
      this.onTool();
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

  /** Drop the column and its pages (the next attach builds them again). */
  private rebuild(): void {
    if (this.wasOpen) {
      this.wasOpen = false;
      this.dispatchEvent(new Event('close'));
    }
    this.dock = null;
    this.panel = null;
    this.toolbar = null;
    this.profile = null;
    this.jobs = null;
    this.shadow.innerHTML = '';
  }

  /**
   * Where the hub's jobs show: at the foot of the open column (not on the
   * Layers page, which has its own), or beside the box at rest (a pending
   * pick's prompt, progress with cancel, failures).
   */
  private placeJobs(open: boolean, page: string): void {
    const jobs = this.jobs;
    const foot = this.dock?.foot;
    if (!jobs || !foot) return;
    if (open) {
      if (jobs.parentNode !== foot) foot.appendChild(jobs);
      jobs.classList.remove('peek');
      foot.hidden = page === 'layers';
    } else {
      if (jobs.parentNode !== this.shadow) this.shadow.appendChild(jobs);
      jobs.classList.add('peek');
    }
  }

  private onDockChange(open: boolean, page: string): void {
    if (!open) this.panel?.resetSettings();
    this.placeJobs(open, page);
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
  }

  /** The mean progress of the running jobs on the box at rest. */
  private showJobs(): void {
    const jobs = this.map?.getAnalysisJobs?.() ?? [];
    if (!jobs.length) { this.dock?.setProgress(null); return; }
    this.dock?.setProgress(jobs.reduce((s, j) => s + j.progress, 0) / jobs.length);
  }
}
