// ============================================================================
// treelet.js - TreeletLabels Web Component
//
// <treelet-labels> - text labels of overlay features, positioned over the
// map by the overlay renderer each frame (screen positions, visibility).
// Spans are reused between frames; the element never takes pointer events.
// ============================================================================

import { BaseElement } from './dom';

const labelStyles = /* css */ `
  :host {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 990;
    contain: strict;
  }
  span {
    position: absolute;
    left: 0;
    top: 0;
    white-space: nowrap;
    font-family: system-ui, -apple-system, sans-serif;
    font-weight: 600;
    line-height: 1.2;
    will-change: transform;
  }
`;

export interface PlacedLabel {
  text: string;
  /** Screen position of the label's anchor (CSS pixels from the container's top-left). */
  x: number;
  y: number;
  size: number;
  color: string;
  halo: string;
}

export class TreeletLabels extends BaseElement {
  private shadow: ShadowRoot;
  private spans: HTMLSpanElement[] = [];
  private keys: string[] = [];

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `<style>${labelStyles}</style>`;
  }

  /**
   * Show these labels (and hide the rest). A label keeps its element from
   * one call to the next (matched by text and style), so a label dropping
   * out doesn't restyle every later one; only positions change.
   */
  show(labels: readonly PlacedLabel[]): void {
    // The elements by text and style (indices, in order), taken as labels claim them
    const byKey = new Map<string, number[]>();
    for (let i = 0; i < this.spans.length; i++) {
      const list = byKey.get(this.keys[i]);
      if (list) list.push(i);
      else byKey.set(this.keys[i], [i]);
    }
    const used = new Uint8Array(this.spans.length);
    const unmatched: Array<[PlacedLabel, string]> = [];
    for (const l of labels) {
      const key = `${l.text}|${l.size}|${l.color}|${l.halo}`;
      const i = byKey.get(key)?.shift();
      if (i === undefined) {
        unmatched.push([l, key]);
        continue;
      }
      used[i] = 1;
      this.place(this.spans[i], l);
    }
    // The rest take the free elements in order (new ones when there are none left)
    let next = 0;
    const claimed: number[] = [];
    for (const [l, key] of unmatched) {
      while (next < used.length && used[next]) next++;
      let i = next++;
      if (i >= used.length) {
        const span = document.createElement('span');
        this.shadow.appendChild(span);
        this.spans.push(span);
        this.keys.push('');
        i = this.spans.length - 1;
      }
      claimed.push(i);
      const span = this.spans[i];
      this.keys[i] = key;
      span.textContent = l.text;
      span.style.fontSize = `${l.size}px`;
      span.style.color = l.color;
      const h = l.halo;
      span.style.textShadow = `0 0 2px ${h}, 0 0 2px ${h}, 0 0 3px ${h}`;
      this.place(span, l);
    }
    for (const i of claimed) if (i < used.length) used[i] = 1;
    for (let i = 0; i < used.length; i++) if (!used[i]) this.spans[i].hidden = true;
  }

  private place(span: HTMLSpanElement, l: PlacedLabel): void {
    span.style.transform = `translate(${Math.round(l.x)}px, ${Math.round(l.y)}px) translate(-50%, -100%)`;
    span.hidden = false;
  }

  /** Number of labels currently shown (tests, diagnostics). */
  get count(): number {
    return this.spans.filter((s) => !s.hidden).length;
  }
}
