// ============================================================================
// treelet.js - Region analyses from the UI
//
// One flow for every control that starts a region analysis (the layer
// panel's Analysis list, the toolbar): ask for what the kind needs (the
// viewshed's observer), compute it over the view, and replace an earlier
// result of the same kind. Progress and cancelling are with the running jobs
// in the hub's column (<treelet-jobs>).
// ============================================================================

import type { Treelet } from '../core/Treelet';
import { REGION_ANALYSIS_INPUT, type RegionAnalysisKind } from '../core/AnalysisController';
import { isAbortError } from '../core/abort';
import type { LngLat } from '../core/types';

const POINT_PROMPT: Partial<Record<RegionAnalysisKind, string>> = {
  viewshed: 'Click the terrain to place the observer',
};

/** Run a region analysis from a UI control (cancelling is not an error). */
export function runRegionAnalysis(map: Treelet, kind: RegionAnalysisKind): void {
  const report = (err: unknown) => {
    if (!isAbortError(err)) console.warn(`treelet: ${kind} failed:`, (err as Error)?.message ?? err);
  };
  // The new run takes the place of the kind's earlier result, and of a run of
  // the kind still going (its result would replace the same coat beside this one)
  const run = (observer?: LngLat) => {
    for (const job of map.getAnalysisJobs()) if (job.kind === kind) map.cancelAnalysis(job.id);
    const previous = map.getLayerStack().find((l) => 'descriptor' in l && l.descriptor.id === kind)?.id;
    return map.computeAnalysis(kind, observer ? { observer, replaceLayer: previous } : { replaceLayer: previous });
  };
  if (REGION_ANALYSIS_INPUT[kind] === 'point') {
    map.pickLocation({ prompt: POINT_PROMPT[kind] ?? 'Click the terrain' })
      .then((pick) => (pick ? run(pick.lngLat) : undefined))
      .catch(report);
  } else {
    run().catch(report);
  }
}
