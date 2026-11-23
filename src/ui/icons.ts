// ============================================================================
// treelet.js - Icons of the UI
//
// Two families:
//  - Logo icons, drawn like the tree and the compass: filled facets at full
//    and .82 / .75 opacity with one leaf-green part. The info box (Ring i)
//    and the page buttons of the columns' rails (Layers, Measure, Legend,
//    Map). The rail cuts draw thin parts heavier so they hold at 20–24 px.
//  - Line icons on a 16 grid (stroke 1.4) or a 10 grid (stroke 1.6) for the
//    controls in rows (eye, chevrons, plus, close, copy, tools).
// Every icon is aria-hidden: the button around it carries the label.
// ============================================================================

const LEAF = '#a5c500';

/** Ring i at box size (46 in the 56 box): the compass ring, the trunk as stem, the leaf as dot. */
export const INFO_SVG = `<svg viewBox="0 0 46 46" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" opacity=".75" d="M23 8.5a14.5 14.5 0 1 0 0 29a14.5 14.5 0 1 0 0-29Zm0 1.4a13.1 13.1 0 1 1 0 26.2a13.1 13.1 0 1 1 0-26.2Z"/><rect fill="currentColor" x="21.3" y="21.4" width="3.4" height="11" transform="rotate(8 23 26.9)"/><path d="M24.9 13.6 26.9 18.7C25.4 18.6 23.8 18.7 22.1 19Z" fill="${LEAF}"/></svg>`;

/** Ring i, rail cut: cropped to the ring, ring 2 thick. */
export const INFO_RAIL_SVG = `<svg viewBox="6 6 34 34" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" opacity=".75" d="M23 8.5a14.5 14.5 0 1 0 0 29a14.5 14.5 0 1 0 0-29Zm0 2a12.5 12.5 0 1 1 0 25a12.5 12.5 0 1 1 0-25Z"/><rect fill="currentColor" x="21.3" y="21.4" width="3.4" height="11" transform="rotate(8 23 26.9)"/><path d="M24.9 13.6 26.9 18.7C25.4 18.6 23.8 18.7 22.1 19Z" fill="${LEAF}"/></svg>`;

/** Layers page: three stacked sheets, the lowest one green. */
export const LAYERS_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 4 28 10 16 16 4 10Z"/><path fill="currentColor" opacity=".82" d="M4 14 16 20 28 14V17L16 23 4 17Z"/><path d="M4 21 16 27 28 21V24L16 30 4 24Z" fill="${LEAF}"/></svg>`;

/** Measure page: a set-square (its inner triangle turns green while a tool runs). */
export const MEASURE_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" opacity=".82" d="M5 27V5l22 22H5Zm5-5h6.5L10 15.5V22Z"/><path class="tool-on" fill="none" d="M10 22h6.5L10 15.5V22Z"/></svg>`;

/** Legend page, Peaks: the tree's blades as two peaks over a trunk bar, the leaf at their foot. */
export const LEGEND_SVG = `<svg viewBox="3 4.5 40 40" aria-hidden="true"><path fill="currentColor" opacity=".82" d="M6 34C9.6 30.4 12.8 24.4 15.2 17.6L25.4 34Z"/><path fill="currentColor" d="M40 34H19L28.4 10C30.6 18.6 34.4 27 40 34Z"/><rect fill="currentColor" opacity=".75" x="5" y="35.7" width="36" height="3" transform="rotate(-2 23 37.2)"/><path d="M6.6 19.4 9.4 25.6C7.8 25.5 6.2 25.6 4.4 25.9Z" fill="${LEAF}"/></svg>`;

/** Map page, Pin: the compass ring over the compass arrow turned down, the leaf inside. */
export const MAP_SVG = `<svg viewBox="3 4 40 40" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" opacity=".75" d="M23 6.5a10 10 0 1 0 0 20a10 10 0 1 0 0-20Zm0 2.4a7.6 7.6 0 1 1 0 15.2a7.6 7.6 0 1 1 0-15.2Z"/><path fill="currentColor" d="M16 28.5 23 42 30 28.5 23 31.4Z"/><path d="M23.6 11.6 26.2 18.6C24.4 18.5 22.4 18.6 20.4 19Z" fill="${LEAF}"/></svg>`;

// ---------------------------------------------------------------------------
// Line icons
// ---------------------------------------------------------------------------

const line16 = (d: string, size = 14) =>
  `<svg class="i" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const line10 = (d: string) =>
  `<svg class="i" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const EYE_SVG = line16('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>');
export const EYE_OFF_SVG = line16('<path d="M2.5 2.5l11 11"/><path d="M6.3 6.4A2 2 0 0 0 9.6 9.7"/><path d="M4.4 4.9C2.6 6.1 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.2 0 2.3-.4 3.2-1"/><path d="M7 3.6c.3 0 .7-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.7 1.3-2 2.5"/>');
export const CHEV_RIGHT_SVG = line10('<path d="M3.75 2.5 6.25 5l-2.5 2.5"/>');
export const CHEV_LEFT_SVG = line10('<path d="M6.25 2.5 3.75 5l2.5 2.5"/>');
export const UP_SVG = line10('<path d="M2.5 6.25 5 3.75l2.5 2.5"/>');
export const DOWN_SVG = line10('<path d="M2.5 3.75 5 6.25l2.5-2.5"/>');
export const PLUS_SVG = line10('<path d="M5 2v6M2 5h6"/>');
export const MINUS_SVG = line10('<path d="M2 5h6"/>');
export const CLOSE_SVG = line10('<path d="M2.5 2.5l5 5M7.5 2.5l-5 5"/>');
export const COPY_SVG = `<svg class="i" width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="7" height="7.5" rx="1"/><path d="M3.5 9.5V3a1 1 0 0 1 1-1H9"/></svg>`;

/** Rotate left / right (24 grid, drawn at 14). */
export const ROTATE_LEFT_SVG = `<svg class="i" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.6-5.9L4 8"/><path d="M4 3.5V8h4.5"/></svg>`;
export const ROTATE_RIGHT_SVG = `<svg class="i" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9L20 8"/><path d="M20 3.5V8h-4.5"/></svg>`;
/** Tilt up / down: small filled triangles. */
export const TILT_UP_SVG = `<svg width="7" height="7" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><path d="M5 1.5 9 8.5H1Z"/></svg>`;
export const TILT_DOWN_SVG = `<svg width="7" height="7" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><path d="M5 8.5 9 1.5H1Z"/></svg>`;

/** The measuring tools (16 grid). */
export const TOOL_ICONS = {
  distance: line16('<path d="M2.5 11.5 11.5 2.5l2 2-9 9z"/><path d="M5 9l1 1M7 7l1.5 1.5M9 5l1 1"/>', 16),
  area: line16('<path d="M3 4.5 9 2.5l4.5 4-2 6.5-7.5-1.5z"/>', 16),
  profile: line16('<path d="M1.5 13.5 5 7l3 3 2.5-5.5 4 9"/><path d="M1.5 13.5h13"/>', 16),
  sight: line16('<circle cx="3.5" cy="11.5" r="1.5"/><circle cx="12.5" cy="4.5" r="1.5"/><path d="M5 10.3 11 5.7" stroke-dasharray="2 1.6"/>', 16),
  viewshed: line16('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>', 16),
} as const;
