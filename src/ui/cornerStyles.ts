// ============================================================================
// treelet.js - Shared styles of the small floating corner elements
// (<treelet-legend>, <treelet-readout>, <treelet-toolbar>, <treelet-profile>):
// the shared theme tokens, the card surface, its buttons and the glass
// variant. Positioning is the corner container's job (Treelet stacks the
// elements that share a corner).
// ============================================================================

import { themeTokens, glassTokens, lightShadowRule } from './themeTokens';

export const cornerCardStyles = /* css */ `
  :host {
    display: block;
    max-width: min(240px, 100%);
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 11px;
    line-height: 1.35;
    pointer-events: none;
    ${themeTokens}
    color: var(--text);
  }

  ${lightShadowRule}

  :host([glass]) {
    ${glassTokens}
  }

  /* Small text buttons in cards (toolbar actions, profile export) */
  .card-btn {
    font: inherit; font-size: 11px; line-height: 1.35;
    border: 0; border-radius: 6px; padding: 3px 8px; cursor: pointer;
    color: var(--text); background: var(--border);
  }
  .card-btn:hover { color: var(--text); filter: brightness(1.08); }
  .card-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

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
