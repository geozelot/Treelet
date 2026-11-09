// ============================================================================
// treelet.js - Analysis Layer
//
// One coat of a registered analysis kind: its parameters, ramp and display
// state. Several layers of the same kind can coexist in the stack.
// ============================================================================

import type { Layer } from './Layer';
import type { AnalysisLayerOptions, ResolvedAnalysisLayerDisplay } from './types';
import type { AnalysisDescriptor, Ramp } from '../analysis/types';
import { getAnalysis, resolveParams } from '../analysis/registry';
import { resolveRamp } from '../analysis/ramps';

/** Auto-incrementing ID counter for analysis layers. */
let nextAnalysisLayerId = 0;

export class AnalysisLayer<P extends object = Record<string, unknown>> implements Layer {
  readonly id: string;
  readonly layerName: string;
  readonly attribution = '';
  readonly minZoom: number;
  readonly maxZoom: number;

  readonly descriptor: AnalysisDescriptor<P>;
  /** Current parameters (resolved against the descriptor's defaults). */
  params: P;
  /** Current ramp (value kinds), a built-in name or a spec. */
  ramp: Ramp | undefined;
  /** Per-layer display settings. */
  readonly display: ResolvedAnalysisLayerDisplay;

  /** Whether this coat is drawn. */
  visible: boolean;

  constructor(options: AnalysisLayerOptions<P>) {
    const descriptor = getAnalysis(options.analysis) as AnalysisDescriptor<P> | undefined;
    if (!descriptor) {
      throw new Error(`treelet: unknown analysis "${options.analysis}" (register it with registerAnalysis)`);
    }
    this.descriptor = descriptor;
    this.id = `analysis-${nextAnalysisLayerId++}`;
    this.layerName = options.layerName ?? descriptor.label;
    this.minZoom = options.minZoom ?? 0;
    this.maxZoom = options.maxZoom ?? 22;
    this.params = resolveParams(descriptor, options.params);
    if (options.ramp !== undefined) resolveRamp(options.ramp); // validates
    this.ramp = options.ramp ?? descriptor.ramp;

    const ld = options.layerDisplay;
    this.display = {
      visible: ld?.visible ?? true,
      opacity: Math.max(0, Math.min(1, ld?.opacity ?? descriptor.opacity ?? 1)),
      blendMode: ld?.blendMode ?? descriptor.blendMode ?? 'normal',
    };
    this.visible = this.display.visible;
  }

  /** True for kinds whose value a ramp colors (and that have a legend). */
  get isValueKind(): boolean {
    return this.descriptor.ramp !== undefined;
  }

  /** Merge parameters over the current ones (validated against the schema). */
  setParams(params: Partial<P>): void {
    this.params = resolveParams(this.descriptor, params, this.params);
  }
}
