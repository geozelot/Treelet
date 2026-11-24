// ============================================================================
// treelet.js - Layer Registry
//
// Manages registered base, drape, analysis and overlay layers, and the
// coat stack: the order in which the active drape (imagery) and the
// analysis layers are drawn over the terrain, bottom first.
// Only one base layer is active at a time (radio selection); likewise one
// drape at a time, so imagery is a single coat.
// ============================================================================

import type {
  BaseLayerOptions,
  DrapeLayerOptions,
  AnalysisLayerOptions,
  OverlayLayerOptions,
  LayerHandle,
} from './types';
import { BaseLayer } from './BaseLayer';
import { DrapeLayer } from './DrapeLayer';
import { AnalysisLayer } from './AnalysisLayer';
import { OverlayLayer } from './OverlayLayer';

/** A member of the coat stack. */
export type StackLayer = DrapeLayer | AnalysisLayer;

function idOf(handle: LayerHandle | string): string {
  return typeof handle === 'string' ? handle : handle.id;
}

/**
 * Central registry for all map layers.
 *
 * Base layers: only one active at a time (provides elevation data).
 * Drape layers: many registered, one active (the imagery coat).
 * Analysis layers: any number, each a coat in the stack.
 * Overlay layers: stub for future vector overlays.
 */
export class LayerRegistry {
  private baseLayers = new Map<string, BaseLayer>();
  private drapeLayers = new Map<string, DrapeLayer>();
  private analysisLayers = new Map<string, AnalysisLayer>();
  private overlayLayers = new Map<string, OverlayLayer>();
  private activeBaseLayerId: string | null = null;
  private activeDrapeId: string | null = null;
  /** Coat order, bottom first: analysis layer ids and the active drape id. */
  private stack: string[] = [];

  // =========================================================================
  // Base Layers
  // =========================================================================

  addBaseLayer(options: BaseLayerOptions): LayerHandle {
    const layer = new BaseLayer(options);

    if (this.baseLayers.has(layer.id)) {
      throw new Error(`treelet: base layer "${layer.id}" already registered`);
    }

    this.baseLayers.set(layer.id, layer);

    // The first layer becomes active; later ones only when explicitly asked
    // (layerDisplay.visible: true), so adding a layer never silently swaps
    // the terrain out from under the user.
    if (this.activeBaseLayerId === null || options.layerDisplay?.visible === true) {
      this.setActiveBaseLayer(layer.id);
    } else {
      layer.visible = false;
    }

    return { id: layer.id, layerName: layer.layerName };
  }

  removeBaseLayer(handle: LayerHandle | string): boolean {
    const id = idOf(handle);
    const layer = this.baseLayers.get(id);
    if (!layer) return false;

    this.baseLayers.delete(id);

    if (this.activeBaseLayerId === id) {
      const firstRemaining = this.baseLayers.keys().next().value;
      this.activeBaseLayerId = firstRemaining ?? null;
      if (this.activeBaseLayerId) {
        this.baseLayers.get(this.activeBaseLayerId)!.visible = true;
      }
    }

    return true;
  }

  setActiveBaseLayer(handle: LayerHandle | string): void {
    const id = idOf(handle);

    if (!this.baseLayers.has(id)) {
      throw new Error(`treelet: base layer "${id}" not found`);
    }

    for (const layer of this.baseLayers.values()) {
      layer.visible = false;
    }

    this.activeBaseLayerId = id;
    this.baseLayers.get(id)!.visible = true;
  }

  getActiveBaseLayer(): BaseLayer | null {
    if (!this.activeBaseLayerId) return null;
    return this.baseLayers.get(this.activeBaseLayerId) ?? null;
  }

  getBaseLayer(handle: LayerHandle | string): BaseLayer | undefined {
    return this.baseLayers.get(idOf(handle));
  }

  getAllBaseLayers(): BaseLayer[] {
    return Array.from(this.baseLayers.values());
  }

  hasBaseLayers(): boolean {
    return this.baseLayers.size > 0;
  }

  // =========================================================================
  // Drape Layers
  // =========================================================================

  addDrapeLayer(options: DrapeLayerOptions): LayerHandle {
    const layer = new DrapeLayer(options);

    if (this.drapeLayers.has(layer.id)) {
      throw new Error(`treelet: drape layer "${layer.id}" already registered`);
    }

    this.drapeLayers.set(layer.id, layer);
    layer.visible = false;
    return { id: layer.id, layerName: layer.layerName };
  }

  removeDrapeLayer(handle: LayerHandle | string): boolean {
    const id = idOf(handle);
    if (!this.drapeLayers.has(id)) return false;
    if (this.activeDrapeId === id) this.setActiveDrape(null);
    this.drapeLayers.delete(id);
    return true;
  }

  getDrapeLayer(handle: LayerHandle | string): DrapeLayer | undefined {
    return this.drapeLayers.get(idOf(handle));
  }

  getAllDrapeLayers(): DrapeLayer[] {
    return Array.from(this.drapeLayers.values());
  }

  /**
   * Make a drape the imagery coat (or none). A new drape takes the place
   * of the previous one in the stack; the first one goes to the bottom.
   */
  setActiveDrape(handle: LayerHandle | string | null): void {
    const id = handle === null ? null : idOf(handle);
    if (id !== null && !this.drapeLayers.has(id)) {
      throw new Error(`treelet: drape layer "${id}" not found`);
    }
    if (id === this.activeDrapeId) return;
    const previous = this.activeDrapeId;
    for (const layer of this.drapeLayers.values()) layer.visible = false;
    const at = previous === null ? -1 : this.stack.indexOf(previous);
    if (at >= 0) this.stack.splice(at, 1);
    if (id !== null) {
      this.stack.splice(at >= 0 ? at : 0, 0, id);
      this.drapeLayers.get(id)!.visible = true;
    }
    this.activeDrapeId = id;
  }

  getActiveDrapeId(): string | null {
    return this.activeDrapeId;
  }

  getActiveDrape(): DrapeLayer | null {
    return this.activeDrapeId === null ? null : this.drapeLayers.get(this.activeDrapeId) ?? null;
  }

  hasDrapeLayers(): boolean {
    return this.drapeLayers.size > 0;
  }

  // =========================================================================
  // Analysis Layers
  // =========================================================================

  /**
   * Add an analysis layer. Value kinds (those with a ramp: elevation, slope…)
   * color the ground and go in just above the imagery and the other value
   * coats; color kinds (contours, hillshade) go on top, so a fresh stack
   * reads [imagery, values…, lines and light] without reordering.
   */
  addAnalysisLayer<P extends object>(options: AnalysisLayerOptions<P>): LayerHandle {
    const layer = new AnalysisLayer(options);
    this.analysisLayers.set(layer.id, layer as unknown as AnalysisLayer);
    if (layer.isValueKind) {
      let at = 0;
      for (let i = 0; i < this.stack.length; i++) {
        const l = this.getStackLayer(this.stack[i]);
        if (l && (!('descriptor' in l) || l.isValueKind)) at = i + 1;
        else break;
      }
      this.stack.splice(at, 0, layer.id);
    } else {
      this.stack.push(layer.id);
    }
    return { id: layer.id, layerName: layer.layerName };
  }

  removeAnalysisLayer(handle: LayerHandle | string): boolean {
    const id = idOf(handle);
    if (!this.analysisLayers.delete(id)) return false;
    const at = this.stack.indexOf(id);
    if (at >= 0) this.stack.splice(at, 1);
    return true;
  }

  getAnalysisLayer(handle: LayerHandle | string): AnalysisLayer | undefined {
    return this.analysisLayers.get(idOf(handle));
  }

  getAllAnalysisLayers(): AnalysisLayer[] {
    return Array.from(this.analysisLayers.values());
  }

  // =========================================================================
  // Coat stack
  // =========================================================================

  /** A stack member (the active drape or an analysis layer) by id. */
  getStackLayer(handle: LayerHandle | string): StackLayer | undefined {
    const id = idOf(handle);
    return this.analysisLayers.get(id) ?? (id === this.activeDrapeId ? this.drapeLayers.get(id) : undefined);
  }

  /** The coats in drawing order, bottom first. */
  getStack(): StackLayer[] {
    const out: StackLayer[] = [];
    for (const id of this.stack) {
      const layer = this.getStackLayer(id);
      if (layer) out.push(layer);
    }
    return out;
  }

  /**
   * Move a coat to `index` (0 = bottom; clamped). Returns false when the
   * layer is not in the stack.
   */
  moveLayer(handle: LayerHandle | string, index: number): boolean {
    const id = idOf(handle);
    const from = this.stack.indexOf(id);
    if (from < 0) return false;
    const to = Math.max(0, Math.min(this.stack.length - 1, Math.round(index)));
    if (to === from) return true;
    this.stack.splice(from, 1);
    this.stack.splice(to, 0, id);
    return true;
  }

  // =========================================================================
  // Overlay Layers (stub)
  // =========================================================================

  addOverlayLayer(options: OverlayLayerOptions): LayerHandle {
    const layer = new OverlayLayer(options);

    if (this.overlayLayers.has(layer.id)) {
      throw new Error(`treelet: overlay layer "${layer.id}" already registered`);
    }

    this.overlayLayers.set(layer.id, layer);
    return { id: layer.id, layerName: layer.layerName };
  }

  removeOverlayLayer(handle: LayerHandle | string): boolean {
    const id = idOf(handle);
    const layer = this.overlayLayers.get(id);
    if (!layer) return false;

    this.overlayLayers.delete(id);
    return true;
  }

  getOverlayLayer(handle: LayerHandle | string): OverlayLayer | undefined {
    return this.overlayLayers.get(idOf(handle));
  }

  getAllOverlayLayers(): OverlayLayer[] {
    return Array.from(this.overlayLayers.values());
  }

  // =========================================================================
  // Attribution (collects from all layers)
  // =========================================================================

  getAllAttributions(): string[] {
    const attributions: string[] = [];
    const seen = new Set<string>();

    const collect = (attr: string) => {
      if (attr && !seen.has(attr)) {
        seen.add(attr);
        attributions.push(attr);
      }
    };

    for (const layer of this.baseLayers.values()) collect(layer.attribution);
    for (const layer of this.drapeLayers.values()) collect(layer.attribution);
    for (const layer of this.overlayLayers.values()) collect(layer.attribution);

    return attributions;
  }
}
