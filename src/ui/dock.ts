// ============================================================================
// treelet.js - Dock: a corner box that opens into a column with a rail
//
// The frame shared by the info box (<treelet-info>) and the hub
// (<treelet-hub>). At rest it is a 56 box in its corner. A tap, click,
// Enter or Space turns it into a column of 24 rows (264 wide; the full
// width of the map when compact) with a slim rail on its outer side:
//
//   - the box's own icon at the far end of the rail closes the column;
//   - the page buttons stay by the corner the box opened from (at the
//     bottom in a bottom corner, at the top in a top corner).
//
// The open page is marked like everything selected: the active fill and a
// 2px accent line on the side facing the rows. Escape steps back out of a
// sub-page (the page's content handles that and stops the key), then
// closes the column and returns focus to the box. A click on the map does
// not close it: the measuring tools need those clicks.
// ============================================================================

import { kitStyles } from './kit';
import type { UICorner } from '../core/types';

export interface DockPageSpec {
  id: string;
  /** Accessible name of the page button and the page. */
  label: string;
  /** Rail icon (an SVG string). */
  icon: string;
}

export interface DockSpec {
  /** Accessible name of the column ("Legend and map"). */
  label: string;
  /** Icon of the box at rest, and of the rail's close button. */
  boxIcon: string;
  railIcon: string;
  /** Pages in rail order, outer end first (the last one sits by the corner and opens first). */
  pages: DockPageSpec[];
  /** A footer under the pages (the info column's credits). */
  footer?: boolean;
}

const dockStyles = /* css */ `
  :host {
    position: absolute; z-index: 998; display: flex; pointer-events: none;
    --dock-max: calc(100vh - 24px);
  }
  :host([data-v="bottom"]) { bottom: 12px; align-items: flex-end; }
  :host([data-v="top"]) { top: 12px; align-items: flex-start; }
  :host([data-h="left"]) { left: 12px; justify-content: flex-start; }
  :host([data-h="right"]) { right: 12px; justify-content: flex-end; }
  :host([compact][open]) { left: 12px; right: 12px; }

  .box, .pane { pointer-events: auto; }

  /* The box at rest */
  .box {
    position: relative; width: 56px; height: 56px; display: grid; place-items: center; flex: none;
    color: var(--text); opacity: .65; transition: opacity .15s;
  }
  .box:focus-visible { opacity: 1; outline-offset: 2px; }
  @media (hover: hover) { .box:hover { opacity: 1; } }
  .box > svg { width: 42px; height: 42px; }
  :host([open]) .box { display: none; }
  /* Running jobs: a 2px progress line along the box's foot */
  .jobline { position: absolute; left: 8px; right: 8px; bottom: 5px; height: 2px; border-radius: 1px; background: var(--btn-bg); overflow: hidden; }
  .jobline > i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .12s linear; }

  /* The open column */
  .pane { display: flex; align-items: stretch; max-height: var(--dock-max); overflow: hidden; }
  :host([data-h="right"]) .pane { flex-direction: row; transform-origin: right bottom; }
  :host([data-h="left"]) .pane { flex-direction: row-reverse; transform-origin: left bottom; }
  :host([data-v="top"][data-h="right"]) .pane { transform-origin: right top; }
  :host([data-v="top"][data-h="left"]) .pane { transform-origin: left top; }
  :host([compact]) .pane { flex: 1; min-width: 0; }
  .pane:not([hidden]) { animation: dock-in .14s ease-out; }
  @keyframes dock-in { from { opacity: 0; transform: scale(.96); } }
  @media (prefers-reduced-motion: reduce) { .pane:not([hidden]) { animation: none; } }

  .pbody {
    flex: none; width: 264px; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding: 6px;
    overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin;
  }
  :host([compact]) .pbody { flex: 1; width: auto; }
  .page { display: flex; flex-direction: column; gap: 2px; }
  .page > * { flex: none; }
  .foot { display: flex; flex-direction: column; margin-top: auto; padding-top: 4px; }
  .foot:empty { display: none; }

  /* The rail: 36 inside its 1px divider, 28 buttons, pad 4 (corners concentric: 9 - 4 = 5) */
  .rail { flex: none; width: 37px; display: flex; flex-direction: column; gap: 2px; padding: 4px; background: var(--hover-bg); }
  :host([data-h="right"]) .rail { border-left: 1px solid var(--border); }
  :host([data-h="left"]) .rail { border-right: 1px solid var(--border); }
  .tabs { display: flex; flex-direction: column; gap: 2px; margin-top: auto; }
  :host([data-v="top"]) .rail, :host([data-v="top"]) .tabs { flex-direction: column-reverse; }
  :host([data-v="top"]) .tabs { margin-top: 0; margin-bottom: auto; }
  .rb {
    position: relative; flex: none; width: 28px; height: 28px; display: grid; place-items: center;
    border-radius: 5px; color: var(--text-dim);
  }
  .rb > svg { width: 20px; height: 20px; }
  .rb.home { color: var(--text); }
  .rb.home > svg { width: 24px; height: 24px; }
  .rb[aria-selected="true"] { background: var(--active-bg); color: var(--text); }
  .rb[aria-selected="true"]::after { content: ''; position: absolute; top: 6px; bottom: 6px; width: 2px; background: var(--accent); }
  :host([data-h="right"]) .rb[aria-selected="true"]::after { left: -4px; }
  :host([data-h="left"]) .rb[aria-selected="true"]::after { right: -4px; }
  @media (hover: hover) {
    .rb:hover { background: var(--hover-bg); color: var(--text); }
    .rb[aria-selected="true"]:hover { background: var(--active-bg); }
  }
`;

/**
 * The frame of a dock in an element's shadow root. The element fills the
 * pages (`pageEl(id)`) and the footer; the frame opens, closes and switches.
 */
export class DockFrame {
  readonly box: HTMLButtonElement;
  readonly pane: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly foot: HTMLDivElement | null;
  private readonly home: HTMLButtonElement;
  private readonly tabs = new Map<string, HTMLButtonElement>();
  private readonly pages = new Map<string, HTMLDivElement>();
  private readonly jobline: HTMLElement;
  private current: string;
  private opened = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly shadow: ShadowRoot,
    private readonly spec: DockSpec,
    /** Called after the column opened or closed, or the page changed. */
    private readonly onChange: (open: boolean, page: string) => void,
    /** Extra styles of the element. */
    styles = '',
  ) {
    const name = spec.label;
    const lower = name.charAt(0).toLowerCase() + name.slice(1);
    const pages = spec.pages;
    const single = pages.length < 2;
    shadow.innerHTML = `<style>${kitStyles}${dockStyles}${styles}</style>
      <button type="button" class="box surf" aria-expanded="false" aria-controls="pane" aria-label="Open ${lower}" title="${name}">
        ${spec.boxIcon}<span class="jobline" hidden><i></i></span>
      </button>
      <div class="pane surf" id="pane" role="region" aria-label="${name}" hidden>
        <div class="pbody">
          ${pages.map((p) => `<div class="page" id="page-${p.id}" data-page="${p.id}"${single ? '' : ` role="tabpanel" aria-labelledby="tab-${p.id}"`} hidden></div>`).join('')}
          ${spec.footer ? '<div class="foot"></div>' : ''}
        </div>
        <div class="rail">
          <button type="button" class="rb home" aria-label="Close ${lower}" aria-expanded="true" aria-controls="pane" title="Close">${spec.railIcon}</button>
          ${single ? '' : `<div class="tabs" role="tablist" aria-label="Pages" aria-orientation="vertical">
            ${pages.map((p) => `<button type="button" class="rb" role="tab" id="tab-${p.id}" data-page="${p.id}" aria-selected="false" aria-controls="page-${p.id}" aria-label="${p.label}" title="${p.label}" tabindex="-1">${p.icon}</button>`).join('')}
          </div>`}
        </div>
      </div>`;
    this.box = shadow.querySelector('.box') as HTMLButtonElement;
    this.pane = shadow.querySelector('.pane') as HTMLDivElement;
    this.body = shadow.querySelector('.pbody') as HTMLDivElement;
    this.foot = shadow.querySelector('.foot');
    this.home = shadow.querySelector('.rb.home') as HTMLButtonElement;
    this.jobline = shadow.querySelector('.jobline') as HTMLElement;
    shadow.querySelectorAll<HTMLButtonElement>('.rb[role="tab"]').forEach((b) => this.tabs.set(b.dataset.page!, b));
    shadow.querySelectorAll<HTMLDivElement>('.page').forEach((p) => this.pages.set(p.dataset.page!, p));
    this.current = pages[pages.length - 1].id;
    this.syncPage();

    this.box.addEventListener('click', (e) => this.open(undefined, e.detail === 0));
    this.home.addEventListener('click', (e) => this.close(e.detail === 0));
    for (const tab of this.tabs.values()) {
      tab.addEventListener('click', () => this.show(tab.dataset.page!));
    }
    shadow.querySelector('.tabs')?.addEventListener('keydown', (ev) => this.onTabKey(ev as KeyboardEvent));
    // Escape the page's contents did not use (no sub-page open) closes the column
    this.pane.addEventListener('keydown', (ev) => {
      const e = ev as KeyboardEvent;
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.stopPropagation();
      this.close(true);
    });
  }

  get isOpen(): boolean { return this.opened; }
  get page(): string { return this.current; }

  /** The container of a page's content. */
  pageEl(id: string): HTMLDivElement {
    return this.pages.get(id)!;
  }

  /** Place the dock in a corner of the map. */
  place(corner: UICorner): void {
    const [v, h] = corner.split('-') as ['top' | 'bottom', 'left' | 'right'];
    this.host.dataset.v = v;
    this.host.dataset.h = h;
  }

  /** Open the column (on `page`, or the page shown last). */
  open(page?: string, focus = false): void {
    if (page && this.pages.has(page)) this.current = page;
    const was = this.opened;
    this.opened = true;
    this.host.toggleAttribute('open', true);
    this.pane.hidden = false;
    this.box.setAttribute('aria-expanded', 'true');
    this.syncPage();
    if (focus) (this.tabs.get(this.current) ?? this.home).focus();
    if (!was || page) this.onChange(true, this.current);
  }

  /** Close the column back into its box. */
  close(focus = false): void {
    if (!this.opened) return;
    this.opened = false;
    this.host.toggleAttribute('open', false);
    this.pane.hidden = true;
    this.box.setAttribute('aria-expanded', 'false');
    if (focus) this.box.focus();
    this.onChange(false, this.current);
  }

  /** Show a page (opening the column when closed). */
  show(page: string): void {
    if (!this.pages.has(page)) return;
    if (!this.opened) { this.open(page); return; }
    if (page === this.current) return;
    this.current = page;
    this.syncPage();
    this.onChange(true, page);
  }

  /** Progress of running jobs on the box at rest (0..1), or null for none. */
  setProgress(progress: number | null): void {
    this.jobline.hidden = progress === null;
    const fill = this.jobline.firstElementChild as HTMLElement;
    fill.style.width = `${Math.round(Math.max(0, Math.min(1, progress ?? 0)) * 100)}%`;
  }

  private syncPage(): void {
    for (const [id, el] of this.pages) el.hidden = id !== this.current;
    for (const [id, tab] of this.tabs) {
      const on = id === this.current;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
  }

  /** Arrow keys move along the page buttons (and show the page). */
  private onTabKey(e: KeyboardEvent): void {
    const ids = this.spec.pages.map((p) => p.id);
    const i = ids.indexOf(this.current);
    let next = -1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = Math.max(0, i - 1);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = Math.min(ids.length - 1, i + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    if (next < 0) return;
    e.preventDefault();
    this.show(ids[next]);
    this.tabs.get(ids[next])?.focus();
  }
}
