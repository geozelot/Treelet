// ============================================================================
// treelet.js - Analysis module
// ============================================================================

export type {
  RGB,
  RGBA,
  CoatBlendMode,
  ColorRamp,
  ContinuousRamp,
  ClassRamp,
  RampSpec,
  Ramp,
  ParamSpec,
  RangeParam,
  SpanParam,
  SelectParam,
  ColorParam,
  BooleanParam,
  Vec4,
  SurfaceSample,
  LegendClass,
  LegendSpec,
  AnalysisDescriptor,
} from './types';
export {
  registerAnalysis,
  getAnalysis,
  listAnalyses,
  resolveParams,
  MAX_COATS,
} from './registry';
export {
  BUILTIN_RAMPS,
  BUILTIN_RAMP_NAMES,
  RAMP_PRESET_FOR,
  rampNamesFor,
  resolveRamp,
  rampColorAt,
  rampGradientCss,
  cssColor,
  legendFor,
} from './ramps';
export { sampleSurfaceGrid, type GridReader } from './surface';
export * from './builtins';
