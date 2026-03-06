// ============================================================================
// treelet.js - Compass Styles
//
// CSS for the <treelet-compass> web component:
//   - Compass box with rotatable SVG
//   - Slide-out navigation panel: map coords, viewport stats, D-pad, zoom
//   - Layer box with slide-out panel
//   - Light/dark theme via light-dark()
//   - Direction-aware positioning via data-h / data-v attributes
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

    color-scheme: light dark;

    --bg: light-dark(#fafafa, #181818);
    --border: light-dark(rgba(0, 0, 0, 0.10), rgba(255, 255, 255, 0.08));
    --shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    --text: light-dark(#333333, #e8e8e8);
    --text-dim: light-dark(rgba(0, 0, 0, 0.55), rgba(255, 255, 255, 0.55));
    --text-muted: light-dark(rgba(0, 0, 0, 0.40), rgba(255, 255, 255, 0.45));
    --hover-bg: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.06));
    --hover-text: light-dark(#222222, #e8e8e8);
    --active-bg: light-dark(rgba(0, 0, 0, 0.10), rgba(255, 255, 255, 0.14));
    --active-text: light-dark(#000000, #ffffff);
    --accent: light-dark(#555555, #b0b0b0);
    --control-border: light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.12));
    --control-bg: light-dark(rgba(0, 0, 0, 0.04), rgba(255, 255, 255, 0.04));

    color: var(--text);
  }

  @media (prefers-color-scheme: light) {
    :host { --shadow: 0 4px 16px rgba(0, 0, 0, 0.10); }
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
     Compass row - nav-panel + compass-box side by side
     ========================================================================== */

  .compass-row {
    position: relative;
    display: flex;
    align-items: stretch;
  }

  .compass-row[data-h="right"] { flex-direction: row;         justify-content: flex-end; }
  .compass-row[data-h="left"]  { flex-direction: row-reverse; justify-content: flex-start; }

  /* ==========================================================================
     Compass box - clickable SVG that resets orientation
     ========================================================================== */

  .compass-box {
    position: relative;
    width: 60px;
    height: 60px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.65;
    transition: background 0.15s, opacity 0.15s, border-radius 0.2s;
    flex-shrink: 0;
  }

  .compass-row:hover .compass-box {
    background: var(--bg);
    opacity: 1;
    transition: background 0.15s, opacity 0.15s, border-radius 0s;
  }

  .compass-row[data-h="right"]:hover .compass-box { border-radius: 0 8px 8px 0; }
  .compass-row[data-h="left"]:hover  .compass-box { border-radius: 8px 0 0 8px; }

  .compass-box:active { background: var(--active-bg); }

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
     Navigation panel - slides out from compass box on hover
     ========================================================================== */

  .nav-panel {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--bg);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s, transform 0.2s;
    overflow: visible;
    display: flex;
    flex-direction: row;
  }

  .compass-row:hover .nav-panel {
    opacity: 1;
    pointer-events: auto;
  }

  .compass-row[data-h="right"] .nav-panel {
    right: 100%;
    border-right: none;
    border-radius: 8px 0 0 8px;
    transform: translateX(8px);
  }

  .compass-row[data-h="left"] .nav-panel {
    left: 100%;
    border-left: none;
    border-radius: 0 8px 8px 0;
    transform: translateX(-8px);
    flex-direction: row-reverse;
  }

  .compass-row[data-h="right"]:hover .nav-panel,
  .compass-row[data-h="left"]:hover  .nav-panel {
    transform: translateX(0);
  }

  /* ==========================================================================
     Nav sections - NAVIGATION (D-pad) and ZOOM (stack)
     ========================================================================== */

  .nav-section {
    display: flex;
    flex-direction: column;
    padding: 3px 4px;
  }

  .nav-label {
    font-size: 8px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    opacity: 0.55;
    text-align: center;
    padding-bottom: 2px;
  }

  .nav-divider {
    width: 1px;
    align-self: stretch;
    background: var(--border);
  }

  /* -- Navigation D-pad: R− | T+/T− | R+ -- */

  .nav-grid {
    display: grid;
    grid-template-columns: 21px 28px 21px;
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
    border-radius: 4px;
    background: var(--active-bg);
    color: var(--active-text);
    opacity: 0.45;
    font: inherit;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.15s;
    user-select: none;
    padding: 0;
  }

  .nav-btn svg { width: 10px; height: 10px; }

  .nav-btn:hover { opacity: 1; }

  .nav-btn:active {
    opacity: 1;
    background: light-dark(rgba(0, 0, 0, 0.18), rgba(255, 255, 255, 0.22));
  }

  /* ==========================================================================
     Info sections - Map (copy) and Viewport (stats), wider than nav/zoom
     ========================================================================== */

  .nav-info-section,
  .nav-copy-section {
    padding: 3px 5px;
  }

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
    font-size: 9px;
    font-weight: 600;
    opacity: 0.5;
    min-width: 34px;
  }

  .info-copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    border: none;
    border-radius: 3px;
    background: var(--active-bg);
    color: var(--active-text);
    opacity: 0.45;
    font: inherit;
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.3px;
    padding: 2px 5px;
    cursor: pointer;
    transition: opacity 0.15s;
    white-space: nowrap;
  }

  .info-copy-btn svg {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
  }

  .info-copy-btn:hover { opacity: 1; }

  .info-copy-btn:active {
    opacity: 1;
    background: light-dark(rgba(0, 0, 0, 0.18), rgba(255, 255, 255, 0.22));
  }

  .info-copy-btn.copied {
    opacity: 1;
    background: light-dark(rgba(0, 120, 0, 0.12), rgba(100, 255, 100, 0.15));
  }

  /* -- Stats: two side-by-side sub-grids (label value | label value) -- */

  .info-stats {
    display: flex;
    gap: 10px;
  }

  .info-stats-col {
    display: grid;
    grid-template-columns: auto auto;
    gap: 1px 3px;
    align-items: baseline;
  }

  .info-stat-label {
    font-size: 8px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    opacity: 0.45;
  }

  .info-stat-value {
    font-size: 10px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
    text-align: right;
    min-width: 20px;
  }

  /* Second column (Pitch / Bearing) needs room for "360.0°" */
  .info-stats-col:last-child .info-stat-value {
    min-width: 38px;
  }

  /* ==========================================================================
     Layer row - layer-slide + layer-box side by side (mirrors compass-row)
     ========================================================================== */

  .layer-row {
    position: relative;
    display: flex;
    align-items: stretch;
  }

  .layer-row[data-h="right"] { flex-direction: row;         justify-content: flex-end; }
  .layer-row[data-h="left"]  { flex-direction: row-reverse; justify-content: flex-start; }

  /* Layer slide panel - slides out on hover */

  .layer-slide {
    position: absolute;
    background: var(--bg);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s, transform 0.2s;
    overflow: visible;
  }

  /* Pin slide to both edges of the layer-row so its height matches the box */
  .layer-row .layer-slide { top: 0; bottom: 0; }

  .layer-row:hover .layer-slide {
    opacity: 1;
    pointer-events: auto;
  }

  .layer-row[data-h="right"] .layer-slide {
    right: 100%;
    border-right: none;
    border-radius: 8px 0 0 8px;
    transform: translateX(8px);
  }

  .layer-row[data-h="left"] .layer-slide {
    left: 100%;
    border-left: none;
    border-radius: 0 8px 8px 0;
    transform: translateX(-8px);
  }

  .layer-row[data-h="right"]:hover .layer-slide,
  .layer-row[data-h="left"]:hover  .layer-slide {
    transform: translateX(0);
  }

  /* Layer box icon - mirrors compass-box appearance */

  .layer-box {
    position: relative;
    width: 40px;
    height: 40px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    opacity: 0.65;
    transition: background 0.15s, opacity 0.15s, border-radius 0.2s;
    color: var(--text);
  }

  .layer-box svg { width: 24px; height: 24px; }

  .layer-row:hover .layer-box {
    background: var(--bg);
    opacity: 1;
    transition: background 0.15s, opacity 0.15s, border-radius 0s;
  }

  .layer-row[data-h="right"]:hover .layer-box { border-radius: 0 8px 8px 0; }
  .layer-row[data-h="left"]:hover  .layer-box { border-radius: 8px 0 0 8px; }
`;
