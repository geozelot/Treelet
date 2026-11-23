// ============================================================================
// treelet.js - UI kit: the shared look and the scrub control
//
// One box, one column, one row. Every element of the UI is built from the
// same parts, so they line up wherever they are combined:
//
//   rows 24 high, 2 apart; columns padded 6; text 8 in from a row's edge;
//   radii 10 (surfaces) / 5 (rows, buttons) / 3 (swatches); type 10 caps /
//   11 / 12. Selected = the active fill plus a 2px accent line; the accent
//   is never a fill.
//
// Controls are rows: scrub rows (the row is the slider), segments (2-4
// short choices), choice rows, and rows that drill into a sub-page.
// Each element includes `kitStyles` in its shadow root.
// ============================================================================

import { themeTokens, glassTokens, lightShadowRule } from './themeTokens';
import { escapeHtml } from './dom';

export const kitStyles = /* css */ `
  :host {
    ${themeTokens}
    font: 12px/16px system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: var(--text);
    -webkit-tap-highlight-color: transparent;
  }
  ${lightShadowRule}
  :host([glass]) { ${glassTokens} }
  :host([hidden]) { display: none !important; }

  *, *::before, *::after { box-sizing: border-box; }
  button { all: unset; box-sizing: border-box; cursor: pointer; }
  button:disabled { cursor: default; color: var(--text-off); }
  button:focus-visible, [tabindex]:focus-visible, input:focus-visible {
    outline: 2px solid var(--accent); outline-offset: -2px;
  }
  svg { display: block; flex: none; }
  [hidden] { display: none !important; }

  /* Surfaces: boxes and columns */
  .surf {
    background: var(--surface-bg);
    -webkit-backdrop-filter: var(--surface-filter);
    backdrop-filter: var(--surface-filter);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }

  /* Group header: 10px caps sitting on the row's baseline */
  .grp {
    flex: none; height: 24px; display: flex; align-items: flex-end; gap: 6px; padding: 0 8px 4px;
    font-size: 10px; line-height: 12px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase;
    color: var(--text-dim); white-space: nowrap;
  }
  .grp > .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .grp > .ib { margin: 0 -6px -4px auto; }

  /* Rows: 24 high, text 8 in from the edge */
  .row {
    position: relative; flex: none; min-width: 0; height: 24px; display: flex; align-items: center; gap: 6px;
    padding: 0 8px; border-radius: 5px; white-space: nowrap;
  }
  .row.fill { background: var(--btn-bg); }
  .row.sel { background: var(--active-bg); }
  .row.sel::before {
    content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px; border-radius: 1px; background: var(--accent);
  }
  .row.tight { padding: 0 2px; gap: 0; }
  .row.flush { padding-right: 0; }
  .row.wrap { height: auto; min-height: 24px; padding-top: 4px; padding-bottom: 4px; white-space: normal; line-height: 16px; }
  .row.back { gap: 4px; padding-left: 4px; font-weight: 600; }
  .k { flex: none; font-size: 11px; color: var(--text-dim); }
  .v {
    flex: 0 1 auto; min-width: 0; margin-left: auto; overflow: hidden; text-overflow: ellipsis;
    font-size: 11px; font-variant-numeric: tabular-nums;
  }
  .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .dim { color: var(--text-dim); }
  .off { color: var(--text-off); }
  .err { color: light-dark(#b42318, #ff8a7a); }

  /* A name that opens something: fills the row, chevron at its end */
  .nm {
    flex: 1; min-width: 0; height: 24px; padding: 0 6px; display: flex; align-items: center; gap: 6px;
    border-radius: 5px; line-height: 24px; overflow: hidden;
  }
  .nm > .t { flex: 1; white-space: nowrap; }
  .nm.off { color: var(--text-off); }
  .chev { color: var(--text-dim); }

  /* Icon button in a row */
  .ib { width: 24px; height: 24px; display: grid; place-items: center; flex: none; border-radius: 5px; color: var(--text-dim); }
  .ib.on { color: var(--accent); }
  .ib.off { color: var(--text-off); }

  /* Scrub row: the row is the slider. The fill is the value, the accent line runs under it. */
  .scrub {
    position: relative; flex: none; min-width: 0; height: 24px; display: flex; align-items: center; gap: 6px;
    padding: 0 8px; border-radius: 5px; overflow: hidden; background: var(--btn-bg); white-space: nowrap;
    cursor: ew-resize; touch-action: pan-y; user-select: none; -webkit-user-select: none;
  }
  .scrub > .fl {
    position: absolute; left: 0; top: 0; bottom: 0; background: var(--active-bg);
    border-bottom: 2px solid var(--accent); pointer-events: none;
  }
  .scrub > .k, .scrub > .v { position: relative; }
  .scrub.prog { cursor: default; }
  .duo { flex: none; height: 24px; display: flex; gap: 2px; min-width: 0; }
  .duo > .scrub { flex: 1; }

  /* Segments: 2-4 short choices; .full spans the row */
  .seg { display: flex; gap: 2px; margin-left: auto; min-width: 0; }
  .seg > button {
    position: relative; height: 24px; padding: 0 8px; display: flex; align-items: center; justify-content: center; gap: 4px;
    border-radius: 5px; background: var(--btn-bg); color: var(--text-dim); font-size: 11px; white-space: nowrap;
  }
  .seg > button[aria-pressed="true"] { background: var(--active-bg); color: var(--text); }
  .seg > button[aria-pressed="true"]::after {
    content: ''; position: absolute; left: 6px; right: 6px; bottom: 0; height: 2px; background: var(--accent);
  }
  .seg > button.copied { color: var(--accent); }
  .seg.full { flex: none; height: 24px; margin-left: 0; }
  .seg.full > button { flex: 1; min-width: 0; padding: 0 4px; overflow: hidden; text-overflow: ellipsis; }

  /* Text buttons in a row of actions */
  .btn {
    height: 24px; padding: 0 8px; display: inline-flex; align-items: center; justify-content: center; gap: 4px; flex: none;
    border-radius: 5px; background: var(--btn-bg); color: var(--text-dim); font-size: 11px; white-space: nowrap;
  }
  .acts { flex: none; height: 24px; display: flex; gap: 2px; }
  .acts > .sp { flex: 1; }
  .acts.even > .btn { flex: 1; min-width: 0; }

  /* Two label / value pairs in a row */
  .pair {
    flex: none; height: 24px; display: grid; grid-template-columns: 1fr 1fr; column-gap: 16px; padding: 0 8px;
    align-items: center; white-space: nowrap;
  }
  .pair > span { display: flex; align-items: center; gap: 6px; min-width: 0; }

  /* A row of icon buttons (tools) */
  .trow { flex: none; height: 24px; display: flex; gap: 2px; }
  .ic {
    position: relative; flex: 1; min-width: 0; height: 24px; display: grid; place-items: center;
    border-radius: 5px; background: var(--btn-bg); color: var(--text-dim);
  }
  .ic[aria-pressed="true"] { background: var(--active-bg); color: var(--text); }
  .ic[aria-pressed="true"]::after {
    content: ''; position: absolute; left: 6px; right: 6px; bottom: 0; height: 2px; background: var(--accent);
  }

  /* Legends, swatches, ramps */
  .leg { flex: none; display: grid; grid-template-rows: 10px 14px; row-gap: 4px; padding: 2px 8px; }
  .leg > .bar { border-radius: 3px; box-shadow: inset 0 0 0 1px var(--border); }
  .rng {
    display: flex; justify-content: space-between; gap: 8px; font-size: 11px; line-height: 14px;
    color: var(--text-dim); font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .sw { flex: none; width: 16px; height: 16px; border-radius: 3px; box-shadow: inset 0 0 0 1px var(--border); }
  .sws { display: flex; gap: 6px; margin-left: auto; }
  button.sw[aria-pressed="true"] { outline: 2px solid var(--accent); outline-offset: 1px; }
  .ramp { flex: none; width: 64px; height: 8px; border-radius: 3px; box-shadow: inset 0 0 0 1px var(--border); }

  .hint { flex: none; padding: 4px 8px; font-size: 11px; line-height: 16px; color: var(--text-dim); white-space: normal; }
  .date {
    margin-left: auto; height: 24px; border: 0; padding: 0; background: transparent; color: var(--text);
    font: inherit; font-size: 11px; font-variant-numeric: tabular-nums;
  }
  /* For screen readers only */
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  @media (hover: hover) {
    button.row:hover, .nm:hover, .ib:hover, .btn:hover, .ic:hover, .seg > button:hover { background: var(--hover-bg); }
    button.row.fill:hover, .seg > button[aria-pressed="true"]:hover, .ic[aria-pressed="true"]:hover, .row.sel:hover { background: var(--active-bg); }
    button:disabled:hover { background: none; }
    .btn:hover, .ib:hover, .seg > button:hover, .ic:hover { color: var(--text); }
  }
`;

// ===========================================================================
// Scrub rows
// ===========================================================================

export interface ScrubSpec {
  /** Text at the row's start (also the accessible name unless `ariaLabel`). */
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** The value as shown. */
  text: string;
  /** Extra data attributes (`{ action: 'opacity' }` → `data-action="opacity"`). */
  data?: Record<string, string | number | undefined>;
  /** Keeps keyboard focus on the control across re-renders. */
  focusKey?: string;
  /** `data-value-for` of the value label. */
  valueKey?: string;
  ariaLabel?: string;
}

function fraction(value: number, min: number, max: number): number {
  return max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
}

/** The markup of a scrub row. */
export function scrubHtml(s: ScrubSpec): string {
  const data = Object.entries(s.data ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` data-${k}="${escapeHtml(String(v))}"`).join('');
  const focus = s.focusKey === undefined ? '' : ` data-focus-key="${escapeHtml(s.focusKey)}"`;
  const valueFor = s.valueKey === undefined ? '' : ` data-value-for="${escapeHtml(s.valueKey)}"`;
  const t = fraction(s.value, s.min, s.max);
  return `<div class="scrub" role="slider" tabindex="0" aria-label="${escapeHtml(s.ariaLabel ?? s.label)}"`
    + ` aria-valuemin="${s.min}" aria-valuemax="${s.max}" aria-valuenow="${s.value}" aria-valuetext="${escapeHtml(s.text)}"`
    + ` data-min="${s.min}" data-max="${s.max}" data-step="${s.step}" data-value="${s.value}"${data}${focus}>`
    + `<span class="fl" style="width:${(t * 100).toFixed(2)}%"></span>`
    + `<span class="k">${escapeHtml(s.label)}</span><span class="v"${valueFor}>${escapeHtml(s.text)}</span></div>`;
}

/** A read-only progress row (a running job): the same fill as a scrub. */
export function progressHtml(label: string, text: string, progress: number, attrs = ''): string {
  return `<div class="scrub prog" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100"`
    + ` aria-valuenow="${Math.round(progress * 100)}"${attrs}>`
    + `<span class="fl" style="width:${(fraction(progress, 0, 1) * 100).toFixed(1)}%"></span>`
    + `<span class="k">${escapeHtml(label)}</span><span class="v">${escapeHtml(text)}</span></div>`;
}

/** Snap to the step grid from `min`, within [min, max]. */
export function snapValue(value: number, min: number, max: number, step: number): number {
  const s = step > 0 ? step : 1;
  const snapped = Number((min + Math.round((value - min) / s) * s).toPrecision(12));
  return Math.min(max, Math.max(min, snapped));
}

/** Set a scrub's value (fill, ARIA, data) and the text shown; does not call the handler. */
export function setScrub(el: HTMLElement, value: number, text?: string): void {
  const min = Number(el.dataset.min);
  const max = Number(el.dataset.max);
  el.dataset.value = String(value);
  el.setAttribute('aria-valuenow', String(value));
  const fl = el.querySelector<HTMLElement>('.fl');
  if (fl) fl.style.width = `${(fraction(value, min, max) * 100).toFixed(2)}%`;
  if (text !== undefined) {
    el.setAttribute('aria-valuetext', text);
    const v = el.querySelector<HTMLElement>('.v');
    if (v) v.textContent = text;
  }
}

/**
 * Handler of a scrub's new value: does what it sets and returns the text to
 * show (or nothing to keep the text).
 */
export type ScrubHandler = (el: HTMLElement, value: number) => string | void;

/** How far a touch must move sideways before it scrubs (CSS px). */
const TOUCH_SLOP = 8;

/**
 * Make the scrub rows under `root` work (event delegation, bound once).
 *
 * - Mouse and pen: press to set the value under the pointer, drag to scrub.
 * - Touch: a sideways drag scrubs; a vertical drag scrolls the column
 *   (`touch-action: pan-y`); a tap sets the value under the finger.
 * - Keys: arrows ±1 step, Page Up / Down ±10 steps, Home / End.
 */
export function bindScrubs(root: ShadowRoot | HTMLElement, onValue: ScrubHandler): void {
  let drag: { el: HTMLElement; id: number; x0: number; y0: number; active: boolean; touch: boolean } | null = null;

  const scrubOf = (target: EventTarget | null): HTMLElement | null => {
    const el = target as Element | null;
    return (el && typeof el.closest === 'function' ? el.closest('.scrub[role="slider"]') : null) as HTMLElement | null;
  };

  const apply = (el: HTMLElement, value: number): void => {
    const min = Number(el.dataset.min);
    const max = Number(el.dataset.max);
    const v = snapValue(value, min, max, Number(el.dataset.step));
    if (v === Number(el.dataset.value)) return;
    setScrub(el, v);
    const text = onValue(el, v);
    if (typeof text === 'string') setScrub(el, v, text);
  };

  const applyAt = (el: HTMLElement, clientX: number): void => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0)) return;
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const min = Number(el.dataset.min);
    const max = Number(el.dataset.max);
    apply(el, min + t * (max - min));
  };

  const capture = (el: HTMLElement, id: number): void => {
    try { el.setPointerCapture(id); } catch { /* the pointer may be gone */ }
  };

  root.addEventListener('pointerdown', (ev) => {
    const e = ev as PointerEvent;
    if (e.button > 0) return;
    const el = scrubOf(e.target);
    if (!el) return;
    const touch = e.pointerType === 'touch';
    drag = { el, id: e.pointerId, x0: e.clientX, y0: e.clientY, active: !touch, touch };
    if (!touch) {
      e.preventDefault(); // no text selection; focus is set below
      el.focus({ preventScroll: true });
      capture(el, e.pointerId);
      applyAt(el, e.clientX);
    }
  });

  root.addEventListener('pointermove', (ev) => {
    const e = ev as PointerEvent;
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active) {
      const dx = Math.abs(e.clientX - drag.x0);
      const dy = Math.abs(e.clientY - drag.y0);
      if (dy > TOUCH_SLOP && dy >= dx) { drag = null; return; } // a scroll
      if (dx <= TOUCH_SLOP) return;
      drag.active = true;
      capture(drag.el, e.pointerId);
    }
    applyAt(drag.el, e.clientX);
  });

  root.addEventListener('pointerup', (ev) => {
    const e = ev as PointerEvent;
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.touch && !d.active) applyAt(d.el, e.clientX); // a tap
  });

  root.addEventListener('pointercancel', () => { drag = null; });

  root.addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    const el = scrubOf(e.target);
    if (!el) return;
    const min = Number(el.dataset.min);
    const max = Number(el.dataset.max);
    const step = Number(el.dataset.step) || 1;
    const value = Number(el.dataset.value);
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowUp': next = value + step; break;
      case 'ArrowLeft': case 'ArrowDown': next = value - step; break;
      case 'PageUp': next = value + step * 10; break;
      case 'PageDown': next = value - step * 10; break;
      case 'Home': next = min; break;
      case 'End': next = max; break;
    }
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    apply(el, next);
  });
}
