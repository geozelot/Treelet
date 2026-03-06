// ============================================================================
// treelet.js - Layer Registry
//
// Manages registered base and drape layers. Only one base layer is
// active at a time (radio selection). The registry supports multiple
// active drape layers, but Treelet enforces single-drape exclusivity.
// ============================================================================

import type { BaseLayerOptions, DrapeLayerOptions } from '../core/types';
import { BaseLayer } from './base/BaseLayer';
import { DrapeLayer } from './drape/DrapeLayer';

/**
 * Central registry for all map layers.
 *
 * Base layers: only one active at a time (provides elevation data).
 * Drape layers: registry allows multiple active; Treelet enforces one at a time.
 */
export class LayerRegistry {
  private baseLayers = new Map<string, BaseLayer>();
  private drapeLayers = new Map<string, DrapeLayer>();
  private activeBaseLayerId: string | null = null;

  // =========================================================================
  // Base Layers
  // =========================================================================

  addBaseLayer(options: BaseLayerOptions): BaseLayer {
    if (this.baseLayers.has(options.id)) {
      throw new Error(`treelet: base layer "${options.id}" already registered`);
    }

    const layer = new BaseLayer(options);
    this.baseLayers.set(layer.id, layer);

    if (this.activeBaseLayerId === null || layer.active) {
      this.setActiveBaseLayer(layer.id);
    }

    return layer;
  }

  removeBaseLayer(id: string): boolean {
    const layer = this.baseLayers.get(id);
    if (!layer) return false;

    this.baseLayers.delete(id);

    if (this.activeBaseLayerId === id) {
      const firstRemaining = this.baseLayers.keys().next().value;
      this.activeBaseLayerId = firstRemaining ?? null;
      if (this.activeBaseLayerId) {
        this.baseLayers.get(this.activeBaseLayerId)!.active = true;
      }
    }

    return true;
  }

  setActiveBaseLayer(id: string): void {
    if (!this.baseLayers.has(id)) {
      throw new Error(`treelet: base layer "${id}" not found`);
    }

    for (const layer of this.baseLayers.values()) {
      layer.active = false;
    }

    this.activeBaseLayerId = id;
    this.baseLayers.get(id)!.active = true;
  }

  getActiveBaseLayer(): BaseLayer | null {
    if (!this.activeBaseLayerId) return null;
    return this.baseLayers.get(this.activeBaseLayerId) ?? null;
  }

  getBaseLayer(id: string): BaseLayer | undefined {
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

  addDrapeLayer(options: DrapeLayerOptions): DrapeLayer {
    if (this.drapeLayers.has(options.id)) {
      throw new Error(`treelet: drape layer "${options.id}" already registered`);
    }

    const layer = new DrapeLayer(options);
    this.drapeLayers.set(layer.id, layer);
    return layer;
  }

  removeDrapeLayer(id: string): boolean {
    const layer = this.drapeLayers.get(id);
    if (!layer) return false;

    layer.dispose();
    this.drapeLayers.delete(id);
    return true;
  }

  getDrapeLayer(id: string): DrapeLayer | undefined {
    return this.drapeLayers.get(id);
  }

  getActiveDrapeLayers(): DrapeLayer[] {
    return Array.from(this.drapeLayers.values()).filter((l) => l.active);
  }

  getAllDrapeLayers(): DrapeLayer[] {
    return Array.from(this.drapeLayers.values());
  }

  setDrapeLayerActive(id: string, active: boolean): void {
    const layer = this.drapeLayers.get(id);
    if (layer) {
      layer.active = active;
    }
  }

  hasDrapeLayers(): boolean {
    return this.drapeLayers.size > 0;
  }
}
