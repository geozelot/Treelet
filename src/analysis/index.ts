// ============================================================================
// treelet.js - Analysis module
// ============================================================================

export type {
  RGB,
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
  resolveRamp,
  rampColorAt,
  rampGradientCss,
  legendFor,
} from './ramps';
export * from './builtins';
