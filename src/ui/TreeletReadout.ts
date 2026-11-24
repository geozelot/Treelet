// ============================================================================
// treelet.js - TreeletReadout Web Component
//
// <treelet-readout> - the terrain under the pointer, as rows of the info
// column's Legend page: elevation, slope and aspect, and the value of the
// topmost other analysis coat (water depth, curvature, a raster…). Follows
// the mouse over the map itself (sampled at most once per animation frame,
// only while the readout is shown); over the map's controls and off the map
// the values show "–" (the rows stay, so the column doesn't jump). On touch
// screens a tap on the terrain samples that point ("Tapped point").
// ============================================================================

import { BaseElement, escapeHtml } from './dom';
import { kitStyles } from './kit';
import type { Treelet } from '../core/Treelet';
import type { TerrainPick } from '../core/types';
import type { StackLayer } from '../layers/LayerRegistry';
import { formatValue } from '../analysis/ramps';
import { formatElevation } from '../tools/format';

/** Kinds the three readout lines already show. */
const SHOWN_KINDS = new Set(['elevation', 'slope', 'aspect']);

const readoutStyles = /* css */ `
  ${kitStyles}
  :host { display: flex; flex-direction: column; gap: 2px; }
  .rows { display: flex; flex-direction: column; gap: 2px; }
`;

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** 0–360° → compass point (eight sectors). */
export function compassPoint(bearing: number): string {
  const b = ((bearing % 360) + 360) % 360;
  return COMPASS_POINTS[Math.round(b / 45) % 8];
}

/** The lines a readout shows for a terrain sample. */
export function formatReadout(pick: TerrainPick): Array<[label: string, value: string]> {
  const elevation = formatElevation(pick.elevation);
  const slope = `${pick.slope.toFixed(1)}°`;
  const aspect = pick.aspect === null ? 'flat' : `${Math.round(pick.aspect)}° ${compassPoint(pick.aspect)}`;
  return [['Elevation', elevation], ['Slope', slope], ['Aspect', aspect]];
}

/** How far a touch may move (CSS px) and still count as a tap. */
const TAP_SLOP = 8;

const EMPTY = '–';

export class TreeletReadout extends BaseElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;
  private target: HTMLElement | null = null;
  private rowsEl: HTMLDivElement | null = null;
  private frame: number | null = null;
  private pending: { x: number; y: number } | null = null;
  private touchStart: { x: number; y: number; id: number } | null = null;
  /** The values stay until the next tap (touch). */
  private pinned = false;
  /** Sampling only while the readout is shown (its page is open). */
  private shown = true;
  private lastPick: TerrainPick | null = null;
  /** Screens without hover (touch): the readout shows tapped points. */
  private readonly hoverNone = typeof matchMedia === 'function' ? matchMedia('(hover: none)') : null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  /** Attach to a map; pointer events are read from the map's container. */
  attach(map: Treelet, options: { glass?: boolean } = {}): void {
    this.detach();
    this.map = map;
    this.toggleAttribute('glass', options.glass === true);
    if (!this.rowsEl) {
      this.shadow.innerHTML = `<style>${readoutStyles}</style><div class="rows" role="group" aria-label="Terrain under the pointer"></div>`;
      this.rowsEl = this.shadow.querySelector('.rows') as HTMLDivElement;
    }
    this.render(null);
    if (this.isConnected) this.listen();
  }

  /**
   * Whether the readout is on screen. While it is not, pointer moves are not
   * sampled (the info column sets this as it opens, closes and turns pages).
   */
  set active(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    if (!on && this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
      this.pending = null;
    }
    if (on) this.render(this.pinned ? this.lastPick : null);
  }

  get active(): boolean {
    return this.shown;
  }

  connectedCallback(): void {
    // Moved in the page (disconnected, then connected): listen again
    if (this.map && !this.target) this.listen();
  }

  private listen(): void {
    if (!this.map) return;
    const t = this.target = this.map.getContainer();
    t.addEventListener('pointermove', this.onPointerMove);
    t.addEventListener('pointerleave', this.onPointerLeave);
    t.addEventListener('pointerdown', this.onPointerDown);
    t.addEventListener('pointerup', this.onPointerUp);
    t.addEventListener('pointercancel', this.onPointerCancel);
  }

  disconnectedCallback(): void {
    this.detach();
  }

  private detach(): void {
    const t = this.target;
    if (t) {
      t.removeEventListener('pointermove', this.onPointerMove);
      t.removeEventListener('pointerleave', this.onPointerLeave);
      t.removeEventListener('pointerdown', this.onPointerDown);
      t.removeEventListener('pointerup', this.onPointerUp);
      t.removeEventListener('pointercancel', this.onPointerCancel);
    }
    this.target = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pending = null;
  }

  /** Sample and show the terrain at container-relative pixel (x, y). */
  showAt(x: number, y: number): void {
    const pick = this.map?.pick(x, y) ?? null;
    this.render(pick);
  }

  /**
   * Whether the event comes from the map itself (its canvas, a child of the
   * container, or the container), not from a control over it (columns,
   * compass, profile…). The container may itself be in a shadow root.
   */
  private onMapSurface(e: PointerEvent): boolean {
    const origin = e.composedPath()[0] ?? e.target;
    if (origin === this.target) return true;
    return origin instanceof HTMLCanvasElement && origin.parentNode === this.target;
  }

  private position(e: PointerEvent): { x: number; y: number } {
    const rect = this.target!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || this.pinned || !this.shown) return;
    if (!this.onMapSurface(e)) {
      // Over a control: nothing of the terrain to show (once: the dashes stay)
      this.pending = null;
      if (this.lastPick !== null) this.render(null);
      return;
    }
    this.pending = this.position(e);
    if (this.frame === null) {
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        if (this.pending) this.showAt(this.pending.x, this.pending.y);
      });
    }
  };

  private onPointerLeave = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || this.pinned || !this.shown) return;
    this.pending = null;
    this.render(null);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      if (this.pinned) {
        this.pinned = false;
        this.render(null);
      }
      return;
    }
    // A tap on a control is the control's, not a terrain sample (nor is one while the readout is hidden)
    this.touchStart = this.shown && this.onMapSurface(e) ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
  };

  private onPointerUp = (e: PointerEvent): void => {
    const start = this.touchStart;
    if (!start || start.id !== e.pointerId) return;
    this.touchStart = null;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) return;
    const { x, y } = this.position(e);
    const pick = this.map?.pick(x, y) ?? null;
    this.pinned = pick !== null;
    this.render(pick);
  };

  private onPointerCancel = (): void => {
    this.touchStart = null;
  };

  private render(pick: TerrainPick | null): void {
    if (!this.rowsEl) return;
    this.lastPick = pick;
    const rows: Array<[string, string]> = pick
      ? formatReadout(pick)
      : [['Elevation', EMPTY], ['Slope', EMPTY], ['Aspect', EMPTY]];
    const extra = this.extraRow(pick);
    if (extra) {
      const { layer, value } = extra;
      const unit = 'unit' in layer && layer.unit ? ` ${layer.unit}` : '';
      rows.push([layer.layerName, value === null ? EMPTY : `${formatValue(value)}${unit}`]);
    }
    // Touch screens sample where they are tapped
    const touchOnly = this.hoverNone?.matches ?? false;
    const title = this.pinned || touchOnly ? 'Tapped point' : 'Cursor';
    this.rowsEl.innerHTML = `<div class="grp"><span class="t">${title}</span></div>`
      + rows.map(([label, value]) =>
        `<div class="row"><span class="k">${escapeHtml(label)}</span><span class="v${value === EMPTY ? ' dim' : ''}">${escapeHtml(value)}</span></div>`,
      ).join('');
  }

  /**
   * The extra row: the topmost visible analysis coat the three lines don't
   * already show that has a value at the pick (a raster covers only its
   * region); the topmost such coat, without a value, when none has one.
   */
  private extraRow(pick: TerrainPick | null): { layer: StackLayer; value: number | null } | null {
    const map = this.map;
    if (!map) return null;
    const stack = map.getLayerStack();
    let topmost: StackLayer | null = null;
    for (let i = stack.length - 1; i >= 0; i--) {
      const layer = stack[i];
      if (!layer.visible || !('descriptor' in layer) || !layer.isValueKind || SHOWN_KINDS.has(layer.descriptor.id)) continue;
      if (!pick) return { layer, value: null };
      const value = map.getAnalysisValue(layer.id, pick.lngLat);
      if (value !== null) return { layer, value };
      topmost ??= layer;
    }
    return topmost ? { layer: topmost, value: null } : null;
  }
}
