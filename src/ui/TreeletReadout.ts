// ============================================================================
// treelet.js - TreeletReadout Web Component
//
// <treelet-readout> - the terrain under the pointer: elevation, slope and
// aspect. Follows the mouse (sampled at most once per animation frame) and
// hides when it leaves the map; on touch screens a tap samples that point
// and the readout stays until the next tap. Sits in a corner container the
// map provides (stacked with the legend when they share a corner).
// ============================================================================

import { BaseElement, escapeHtml } from './dom';
import { cornerCardStyles } from './cornerStyles';
import type { Treelet } from '../core/Treelet';
import type { TerrainPick } from '../core/types';

const readoutStyles = /* css */ `
  ${cornerCardStyles}

  .card { gap: 2px; min-width: 118px; }

  .readout-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-variant-numeric: tabular-nums;
  }
  .readout-label { color: var(--text-dim); }
`;

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** 0–360° → compass point (eight sectors). */
export function compassPoint(bearing: number): string {
  const b = ((bearing % 360) + 360) % 360;
  return COMPASS_POINTS[Math.round(b / 45) % 8];
}

/** The lines a readout shows for a terrain sample. */
export function formatReadout(pick: TerrainPick): Array<[label: string, value: string]> {
  const elevation = `${Math.round(pick.elevation).toLocaleString('en-US').replace(/,/g, ' ')} m`;
  const slope = `${pick.slope.toFixed(1)}°`;
  const aspect = pick.aspect === null ? 'flat' : `${Math.round(pick.aspect)}° ${compassPoint(pick.aspect)}`;
  return [['Elevation', elevation], ['Slope', slope], ['Aspect', aspect]];
}

/** How far a touch may move (CSS px) and still count as a tap. */
const TAP_SLOP = 8;

export class TreeletReadout extends BaseElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;
  private target: HTMLElement | null = null;
  private bodyEl: HTMLDivElement | null = null;
  private frame: number | null = null;
  private pending: { x: number; y: number } | null = null;
  private touchStart: { x: number; y: number; id: number } | null = null;
  /** The readout stays until the next tap (touch). */
  private pinned = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  /** Attach to a map; pointer events are read from the map's container. */
  attach(map: Treelet, options: { glass?: boolean } = {}): void {
    this.detach();
    this.map = map;
    this.target = map.getContainer();
    if (options.glass) this.setAttribute('glass', '');
    else this.removeAttribute('glass');
    if (!this.bodyEl) {
      this.shadow.innerHTML = `<style>${readoutStyles}</style><div class="card" role="status" aria-live="off" aria-label="Terrain under the pointer"></div>`;
      this.bodyEl = this.shadow.querySelector('.card') as HTMLDivElement;
    }
    this.hidden = true;
    const t = this.target;
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

  private position(e: PointerEvent): { x: number; y: number } {
    const rect = this.target!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || this.pinned) return;
    this.pending = this.position(e);
    if (this.frame === null) {
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        if (this.pending) this.showAt(this.pending.x, this.pending.y);
      });
    }
  };

  private onPointerLeave = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || this.pinned) return;
    this.pending = null;
    this.render(null);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      this.pinned = false;
      return;
    }
    this.touchStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
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
    if (!this.bodyEl) return;
    if (!pick) {
      this.hidden = true;
      return;
    }
    this.bodyEl.innerHTML = formatReadout(pick).map(([label, value]) =>
      `<div class="readout-row"><span class="readout-label">${escapeHtml(label)}</span><span class="readout-value">${escapeHtml(value)}</span></div>`,
    ).join('');
    this.hidden = false;
  }
}
