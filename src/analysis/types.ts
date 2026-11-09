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

/** Color with alpha, [r, g, b, a] in 0–1. Ramp colors may carry alpha (a = 0 draws nothing). */
export type RGBA = [number, number, number, number];

/** How a coat combines with what lies below it. */
export type CoatBlendMode = 'normal' | 'multiply' | 'screen' | 'softlight';

/**
 * Built-in ramp names. `cyclic` suits circular data such as aspect.
 * `avalanche` (slope classes 30–35–40–45°, nothing below 30°), `aspect8`
 * (eight compass sectors) and `visibility` (hidden / visible) are class
 * presets for the slope, aspect and viewshed analyses.
 */
export type ColorRamp =
  | 'hypsometric' | 'viridis' | 'inferno' | 'grayscale' | 'cyclic' | 'diverging'
  | 'avalanche' | 'aspect8' | 'visibility';

/** Smooth ramp: color stops over the normalized value t in [0, 1]. */
export interface ContinuousRamp {
  type: 'continuous';
  stops: Array<[t: number, color: RGB | RGBA]>;
}

/**
 * Stepped ramp: `breaks` (ascending, in the analysis' units) split the value
 * domain into `breaks.length + 1` classes, one color each. A color with
 * alpha 0 leaves that class undrawn (and out of the legend). Optional labels
 * replace the generated "a–b" class labels in legends.
 */
export interface ClassRamp {
  type: 'classes';
  breaks: number[];
  colors: Array<RGB | RGBA>;
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
  /** Slider range of the panel; values set from code may lie outside it (see `limits`). */
  min: number;
  max: number;
  step: number;
  /**
   * Values outside these bounds are clamped (with a warning). Default: the
   * slider range `[min, max]`. Use ±Infinity for an open end.
   */
  limits?: [number, number];
  unit?: string;
  /** `'elevation'`: the panel's slider spans the visible elevation range instead of min–max. */
  bounds?: 'elevation';
}

/**
 * A [low, high] pair, e.g. the value range a ramp spans. With `auto` the
 * value may also be the string 'auto' (fit to the visible data); with
 * `optional` it may be null (not applied). `wrap` marks a circular range
 * (bearings) of period `max − min`: [from, to] runs clockwise and may pass
 * through min/max, so the pair is not sorted; ends are reduced into
 * [min, max) and a pair spanning a whole turn or more becomes [min, max]
 * (everything).
 */
export interface SpanParam extends ParamBase {
  type: 'span';
  /** Slider range of the panel; values set from code may lie outside it (see `limits`). */
  min: number;
  max: number;
  step: number;
  /**
   * Values outside these bounds are clamped (with a warning). Default: the
   * slider range `[min, max]`. Use ±Infinity for an open end. Ignored for
   * `wrap` spans.
   */
  limits?: [number, number];
  unit?: string;
  auto?: boolean;
  optional?: boolean;
  wrap?: boolean;
  /** `'data'`: the panel's sliders span the layer's raster values instead of min–max. */
  bounds?: 'data';
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
  /** Gradient dh/dx (east), dh/dy (north) in m/m, true scale. */
  g?: [number, number];
  /** Second derivatives [hxx, hyy, hxy] in 1/m, at the sampled tile's resolution. */
  c?: [number, number, number];
}

// === Legends ===

export interface LegendClass {
  color: RGBA;
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
  stops?: Array<[number, RGBA]>;
  /** Stepped ramps: one entry per drawn class, lowest first. */
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
   * Value domain the ramp spans (value kinds). `visible` is the current
   * visible elevation range [min, max] in meters; the domain is evaluated
   * again whenever it changes, so a domain derived from it (a parameter set
   * to 'auto', or e.g. `[visible[0], visible[0] + 500]`) follows the view.
   */
  domain?: (params: P, visible: [number, number]) => [number, number];
  /** Pack parameters into the two uniforms the shader receives. */
  pack: (params: P, domain: [number, number]) => { p0: Vec4; p1: Vec4 };
  /** The same quantity on the CPU, for readouts and tests (value kinds). */
  cpu?: (s: SurfaceSample, params: P) => number;
  /**
   * Parameters derived from the visible elevation range when a layer is
   * added (under the caller's `params`), e.g. a water level inside the view.
   */
  initialParams?: (visible: [number, number]) => Partial<P>;
  /**
   * The kind draws a raster bound to its layer (`coatRaster()` in GLSL)
   * rather than a quantity of the surface. Its layers come from
   * `addRasterLayer` or a region analysis (viewshed, sun hours…), not from
   * `addAnalysisLayer`.
   */
  raster?: boolean;
  /**
   * The kind reads the terrain-cast shadow factor (`gShadowLit` in GLSL:
   * 1 lit, 0 in shadow); the renderer keeps a shadow map while a coat of
   * it is visible.
   */
  shadowMap?: boolean;
}
