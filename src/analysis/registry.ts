// ============================================================================
// treelet.js - Analysis Registry
//
// Registered kinds are compiled into the terrain fragment shader: each
// contributes its `analysis_<id>` function and a case in `evalAnalysis`.
// Built-ins register on import; `registerAnalysis` adds more at runtime
// (the material is rebuilt once).
// ============================================================================

import type { AnalysisDescriptor, ParamSpec, RGB } from './types';
import { validateRamp } from './ramps';

/** Kind index of the imagery coat (the active drape); analyses start at 1. */
export const IMAGERY_KIND = 0;

/** Coats the shader evaluates per fragment; more are ignored with a warning. */
export const MAX_COATS = 6;

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
  if (descriptor.ramp && typeof descriptor.ramp !== 'string') validateRamp(descriptor.ramp);
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

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Merge user parameters over the descriptor's defaults, dropping values
 * that don't fit the schema (with a warning), clamping numbers to their
 * slider range. Keys without a schema entry pass through unchanged.
 */
export function resolveParams<P extends object>(
  descriptor: AnalysisDescriptor<P>, params: Partial<P> | undefined, base?: P,
): P {
  const out = { ...(base ?? descriptor.defaults) } as Record<string, unknown>;
  if (!params) return out as P;
  const specs = new Map<string, ParamSpec>(descriptor.params.map((p) => [p.key, p]));
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const spec = specs.get(key);
    const reject = () => console.warn(`treelet: ignoring invalid value for ${descriptor.id}.${key}:`, value);
    if (!spec) {
      out[key] = value;
    } else if (spec.type === 'range') {
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = clampNum(value, spec.min, spec.max);
      else reject();
    } else if (spec.type === 'span') {
      if (value === 'auto' && spec.auto) out[key] = 'auto';
      else if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'number' && Number.isFinite(v))) {
        const a = clampNum(value[0], spec.min, spec.max);
        const b = clampNum(value[1], spec.min, spec.max);
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        out[key] = hi > lo ? [lo, hi] : [lo, lo + spec.step];
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
