// ============================================================================
// treelet.js - Layer Controller
//
// Owns layer lifecycle: add, remove and activate base, drape, analysis and
// overlay layers, and the coat stack's order. Coordinates with
// DisplayController for material state after layer changes.
//
// Extracted from Treelet to keep the main orchestrator focused on wiring.
// ============================================================================

import type { TerrainRenderer } from '../terrain/TerrainRenderer';
import type { LayerRegistry, StackLayer } from '../layers/LayerRegistry';
import type { BaseLayer } from '../layers/BaseLayer';
import type { DrapeLayer } from '../layers/DrapeLayer';
import type { AnalysisLayer } from '../layers/AnalysisLayer';
import type {
  BaseLayerOptions,
  DrapeLayerOptions,
  AnalysisLayerOptions,
  OverlayLayerOptions,
  LayerHandle,
} from '../layers/types';
import type { TreeletEventMap } from './types';
import type { DisplayController } from './DisplayController';

/** Callback type for emitting events back to the Treelet EventEmitter. */
type EmitFn = <K extends keyof TreeletEventMap>(event: K, data: TreeletEventMap[K]) => void;

export class LayerController {
  private readonly layerRegistry: LayerRegistry;
  private readonly terrainRenderer: TerrainRenderer;
  private readonly displayController: DisplayController;
  private readonly emitEvent: EmitFn;
  private readonly scheduleTiles: () => void;

  constructor(
    layerRegistry: LayerRegistry,
    terrainRenderer: TerrainRenderer,
    displayController: DisplayController,
    emitEvent: EmitFn,
    scheduleTiles: () => void,
  ) {
    this.layerRegistry = layerRegistry;
    this.terrainRenderer = terrainRenderer;
    this.displayController = displayController;
    this.emitEvent = emitEvent;
    this.scheduleTiles = scheduleTiles;
  }

  // =========================================================================
  // Base Layer API
  // =========================================================================

  addBaseLayer(options: BaseLayerOptions): LayerHandle {
    const before = this.layerRegistry.getActiveBaseLayer();
    const handle = this.layerRegistry.addBaseLayer(options);
    this.emitEvent('layeradd', { id: handle.id });
    this.onActiveBaseLayerMaybeChanged(before);
    this.emitEvent('layerchange', {});
    return handle;
  }

  removeBaseLayer(handle: LayerHandle | string): boolean {
    const id = typeof handle === 'string' ? handle : handle.id;
    const before = this.layerRegistry.getActiveBaseLayer();
    if (this.layerRegistry.removeBaseLayer(handle)) {
      this.emitEvent('layerremove', { id });
      this.onActiveBaseLayerMaybeChanged(before);
      this.emitEvent('layerchange', {});
      return true;
    }
    return false;
  }

  setActiveBaseLayer(handle: LayerHandle | string): void {
    const before = this.layerRegistry.getActiveBaseLayer();
    this.layerRegistry.setActiveBaseLayer(handle);
    this.onActiveBaseLayerMaybeChanged(before);
    this.emitEvent('layerchange', {});
  }

  /**
   * Reload terrain data when the active base layer actually changed —
   * adding an inactive layer must not wipe the atlas.
   */
  private onActiveBaseLayerMaybeChanged(before: BaseLayer | null): void {
    const after = this.layerRegistry.getActiveBaseLayer();
    if (after === before) return;
    this.terrainRenderer.reload();
    this.displayController.applyMaterialState();
    this.scheduleTiles();
  }

  // =========================================================================
  // Drape API (single active drape = the imagery coat)
  // =========================================================================

  addDrapeLayer(options: DrapeLayerOptions): LayerHandle {
    const handle = this.layerRegistry.addDrapeLayer(options);
    this.emitEvent('layeradd', { id: handle.id });
    this.emitEvent('layerchange', {});
    return handle;
  }

  removeDrapeLayer(handle: LayerHandle | string): boolean {
    const id = typeof handle === 'string' ? handle : handle.id;
    const wasActive = this.layerRegistry.getActiveDrapeId() === id;
    if (this.layerRegistry.removeDrapeLayer(handle)) {
      if (wasActive) {
        this.terrainRenderer.clearDrapes();
        this.displayController.applyMaterialState();
      }
      this.emitEvent('layerremove', { id });
      this.emitEvent('layerchange', {});
      return true;
    }
    return false;
  }

  /** Make a drape layer the imagery coat (replacing the active one). */
  activateDrapeLayer(handle: LayerHandle | string): void {
    const id = typeof handle === 'string' ? handle : handle.id;
    const drapeLayer = this.layerRegistry.getDrapeLayer(id);
    if (!drapeLayer) {
      console.warn(`treelet: drape layer "${id}" not found`);
      return;
    }
    if (this.layerRegistry.getActiveDrapeId() === id) {
      if (!drapeLayer.visible) this.displayController.setLayerVisible(id, true);
      return;
    }

    this.layerRegistry.setActiveDrape(id);

    // Bind drape atlas to terrain renderer and start fetching tiles
    this.terrainRenderer.setActiveDrape(drapeLayer);
    this.displayController.applyMaterialState();

    // Render (and with it schedule drape fetches) on the next frame
    this.scheduleTiles();
    this.emitEvent('layerchange', {});
  }

  /** Remove the imagery coat (keeps the drape layer registered). */
  deactivateDrapeLayer(): void {
    if (this.layerRegistry.getActiveDrapeId() === null) return;
    this.layerRegistry.setActiveDrape(null);
    this.terrainRenderer.clearDrapes();
    this.displayController.applyMaterialState();
    this.emitEvent('layerchange', {});
  }

  // =========================================================================
  // Analysis Layer API
  // =========================================================================

  addAnalysisLayer<P extends object>(options: AnalysisLayerOptions<P>): LayerHandle {
    const handle = this.layerRegistry.addAnalysisLayer(options);
    this.displayController.applyMaterialState();
    this.emitEvent('layeradd', { id: handle.id });
    this.emitEvent('layerchange', {});
    return handle;
  }

  removeAnalysisLayer(handle: LayerHandle | string): boolean {
    const id = typeof handle === 'string' ? handle : handle.id;
    if (!this.layerRegistry.removeAnalysisLayer(handle)) return false;
    this.displayController.applyMaterialState();
    this.emitEvent('layerremove', { id });
    this.emitEvent('layerchange', {});
    return true;
  }

  /** Move a coat within the stack (0 = bottom). */
  moveLayer(handle: LayerHandle | string, index: number): boolean {
    if (!this.layerRegistry.moveLayer(handle, index)) return false;
    this.displayController.applyMaterialState();
    this.emitEvent('layerchange', {});
    return true;
  }

  // =========================================================================
  // Overlay Layer API (stub)
  // =========================================================================

  addOverlayLayer(options: OverlayLayerOptions): LayerHandle {
    const handle = this.layerRegistry.addOverlayLayer(options);
    this.emitEvent('layeradd', { id: handle.id });
    this.emitEvent('layerchange', {});
    return handle;
  }

  removeOverlayLayer(handle: LayerHandle | string): boolean {
    const id = typeof handle === 'string' ? handle : handle.id;
    if (this.layerRegistry.removeOverlayLayer(handle)) {
      this.emitEvent('layerremove', { id });
      this.emitEvent('layerchange', {});
      return true;
    }
    return false;
  }

  // =========================================================================
  // Layer Queries
  // =========================================================================

  getBaseLayers(): BaseLayer[] {
    return this.layerRegistry.getAllBaseLayers();
  }

  getDrapeLayers(): DrapeLayer[] {
    return this.layerRegistry.getAllDrapeLayers();
  }

  getAnalysisLayers(): AnalysisLayer[] {
    return this.layerRegistry.getAllAnalysisLayers();
  }

  getLayerStack(): StackLayer[] {
    return this.layerRegistry.getStack();
  }
}
