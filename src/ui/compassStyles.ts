// ============================================================================
// treelet.js - Compass Styles
//
// CSS for the <treelet-compass> web component:
//   - Compass box with rotatable SVG
//   - Slide-out navigation panel: map coords, viewport stats, D-pad, zoom
//   - Layer box with slide-out panel
//   - Light/dark theme via light-dark(); optional frosted glass ([glass])
//   - Direction-aware positioning via data-h / data-v attributes
//
// A row's slide-out is shown while the row has the .open class, which
// TreeletCompass sets for mouse hover, a tap, or keyboard focus.
//
// NOTE: Custom properties on :host are inherited by <treelet-panel>'s shadow
//       tree; do not remove variables that appear unused in this file alone.
// ============================================================================

export const compassStyles = /* css */ `
  :host {
    position: absolute;
    inset: 0;
    z-index: 1000;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    pointer-events: none;
    /* Map width for cqw units and @container rules, here and in <treelet-panel> */
    container-type: inline-size;

    color-scheme: light dark;

    --bg: light-dark(#fafafa, #181818);
    /* Boxes and slide-outs; translucent with [glass]. Menus stay on --bg. */
    --surface-bg: var(--bg);
    --surface-filter: none;
    --border: light-dark(rgba(0, 0, 0, 0.10), rgba(255, 255, 255, 0.08));
    --shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    --text: light-dark(#333333, #e8e8e8);
    --text-dim: light-dark(rgba(0, 0, 0, 0.55), rgba(255, 255, 255, 0.55));
    --text-muted: light-dark(rgba(0, 0, 0, 0.40), rgba(255, 255, 255, 0.45));
    --hover-bg: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.06));
    --hover-text: light-dark(#222222, #e8e8e8);
    --active-bg: light-dark(rgba(0, 0, 0, 0.10), rgba(255, 255, 255, 0.14));
    --active-text: light-dark(#000000, #ffffff);
    /* The logo's leaf green; darker on light backgrounds for 3:1 contrast */
    --accent: light-dark(#7a9400, #a5c500);
    --control-border: light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.12));
    --control-bg: light-dark(rgba(0, 0, 0, 0.04), rgba(255, 255, 255, 0.04));
    /* Buttons: resting, hovered/selected, pressed */
    --btn-bg: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.07));
    --btn-bg-hover: var(--active-bg);
    --btn-bg-press: light-dark(rgba(0, 0, 0, 0.18), rgba(255, 255, 255, 0.22));

    /* Type scale: uppercase labels, secondary text, primary text */
    --fs-label: 10px;
    --fs-small: 11px;
    --fs-body: 12px;
    /* Corner radii: surfaces (boxes, panels, menus) and the controls in them */
    --radius: 10px;
    --radius-sm: 5px;
    --fade: 0.15s;

    /* Edge of the compass and layer boxes; their slide-out panels match it. */
    --box-size: 60px;
    /* Room beside a box for its slide-out: map width minus the box and a
       12px margin on both sides. */
    --slide-room: calc(100cqw - var(--box-size) - 24px);

    color: var(--text);
  }

  @media (prefers-color-scheme: light) {
    :host { --shadow: 0 4px 16px rgba(0, 0, 0, 0.10); }
  }

  :host([glass]) {
    --surface-bg: light-dark(rgba(250, 250, 250, 0.72), rgba(24, 24, 24, 0.66));
    --surface-filter: blur(14px) saturate(1.5);
  }

  button {
    margin: 0;
    font: inherit;
    color: inherit;
    -webkit-tap-highlight-color: transparent;
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* ==========================================================================
     Anchor - absolutely positioned in a corner
     ========================================================================== */

  .anchor {
    position: absolute;
    pointer-events: auto;
  }

  .anchor[data-h="right"] { right: 12px; }
  .anchor[data-h="left"]  { left: 12px; }
  .anchor[data-v="top"]    { top: 12px; }
  .anchor[data-v="bottom"] { bottom: 12px; }

  /* ==========================================================================
     Compass wrapper - vertical stack when compass + layers share a corner
     ========================================================================== */

  .compass-wrapper {
    display: flex;
    gap: 6px;
  }

  .compass-wrapper[data-v="top"]    { flex-direction: column; }
  .compass-wrapper[data-v="bottom"] { flex-direction: column-reverse; }

  .anchor[data-h="right"] .compass-wrapper { align-items: flex-end; }
  .anchor[data-h="left"]  .compass-wrapper { align-items: flex-start; }

  /* ==========================================================================
     Rows - a box with its slide-out beside it (compass-row, layer-row)
     ========================================================================== */

  .row {
    position: relative;
    display: flex;
    align-items: stretch;
  }

  .row[data-h="right"] { flex-direction: row;         justify-content: flex-end; }
  .row[data-h="left"]  { flex-direction: row-reverse; justify-content: flex-start; }

  /* Box - compass (click resets orientation) or layer icon */

  .box {
    position: relative;
    box-sizing: border-box;
    width: var(--box-size);
    height: var(--box-size);
    padding: 0;
    background: var(--surface-bg);
    -webkit-backdrop-filter: var(--surface-filter);
    backdrop-filter: var(--surface-filter);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    color: var(--text);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    opacity: 0.65;
    transition: opacity var(--fade), border-radius 0.2s;
  }

  .row.open > .box {
    opacity: 1;
    transition: opacity var(--fade), border-radius 0s;
  }

  .row[data-h="right"].open > .box { border-radius: 0 var(--radius) var(--radius) 0; }
  .row[data-h="left"].open  > .box { border-radius: var(--radius) 0 0 var(--radius); }

  .box:active { background-image: linear-gradient(var(--active-bg), var(--active-bg)); }

  /* Slide-out - fades and slides in beside the box; hidden ones are not
     focusable (visibility), so Tab only reaches an open panel */

  .slide {
    position: absolute;
    top: 0;
    bottom: 0;
    box-sizing: border-box;
    background: var(--surface-bg);
    -webkit-backdrop-filter: var(--surface-filter);
    backdrop-filter: var(--surface-filter);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    white-space: nowrap;
    overflow: visible;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity 0.2s, transform 0.2s, visibility 0s 0.2s;
  }

  .row[data-h="right"] > .slide {
    right: 100%;
    border-right: none;
    border-radius: var(--radius) 0 0 var(--radius);
    transform: translateX(8px);
  }

  .row[data-h="left"] > .slide {
    left: 100%;
    border-left: none;
    border-radius: 0 var(--radius) var(--radius) 0;
    transform: translateX(-8px);
  }

  .row[data-h].open > .slide {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translateX(0);
    transition: opacity 0.2s, transform 0.2s, visibility 0s;
  }

  /* SVG container with 3D transforms */

  .compass-svg {
    width: 46px;
    height: 46px;
    perspective: 150px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .compass-svg svg {
    width: 100%;
    height: 100%;
    will-change: transform;
  }

  /* ==========================================================================
     Navigation panel - Map (copy) | Viewport (stats) | Navigation | Zoom
     ========================================================================== */

  .nav-panel {
    display: flex;
    flex-direction: row;
  }

  .row[data-h="left"] > .nav-panel { flex-direction: row-reverse; }

  /* Narrow maps: drop the Map section, then Viewport, so the panel stays on
     screen (Zoom and Navigation sit next to the box in either corner). The
     full panel needs ~582px of map width, without Map ~377px; the limits
     leave ~10% for wider system fonts. */
  @container (max-width: 640px) {
    .nav-panel > .nav-copy-section, .nav-panel > .nav-copy-section + .nav-divider { display: none; }
  }
  @container (max-width: 420px) {
    .nav-panel > .nav-info-section, .nav-panel > .nav-info-section + .nav-divider { display: none; }
  }

  .nav-section {
    display: flex;
    flex-direction: column;
    padding: 4px 5px;
  }

  .nav-label {
    font-size: var(--fs-label);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.55;
    text-align: center;
    padding-bottom: 3px;
  }

  .nav-divider {
    width: 1px;
    align-self: stretch;
    background: var(--border);
  }

  /* -- Navigation D-pad: R− | T+/T− | R+ -- */

  .nav-grid {
    display: grid;
    grid-template-columns: 22px 28px 22px;
    grid-template-rows: 1fr 1fr;
    gap: 2px;
    align-items: stretch;
    flex: 1;
  }

  .nav-grid > :nth-child(1) { grid-column: 1; grid-row: 1 / -1; }  /* R− */
  .nav-grid > :nth-child(2) { grid-column: 2; grid-row: 1; }       /* T+ */
  .nav-grid > :nth-child(3) { grid-column: 2; grid-row: 2; }       /* T− */
  .nav-grid > :nth-child(4) { grid-column: 3; grid-row: 1 / -1; }  /* R+ */

  /* -- Zoom stack: Z+ / Z− -- */

  .nav-zoom {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 28px;
  }

  .nav-zoom .nav-btn {
    font-size: 16px;
    font-weight: 600;
  }

  /* -- Shared button style (nav + zoom) -- */

  .nav-btn {
    flex: 1;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--btn-bg);
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color var(--fade), color var(--fade);
    user-select: none;
    padding: 0;
  }

  .nav-btn svg { width: 10px; height: 10px; }

  @media (hover: hover) {
    .nav-btn:hover { background: var(--btn-bg-hover); color: var(--text); }
  }

  .nav-btn:active { background: var(--btn-bg-press); color: var(--text); }

  /* ==========================================================================
     Info sections - Map (copy) and Viewport (stats), wider than nav/zoom
     ========================================================================== */

  .info-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    justify-content: center;
    gap: 2px;
  }

  /* -- Copy groups (Center / Extent) -- */

  .info-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .info-group-label {
    font-size: var(--fs-label);
    font-weight: 600;
    opacity: 0.55;
    min-width: 38px;
  }

  .info-copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--btn-bg);
    color: var(--text-dim);
    font-size: var(--fs-label);
    font-weight: 500;
    letter-spacing: 0.3px;
    padding: 2px 6px;
    cursor: pointer;
    transition: background-color var(--fade), color var(--fade);
    white-space: nowrap;
  }

  .info-copy-btn svg {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
  }

  @media (hover: hover) {
    .info-copy-btn:hover { background: var(--btn-bg-hover); color: var(--text); }
  }

  .info-copy-btn:active { background: var(--btn-bg-press); color: var(--text); }

  .info-copy-btn.copied {
    background: color-mix(in srgb, var(--accent) 28%, transparent);
    color: var(--text);
  }

  /* -- Stats: two side-by-side sub-grids (label value | label value) -- */

  .info-stats {
    display: flex;
    gap: 10px;
  }

  .info-stats-col {
    display: grid;
    grid-template-columns: auto auto;
    gap: 2px 4px;
    align-items: baseline;
  }

  .info-stat-label {
    font-size: var(--fs-label);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.45;
  }

  .info-stat-value {
    font-size: var(--fs-small);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
    text-align: right;
    min-width: 24px;
  }

  /* Second column (Pitch / Bearing) needs room for "360.0°" */
  .info-stats-col:last-child .info-stat-value {
    min-width: 42px;
  }

  /* ==========================================================================
     Layer row - the slide-out holds <treelet-panel>
     ========================================================================== */

  /* On narrow maps the panel stops at the opposite margin and its columns shrink */
  .layer-slide { max-width: var(--slide-room); }

  .layer-box svg { width: 36px; height: 36px; }
`;
