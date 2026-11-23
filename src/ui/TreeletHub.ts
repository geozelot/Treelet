// ============================================================================
// treelet.js - TreeletHub Web Component
//
// <treelet-hub> - the tree box. It opens into a column with two pages:
//
//   Layers  - the coat stack and the terrain (<treelet-panel>)
//   Measure - the measuring tools and their results (<treelet-toolbar>),
//             and the elevation profile (<treelet-profile>)
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
  :host([tool-active]) .tool-on { fill: var(--accent); }
`;

export class TreeletHub extends BaseElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;
  private dock: DockFrame | null = null;
  private panel: TreeletPanel | null = null;
  private toolbar: TreeletToolbar | null = null;
  private profile: TreeletProfile | null = null;
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
          { id: 'layers', label: 'Layers', icon: LAYERS_SVG },
        ],
      }, (open, page) => this.onDockChange(open, page), hubStyles);

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
    this.toolbar?.attach(map, glass);
    if (this.isConnected) this.subscribe();
    this.showJobs();
    this.onTool();
  }

  connectedCallback(): void {
    if (this.map && this.dock) {
      this.subscribe();
      this.showJobs();
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
   * @internal
   */
  showProfile(data: ProfileData, hooks: { onHover: (p: ProfilePoint | null) => void; onClose: () => void }): boolean {
    if (!this.profile || !this.dock) return false;
    this.profileHover = hooks.onHover;
    this.profileClose = hooks.onClose;
    this.dock.open('measure');
    // The tool's result above already shows some of the statistics
    const shown = resultPairs(this.map?.getTool().result ?? null);
    const stats = data.stats.filter(([k, v]) => !shown.some(([sk, sv]) => sk === k && sv === v));
    this.profile.show({ ...data, stats });
    return true;
  }

  /** Close the profile on the Measure page. @internal */
  hideProfile(): void {
    this.profile?.hide();
  }

  private onDockChange(open: boolean, _page: string): void {
    if (!open) this.panel?.resetSettings();
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
