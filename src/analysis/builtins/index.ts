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
import { curvature } from './curvature';
import { water } from './water';

export type { ElevationParams } from './elevation';
export type { SlopeParams } from './slope';
export type { AspectParams } from './aspect';
export type { ContoursParams } from './contours';
export type { HillshadeParams } from './hillshade';
export type { CurvatureParams, CurvatureMode } from './curvature';
export type { WaterParams } from './water';
export { slopeDegrees, inSector } from './slope';
export { aspectDegrees } from './aspect';
export { curvatureOf, curvatureValue } from './curvature';
export { waterDepth, WATER_COLORS } from './water';
export { CONTOUR_COLORS } from './contours';

/** Register the built-in analyses (once). */
export function registerBuiltinAnalyses(): void {
  const builtins = [
    elevation, slope, aspect, contours, hillshade, curvature, water,
  ] as unknown as AnalysisDescriptor<object>[];
  for (const d of builtins) {
    if (!getAnalysis(d.id)) registerAnalysis(d);
  }
}
