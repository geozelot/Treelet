// ============================================================================
// treelet.js - Color Ramps
//
// Ramps are data: the built-in names resolve to color stops or classes,
// users pass their own. The same spec feeds the ramp texture the shader
// samples, the panel's preview strip and the legend. Colors may carry
// alpha; a class with alpha 0 draws nothing.
// ============================================================================

import type { ColorRamp, ContinuousRamp, ClassRamp, LegendSpec, Ramp, RampSpec, RGB, RGBA } from './types';

/** Texels per ramp row in the ramp texture (and legend resolution). */
export const RAMP_WIDTH = 1024;

const TWO_PI = Math.PI * 2;

/** Hue wheel with no seam at t = 0 / 1 (aspect). */
function cyclicStops(n = 24): Array<[number, RGB]> {
  const stops: Array<[number, RGB]> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    stops.push([t, [
      0.55 + 0.4 * Math.cos(TWO_PI * t),
      0.55 + 0.4 * Math.cos(TWO_PI * (t + 2 / 3)),
      0.55 + 0.4 * Math.cos(TWO_PI * (t + 1 / 3)),
    ]]);
  }
  return stops;
}

const ASPECT8_COLORS: RGB[] = [
  [0.85, 0.20, 0.20], // N
  [0.95, 0.55, 0.15], // NE
  [0.95, 0.88, 0.25], // E
  [0.45, 0.75, 0.30], // SE
  [0.20, 0.70, 0.70], // S
  [0.25, 0.45, 0.85], // SW
  [0.55, 0.30, 0.75], // W
  [0.85, 0.40, 0.70], // NW
];

export const BUILTIN_RAMPS: Record<ColorRamp, RampSpec> = {
  hypsometric: { type: 'continuous', stops: [
    [0.00, [0.08, 0.32, 0.18]],
    [0.08, [0.30, 0.58, 0.22]],
    [0.20, [0.62, 0.72, 0.32]],
    [0.38, [0.80, 0.72, 0.40]],
    [0.55, [0.64, 0.48, 0.34]],
    [0.78, [0.72, 0.68, 0.65]],
    [1.00, [0.96, 0.96, 0.98]],
  ] },
  viridis: { type: 'continuous', stops: [
    [0.00, [0.267, 0.004, 0.329]],
    [0.25, [0.282, 0.140, 0.458]],
    [0.50, [0.127, 0.566, 0.551]],
    [0.75, [0.369, 0.789, 0.383]],
    [1.00, [0.993, 0.906, 0.144]],
  ] },
  inferno: { type: 'continuous', stops: [
    [0.00, [0.001, 0.000, 0.014]],
    [0.25, [0.341, 0.062, 0.429]],
    [0.50, [0.735, 0.215, 0.330]],
    [0.75, [0.988, 0.645, 0.040]],
    [1.00, [0.988, 0.998, 0.645]],
  ] },
  grayscale: { type: 'continuous', stops: [[0, [0, 0, 0]], [1, [1, 1, 1]]] },
  cyclic: { type: 'continuous', stops: cyclicStops() },
  diverging: { type: 'continuous', stops: [
    [0.0, [0.13, 0.40, 0.67]],
    [0.5, [0.96, 0.96, 0.96]],
    [1.0, [0.70, 0.09, 0.17]],
  ] },
  /** Slope classes of avalanche terrain maps: nothing below 30°, then yellow, orange, red, violet. */
  avalanche: { type: 'classes', breaks: [30, 35, 40, 45], colors: [
    [0, 0, 0, 0],
    [1.00, 0.93, 0.20],
    [1.00, 0.60, 0.10],
    [0.90, 0.15, 0.10],
    [0.60, 0.20, 0.70],
  ] },
  /** Eight compass sectors (N wraps around 0°/360°). */
  aspect8: { type: 'classes',
    breaks: [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5],
    colors: [...ASPECT8_COLORS, ASPECT8_COLORS[0]],
    labels: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'],
  },
};

export const BUILTIN_RAMP_NAMES = Object.keys(BUILTIN_RAMPS) as ColorRamp[];

/** Built-in class presets whose breaks only make sense for one analysis kind. */
export const RAMP_PRESET_FOR: Partial<Record<ColorRamp, string>> = {
  avalanche: 'slope',
  aspect8: 'aspect',
};

/** Built-in ramps that suit an analysis: every general ramp plus its own class presets. */
export function rampNamesFor(analysisId: string): ColorRamp[] {
  return BUILTIN_RAMP_NAMES.filter((name) => {
    const only = RAMP_PRESET_FOR[name];
    return only === undefined || only === analysisId;
  });
}

export function isRampName(ramp: Ramp): ramp is ColorRamp {
  return typeof ramp === 'string';
}

/** The stops or classes behind a ramp name or spec. Throws for unknown names. */
export function resolveRamp(ramp: Ramp): RampSpec {
  if (typeof ramp === 'string') {
    const spec = BUILTIN_RAMPS[ramp];
    if (!spec) throw new Error(`treelet: unknown color ramp "${ramp}"`);
    return spec;
  }
  validateRamp(ramp);
  return ramp;
}

export function validateRamp(spec: RampSpec): void {
  if (spec.type === 'continuous') {
    if (!Array.isArray(spec.stops) || spec.stops.length < 1) {
      throw new Error('treelet: a continuous ramp needs at least one stop');
    }
    for (let i = 1; i < spec.stops.length; i++) {
      if (spec.stops[i][0] < spec.stops[i - 1][0]) throw new Error('treelet: ramp stops must be ascending');
    }
  } else if (spec.type === 'classes') {
    if (!Array.isArray(spec.breaks) || !Array.isArray(spec.colors) || spec.colors.length !== spec.breaks.length + 1) {
      throw new Error('treelet: a class ramp needs breaks.length + 1 colors');
    }
    for (let i = 1; i < spec.breaks.length; i++) {
      if (spec.breaks[i] < spec.breaks[i - 1]) throw new Error('treelet: ramp breaks must be ascending');
    }
  } else {
    throw new Error(`treelet: unknown ramp type "${(spec as { type: string }).type}"`);
  }
}

/** A color with its alpha (1 where none is given). */
export function rgba(c: RGB | RGBA): RGBA {
  return [c[0], c[1], c[2], c.length > 3 ? (c as RGBA)[3] : 1];
}

/** Color of a continuous ramp at t (clamped to [0, 1]), linearly interpolated. */
export function continuousColorAt(ramp: ContinuousRamp, t: number): RGBA {
  const stops = ramp.stops;
  if (!(t > stops[0][0])) return rgba(stops[0][1]);
  const last = stops[stops.length - 1];
  if (t >= last[0]) return rgba(last[1]);
  let i = 1;
  while (stops[i][0] < t) i++;
  const [t0, c0r] = stops[i - 1];
  const [t1, c1r] = stops[i];
  const c0 = rgba(c0r);
  const c1 = rgba(c1r);
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return [
    c0[0] + (c1[0] - c0[0]) * f,
    c0[1] + (c1[1] - c0[1]) * f,
    c0[2] + (c1[2] - c0[2]) * f,
    c0[3] + (c1[3] - c0[3]) * f,
  ];
}

/** Index of the class a value falls in (values at a break belong to the upper class). */
export function classIndexOf(ramp: ClassRamp, value: number): number {
  let i = 0;
  while (i < ramp.breaks.length && value >= ramp.breaks[i]) i++;
  return i;
}

/**
 * Color for the normalized value t over `domain`. Class breaks are in value
 * units, so a class ramp needs the domain to place them.
 */
export function rampColorAt(spec: RampSpec, t: number, domain: [number, number]): RGBA {
  if (spec.type === 'continuous') return continuousColorAt(spec, t);
  const value = domain[0] + t * (domain[1] - domain[0]);
  return rgba(spec.colors[classIndexOf(spec, value)]);
}

/** Write one ramp row (`width` RGBA8 texels) into `out` starting at `offset`. */
export function writeRampRow(
  out: Uint8Array, offset: number, width: number, spec: RampSpec, domain: [number, number],
): void {
  for (let x = 0; x < width; x++) {
    const c = rampColorAt(spec, x / (width - 1), domain);
    const o = offset + x * 4;
    out[o] = Math.round(Math.max(0, Math.min(1, c[0])) * 255);
    out[o + 1] = Math.round(Math.max(0, Math.min(1, c[1])) * 255);
    out[o + 2] = Math.round(Math.max(0, Math.min(1, c[2])) * 255);
    out[o + 3] = Math.round(Math.max(0, Math.min(1, c[3])) * 255);
  }
}

/** CSS color of a ramp color: `#rrggbb`, or `rgba(...)` when it has alpha below 1. */
export function cssColor(c: RGB | RGBA): string {
  const v = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
  const a = c.length > 3 ? Math.max(0, Math.min(1, (c as RGBA)[3])) : 1;
  if (a < 1) return `rgba(${v(c[0])}, ${v(c[1])}, ${v(c[2])}, ${Math.round(a * 1000) / 1000})`;
  const h = (x: number) => v(x).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

/** CSS `linear-gradient` of a ramp (left = domain low), for previews. */
export function rampGradientCss(spec: RampSpec, domain: [number, number]): string {
  if (spec.type === 'continuous') {
    return `linear-gradient(to right, ${spec.stops.map(([t, c]) => `${cssColor(c)} ${(t * 100).toFixed(1)}%`).join(', ')})`;
  }
  const span = domain[1] - domain[0] || 1;
  const parts: string[] = [];
  let from = 0;
  for (let i = 0; i < spec.colors.length; i++) {
    const to = i < spec.breaks.length ? Math.max(0, Math.min(1, (spec.breaks[i] - domain[0]) / span)) : 1;
    parts.push(`${cssColor(spec.colors[i])} ${(from * 100).toFixed(1)}% ${(to * 100).toFixed(1)}%`);
    from = to;
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

/** Short number for labels: 3 significant-ish digits, no trailing zeros. */
export function formatValue(v: number): string {
  const a = Math.abs(v);
  const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/**
 * Legend data for a ramp over a domain. Classes that draw nothing (alpha 0)
 * are left out; classes sharing a label and color (a sector that wraps
 * around, like north) appear once.
 */
export function legendFor(
  id: string, title: string, spec: RampSpec, domain: [number, number], unit?: string,
): LegendSpec {
  if (spec.type === 'continuous') {
    return {
      id, title, unit, type: 'continuous', domain: [domain[0], domain[1]],
      stops: spec.stops.map(([t, c]) => [t, rgba(c)] as [number, RGBA]),
    };
  }
  const u = unit ?? '';
  const classes: LegendSpec['classes'] = [];
  const seen = new Set<string>();
  spec.colors.forEach((raw, i) => {
    const color = rgba(raw);
    if (color[3] <= 0) return;
    let label = spec.labels?.[i];
    if (label === undefined) {
      if (i === 0) label = `< ${formatValue(spec.breaks[0])}${u}`;
      else if (i === spec.breaks.length) label = `≥ ${formatValue(spec.breaks[i - 1])}${u}`;
      else label = `${formatValue(spec.breaks[i - 1])}–${formatValue(spec.breaks[i])}${u}`;
    }
    const key = `${label}|${cssColor(color)}`;
    if (seen.has(key)) return;
    seen.add(key);
    classes.push({ color, label });
  });
  return { id, title, unit, type: 'classes', domain: [domain[0], domain[1]], classes };
}
