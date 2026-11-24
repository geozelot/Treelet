// ============================================================================
// treelet.js - TreeletPanel Web Component
//
// <treelet-panel> - the layers, as the hub's Layers page: rows of 24 that
// drill into sub-pages (one level deep, with a back row on top).
//
//   Overlay  - running region analyses, a pending pick and failures
//              (<treelet-jobs>); then the coat stack, top first: eye, name → the
//              coat's page; then Add layer → Analysis kinds and Imagery
//   Terrain  - Source → the base layers (a plain row with only one),
//              Exaggeration (scrub), Light → sun settings, Mesh (segments)
//
//   Coat page  - Opacity, Blend, the analysis' parameters (rendered from
//                its schema), its ramp, Move up / Move down / Remove
//   Light page - Sun: Manual (direction, altitude) or Date (day, time)
//
// Values change in place: a 'layerupdate', 'sunchange' or 'rangechange'
// from elsewhere updates the page on the next frame (after a press ends;
// a moving sun only patches its rows); the panel's own
// changes don't re-render it, so a dragged scrub keeps working. Escape on a
// sub-page goes back (focus returns to the row that opened it).
// ============================================================================

import { BaseElement, escapeHtml } from './dom';
import { kitStyles, scrubHtml, bindScrubs, setScrub } from './kit';
import { EYE_SVG, EYE_OFF_SVG, CHEV_RIGHT_SVG, CHEV_LEFT_SVG, PLUS_SVG } from './icons';
import type { TreeletJobs } from './TreeletJobs';
import type { Treelet } from '../core/Treelet';
import type { BlendMode } from '../core/types';
import type { BaseLayer } from '../layers/BaseLayer';
import type { AnalysisLayer } from '../layers/AnalysisLayer';
import type { StackLayer } from '../layers/LayerRegistry';
import type { ParamSpec, RGB } from '../analysis/types';
import { listAnalyses, getAnalysis, BLEND_MODES } from '../analysis/registry';
import { runRegionAnalysis } from './regionAnalysis';
import type { RegionAnalysisKind } from '../core/AnalysisController';
import { BUILTIN_RAMPS, isRampName, rampGradientCss, rampNamesFor } from '../analysis/ramps';

/** Names of the blend modes (every mode of the registry needs one). */
const BLEND_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  softlight: 'Soft light',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const panelStyles = /* css */ `
  ${kitStyles}
  :host { display: flex; flex-direction: column; gap: 2px; }
  .panel { display: flex; flex-direction: column; gap: 2px; }
  .row > .ramp { margin-left: auto; }
`;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isAnalysis(layer: StackLayer): layer is AnalysisLayer {
  return 'descriptor' in layer;
}

function sameColor(a: RGB, b: RGB): boolean {
  return Math.abs(a[0] - b[0]) < 0.02 && Math.abs(a[1] - b[1]) < 0.02 && Math.abs(a[2] - b[2]) < 0.02;
}

function hex(c: RGB): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

/** 1, 2 or 5 × a power of ten, at least `x`. */
function niceStep(x: number): number {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  const m = x / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** Hours as h:mm. */
function formatHour(h: number): string {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60) % 24}:${String(m % 60).padStart(2, '0')}`;
}

function sunText(azimuth: number, altitude: number): string {
  return altitude < 0 ? `${Math.round(azimuth)}° · below the horizon` : `${Math.round(azimuth)}° · ${Math.round(altitude)}° up`;
}

const MINUTES_PER_DAY = 24 * 60;

/** Segments that switch a mode (and set its defaults): a press on the selected one does nothing. */
const MODE_ACTIONS = new Set(['suntime', 'auto', 'optional']);

/** One segment of a segment group; the delegated click handler reads its data attributes. */
interface Segment {
  action: string;
  layerId: string;
  param?: string;
  value: string;
  label: string;
  active: boolean;
  focusKey: string;
  /** More data attributes (e.g. min / max a switch applies). */
  data?: Record<string, string | number>;
}

function segmentButtons(options: readonly Segment[]): string {
  return options.map((o) => {
    const param = o.param === undefined ? '' : ` data-param="${escapeHtml(o.param)}"`;
    const data = Object.entries(o.data ?? {}).map(([k, v]) => ` data-${k}="${escapeHtml(String(v))}"`).join('');
    return `<button type="button" data-action="${o.action}" data-layer-id="${escapeHtml(o.layerId)}"${param}`
      + ` data-value="${escapeHtml(o.value)}"${data} data-focus-key="${escapeHtml(o.focusKey)}" aria-pressed="${o.active}">${escapeHtml(o.label)}</button>`;
  }).join('');
}

/** A group header. */
function grp(title: string): string {
  return `<div class="grp"><span class="t">${escapeHtml(title)}</span></div>`;
}

/**
 * Choices with a label: in the row when short (up to 3, few characters),
 * under a group header across the row (up to 5 short ones), else choice rows.
 */
function choices(label: string, options: readonly Segment[]): string {
  const chars = options.reduce((n, o) => n + o.label.length, 0);
  const group = `role="group" aria-label="${escapeHtml(label)}"`;
  if (options.length <= 3 && chars + label.length <= 26) {
    return `<div class="row flush"><span class="k">${escapeHtml(label)}</span><div class="seg" ${group}>${segmentButtons(options)}</div></div>`;
  }
  if (options.length <= 5 && chars <= 36 && options.every((o) => o.label.length <= 10)) {
    return `${grp(label)}<div class="seg full" ${group}>${segmentButtons(options)}</div>`;
  }
  return grp(label) + options.map((o) => {
    const param = o.param === undefined ? '' : ` data-param="${escapeHtml(o.param)}"`;
    return `<button type="button" class="row${o.active ? ' sel' : ''}" data-action="${o.action}" data-layer-id="${escapeHtml(o.layerId)}"${param}`
      + ` data-value="${escapeHtml(o.value)}" data-focus-key="${escapeHtml(o.focusKey)}" aria-pressed="${o.active}"><span class="t">${escapeHtml(o.label)}</span></button>`;
  }).join('');
}

/** A date as the value of a date input (yyyy-mm-dd, local time). */
function dayValue(time: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`;
}

/** The focused element of a shadow root (null when focus is elsewhere or gone). */
function activeIn(root: ShadowRoot): HTMLElement | null {
  try {
    return root.activeElement as HTMLElement | null;
  } catch {
    return null; // some DOM implementations throw while the focused element is detached
  }
}

/** Focus key of a scrub row (the action keeps a parameter named like a panel control apart). */
function scrubKey(id: string, action: string, param: string): string {
  return `${id}:${action}:${param}`;
}

/** Slider bounds widened (on whole steps) to include `values`, so a value set from code shows. */
function widen(min: number, max: number, values: readonly number[], step: number): [number, number] {
  let lo = min;
  let hi = max;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = Number((Math.floor(v / step) * step).toPrecision(12));
    if (v > hi) hi = Number((Math.ceil(v / step) * step).toPrecision(12));
  }
  return [lo, hi];
}

function formatNumber(v: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  return v.toFixed(decimals);
}

/** A value with its unit: a space before word units (m, h), none before symbols (°, %, /km). */
function withUnit(v: number, step: number, unit: string): string {
  return `${formatNumber(v, step)}${unit && /^[A-Za-z]/.test(unit) ? ' ' : ''}${unit}`;
}

/** The page shown: the layers, or one of the sub-pages. */
type View =
  | { kind: 'main' }
  | { kind: 'coat'; id: string }
  | { kind: 'add' }
  | { kind: 'source' }
  | { kind: 'light' };

/**
 * <treelet-panel> - the layers of a map.
 *
 * Uses event delegation: listeners on the shadow root handle all
 * interactions, so replacing the page's markup needs no re-binding.
 */
export class TreeletPanel extends BaseElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;
  private view: View = { kind: 'main' };

  /** Set while the panel itself changes the map, so its own 'layerupdate' / 'sunchange' don't re-render it. */
  private ownChange = false;

  /** A pointer is down in the panel (a scrub may be dragged): updates wait until it is up. */
  private pointerHeld = false;

  /** Layers whose values changed elsewhere, shown on the next frame. */
  private readonly pendingUpdates = new Set<string>();
  private updateFrame = 0;
  private sunPending = false;
  /** The layers changed while a pointer was down: the page is rebuilt once it is up. */
  private layoutPending = false;
  /** The mesh mode changed elsewhere. */
  private meshPending = false;

  /** Persistent containers: only the page's markup is replaced on re-render. */
  private panelEl: HTMLDivElement | null = null;
  /** Running jobs, a pending pick and failures, placed in the Overlay group on every rebuild. */
  private jobsEl: TreeletJobs | null = null;
  private subscribed = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `<style>${panelStyles}</style><div class="panel"></div>`;
    this.panelEl = this.shadow.querySelector('.panel') as HTMLDivElement;
    this.shadow.addEventListener('click', this.handleClick);
    this.shadow.addEventListener('change', this.handleChange);
    this.shadow.addEventListener('pointerdown', this.handlePointerDown, true);
    this.shadow.addEventListener('keydown', this.handleKeyDown);
    bindScrubs(this.shadow, this.handleScrub);
  }

  /** Attach to a map (the hub places the panel on its Layers page). */
  attach(map: Treelet, options: { glass?: boolean } = {}): void {
    if (this.map !== map) this.unsubscribe();
    this.map = map;
    this.toggleAttribute('glass', options.glass === true);
    this.jobsEl ??= document.createElement('treelet-jobs') as TreeletJobs;
    this.jobsEl.attach(map, options);
    if (this.isConnected) this.subscribe();
    this.render();
  }

  connectedCallback(): void {
    if (this.map) {
      this.subscribe();
      this.render();
    }
  }

  disconnectedCallback(): void {
    this.unsubscribe();
  }

  private subscribe(): void {
    const map = this.map;
    if (!map || this.subscribed) return;
    this.subscribed = true;
    map.on('layerchange', this.onLayerChange);
    map.on('layerupdate', this.onLayerUpdate);
    map.on('sunchange', this.onSunChange);
    map.on('rangechange', this.onRangeChange);
    map.on('meshchange', this.onMeshChange);
  }

  private unsubscribe(): void {
    const map = this.map;
    if (!map || !this.subscribed) return;
    this.subscribed = false;
    map.off('layerchange', this.onLayerChange);
    map.off('layerupdate', this.onLayerUpdate);
    map.off('sunchange', this.onSunChange);
    map.off('rangechange', this.onRangeChange);
    map.off('meshchange', this.onMeshChange);
    if (this.updateFrame) cancelAnimationFrame(this.updateFrame);
    this.updateFrame = 0;
  }

  private readonly onLayerChange = (): void => this.refresh();
  private readonly onLayerUpdate = (e: { id: string }): void => this.layerUpdated(e.id);
  private readonly onSunChange = (): void => this.sunChanged();
  private readonly onMeshChange = (): void => {
    if (this.ownChange || !this.map) return;
    this.meshPending = true;
    this.scheduleUpdate();
  };
  /** The visible elevations changed: a coat page whose scrubs span them (a water level, Auto) follows. */
  private readonly onRangeChange = (): void => {
    const v = this.view;
    if (v.kind !== 'coat' || !this.map) return;
    const layer = this.map.getLayerStack().find((l) => l.id === v.id);
    if (layer && isAnalysis(layer) && layer.descriptor.params.some((p) => ('bounds' in p && p.bounds === 'elevation') || ('auto' in p && p.auto))) {
      this.pendingUpdates.add(v.id);
      this.scheduleUpdate();
    }
  };

  /**
   * Show the map's layers again (after layers were added, removed or
   * reordered). While a pointer is down in the panel the page is rebuilt
   * after it is released: rebuilding would end a scrub's drag or drop the
   * click of the pressed row.
   */
  refresh(): void {
    if (!this.map) return;
    if (this.pointerHeld) {
      this.layoutPending = true;
      return;
    }
    this.render();
  }

  /**
   * A layer's values changed ('layerupdate'): show them on its open page on
   * the next frame. Changes the panel made itself are already shown (and
   * re-rendering would end the drag of the scrub that made them).
   */
  layerUpdated(id: string): void {
    if (this.ownChange || !this.map) return;
    this.pendingUpdates.add(id);
    this.scheduleUpdate();
  }

  /** The sun moved ('sunchange'): show it unless the panel moved it. */
  sunChanged(): void {
    if (this.ownChange || !this.map) return;
    this.sunPending = true;
    this.scheduleUpdate();
  }

  /** Back to the layers from any sub-page (the hub calls this as it closes). */
  resetSettings(): void {
    if (this.view.kind === 'main') return;
    this.view = { kind: 'main' };
    this.render();
  }

  private scheduleUpdate(): void {
    if (this.updateFrame || this.pointerHeld) return; // after the pointer is released
    this.updateFrame = requestAnimationFrame(() => {
      this.updateFrame = 0;
      this.flushUpdates();
    });
  }

  private flushUpdates(): void {
    // A press began after the frame was scheduled: wait for its release (which schedules again)
    if (!this.map || !this.panelEl || this.pointerHeld) return;
    const v = this.view;
    const layout = this.layoutPending;
    const coat = v.kind === 'coat' && this.pendingUpdates.has(v.id);
    const base = this.map.getBaseLayers().find((l) => l.visible)?.id;
    const terrain = v.kind === 'main' && (this.meshPending || (base !== undefined && this.pendingUpdates.has(base)));
    const sun = this.sunPending;
    this.layoutPending = false;
    this.meshPending = false;
    this.pendingUpdates.clear();
    this.sunPending = false;
    if (layout || coat) {
      this.render();
      return;
    }
    if (sun) this.showSun();
    if (terrain) this.showTerrain();
  }

  /** The Terrain rows of the layers in place: exaggeration and mesh (set from code). */
  private showTerrain(): void {
    const map = this.map!;
    const panel = this.panelEl!;
    const exag = panel.querySelector<HTMLElement>('.scrub[data-action="exaggeration"]');
    const value = map.getExaggeration();
    if (exag) {
      // Outside the scrub's range: rebuilt with a range that shows it
      if (value < Number(exag.dataset.min) || value > Number(exag.dataset.max)) {
        this.render();
        return;
      }
      setScrub(exag, value, `${value.toFixed(1)}×`);
    }
    const mode = !map.getWireframe() ? 'solid' : map.getWireframeWhite() ? 'white' : 'wire';
    panel.querySelectorAll<HTMLElement>('[data-action="wireframe"]').forEach((b) => {
      const on = b.dataset.value === mode;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('sel', on);
    });
  }

  /**
   * Show where the sun is now, in place: the Light row's summary on the
   * layers, the scrubs, day and position on the Light page (rebuilt only
   * when it switched between a manual sun and a date). An animated sun
   * (a sun time set every frame) leaves the rows, and the day being typed,
   * as they are.
   */
  private showSun(): void {
    const map = this.map!;
    const panel = this.panelEl!;
    if (this.view.kind === 'main') {
      const row = panel.querySelector<HTMLElement>('[data-view="light"]');
      const summary = this.lightSummary();
      row?.setAttribute('aria-label', `Light: ${summary}`);
      const v = row?.querySelector<HTMLElement>('.v');
      if (v) v.textContent = summary;
      return;
    }
    if (this.view.kind !== 'light') return;
    const time = map.getSunTime?.() ?? null;
    const day = panel.querySelector<HTMLInputElement>('input[data-action="sunday"]');
    if ((time !== null) !== (day !== null)) {
      this.render();
      return;
    }
    const scrub = (action: string) => panel.querySelector<HTMLElement>(`.scrub[data-action="${action}"]`);
    if (!time) {
      const azimuth = scrub('azimuth');
      const altitude = scrub('altitude');
      if (azimuth) setScrub(azimuth, map.getSunAzimuth(), `${Math.round(map.getSunAzimuth())}°`);
      if (altitude) setScrub(altitude, map.getSunAltitude(), `${Math.round(map.getSunAltitude())}°`);
      return;
    }
    if (day && activeIn(this.shadow) !== day) day.value = dayValue(time);
    const hour = scrub('sunhour');
    const h = time.getHours() + time.getMinutes() / 60;
    if (hour) setScrub(hour, h, formatHour(h));
    this.showSunPosition();
  }

  /** Run a change of the map made by the panel (its events then don't re-render the panel). */
  private own(change: () => void): void {
    this.ownChange = true;
    try {
      change();
    } finally {
      this.ownChange = false;
    }
  }

  /** Show another page; focus goes to its back row, or back to the row that opened it. */
  private go(view: View, focusKey?: string): void {
    const from = this.view;
    this.view = view;
    let key = focusKey;
    if (key === undefined) {
      if (view.kind !== 'main') key = 'back';
      else if (from.kind === 'coat') key = `coat-${from.id}`;
      else if (from.kind !== 'main') key = from.kind;
    }
    this.render(key);
  }

  // =========================================================================
  // Delegated event handlers (arrow functions for stable `this`)
  // =========================================================================

  private handleClick = (e: Event): void => {
    if (!this.map) return;
    const map = this.map;
    const target = e.target as HTMLElement;

    // === Navigation: sub-pages and back ===
    const nav = target.closest<HTMLElement>('[data-view]');
    if (nav) {
      e.stopPropagation();
      const kind = nav.dataset.view as View['kind'];
      this.go(kind === 'coat' ? { kind, id: nav.dataset.layerId! } : { kind } as View);
      return;
    }

    const control = target.closest<HTMLElement>('[data-action]');
    if (!control) return;
    e.stopPropagation();
    const action = control.dataset.action!;
    const id = control.dataset.layerId ?? '';
    const key = control.dataset.param ?? '';
    const value = control.dataset.value ?? '';
    // The selected mode again keeps what was set in it (a Date mode its day, a sector its ends)
    if (MODE_ACTIONS.has(action) && control.getAttribute('aria-pressed') === 'true') return;
    const coatChange = (change: () => void) => {
      this.own(change);
      this.render();
    };

    switch (action) {
      // --- Stack rows ---
      case 'visible': {
        const row = control.closest<HTMLElement>('[data-visible]')!;
        map.setLayerVisible(id, row.dataset.visible !== 'true');
        return;
      }
      // --- Add layer ---
      case 'add': {
        const kind = control.dataset.kind!;
        if (getAnalysis(kind)?.raster) {
          runRegionAnalysis(map, kind as RegionAnalysisKind);
          this.go({ kind: 'main' }, 'add');
        } else {
          // The map re-renders on 'layerchange' before the handle is known: open the new coat after
          const handle = map.addAnalysisLayer({ analysis: kind });
          this.go({ kind: 'coat', id: handle.id });
        }
        return;
      }
      case 'drape':
        map.activateDrapeLayer(id);
        this.go({ kind: 'main' }, 'add');
        return;
      case 'base':
        map.setActiveBaseLayer(id);
        this.go({ kind: 'main' }, 'source');
        return;
      // --- The coat's page ---
      case 'up':
      case 'down': {
        const index = parseInt(control.dataset.index!, 10);
        map.moveLayer(id, action === 'up' ? index + 1 : index - 1);
        return;
      }
      case 'remove':
        this.view = { kind: 'main' };
        if (control.dataset.layerType === 'drape') map.deactivateDrapeLayer();
        else map.removeAnalysisLayer(id);
        this.render('add');
        return;
      case 'blend':
        coatChange(() => map.setLayerBlendMode(id, value as BlendMode));
        return;
      case 'ramp':
        coatChange(() => map.setAnalysisRamp(id, value as never));
        return;
      case 'color':
        coatChange(() => map.setAnalysisParams(id, { [key]: [
          parseFloat(control.dataset.r!), parseFloat(control.dataset.g!), parseFloat(control.dataset.b!),
        ] }));
        return;
      case 'select':
        coatChange(() => map.setAnalysisParams(id, { [key]: value }));
        return;
      case 'toggle':
        coatChange(() => map.setAnalysisParams(id, { [key]: value === 'true' }));
        return;
      case 'auto':
        coatChange(() => {
          if (value === 'true') {
            map.setAnalysisParams(id, { [key]: 'auto' });
          } else {
            const domain = map.getLegend(id)?.domain ?? [parseFloat(control.dataset.min!), parseFloat(control.dataset.max!)];
            map.setAnalysisParams(id, { [key]: [domain[0], domain[1]] });
          }
        });
        return;
      case 'optional':
        // An optional span: off = null, on = the pair the button carries
        coatChange(() => map.setAnalysisParams(id, {
          [key]: value === 'true' ? [parseFloat(control.dataset.min!), parseFloat(control.dataset.max!)] : null,
        }));
        return;
      // --- Terrain ---
      case 'wireframe':
        this.own(() => {
          map.setWireframe(value !== 'solid');
          map.setWireframeWhite(value === 'white');
        });
        this.render();
        return;
      case 'suntime':
        this.own(() => {
          if (value === 'date') {
            // Start from now, to the quarter hour
            const now = new Date();
            now.setMinutes(Math.round(now.getMinutes() / 15) * 15, 0, 0);
            map.setSunTime(now);
          } else {
            map.setSunTime(null);
          }
        });
        this.render();
        return;
    }
  };

  /** The day input of the sun's date. */
  private handleChange = (e: Event): void => {
    const target = e.target as HTMLInputElement;
    if (!this.map || target.dataset.action !== 'sunday') return;
    e.stopPropagation();
    const [y, m, d] = target.value.split('-').map(Number);
    if (!(y && m && d)) return;
    const map = this.map;
    this.own(() => {
      const next = new Date((map.getSunTime() ?? new Date()).getTime());
      next.setFullYear(y, m - 1, d);
      map.setSunTime(next);
    });
    this.showSunPosition();
  };

  private showSunPosition(): void {
    const pos = this.panelEl?.querySelector<HTMLElement>('[data-value-for="sun:position"]');
    if (pos && this.map) pos.textContent = sunText(this.map.getSunAzimuth(), this.map.getSunAltitude());
  }

  /** Value updates from elsewhere wait while a pointer is down (a scrub may be dragged). */
  private handlePointerDown = (): void => {
    if (this.pointerHeld || typeof window === 'undefined') return;
    this.pointerHeld = true;
    const release = () => {
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      this.pointerHeld = false;
      // On the next frame, after the click the release may still make
      if (this.layoutPending || this.pendingUpdates.size > 0 || this.sunPending) this.scheduleUpdate();
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
  };

  /** Escape on a sub-page goes back (and stays in the panel). */
  private handleKeyDown = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    if (e.key !== 'Escape') return;
    // In a field (the day) Escape is the field's: it closes its picker, not the page or the column
    if (e.target instanceof HTMLInputElement) {
      e.stopPropagation();
      return;
    }
    if (this.view.kind === 'main') return;
    e.preventDefault();
    e.stopPropagation();
    this.go({ kind: 'main' });
  };

  /**
   * Scrub rows: `data-action` says what they set (an analysis parameter, a
   * span end, the coat opacity, exaggeration or the sun), `data-layer-id`
   * and `data-param` which one. Returns the value as shown.
   */
  private handleScrub = (el: HTMLElement, val: number): string | void => {
    if (!this.map) return;
    const map = this.map;
    const action = el.dataset.action ?? '';
    const id = el.dataset.layerId ?? '';
    const param = el.dataset.param ?? '';
    const step = Number(el.dataset.step) || 1;
    const unit = el.dataset.unit ?? '';
    let text: string | undefined;

    this.own(() => {
      switch (action) {
        case 'sunhour': {
          const next = new Date((map.getSunTime() ?? new Date()).getTime());
          // Within the day shown (the scrub ends at 23:45)
          const minutes = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(val * 60)));
          next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
          map.setSunTime(next);
          text = formatHour(minutes / 60);
          this.showSunPosition();
          return;
        }
        case 'exaggeration':
          map.setExaggeration(val);
          text = `${val.toFixed(1)}×`;
          return;
        case 'azimuth':
          map.setSunAzimuth(val);
          text = `${Math.round(val)}°`;
          return;
        case 'altitude':
          map.setSunAltitude(val);
          text = `${Math.round(val)}°`;
          return;
        case 'opacity':
          map.setLayerOpacity(id, val);
          text = `${Math.round(val * 100)}%`;
          return;
        case 'span': {
          // One end of a [low, high] pair: read the other scrub
          const end = el.dataset.span;
          const other = this.panelEl?.querySelector<HTMLElement>(
            `.scrub[data-action="span"][data-layer-id="${CSS.escape(id)}"][data-param="${CSS.escape(param)}"][data-span="${end === '0' ? '1' : '0'}"]`,
          );
          const otherValue = Number(other?.dataset.value ?? 0);
          const a = end === '0' ? val : otherValue;
          const b = end === '1' ? val : otherValue;
          if (el.dataset.wrap !== undefined) {
            // A circular range runs clockwise from a to b (a > b passes through north)
            map.setAnalysisParams(id, { [param]: [a, b] });
          } else {
            // The ends keep their order: the other end moves along, a step apart, when crossed
            const min = Number(el.dataset.min);
            const max = Number(el.dataset.max);
            let lo = a;
            let hi = b;
            if (end === '0' && hi < lo + step) {
              hi = Math.min(max, lo + step);
              lo = Math.min(lo, hi - step);
            } else if (end === '1' && lo > hi - step) {
              lo = Math.max(min, hi - step);
              hi = Math.max(hi, lo + step);
            }
            map.setAnalysisParams(id, { [param]: [lo, hi] });
            const show = (s: HTMLElement, v: number) => setScrub(s, v, withUnit(v, step, unit));
            if (other) show(other, end === '0' ? hi : lo);
            show(el, end === '0' ? lo : hi); // the dragged end, kept a step from the range's end
            return;
          }
          text = withUnit(val, step, unit);
          return;
        }
        case 'param':
          map.setAnalysisParams(id, { [param]: val });
          text = withUnit(val, step, unit);
          return;
      }
    });
    return text;
  };

  // =========================================================================
  // Render
  // =========================================================================

  private render(focusKey?: string): void {
    if (!this.map || !this.panelEl) return;
    const view = this.resolveView();
    let html: string;
    switch (view.kind) {
      case 'coat': html = this.renderCoatPage(view.id); break;
      case 'add': html = this.renderAddPage(); break;
      case 'source': html = this.renderSourcePage(); break;
      case 'light': html = this.renderLightPage(); break;
      default: html = this.renderMain();
    }
    // Keep keyboard focus on the same control across the rebuild
    const focused = activeIn(this.shadow);
    const key = focusKey ?? focused?.dataset.focusKey;
    this.panelEl.innerHTML = html;
    const slot = this.panelEl.querySelector('.jobs-slot');
    if (slot && this.jobsEl) slot.replaceWith(this.jobsEl);
    if (key && (focusKey !== undefined || focused)) {
      const el = this.panelEl.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
      // Now disabled (Move up at the top): the next control of its row keeps focus
      const target = el && (el as HTMLButtonElement).disabled
        ? el.parentElement?.querySelector<HTMLElement>('button:not(:disabled)') ?? this.panelEl.querySelector<HTMLElement>('.row.back')
        : el;
      target?.focus();
    }
  }

  /** The view, or the layers when its coat is gone. */
  private resolveView(): View {
    const v = this.view;
    if (v.kind === 'coat' && !this.map!.getLayerStack().some((l) => l.id === v.id)) this.view = { kind: 'main' };
    return this.view;
  }

  // =========================================================================
  // The layers
  // =========================================================================

  private renderMain(): string {
    const map = this.map!;
    const stack = map.getLayerStack();
    const bases = map.getBaseLayers();
    const active = bases.find((l) => l.visible);
    const rows: string[] = [grp('Overlay'), '<div class="jobs-slot"></div>'];
    for (let index = stack.length - 1; index >= 0; index--) rows.push(this.renderStackRow(stack[index]));
    rows.push(`<button type="button" class="row tight" data-view="add" data-focus-key="add">
      <span class="ib">${PLUS_SVG}</span><span class="nm dim"><span class="t">Add layer</span><span class="chev">${CHEV_RIGHT_SVG}</span></span></button>`);

    rows.push(grp('Terrain'));
    rows.push(this.renderSourceRow(active, bases.length));
    const exag = map.getExaggeration();
    const [emin, emax] = widen(0.5, 5, [exag], 0.1);
    rows.push(scrubHtml({
      label: 'Exaggeration', value: exag, min: emin, max: emax, step: 0.1, text: `${exag.toFixed(1)}×`,
      data: { action: 'exaggeration', 'layer-id': active?.id ?? '' }, focusKey: 'exaggeration',
    }));
    rows.push(`<button type="button" class="row fill" data-view="light" data-focus-key="light" aria-label="Light: ${escapeHtml(this.lightSummary())}">
      <span class="k">Light</span><span class="v">${escapeHtml(this.lightSummary())}</span><span class="chev">${CHEV_RIGHT_SVG}</span></button>`);
    rows.push(this.renderMeshRow());
    return rows.join('');
  }

  /** A coat: eye, then its name opening its page. */
  private renderStackRow(layer: StackLayer): string {
    const id = escapeHtml(layer.id);
    const name = escapeHtml(layer.layerName);
    const v = layer.visible;
    return `<div class="row tight" data-layer-id="${id}" data-visible="${v}">
      <button type="button" class="ib${v ? ' on' : ' off'}" data-action="visible" data-layer-id="${id}" data-focus-key="eye-${id}"
        aria-pressed="${v}" aria-label="${v ? 'Hide' : 'Show'} ${name}" title="${v ? 'Hide' : 'Show'}">${v ? EYE_SVG : EYE_OFF_SVG}</button>
      <button type="button" class="nm${v ? '' : ' off'}" data-view="coat" data-layer-id="${id}" data-focus-key="coat-${id}"
        aria-label="${name} settings"><span class="t">${name}</span><span class="chev">${CHEV_RIGHT_SVG}</span></button>
    </div>`;
  }

  private renderSourceRow(active: BaseLayer | undefined, count: number): string {
    const name = escapeHtml(active?.layerName ?? 'None');
    if (count < 2) return `<div class="row fill"><span class="k">Source</span><span class="v">${name}</span></div>`;
    return `<button type="button" class="row fill" data-view="source" data-focus-key="source" aria-label="Source: ${name}">
      <span class="k">Source</span><span class="v">${name}</span><span class="chev">${CHEV_RIGHT_SVG}</span></button>`;
  }

  private renderMeshRow(): string {
    const wire = this.map!.getWireframe();
    const white = this.map!.getWireframeWhite();
    const mode = !wire ? 'solid' : white ? 'white' : 'wire';
    const options: Array<[string, string]> = [['solid', 'Solid'], ['wire', 'Wire'], ['white', 'White']];
    return choices('Mesh', options.map(([v, label]) => ({
      action: 'wireframe', layerId: 'mesh', value: v, label, active: mode === v, focusKey: `mesh-${v}`,
    })));
  }

  private lightSummary(): string {
    const map = this.map!;
    const time = map.getSunTime?.() ?? null;
    if (!time) return `Manual · ${Math.round(map.getSunAzimuth())}° · ${Math.round(map.getSunAltitude())}°`;
    return `${time.getDate()} ${MONTHS[time.getMonth()]} · ${formatHour(time.getHours() + time.getMinutes() / 60)}`;
  }

  private backRow(title: string): string {
    return `<button type="button" class="row back" data-view="main" data-focus-key="back" aria-label="Back to the layers">
      <span class="chev">${CHEV_LEFT_SVG}</span><span class="t">${escapeHtml(title)}</span></button>`;
  }

  // =========================================================================
  // Sub-pages
  // =========================================================================

  /** Analysis kinds (add a coat) and the imagery not shown (swap it in). */
  private renderAddPage(): string {
    const map = this.map!;
    const parts: string[] = [this.backRow('Add layer'), grp('Analysis')];
    // Raster kinds appear only when the map can compute them over the view
    const computable = new Set<string>(map.getRegionAnalyses?.() ?? []);
    for (const d of listAnalyses()) {
      if (d.raster && !computable.has(d.id)) continue;
      parts.push(`<button type="button" class="row" data-action="add" data-kind="${escapeHtml(d.id)}" data-focus-key="add-${escapeHtml(d.id)}">
        <span class="t">${escapeHtml(d.label)}</span>${d.raster ? '<span class="v dim">over the view</span>' : ''}</button>`);
    }
    const active = map.getActiveDrapeId();
    const drapes = map.getDrapeLayers().filter((l) => l.id !== active);
    if (drapes.length) {
      parts.push(grp('Imagery'));
      for (const d of drapes) {
        parts.push(`<button type="button" class="row" data-action="drape" data-layer-id="${escapeHtml(d.id)}" data-focus-key="drape-${escapeHtml(d.id)}">
          <span class="t">${escapeHtml(d.layerName)}</span></button>`);
      }
    }
    return parts.join('');
  }

  /** The base layers; the active one selected. */
  private renderSourcePage(): string {
    const parts: string[] = [this.backRow('Source')];
    for (const l of this.map!.getBaseLayers()) {
      parts.push(`<button type="button" class="row${l.visible ? ' sel' : ''}" data-action="base" data-layer-id="${escapeHtml(l.id)}"
        data-focus-key="base-${escapeHtml(l.id)}" aria-pressed="${l.visible}"><span class="t">${escapeHtml(l.layerName)}</span></button>`);
    }
    return parts.join('');
  }

  private renderLightPage(): string {
    const map = this.map!;
    const azimuth = map.getSunAzimuth();
    const altitude = map.getSunAltitude();
    const time = map.getSunTime?.() ?? null;
    const mode = time ? 'date' : 'manual';
    const parts: string[] = [this.backRow('Light')];
    parts.push(choices('Sun', ([['manual', 'Manual'], ['date', 'Date']] as const).map(([v, label]) => ({
      action: 'suntime', layerId: 'sun', value: v, label, active: mode === v, focusKey: `sun-${v}`,
    }))));
    if (!time) {
      parts.push(scrubHtml({
        label: 'Direction', value: azimuth, min: 0, max: 360, step: 1, text: `${Math.round(azimuth)}°`,
        data: { action: 'azimuth', 'layer-id': 'sun', param: 'azimuth' }, focusKey: scrubKey('sun', 'azimuth', 'azimuth'),
      }));
      parts.push(scrubHtml({
        label: 'Altitude', value: altitude, min: 5, max: 90, step: 1, text: `${Math.round(altitude)}°`,
        data: { action: 'altitude', 'layer-id': 'sun', param: 'altitude' }, focusKey: scrubKey('sun', 'altitude', 'altitude'),
      }));
      return parts.join('');
    }
    // Date mode: the sun stands where it does at that local time over the map center
    const day = dayValue(time);
    const hour = time.getHours() + time.getMinutes() / 60;
    parts.push(`<div class="row fill"><span class="k">Day</span>
      <input type="date" class="date" data-action="sunday" data-layer-id="sun" data-focus-key="sun:day" value="${day}" aria-label="Day"></div>`);
    parts.push(scrubHtml({
      label: 'Time', value: hour, min: 0, max: 24 - 0.25, step: 0.25, text: formatHour(hour),
      data: { action: 'sunhour', 'layer-id': 'sun', param: 'sunhour' }, focusKey: scrubKey('sun', 'sunhour', 'sunhour'),
    }));
    parts.push(`<div class="row"><span class="k">Sun</span><span class="v" data-value-for="sun:position">${sunText(azimuth, altitude)}</span></div>`);
    return parts.join('');
  }

  /** A coat's page: opacity, blend, the analysis' parameters and ramp, then its place in the stack. */
  private renderCoatPage(id: string): string {
    const stack = this.map!.getLayerStack();
    const index = stack.findIndex((l) => l.id === id);
    const layer = stack[index];
    const eid = escapeHtml(id);
    const opacity = layer.display.opacity;
    const blend = layer.display.blendMode;
    const type = isAnalysis(layer) ? 'analysis' : 'drape';
    const parts: string[] = [
      this.backRow(layer.layerName),
      scrubHtml({
        label: 'Opacity', value: opacity, min: 0, max: 1, step: 0.05, text: `${Math.round(opacity * 100)}%`,
        data: { action: 'opacity', 'layer-id': id, param: 'opacity' }, focusKey: scrubKey(id, 'opacity', 'opacity'),
      }),
      choices('Blend', BLEND_MODES.map((m) => ({
        action: 'blend', layerId: id, value: m, label: BLEND_LABELS[m], active: blend === m, focusKey: `blend-${id}-${m}`,
      }))),
    ];
    if (isAnalysis(layer)) {
      for (const spec of layer.descriptor.params) parts.push(this.renderParam(layer, spec));
      if (layer.isValueKind) parts.push(this.renderRampList(layer));
    }
    parts.push(grp('Layer'));
    const top = index === stack.length - 1;
    const bottom = index === 0;
    parts.push(`<div class="acts even" data-layer-id="${eid}">
      <button type="button" class="btn" data-action="up" data-layer-id="${eid}" data-index="${index}" data-focus-key="up-${eid}"${top ? ' disabled' : ''}>Move up</button>
      <button type="button" class="btn" data-action="down" data-layer-id="${eid}" data-index="${index}" data-focus-key="down-${eid}"${bottom ? ' disabled' : ''}>Move down</button>
      <button type="button" class="btn" data-action="remove" data-layer-id="${eid}" data-layer-type="${type}" data-focus-key="remove-${eid}">Remove</button>
    </div>`);
    return parts.join('');
  }

  /** One parameter control from the analysis' schema. */
  private renderParam(layer: AnalysisLayer, spec: ParamSpec): string {
    const id = layer.id;
    const value = layer.params[spec.key];
    const unit = 'unit' in spec ? spec.unit ?? '' : '';
    switch (spec.type) {
      case 'range': {
        const v = typeof value === 'number' ? value : spec.min;
        let [min, max] = [spec.min, spec.max];
        if (spec.bounds === 'elevation') {
          // The scrub spans what is on screen
          const [lo, hi] = this.map!.getVisibleElevationRange();
          min = Math.max(spec.min, Math.floor(lo / spec.step) * spec.step);
          max = Math.min(spec.max, Math.ceil(Math.max(hi, min + spec.step) / spec.step) * spec.step);
        }
        // A value set from code may lie outside the scrub's range: widen it to show the value
        [min, max] = widen(min, max, [v], spec.step);
        return scrubHtml({
          label: spec.label, value: v, min, max, step: spec.step, text: withUnit(v, spec.step, unit),
          data: { action: 'param', 'layer-id': id, param: spec.key, unit }, focusKey: scrubKey(id, 'param', spec.key),
        });
      }
      case 'span': {
        const auto = value === 'auto';
        const off = value === null;
        const parts: string[] = [];
        if (spec.optional) {
          // Default sector when switched on: through north for bearings, else the full range
          const on: [number, number] = spec.wrap ? [315, 45] : [spec.min, spec.max];
          parts.push(choices(spec.label, [
            { action: 'optional', layerId: id, param: spec.key, value: 'false', label: 'All', active: off, focusKey: `off-${id}-${spec.key}` },
            { action: 'optional', layerId: id, param: spec.key, value: 'true', label: spec.wrap ? 'Sector' : 'Range', active: !off,
              focusKey: `on-${id}-${spec.key}`, data: { min: on[0], max: on[1] } },
          ]));
          if (off) return parts.join('');
        }
        if (spec.auto) {
          parts.push(choices(spec.optional ? 'Mode' : spec.label, [
            { action: 'auto', layerId: id, param: spec.key, value: 'true', label: 'Auto', active: auto, focusKey: `auto-${id}-${spec.key}` },
            { action: 'auto', layerId: id, param: spec.key, value: 'false', label: 'Manual', active: !auto,
              focusKey: `manual-${id}-${spec.key}`, data: { min: spec.min, max: spec.max } },
          ]));
        }
        if (!spec.auto && !spec.optional) parts.push(grp(spec.label));
        if (auto) {
          const d = this.map!.getLegend(id)?.domain;
          if (d) parts.push(`<div class="row"><span class="k">Visible</span><span class="v">${formatNumber(d[0], spec.step)}–${escapeHtml(withUnit(d[1], spec.step, unit))}</span></div>`);
          return parts.join('');
        }
        const [lo, hi] = Array.isArray(value) ? value as [number, number] : [spec.min, spec.max];
        let [smin, smax, step] = [spec.min, spec.max, spec.step];
        if (spec.bounds === 'data') {
          // Scrubs span the raster's values (and the current range)
          const r = this.map!.getRasterInfo?.(id)?.range ?? [lo, hi];
          const a = Math.min(r[0], lo);
          const b = Math.max(r[1], hi, a + 1e-6);
          step = niceStep((b - a) / 200);
          smin = Number((Math.floor(a / step + 1e-9) * step).toPrecision(12));
          smax = Number((Math.ceil(b / step - 1e-9) * step).toPrecision(12));
        } else if (!spec.wrap) {
          [smin, smax] = widen(smin, smax, [lo, hi], step);
        }
        const names = spec.wrap ? ['From', 'To'] : ['Low', 'High'];
        const end = (i: 0 | 1, v: number) => scrubHtml({
          label: names[i], ariaLabel: `${spec.label} ${names[i].toLowerCase()}`, value: v, min: smin, max: smax, step,
          text: withUnit(v, step, unit),
          data: { action: 'span', 'layer-id': id, param: spec.key, span: i, unit, wrap: spec.wrap ? '' : undefined },
          focusKey: `${scrubKey(id, 'span', spec.key)}:${i}`,
        });
        parts.push(`<div class="duo">${end(0, lo)}${end(1, hi)}</div>`);
        return parts.join('');
      }
      case 'select':
        return choices(spec.label, spec.options.map((o) => ({
          action: 'select', layerId: id, param: spec.key, value: o.value, label: o.label,
          active: String(value) === o.value, focusKey: `sel-${id}-${spec.key}-${o.value}`,
        })));
      case 'color': {
        const current = Array.isArray(value) ? value as RGB : [0, 0, 0] as RGB;
        const eid = escapeHtml(id);
        return `<div class="row"><span class="k">${escapeHtml(spec.label)}</span><div class="sws" role="group" aria-label="${escapeHtml(spec.label)}">
          ${(spec.presets ?? []).map((p) => {
            const active = sameColor(p.color, current);
            return `<button type="button" class="sw" data-action="color" data-layer-id="${eid}"
              data-param="${spec.key}" style="background:${hex(p.color)}" data-r="${p.color[0]}" data-g="${p.color[1]}" data-b="${p.color[2]}"
              data-focus-key="swatch-${eid}-${spec.key}-${escapeHtml(p.label)}" title="${escapeHtml(p.label)}" aria-label="${escapeHtml(p.label)}" aria-pressed="${active}"></button>`;
          }).join('')}
        </div></div>`;
      }
      case 'boolean': {
        const on = value === true;
        return choices(spec.label, [
          { action: 'toggle', layerId: id, param: spec.key, value: 'true', label: 'On', active: on, focusKey: `on-${id}-${spec.key}` },
          { action: 'toggle', layerId: id, param: spec.key, value: 'false', label: 'Off', active: !on, focusKey: `off-${id}-${spec.key}` },
        ]);
      }
    }
  }

  private renderRampList(layer: AnalysisLayer): string {
    const eid = escapeHtml(layer.id);
    const current = layer.ramp ?? layer.descriptor.ramp;
    const custom = current !== undefined && !isRampName(current);
    // Class presets place their breaks on the layer's value range
    const domain = this.map!.getLegend(layer.id)?.domain ?? [0, 1];
    return grp('Ramp') + rampNamesFor(layer.descriptor.id).map((name) => {
      const active = current === name;
      const spec = BUILTIN_RAMPS[name];
      return `<button type="button" class="row${active ? ' sel' : ''}" data-action="ramp" data-layer-id="${eid}" data-value="${name}"
        data-focus-key="ramp-${eid}-${name}" aria-pressed="${active}">
        <span class="t">${capitalize(name)}</span>
        <span class="ramp" style="background:${rampGradientCss(spec, spec.type === 'classes' ? domain : [0, 1])}"></span>
      </button>`;
    }).join('') + (custom ? `<div class="row sel" aria-current="true"><span class="t">Custom</span>
      <span class="ramp" style="background:${rampGradientCss(current, domain)}"></span></div>` : '');
  }
}
