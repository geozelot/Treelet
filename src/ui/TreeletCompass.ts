// ============================================================================
// treelet.js - TreeletCompass Web Component
//
// <treelet-compass> - the compass in its corner: a 60 box whose arrow turns
// and tilts with the camera; a click or tap resets the orientation (north
// up, looking straight down). Optional navigation wings grow from it toward
// the map, 6 apart:
//
//   zoom in / out  - a 28 wing beside the box
//   rotate ↺ / ↻   - a 28 wing above or below it
//   tilt ▲ / ▼     - a 28 square in the corner between them
//
// The wings hide when the map is compact (phones use gestures).
// ============================================================================

import { kitStyles } from './kit';
import { COMPASS_SVG } from './compassSvg';
import { PLUS_SVG, MINUS_SVG, ROTATE_LEFT_SVG, ROTATE_RIGHT_SVG, TILT_UP_SVG, TILT_DOWN_SVG } from './icons';
import type { Treelet } from '../core/Treelet';
import type { CameraController, CameraState } from '../scene/CameraController';
import type { UICorner } from '../core/types';
import { BaseElement } from './dom';

const compassStyles = /* css */ `
  ${kitStyles}
  :host { position: absolute; z-index: 999; width: 60px; height: 60px; pointer-events: none; }
  :host([data-v="top"]) { top: 12px; }
  :host([data-v="bottom"]) { bottom: 12px; }
  :host([data-h="left"]) { left: 12px; }
  :host([data-h="right"]) { right: 12px; }
  :host([navigation]:not([compact])) { width: 94px; height: 94px; }

  .nav { position: relative; width: 100%; height: 100%; opacity: .65; transition: opacity .15s; }
  .nav:focus-within { opacity: 1; }
  @media (hover: hover) { .nav:hover { opacity: 1; } }
  .nav > * { position: absolute; pointer-events: auto; }

  .box { width: 60px; height: 60px; display: grid; place-items: center; color: var(--text); }
  .box > .arrow { width: 46px; height: 46px; display: grid; place-items: center; perspective: 150px; }
  .box > .arrow > svg { width: 46px; height: 46px; will-change: transform; }

  .wing { display: flex; overflow: hidden; }
  .wing.v { flex-direction: column; }
  .wing > button { flex: 1; min-width: 0; min-height: 0; display: grid; place-items: center; color: var(--text-dim); }
  .wing.v > button + button { border-top: 1px solid var(--border); }
  .wing.h > button + button { border-left: 1px solid var(--border); }
  @media (hover: hover) { .wing > button:hover { background: var(--hover-bg); color: var(--text); } }
  .wing > button:active { background: var(--active-bg); }
  :host(:not([navigation])) .wing, :host([compact]) .wing { display: none; }

  /* The box in the corner, the wings toward the map */
  :host([data-h="right"]) .box, :host([data-h="right"]) .rot { right: 0; }
  :host([data-h="left"]) .box, :host([data-h="left"]) .rot { left: 0; }
  :host([data-v="top"]) .box, :host([data-v="top"]) .zoom { top: 0; }
  :host([data-v="bottom"]) .box, :host([data-v="bottom"]) .zoom { bottom: 0; }
  .zoom { width: 28px; height: 60px; }
  .rot { width: 60px; height: 28px; }
  .tilt { width: 28px; height: 28px; }
  :host([data-h="right"]) .zoom, :host([data-h="right"]) .tilt { right: 66px; }
  :host([data-h="left"]) .zoom, :host([data-h="left"]) .tilt { left: 66px; }
  :host([data-v="top"]) .rot, :host([data-v="top"]) .tilt { top: 66px; }
  :host([data-v="bottom"]) .rot, :host([data-v="bottom"]) .tilt { bottom: 66px; }
`;

export class TreeletCompass extends BaseElement {
  private shadow: ShadowRoot;
  private cc: CameraController | null = null;
  private arrow: SVGElement | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  /**
   * Attach to a map.
   *
   * @param options.compassPosition - corner of the compass (default 'top-right')
   * @param options.navigation      - zoom, rotate and tilt buttons beside it (default true)
   * @param options.glass           - frosted surfaces
   */
  attach(map: Treelet, options: { compassPosition?: UICorner; navigation?: boolean; glass?: boolean } = {}): void {
    this.cc = map.getCameraController();
    const [v, h] = (options.compassPosition ?? 'top-right').split('-') as ['top' | 'bottom', 'left' | 'right'];
    this.dataset.v = v;
    this.dataset.h = h;
    this.toggleAttribute('navigation', options.navigation !== false);
    this.toggleAttribute('glass', options.glass === true);
    if (!this.arrow) this.render();
    this.updateCamera(this.cc.getState());
  }

  /** Called on every camera change (non-debounced) for smooth visual sync. */
  updateCamera(state: CameraState): void {
    if (this.arrow) this.arrow.style.transform = `rotateX(${state.pitch}deg) rotateZ(${state.rotation}deg)`;
  }

  private render(): void {
    // The vertical wing's order follows the map: up is up
    this.shadow.innerHTML = `<style>${compassStyles}</style>
      <div class="nav" role="group" aria-label="Navigation">
        <button type="button" class="box surf" data-nav="reset" title="Reset orientation" aria-label="Reset orientation">
          <span class="arrow">${COMPASS_SVG}</span>
        </button>
        <div class="wing v zoom surf">
          <button type="button" data-nav="zoom-in" title="Zoom in" aria-label="Zoom in">${PLUS_SVG}</button>
          <button type="button" data-nav="zoom-out" title="Zoom out" aria-label="Zoom out">${MINUS_SVG}</button>
        </div>
        <div class="wing h rot surf">
          <button type="button" data-nav="rotate-left" title="Rotate left" aria-label="Rotate left">${ROTATE_LEFT_SVG}</button>
          <button type="button" data-nav="rotate-right" title="Rotate right" aria-label="Rotate right">${ROTATE_RIGHT_SVG}</button>
        </div>
        <div class="wing v tilt surf">
          <button type="button" data-nav="tilt-up" title="Tilt up" aria-label="Tilt up">${TILT_UP_SVG}</button>
          <button type="button" data-nav="tilt-down" title="Tilt down" aria-label="Tilt down">${TILT_DOWN_SVG}</button>
        </div>
      </div>`;
    this.arrow = this.shadow.querySelector('.arrow svg');
    this.shadow.addEventListener('click', this.onClick);
  }

  private onClick = (e: Event): void => {
    const nav = (e.target as HTMLElement).closest<HTMLElement>('[data-nav]')?.dataset.nav;
    const cc = this.cc;
    if (!nav || !cc) return;
    e.stopPropagation();
    const s = cc.getState();
    switch (nav) {
      case 'reset': cc.resetOrientation(); break;
      // Zoom ±1 (to whole levels)
      case 'zoom-in': cc.setZoomLevel(Math.round(s.zoom) + 1); break;
      case 'zoom-out': cc.setZoomLevel(Math.round(s.zoom) - 1); break;
      // Rotation ±15°
      case 'rotate-left': cc.setAzimuth(s.rotation - 15); break;
      case 'rotate-right': cc.setAzimuth(s.rotation + 15); break;
      // Tilt ±5° (clamped by the camera's pitch limits)
      case 'tilt-up': cc.setPitch(s.pitch - 5); break;
      case 'tilt-down': cc.setPitch(s.pitch + 5); break;
    }
  };
}
