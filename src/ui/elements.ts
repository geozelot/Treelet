// ============================================================================
// treelet.js - Custom element registration
//
// Explicit, idempotent registration instead of import-time side effects, so
// the package is tree-shakeable and safe to import outside the browser.
// ============================================================================

import { TreeletPanel } from './TreeletPanel';
import { TreeletCompass } from './TreeletCompass';
import { TreeletAttribution } from './TreeletAttribution';
import { TreeletLegend } from './TreeletLegend';
import { TreeletReadout } from './TreeletReadout';

/** Register <treelet-panel>, <treelet-compass>, <treelet-attribution>, <treelet-legend> and <treelet-readout> (once). */
export function defineTreeletElements(): void {
  if (typeof customElements === 'undefined') return;
  if (!customElements.get('treelet-panel')) customElements.define('treelet-panel', TreeletPanel);
  if (!customElements.get('treelet-compass')) customElements.define('treelet-compass', TreeletCompass);
  if (!customElements.get('treelet-attribution')) customElements.define('treelet-attribution', TreeletAttribution);
  if (!customElements.get('treelet-legend')) customElements.define('treelet-legend', TreeletLegend);
  if (!customElements.get('treelet-readout')) customElements.define('treelet-readout', TreeletReadout);
}
