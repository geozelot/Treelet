// ============================================================================
// treelet.js - Analysis Registry
//
// Registered kinds are compiled into the terrain fragment shader: each
// contributes its `analysis_<id>` function and a case in `evalAnalysis`.
// Built-ins register on import; `registerAnalysis` adds more at runtime
// (the material is rebuilt once).
// ============================================================================

import type { AnalysisDescriptor, CoatBlendMode, ParamSpec, RGB } from './types';
import { resolveRamp } from './ramps';

/** Kind index of the imagery coat (the active drape); analyses start at 1. */
export const IMAGERY_KIND = 0;

/** Coats the shader evaluates per fragment; more are ignored with a warning. */
export const MAX_COATS = 6;

/** Blend modes of a coat, in the order of the shader's blend codes. */
export const BLEND_MODES: readonly CoatBlendMode[] = ['normal', 'multiply', 'screen', 'softlight'];

/** Whether `mode` is a coat blend mode. */
export function isBlendMode(mode: unknown): mode is CoatBlendMode {
  return typeof mode === 'string' && (BLEND_MODES as readonly string[]).includes(mode);
}

const descriptors = new Map<string, AnalysisDescriptor<object>>();
const kinds = new Map<string, number>();
let nextKind = IMAGERY_KIND + 1;
let version = 0;
const listeners = new Set<() => void>();

/**
 * Register an analysis kind. The id must be unique and a valid GLSL
 * identifier suffix; `glsl` must define `vec4 analysis_<id>(Surface s, vec4 p0, vec4 p1)`.
 */
export function registerAnalysis<P extends object>(descriptor: AnalysisDescriptor<P>): void {
  const { id } = descriptor;
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    throw new Error(`treelet: analysis id "${id}" must match [a-z][a-z0-9_]*`);
  }
  if (descriptors.has(id)) throw new Error(`treelet: analysis "${id}" is already registered`);
  if (!descriptor.glsl.includes(`analysis_${id}`)) {
    throw new Error(`treelet: analysis "${id}" GLSL must define analysis_${id}(Surface s, vec4 p0, vec4 p1)`);
  }
  if (descriptor.ramp !== undefined) resolveRamp(descriptor.ramp); // validates names and specs (throws)
  if (descriptor.blendMode !== undefined && !isBlendMode(descriptor.blendMode)) {
    throw new Error(`treelet: analysis "${id}" has an unknown blend mode "${String(descriptor.blendMode)}"`);
  }
  descriptors.set(id, descriptor as unknown as AnalysisDescriptor<object>);
  kinds.set(id, nextKind++);
  version++;
  for (const l of listeners) l();
}

export function getAnalysis(id: string): AnalysisDescriptor<object> | undefined {
  return descriptors.get(id);
}

export function listAnalyses(): AnalysisDescriptor<object>[] {
  return Array.from(descriptors.values());
}

/** Shader kind index of a registered analysis. */
export function analysisKind(id: string): number {
  const k = kinds.get(id);
  if (k === undefined) throw new Error(`treelet: unknown analysis "${id}"`);
  return k;
}

/** Bumps whenever a kind is registered (the material must be recompiled). */
export function analysisVersion(): number {
  return version;
}

/** Called after each registration; returns an unsubscribe function. */
export function onAnalysisRegistered(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * GLSL for all registered kinds plus the dispatcher the fragment shader
 * calls. Unknown kinds draw nothing.
 */
export function analysisShaderSource(): string {
  const parts: string[] = [];
  const cases: string[] = [];
  for (const [id, d] of descriptors) {
    parts.push(`// ---- ${id} ----`, d.glsl);
    cases.push(`  if (kind == ${kinds.get(id)}) return analysis_${id}(s, p0, p1);`);
  }
  parts.push(
    'vec4 evalAnalysis(int kind, Surface s, vec4 p0, vec4 p1) {',
    ...cases,
    '  return vec4(0.0);',
    '}',
  );
  return parts.join('\n');
}

// === Parameter helpers ===

function isRGB(v: unknown): v is RGB {
  return Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && Number.isFinite(c));
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Copy of a parameter set; arrays (spans, colors) are copied, so no two layers share one. */
export function copyParams<P extends object>(params: P): P {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) out[k] = Array.isArray(v) ? v.slice() : v;
  return out as P;
}

/** Reduce `v` into [lo, lo + period). */
function wrapInto(v: number, lo: number, period: number): number {
  const r = (v - lo) % period;
  return lo + (r < 0 ? r + period : r);
}

/**
 * Merge user parameters over `base` (default: the descriptor's defaults)
 * into a new object. Values that don't fit the schema are dropped with a
 * warning; numbers outside a parameter's `limits` (default: its slider
 * range) are clamped with a warning. Circular (`wrap`) spans are reduced
 * into one turn instead. Keys without a schema entry pass through
 * unchanged. A null value is accepted only for optional spans.
 */
export function resolveParams<P extends object>(
  descriptor: AnalysisDescriptor<P>, params: Partial<P> | undefined, base?: P,
): P {
  const out = copyParams(base ?? descriptor.defaults) as Record<string, unknown>;
  if (!params) return out as P;
  const specs = new Map<string, ParamSpec>(descriptor.params.map((p) => [p.key, p]));
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const spec = specs.get(key);
    const reject = () => console.warn(`treelet: ignoring invalid value for ${descriptor.id}.${key}:`, value);
    const clamp = (v: number, lo: number, hi: number): number => {
      if (v >= lo && v <= hi) return v;
      const c = Math.max(lo, Math.min(hi, v));
      console.warn(`treelet: ${descriptor.id}.${key} ${v} is outside [${lo}, ${hi}]; using ${c}`);
      return c;
    };
    if (!spec) {
      out[key] = Array.isArray(value) ? value.slice() : value;
    } else if (value === null) {
      if (spec.type === 'span' && spec.optional) out[key] = null;
      else reject();
    } else if (spec.type === 'range') {
      const [lo, hi] = spec.limits ?? [spec.min, spec.max];
      if (isFiniteNumber(value)) out[key] = clamp(value, lo, hi);
      else reject();
    } else if (spec.type === 'span') {
      if (value === 'auto' && spec.auto) out[key] = 'auto';
      else if (Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber)) {
        const [a, b] = value as [number, number];
        if (spec.wrap) {
          // Clockwise from a to b through min/max; a whole turn or more is everything
          const period = spec.max - spec.min;
          out[key] = b - a >= period
            ? [spec.min, spec.max]
            : [wrapInto(a, spec.min, period), wrapInto(b, spec.min, period)];
        } else {
          const [lo, hi] = spec.limits ?? [spec.min, spec.max];
          const ca = clamp(a, lo, hi);
          const cb = clamp(b, lo, hi);
          const low = Math.min(ca, cb);
          const high = Math.max(ca, cb);
          out[key] = high > low ? [low, high] : [low, low + spec.step];
        }
      } else reject();
    } else if (spec.type === 'select') {
      // Option values are strings; a numeric default keeps numbers ('5' → 5).
      const match = spec.options.find((o) => o.value === String(value));
      if (match) out[key] = typeof (descriptor.defaults as Record<string, unknown>)[key] === 'number' ? Number(match.value) : match.value;
      else reject();
    } else if (spec.type === 'color') {
      if (isRGB(value)) out[key] = [value[0], value[1], value[2]];
      else reject();
    } else if (spec.type === 'boolean') {
      if (typeof value === 'boolean') out[key] = value;
      else reject();
    }
  }
  return out as P;
}
