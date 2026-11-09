// ============================================================================
// treelet.js - Theme tokens shared by the UI elements
//
// One definition of the colors, surfaces and radii every treelet element
// uses (compass and layer panel, legend, readout, toolbar, profile), so a
// theme change is made once. Each element's :host includes `themeTokens`,
// `:host([glass])` includes `glassTokens`, and the sheet adds
// `lightShadowRule`.
// ============================================================================

/** Declarations for `:host`: light/dark colors via light-dark(). */
export const themeTokens = /* css */ `
    color-scheme: light dark;

    --bg: light-dark(#fafafa, #181818);
    /* Boxes and cards; translucent with [glass] */
    --surface-bg: var(--bg);
    --surface-filter: none;
    --border: light-dark(rgba(0, 0, 0, 0.10), rgba(255, 255, 255, 0.08));
    --shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    --text: light-dark(#333333, #e8e8e8);
    --text-dim: light-dark(rgba(0, 0, 0, 0.55), rgba(255, 255, 255, 0.55));
    /* The logo's leaf green; darker on light backgrounds for 3:1 contrast */
    --accent: light-dark(#7a9400, #a5c500);
    /* Text on the accent */
    --on-accent: light-dark(#ffffff, #111111);
    --radius: 10px;
`;

/** Declarations for `:host([glass])`: frosted surfaces. */
export const glassTokens = /* css */ `
    --surface-bg: light-dark(rgba(250, 250, 250, 0.72), rgba(24, 24, 24, 0.66));
    --surface-filter: blur(14px) saturate(1.5);
`;

/** A softer shadow on light backgrounds. */
export const lightShadowRule = /* css */ `
  @media (prefers-color-scheme: light) {
    :host { --shadow: 0 4px 16px rgba(0, 0, 0, 0.10); }
  }
`;
