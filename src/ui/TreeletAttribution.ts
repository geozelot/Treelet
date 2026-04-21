// ============================================================================
// treelet.js - Attribution Control
//
// <treelet-attribution> - slim bar at the bottom edge of the map container.
// Shows the Treelet logo + name, followed by attribution strings from the
// active base layer and any active external drape layer.
// Positioned at the opposite bottom corner to the layer panel.
// ============================================================================

import type { Treelet } from '../core/Treelet';

/** Inline treelet logo SVG (optimized from assets/treelet_logo.svg). */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3.196 2.665"><g transform="translate(-89.118,-155.866)"><path d="m92.008 157.174-.325.599c.169-.004.338.011.503.045z" fill="#a5c500"/><path d="m89.518 157.998 1.238.009c-.144-.262-.258-.54-.339-.827z" fill="#ccc"/><path d="m92.314 157.153c-.148-.19-.273-.397-.372-.614-.097-.217-.167-.443-.21-.673l-1.307 1.266z" fill="#ccc"/><path d="m89.118 156.279c.156.21.288.436.392.675.101.238.175.486.218.738l1.405-1.375z" fill="#999"/><rect width=".325" height="1.043" x="19.705" y="180.364" rx="0" fill="#999" transform="matrix(.91845 -.39553 .40191 .91568 0 0)"/><rect width=".324" height=".793" x="113.853" y="148.952" rx="0" fill="#999" transform="matrix(.99578 .09178 -.14996 .98869 0 0)"/></g></svg>`;

/**
 * Slim attribution bar anchored to a bottom corner.
 *
 * Layout: `<logo> Treelet | <layer attributions>`
 *
 * Automatically refreshes on every `layerchange` event, collecting
 * attribution text from the active base and drape layer sources.
 */
export class TreeletAttribution extends HTMLElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;
  private attrEl: HTMLElement | null = null;
  private sepEl: HTMLElement | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  /**
   * Attach to a Treelet instance and render in the given bottom corner.
   *
   * @param map  - Treelet map instance
   * @param side - `'left'` or `'right'` for bottom-left / bottom-right
   */
  attach(map: Treelet, side: 'left' | 'right'): void {
    this.map = map;
    this.render(side);
    this.attrEl = this.shadow.getElementById('attr');
    this.sepEl = this.shadow.getElementById('sep');
    this.refresh();

    map.on('layerchange', () => this.refresh());
  }

  /**
   * Rebuild the displayed attribution text from active layer sources.
   */
  refresh(): void {
    if (!this.map || !this.attrEl || !this.sepEl) return;

    const parts: string[] = [];

    // Active base layer attribution
    for (const layer of this.map.getBaseLayers()) {
      if (layer.visible && layer.attribution) {
        parts.push(layer.attribution);
      }
    }

    // Active external drape attribution (skip when BaseDrape is active)
    if (!this.map.isBaseDrapeActive()) {
      for (const drape of this.map.getDrapeLayers()) {
        if (drape.visible && drape.attribution) {
          parts.push(drape.attribution);
        }
      }
    }

    // Deduplicate (same text may appear across base + drape)
    const unique = [...new Set(parts)];

    if (unique.length === 0) {
      this.attrEl.textContent = '';
      this.attrEl.style.display = 'none';
      this.sepEl.style.display = 'none';
    } else {
      this.attrEl.textContent = unique.join(' | ');
      this.attrEl.style.display = '';
      this.sepEl.style.display = '';
    }
  }

  // =========================================================================
  // Rendering
  // =========================================================================

  private render(side: 'left' | 'right'): void {
    const radius = side === 'left' ? '0 4px 0 0' : '4px 0 0 0';

    this.shadow.innerHTML = `
      <style>
        :host {
          position: absolute;
          bottom: 0;
          ${side}: 0;
          z-index: 999;
          pointer-events: auto;
          color-scheme: light dark;
        }

        .bar {
          display: flex;
          align-items: center;
          gap: 3px;
          background: light-dark(rgba(255, 255, 255, 0.75), rgba(0, 0, 0, 0.55));
          color: light-dark(#333, #ccc);
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 10px;
          line-height: 1.4;
          padding: 2px 6px;
          border-radius: ${radius};
          white-space: nowrap;
          opacity: 0.65;
          transition: opacity 0.15s;
        }

        .bar:hover {
          opacity: 1;
        }

        .logo {
          display: flex;
          align-items: center;
          gap: 2px;
          flex-shrink: 0;
        }

        .logo svg {
          width: 10px;
          height: 10px;
        }

        .logo span {
          font-weight: 600;
          opacity: 0.7;
        }

        .sep {
          opacity: 0.4;
        }

        .attr {
          opacity: 0.85;
        }
      </style>
      <div class="bar">
        <div class="logo">${LOGO_SVG}<span>Treelet</span></div>
        <span class="sep" id="sep">|</span>
        <span class="attr" id="attr"></span>
      </div>
    `;
  }
}

// Register the custom element
if (!customElements.get('treelet-attribution')) {
  customElements.define('treelet-attribution', TreeletAttribution);
}
