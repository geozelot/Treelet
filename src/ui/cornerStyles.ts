// ============================================================================
// treelet.js - Shared styles of the small floating corner elements
// (<treelet-legend>, <treelet-readout>): tokens, the card surface and the
// glass variant. Positioning is the corner container's job (Treelet stacks
// the elements that share a corner).
// ============================================================================

export const cornerCardStyles = /* css */ `
  :host {
    display: block;
    max-width: min(240px, 100%);
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 11px;
    line-height: 1.35;
    pointer-events: none;
    color-scheme: light dark;

    --bg: light-dark(#fafafa, #181818);
    --surface-bg: var(--bg);
    --surface-filter: none;
    --border: light-dark(rgba(0, 0, 0, 0.10), rgba(255, 255, 255, 0.08));
    --shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    --text: light-dark(#333333, #e8e8e8);
    --text-dim: light-dark(rgba(0, 0, 0, 0.55), rgba(255, 255, 255, 0.55));
    --radius: 10px;
    color: var(--text);
  }

  @media (prefers-color-scheme: light) {
    :host { --shadow: 0 4px 16px rgba(0, 0, 0, 0.10); }
  }

  :host([glass]) {
    --surface-bg: light-dark(rgba(250, 250, 250, 0.72), rgba(24, 24, 24, 0.66));
    --surface-filter: blur(14px) saturate(1.5);
  }

  :host([hidden]) { display: none; }

  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 7px 9px 8px;
    background: var(--surface-bg);
    -webkit-backdrop-filter: var(--surface-filter);
    backdrop-filter: var(--surface-filter);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    pointer-events: auto;
  }

  .card-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.6;
    margin-bottom: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;
