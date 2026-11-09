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

  /** Show exactly these labels (centered above their anchors). */
  show(labels: readonly PlacedLabel[]): void {
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      let span = this.spans[i];
      if (!span) {
        span = document.createElement('span');
        this.shadow.appendChild(span);
        this.spans.push(span);
        this.keys.push('');
      }
      const key = `${l.text}|${l.size}|${l.color}|${l.halo}`;
      if (this.keys[i] !== key) {
        this.keys[i] = key;
        span.textContent = l.text;
        span.style.fontSize = `${l.size}px`;
        span.style.color = l.color;
        const h = l.halo;
        span.style.textShadow = `0 0 2px ${h}, 0 0 2px ${h}, 0 0 3px ${h}`;
      }
      span.style.transform = `translate(${Math.round(l.x)}px, ${Math.round(l.y)}px) translate(-50%, -100%)`;
      span.hidden = false;
    }
    for (let i = labels.length; i < this.spans.length; i++) this.spans[i].hidden = true;
  }

  /** Number of labels currently shown (tests, diagnostics). */
  get count(): number {
    return this.spans.filter((s) => !s.hidden).length;
  }
}
