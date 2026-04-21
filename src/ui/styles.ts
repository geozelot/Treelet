// ============================================================================
// treelet.js - UI Styles
//
// CSS for the <treelet-panel> web component (Shadow DOM).
// Light/dark theme via light-dark(); grey-only palette.
// ============================================================================

export const panelStyles = /* css */ `
  :host {
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    display: block;
    height: 100%;
    overflow: visible;

    color-scheme: light dark;

    /* Panel-specific vars (shared vars inherited from treelet-compass) */
    --thumb-border: light-dark(rgba(250, 250, 250, 0.9), rgba(24, 24, 24, 0.9));
    --submenu2-bg: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.07));

    color: var(--text);
  }

  /* ==========================================================================
     Panel - fixed-height two-column layout (Terrain + Overlay)
     Height matches the layer icon; dropdowns expand outward via abs. pos.
     ========================================================================== */

  .panel {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    height: 100%;
  }

  /* -- Column layout -- */

  .layer-col {
    display: flex;
    position: relative;
    min-width: 190px;
    border-right: 1px solid var(--border);
  }

  .layer-col:last-child {
    border-right: none;
  }

  /* DOM order: [active, selector]. flex-direction controls visual order.
     Top-anchored: column → active top (near icon), selector bottom.
     Bottom-anchored: column-reverse → selector top, active bottom (near icon). */
  :host([data-v="top"]) .layer-col    { flex-direction: column; }
  :host([data-v="bottom"]) .layer-col { flex-direction: column-reverse; }

  /* -- Column header (hover target for layer selector dropdown) -- */

  .layer-col-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    white-space: nowrap;
    cursor: pointer;
    position: relative;
    z-index: 11;
    border-left: 1px solid transparent;
    border-right: 1px solid transparent;
  }

  /* Header padding: larger gap on the outer (panel edge) side for breathing room.
     Top-anchored: header at bottom of column → more bottom padding.
     Bottom-anchored: header at top of column → more top padding. */
  :host([data-v="top"])    .layer-col-header { padding: 1px 8px 9px; }
  :host([data-v="bottom"]) .layer-col-header { padding: 9px 8px 1px; }

  .layer-col-header:hover {
    background: var(--hover-bg);
  }

  /* On hover: header becomes the cap of the dropdown card */
  :host([data-v="top"]) .layer-col-selector:hover .layer-col-header {
    background: var(--bg);
    border-left-color: var(--border);
    border-right-color: var(--border);
    border-radius: 10px 10px 0 0;
  }

  :host([data-v="bottom"]) .layer-col-selector:hover .layer-col-header {
    background: var(--bg);
    border-left-color: var(--border);
    border-right-color: var(--border);
    border-radius: 0 0 10px 10px;
  }

  .layer-col-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    opacity: 0.55;
  }

  .layer-col-header:hover .layer-col-title {
    opacity: 0.8;
  }

  /* Chevron hint - discrete arrow indicating the header is interactive */
  .header-chevron {
    flex-shrink: 0;
    width: 0;
    height: 0;
    border-left: 3.5px solid transparent;
    border-right: 3.5px solid transparent;
    opacity: 0.35;
    transition: opacity 0.15s;
  }
  :host([data-v="bottom"]) .header-chevron { border-bottom: 4px solid currentColor; }
  :host([data-v="top"])    .header-chevron { border-top: 4px solid currentColor; }

  .layer-col-header:hover .header-chevron { opacity: 0.6; }

  /* -- Selector wrapper (header + dropdown, hover trigger) -- */

  .layer-col-selector {
    position: relative;
  }

  /* -- Active layer section (clickable button → settings) -- */

  .layer-col-active {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: stretch;
    overflow: visible;
    padding: 2px 4px;
  }

  /* Halve padding on the separator side so inter-column gap ≈ outer gap */
  .layer-col:not(:last-child) .layer-col-active { padding-right: 2px; }
  .layer-col:not(:first-child) .layer-col-active { padding-left: 2px; }

  /* Wrapper - positions the settings panel relative to the button */
  .active-btn-wrap {
    position: relative;
  }

  .active-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 6px;
    cursor: pointer;
    border-radius: 4px;
    background: var(--active-bg);
    color: var(--active-text);
    opacity: 0.45;
    transition: opacity 0.15s;
  }

  .active-row:hover,
  .active-row:has(+ .active-settings:not(.hidden)) {
    opacity: 1;
  }

  .active-name {
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: inherit;
  }

  .active-row .gear-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    color: var(--text-muted);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s, color 0.15s;
  }

  .active-row:hover .gear-icon {
    opacity: 1;
  }

  .active-row .gear-icon.open {
    opacity: 1;
    color: var(--accent);
  }

  /* Settings panel - absolutely positioned, anchored to button wrapper */

  .active-settings {
    position: absolute;
    left: 0;
    right: 0;
    padding: 6px 8px 8px 8px;
    background-color: var(--bg);
    background-image: linear-gradient(var(--active-bg), var(--active-bg));
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    z-index: 15;
  }

  .active-settings.hidden {
    display: none;
  }

  .hidden {
    display: none !important;
  }

  /* Top-anchored: settings expand downward from the button */
  :host([data-v="top"]) .active-settings {
    top: 100%;
    border-top: none;
    border-radius: 0 0 10px 10px;
  }

  /* Bottom-anchored: settings expand upward from the button */
  :host([data-v="bottom"]) .active-settings {
    bottom: 100%;
    border-bottom: none;
    border-radius: 10px 10px 0 0;
  }

  /* -- Layer dropdown (shown on header hover, visually connected to header) -- */

  .layer-col-body {
    display: none;
    position: absolute;
    left: 0;
    right: 0;
    padding: 4px 6px 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    z-index: 10;
  }

  .layer-col-body:empty {
    display: none !important;
  }

  .layer-col-selector:hover .layer-col-body {
    display: block;
  }

  /* Top-anchored: dropdown slides under header, extends downward */
  :host([data-v="top"]) .layer-col-body {
    top: 0;
    border-top: none;
    border-radius: 0 0 10px 10px;
    padding-top: 31px; /* header height (~27px) + content gap (4px) */
  }

  /* Bottom-anchored: dropdown slides under header, extends upward */
  :host([data-v="bottom"]) .layer-col-body {
    bottom: 0;
    border-bottom: none;
    border-radius: 10px 10px 0 0;
    padding-bottom: 31px; /* header height (~27px) + content gap (4px) */
  }

  /* -- Dropdown group label (e.g. "Terrain", "Layer" section headers) -- */

  .dropdown-group-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.4;
    padding: 4px 8px 2px;
    pointer-events: none;
  }

  /* -- Layer entries (in dropdown) -- */

  .layer-entry {
    border-radius: 4px;
    margin-bottom: 2px;
    overflow: hidden;
  }

  .layer-entry:last-child {
    margin-bottom: 0;
  }

  .layer-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 5px 8px;
    cursor: pointer;
    user-select: none;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--text-dim);
    font: inherit;
    font-size: 12px;
    text-align: left;
    white-space: nowrap;
    transition: background 0.1s, color 0.1s;
  }

  .layer-btn:hover {
    background: var(--hover-bg);
    color: var(--hover-text);
  }

  .layer-btn.active {
    background: var(--active-bg);
    color: var(--active-text);
  }

  /* -- Overlay dropdown separator -- */

  .overlay-separator {
    height: 1px;
    background: var(--border);
    margin: 6px 0;
  }

  /* -- Setting sub-labels -- */

  .setting-label {
    font-size: 10px;
    opacity: 0.5;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-top: 4px;
    margin-bottom: 2px;
  }

  /* -- Ramp buttons (color ramp selection with gradient indicator) -- */

  .ramp-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: 3px;
    margin-bottom: 3px;
    padding: 2px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--submenu2-bg);
  }

  .ramp-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 6px 3px 8px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
    user-select: none;
    transition: background 0.1s, color 0.1s;
    text-align: left;
  }

  .ramp-btn:hover {
    background: var(--hover-bg);
    color: var(--hover-text);
  }

  .ramp-btn.active {
    background: var(--active-bg);
    color: var(--active-text);
  }

  .ramp-indicator {
    width: 36px;
    height: 6px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  /* -- Color swatch picker (for contour line color) -- */

  .swatch-row {
    display: flex;
    gap: 5px;
    margin-top: 4px;
    margin-bottom: 4px;
    padding: 5px 6px;
    border-radius: 4px;
    flex-wrap: wrap;
    background: var(--submenu2-bg);
  }

  .color-swatch {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 2px solid transparent;
    cursor: pointer;
    transition: border-color 0.1s, transform 0.1s;
  }

  .color-swatch:hover {
    transform: scale(1.15);
  }

  .color-swatch.active {
    border-color: var(--accent);
  }

  /* -- Toggle switch (for wireframe normals/white) -- */

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 0;
  }

  .toggle-label {
    font-size: 11px;
    opacity: 0.6;
  }

  .toggle-btn {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 8px;
    border: 1px solid var(--control-border);
    background: var(--control-bg);
    color: var(--text-dim);
    cursor: pointer;
    user-select: none;
    transition: all 0.1s;
  }

  .toggle-btn:hover {
    background: var(--hover-bg);
  }

  .toggle-btn.active {
    background: var(--active-bg);
    border-color: var(--accent);
    color: var(--active-text);
  }

  /* -- Slider controls -- */

  .control-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 0;
    gap: 8px;
  }

  .control-label {
    font-size: 11px;
    opacity: 0.6;
    white-space: nowrap;
  }

  .control-value {
    font-size: 11px;
    opacity: 0.5;
    min-width: 32px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 4px;
    background: var(--control-border);
    border-radius: 2px;
    outline: none;
    margin: 4px 0;
  }

  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: 2px solid var(--thumb-border);
  }

  input[type="range"]::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: 2px solid var(--thumb-border);
  }
`;
