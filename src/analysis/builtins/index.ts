// ============================================================================
// treelet.js - Built-in analyses
//
// Registered on import, in the order the panel lists them.
// ============================================================================

import { registerAnalysis, getAnalysis } from '../registry';
import type { AnalysisDescriptor } from '../types';
import { elevation } from './elevation';
import { slope } from './slope';
import { aspect } from './aspect';
import { contours } from './contours';
import { hillshade } from './hillshade';

export type { ElevationParams } from './elevation';
export type { SlopeParams } from './slope';
export type { AspectParams } from './aspect';
export type { ContoursParams } from './contours';
export type { HillshadeParams } from './hillshade';
export { slopeDegrees } from './slope';
export { aspectDegrees } from './aspect';
export { CONTOUR_COLORS } from './contours';

/** Register the built-in analyses (once). */
export function registerBuiltinAnalyses(): void {
  const builtins = [elevation, slope, aspect, contours, hillshade] as unknown as AnalysisDescriptor<object>[];
  for (const d of builtins) {
    if (!getAnalysis(d.id)) registerAnalysis(d);
  }
}
