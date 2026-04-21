// ============================================================================
// treelet.js - Layer Registry
//
// Manages registered base, drape, and overlay layers.
// Only one base layer is active at a time (radio selection).
// Drape exclusivity is enforced by Treelet (single drape at a time).
// ============================================================================

import type {
  BaseLayerOptions,
  DrapeLayerOptions,
  OverlayLayerOptions,
  LayerHandle,
} from './types';
import { BaseLayer } from './BaseLayer';
import { DrapeLayer } from './DrapeLayer';
import { OverlayLayer } from './OverlayLayer';

/**
 * Central registry for all map layers.
 *
 * Base layers: only one active at a time (provides elevation data).
 * Drape layers: registry allows multiple; Treelet enforces one at a time.
 * Overlay layers: stub for future vector overlays.
 */
export class LayerRegistry {
  private baseLayers = new Map<string, BaseLayer>();
  private drapeLayers = new Map<string, DrapeLayer>();
  private overlayLayers = new Map<string, OverlayLayer>();
  private activeBaseLayerId: string | null = null;

  // =========================================================================
  // Base Layers
  // =========================================================================

  addBaseLayer(options: BaseLayerOptions): LayerHandle {
    const layer = new BaseLayer(options);

    if (this.baseLayers.has(layer.id)) {
      throw new Error(`treelet: base layer "${layer.id}" already registered`);
    }

    this.baseLayers.set(layer.id, layer);

    if (this.activeBaseLayerId === null || layer.visible) {
      this.setActiveBaseLayer(layer.id);
    }

    return { id: layer.id, layerName: layer.layerName };
  }

  removeBaseLayer(handle: LayerHandle | string): boolean {
    const id = typeof handle === 'string' ? handle : handle.id;
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
    const id = typeof handle === 'string' ? handle : handle.id;

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
    const id = typeof handle === 'string' ? handle : handle.id;
    return this.baseLayers.get(id);
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
    return { id: layer.id, layerName: layer.layerName };
  }

  removeDrapeLayer(handle: LayerHandle | string): boolean {
    const id = typeof handle === 'string' ? handle : handle.id;
    if (!this.drapeLayers.has(id)) return false;
    this.drapeLayers.delete(id);
    return true;
  }

  getDrapeLayer(handle: LayerHandle | string): DrapeLayer | undefined {
    const id = typeof handle === 'string' ? handle : handle.id;
    return this.drapeLayers.get(id);
  }

  getAllDrapeLayers(): DrapeLayer[] {
    return Array.from(this.drapeLayers.values());
  }

  setDrapeLayerActive(handle: LayerHandle | string, active: boolean): void {
    const id = typeof handle === 'string' ? handle : handle.id;
    const layer = this.drapeLayers.get(id);
    if (layer) {
      layer.visible = active;
    }
  }

  hasDrapeLayers(): boolean {
    return this.drapeLayers.size > 0;
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
    const id = typeof handle === 'string' ? handle : handle.id;
    const layer = this.overlayLayers.get(id);
    if (!layer) return false;

    this.overlayLayers.delete(id);
    return true;
  }

  getOverlayLayer(handle: LayerHandle | string): OverlayLayer | undefined {
    const id = typeof handle === 'string' ? handle : handle.id;
    return this.overlayLayers.get(id);
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
