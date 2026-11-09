// ============================================================================
// treelet.js - Analysis Type Definitions
//
// An analysis is a quantity derived from the terrain (slope, elevation,
// light…) that is drawn as a coat over the ground. Each kind is described
// by an AnalysisDescriptor: a GLSL snippet for the fragment shader, a
// parameter schema the panel renders from, and the ramp that maps values
// to colors. Ramps are data (not shader code), so legends, panel previews
// and the shader always agree.
// ============================================================================

/** Color as [r, g, b] in 0–1. */
export type RGB = [number, number, number];

/** How a coat combines with what lies below it. */
export type CoatBlendMode = 'normal' | 'multiply' | 'screen' | 'softlight';

/** Built-in ramp names. `cyclic` suits circular data such as aspect. */
export type ColorRamp = 'hypsometric' | 'viridis' | 'inferno' | 'grayscale' | 'cyclic' | 'diverging';

/** Smooth ramp: color stops over the normalized value t in [0, 1]. */
export interface ContinuousRamp {
  type: 'continuous';
  stops: Array<[t: number, color: RGB]>;
}

/**
 * Stepped ramp: `breaks` (ascending, in the analysis' units) split the value
 * domain into `breaks.length + 1` classes, one color each. Optional labels
 * replace the generated "a–b" class labels in legends.
 */
export interface ClassRamp {
  type: 'classes';
  breaks: number[];
  colors: RGB[];
  labels?: string[];
}

export type RampSpec = ContinuousRamp | ClassRamp;

/** A built-in ramp name or an explicit spec. */
export type Ramp = ColorRamp | RampSpec;

// === Parameter schema ===

interface ParamBase {
  key: string;
  label: string;
}

/** A single number on a slider. */
export interface RangeParam extends ParamBase {
  type: 'range';
  min: number;
  max: number;
  step: number;
  unit?: string;
}

/**
 * A [low, high] pair, e.g. the value range a ramp spans. With `auto` the
 * value may also be the string 'auto' (fit to the visible data).
 */
export interface SpanParam extends ParamBase {
  type: 'span';
  min: number;
  max: number;
  step: number;
  unit?: string;
  auto?: boolean;
}

export interface SelectParam extends ParamBase {
  type: 'select';
  options: Array<{ value: string; label: string }>;
}

/** An RGB color; the panel offers `presets` as swatches. */
export interface ColorParam extends ParamBase {
  type: 'color';
  presets?: Array<{ label: string; color: RGB }>;
}

export interface BooleanParam extends ParamBase {
  type: 'boolean';
}

export type ParamSpec = RangeParam | SpanParam | SelectParam | ColorParam | BooleanParam;

/** Four floats, one shader `vec4`. */
export type Vec4 = [number, number, number, number];

/** A sampled terrain surface on the CPU (the shader's `Surface`). */
export interface SurfaceSample {
  /** Elevation in meters. */
  h: number;
  /** Unit normal (x east, y north, z up), true scale. */
  n: [number, number, number];
}

// === Legends ===

export interface LegendClass {
  color: RGB;
  label: string;
}

export interface LegendSpec {
  /** Layer id the legend belongs to. */
  id: string;
  title: string;
  unit?: string;
  type: 'continuous' | 'classes';
  /** Value range the ramp spans. */
  domain: [number, number];
  /** Continuous ramps: color stops over t in [0, 1]. */
  stops?: Array<[number, RGB]>;
  /** Stepped ramps: one entry per class, lowest first. */
  classes?: LegendClass[];
}

// === Descriptor ===

/**
 * Describes one kind of analysis.
 *
 * `glsl` defines `vec4 analysis_<id>(Surface s, vec4 p0, vec4 p1)`. A kind
 * with a `ramp` is a *value* kind: it returns the normalized value in `.x`
 * (0 = domain low, 1 = domain high) and the coat's alpha in `.w`; the ramp
 * turns the value into a color. A kind without a ramp returns a color in
 * `.rgb` and alpha in `.w` (contours, hillshade).
 */
export interface AnalysisDescriptor<P extends object = Record<string, unknown>> {
  /** Unique kind id, also the GLSL function suffix (`[a-z][a-z0-9_]*`). */
  id: string;
  label: string;
  /** Unit of the value (legend), e.g. '°' or 'm'. */
  unit?: string;
  glsl: string;
  params: ParamSpec[];
  defaults: P;
  /** Default ramp; present for value kinds only. */
  ramp?: Ramp;
  /** Default blend mode of a new coat of this kind. Default 'normal'. */
  blendMode?: CoatBlendMode;
  /** Default opacity of a new coat of this kind. Default 1. */
  opacity?: number;
  /**
   * Value domain the ramp spans (value kinds). `auto` is the visible
   * elevation range; return it for parameters set to 'auto'.
   */
  domain?: (params: P, auto: [number, number]) => [number, number];
  /** Pack parameters into the two uniforms the shader receives. */
  pack: (params: P, domain: [number, number]) => { p0: Vec4; p1: Vec4 };
  /** The same quantity on the CPU, for readouts and tests (value kinds). */
  cpu?: (s: SurfaceSample, params: P) => number;
}
