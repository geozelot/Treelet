// ============================================================================
// treelet.js - UI Styles
//
// CSS for the <treelet-panel> web component (Shadow DOM).
// Light/dark theme via light-dark(); grey palette with the logo green as
// accent. Colors, type scale and radii are inherited from treelet-compass.
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
    --header-h: 26px;

    color: var(--text);
  }

  button {
    margin: 0;
    font: inherit;
    color: inherit;
    -webkit-tap-highlight-color: transparent;
  }

  /* Inset, so lists that clip their corners don't cut the ring off */
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  @keyframes treelet-fade-in {
    from { opacity: 0; }
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
    /* Half the slide's room on narrow maps (--slide-room from treelet-compass) */
    min-width: min(190px, var(--slide-room, 380px) / 2);
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

  /* -- Column header: section title. With alternatives (.has-choices) it is
        a button that opens the source dropdown, marked by a chevron. -- */

  .layer-col-header {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    height: var(--header-h);
    box-sizing: border-box;
    padding: 0 10px;
    background: transparent;
    border: none;
    border-left: 1px solid transparent;
    border-right: 1px solid transparent;
    text-align: left;
    white-space: nowrap;
    position: relative;
    z-index: 11;
    transition: background-color var(--fade), border-color var(--fade);
  }

  /* Title sits nearer its active row; the extra gap goes to the panel edge.
     Top-anchored: header at bottom of column → more bottom padding.
     Bottom-anchored: header at top of column → more top padding. */
  :host([data-v="top"])    .layer-col-header { padding-bottom: 4px; }
  :host([data-v="bottom"]) .layer-col-header { padding-top: 4px; }

  .has-choices > .layer-col-header {
    cursor: pointer;
  }

  /* Open: header becomes the cap of the dropdown card */
  .has-choices.open > .layer-col-header {
    background: var(--bg);
    border-left-color: var(--border);
    border-right-color: var(--border);
  }
  :host([data-v="top"])    .has-choices.open > .layer-col-header { border-radius: var(--radius) var(--radius) 0 0; }
  :host([data-v="bottom"]) .has-choices.open > .layer-col-header { border-radius: 0 0 var(--radius) var(--radius); }

  .layer-col-title {
    font-size: var(--fs-label);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.5;
    transition: opacity var(--fade);
  }

  .has-choices .layer-col-title {
    opacity: 0.75;
  }

  /* Chevron right after the title: points where the list opens, flips while open */
  .header-chevron {
    display: flex;
    flex-shrink: 0;
    opacity: 0.75;
    transition: opacity var(--fade), transform var(--fade);
  }
  :host([data-v="bottom"]) .header-chevron { transform: rotate(180deg); }

  .has-choices.open .layer-col-title,
  .has-choices.open .header-chevron { opacity: 1; }
  :host([data-v="top"])    .has-choices.open .header-chevron { transform: rotate(180deg); }
  :host([data-v="bottom"]) .has-choices.open .header-chevron { transform: none; }

  /* -- Selector wrapper (header + dropdown) -- */

  .layer-col-selector {
    position: relative;
  }

  /* -- Active layer section (button → settings) -- */

  .layer-col-active {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: stretch;
    overflow: visible;
    padding: 0 6px;
  }

  /* Halve padding on the separator side so inter-column gap ≈ outer gap */
  .layer-col:not(:last-child) .layer-col-active { padding-right: 3px; }
  .layer-col:not(:first-child) .layer-col-active { padding-left: 3px; }

  /* Wrapper - positions the settings panel relative to the button */
  .active-btn-wrap {
    position: relative;
  }

  /* The selected source: full-strength text on a light fill (selected, not disabled) */
  .active-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
    padding: 4px 8px;
    cursor: pointer;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--btn-bg);
    color: var(--text);
    text-align: left;
    transition: background-color var(--fade);
  }

  @media (hover: hover) {
    .active-row:hover { background: var(--btn-bg-hover); }
  }

  .active-row[aria-expanded="true"] {
    background: var(--btn-bg-hover);
  }

  .active-row.is-empty {
    cursor: default;
    color: var(--text-muted);
  }

  .active-name {
    font-size: var(--fs-body);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: inherit;
  }

  /* Settings gear: always faintly visible, so the row reads as configurable */
  .active-row .gear-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    color: var(--text-muted);
    opacity: 0.8;
    pointer-events: none;
    transition: opacity var(--fade), color var(--fade);
  }

  @media (hover: hover) {
    .active-row:hover .gear-icon { opacity: 1; color: var(--text-dim); }
  }

  .active-row[aria-expanded="true"] .gear-icon {
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

  .active-settings.entering {
    animation: treelet-fade-in var(--fade) ease-out;
  }

  .hidden {
    display: none !important;
  }

  /* Top-anchored: settings expand downward from the button */
  :host([data-v="top"]) .active-settings {
    top: 100%;
    border-top: none;
    border-radius: 0 0 var(--radius) var(--radius);
  }

  /* Bottom-anchored: settings expand upward from the button */
  :host([data-v="bottom"]) .active-settings {
    bottom: 100%;
    border-bottom: none;
    border-radius: var(--radius) var(--radius) 0 0;
  }

  /* -- Layer dropdown (shown while its selector is .open, joined to the header) -- */

  .layer-col-body {
    position: absolute;
    left: 0;
    right: 0;
    padding: 4px 6px 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    z-index: 10;
    visibility: hidden;
    opacity: 0;
    transition: opacity var(--fade), visibility 0s var(--fade);
  }

  /* Top-anchored: dropdown slides under header, extends downward */
  :host([data-v="top"]) .layer-col-body {
    top: 0;
    border-top: none;
    border-radius: 0 0 var(--radius) var(--radius);
    padding-top: calc(var(--header-h) + 4px);
  }

  /* Bottom-anchored: dropdown slides under header, extends upward */
  :host([data-v="bottom"]) .layer-col-body {
    bottom: 0;
    border-bottom: none;
    border-radius: var(--radius) var(--radius) 0 0;
    padding-bottom: calc(var(--header-h) + 4px);
  }

  .has-choices.open > .layer-col-body {
    visibility: visible;
    opacity: 1;
    transition: opacity var(--fade), visibility 0s;
  }

  /* -- Dropdown group label ("Analysis", "Layers" section headers) -- */

  .dropdown-group-label {
    font-size: var(--fs-label);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.45;
    padding: 4px 8px 2px;
    pointer-events: none;
  }

  /* -- Layer entries (in dropdown) -- */

  .layer-entry {
    border-radius: var(--radius-sm);
    margin-bottom: 2px;
    overflow: hidden;
  }

  .layer-entry:last-child {
    margin-bottom: 0;
  }

  .layer-btn {
    display: block;
    width: 100%;
    padding: 5px 8px;
    cursor: pointer;
    user-select: none;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--text-dim);
    font-size: var(--fs-body);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background-color 0.1s, color 0.1s;
  }

  .layer-btn:hover,
  .layer-btn:focus-visible {
    background: var(--hover-bg);
    color: var(--hover-text);
  }

  /* -- Overlay dropdown separator -- */

  .overlay-separator {
    height: 1px;
    background: var(--border);
    margin: 6px 0;
  }

  /* -- Setting sub-labels -- */

  .setting-label {
    font-size: var(--fs-label);
    opacity: 0.5;
    text-transform: uppercase;
    letter-spacing: 0.5px;
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
    border-radius: var(--radius-sm);
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
    border-radius: calc(var(--radius-sm) - 2px);
    background: transparent;
    color: var(--text-muted);
    font-size: var(--fs-small);
    cursor: pointer;
    user-select: none;
    transition: background-color 0.1s, color 0.1s;
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
    border-radius: var(--radius-sm);
    flex-wrap: wrap;
    background: var(--submenu2-bg);
  }

  .color-swatch {
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: var(--radius-sm);
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

  .color-swatch:focus-visible {
    outline-offset: 1px;
  }

  /* -- Toggle buttons (wireframe coloring, drape blend mode) -- */

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 0;
  }

  .toggle-label {
    font-size: var(--fs-small);
    opacity: 0.6;
  }

  .toggle-btn {
    font-size: var(--fs-label);
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--control-border);
    background: var(--control-bg);
    color: var(--text-dim);
    cursor: pointer;
    user-select: none;
    transition: background-color 0.1s, border-color 0.1s, color 0.1s;
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
    font-size: var(--fs-small);
    opacity: 0.6;
    white-space: nowrap;
  }

  .control-value {
    font-size: var(--fs-small);
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

  input[type="range"]:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
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
