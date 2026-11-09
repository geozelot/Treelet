// ============================================================================
// treelet.js - Region analyses from the UI
//
// One flow for every control that starts a region analysis (the layer
// panel's Analysis list, the toolbar): ask for what the kind needs (the
// viewshed's observer), compute it over the view, and replace an earlier
// result of the same kind. Progress and cancelling are in the legend.
// ============================================================================

import type { Treelet } from '../core/Treelet';
import { REGION_ANALYSIS_INPUT, type RegionAnalysisKind } from '../core/AnalysisController';
import { isAbortError } from '../core/abort';

const POINT_PROMPT: Partial<Record<RegionAnalysisKind, string>> = {
  viewshed: 'Click the terrain to place the observer',
};

/** Run a region analysis from a UI control (cancelling is not an error). */
export function runRegionAnalysis(map: Treelet, kind: RegionAnalysisKind): void {
  const previous = map.getLayerStack().find((l) => 'descriptor' in l && l.descriptor.id === kind)?.id;
  const report = (err: unknown) => {
    if (!isAbortError(err)) console.warn(`treelet: ${kind} failed:`, (err as Error)?.message ?? err);
  };
  if (REGION_ANALYSIS_INPUT[kind] === 'point') {
    map.pickLocation({ prompt: POINT_PROMPT[kind] ?? 'Click the terrain' })
      .then((pick) => (pick ? map.computeAnalysis(kind, { observer: pick.lngLat, replaceLayer: previous }) : undefined))
      .catch(report);
  } else {
    map.computeAnalysis(kind, { replaceLayer: previous }).catch(report);
  }
}
