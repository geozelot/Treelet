// ============================================================================
// treelet.js - Attribution
//
// <treelet-attribution> - the Treelet mark followed by the attributions of
// the active base layer, the shown imagery and the visible overlays.
//
//  - Inside the info column (the default UI) it is the column's footer: a
//    row under a hairline, centred on the rail's lowest button.
//  - On its own (no info column: `guiDisplay.infoPosition: false`, or the
//    UI turned off) it is a slim tag in a bottom corner of the map.
//
// Refreshes on every `layerchange`. Attribution strings may contain simple
// HTML (links, emphasis); it is sanitized to text plus `<a href>` with
// http(s)/mailto targets.
// ============================================================================

import type { Treelet } from '../core/Treelet';
import { BaseElement, appendSanitizedHtml } from './dom';
import { kitStyles } from './kit';
import { TREE_SVG } from './treeSvg';

const attributionStyles = /* css */ `
  ${kitStyles}
  :host { display: block; min-width: 0; }
  .credit {
    min-height: 25px; display: flex; align-items: center; gap: 6px; padding: 4px 8px;
    border-top: 1px solid var(--border);
    font-size: 10px; line-height: 14px; color: var(--text-dim);
  }
  .mark { display: flex; align-items: center; gap: 4px; flex: none; }
  .mark svg { width: 13px; height: 11px; color: var(--text); }
  .mark b { font-weight: 600; color: var(--text); }
  .attr { min-width: 0; }
  .attr a { color: inherit; }

  /* On its own: a tag in a bottom corner */
  :host([data-side]) { position: absolute; bottom: 0; z-index: 999; max-width: calc(100% - 80px); }
  :host([data-side="left"]) { left: 0; }
  :host([data-side="right"]) { right: 0; }
  :host([data-side]) .credit {
    min-height: 18px; padding: 0 8px; border: 0; white-space: nowrap;
    background: var(--surface-bg); -webkit-backdrop-filter: var(--surface-filter); backdrop-filter: var(--surface-filter);
  }
  :host([data-side="left"]) .credit { border-top: 1px solid var(--border); border-right: 1px solid var(--border); border-top-right-radius: 5px; padding-left: 12px; }
  :host([data-side="right"]) .credit { border-top: 1px solid var(--border); border-left: 1px solid var(--border); border-top-left-radius: 5px; padding-right: 12px; }
  :host([data-side]) .attr { overflow: hidden; text-overflow: ellipsis; }
`;

/**
 * The map's credits: `<logo> Treelet · <layer attributions>`.
 */
export class TreeletAttribution extends BaseElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;
  private attrEl: HTMLElement | null = null;
  private readonly onLayerChange = (): void => this.refresh();

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  /**
   * Attach to a Treelet instance.
   *
   * @param map  - Treelet map instance
   * @param side - `'left'` or `'right'`: a tag in that bottom corner of the
   *               map. Without it the credits are a row for a column's footer.
   */
  attach(map: Treelet, side?: 'left' | 'right', options: { glass?: boolean } = {}): void {
    if (this.map && this.map !== map) this.map.off('layerchange', this.onLayerChange);
    this.map = map;
    if (side) this.dataset.side = side; else delete this.dataset.side;
    this.toggleAttribute('glass', options.glass === true);
    if (!this.attrEl) {
      this.shadow.innerHTML = `<style>${attributionStyles}</style>
        <div class="credit" role="contentinfo" aria-label="Credits">
          <span class="mark">${TREE_SVG}<b>Treelet</b></span><span class="attr"></span>
        </div>`;
      this.attrEl = this.shadow.querySelector('.attr');
    }
    map.on('layerchange', this.onLayerChange);
    this.refresh();
  }

  disconnectedCallback(): void {
    this.map?.off('layerchange', this.onLayerChange);
  }

  connectedCallback(): void {
    if (this.map && this.attrEl) {
      this.map.off('layerchange', this.onLayerChange);
      this.map.on('layerchange', this.onLayerChange);
      this.refresh();
    }
  }

  /**
   * Rebuild the displayed attribution text from active layer sources.
   */
  refresh(): void {
    if (!this.map || !this.attrEl) return;

    const parts: string[] = [];

    // Active base layer attribution
    for (const layer of this.map.getBaseLayers()) {
      if (layer.visible && layer.attribution) parts.push(layer.attribution);
    }
    // The active drape's attribution (while its imagery is shown)
    for (const drape of this.map.getDrapeLayers()) {
      if (drape.visible && drape.attribution) parts.push(drape.attribution);
    }
    // Visible overlays (their data may require a notice, e.g. ODbL)
    for (const overlay of this.map.getOverlayLayers()) {
      if (overlay.visible && overlay.attribution) parts.push(overlay.attribution);
    }

    // Deduplicate (same text may appear across base, drape and overlays)
    const unique = [...new Set(parts)];

    this.attrEl.replaceChildren();
    unique.forEach((html, i) => {
      this.attrEl!.appendChild(document.createTextNode(i > 0 ? ' · ' : ''));
      appendSanitizedHtml(this.attrEl!, html);
    });
    if (unique.length) this.attrEl.title = this.attrEl.textContent ?? '';
    else this.attrEl.removeAttribute('title');
  }
}
