// ============================================================================
// treelet.js - Layer Controller
//
// Owns layer lifecycle: add, remove, activate base/drape/overlay layers.
// Coordinates with DisplayController for material state after layer changes.
//
// Extracted from Treelet to keep the main orchestrator focused on wiring.
// ============================================================================

import type { TerrainRenderer } from '../terrain/TerrainRenderer';
import type { LayerRegistry } from '../layers/LayerRegistry';
import type { BaseLayer } from '../layers/BaseLayer';
import type { DrapeLayer } from '../layers/DrapeLayer';
import type {
  BaseLayerOptions,
  DrapeLayerOptions,
  OverlayLayerOptions,
  LayerHandle,
} from '../layers/types';
import type { BaseDrapeMode, TreeletEventMap } from './types';
import type { DisplayController } from './DisplayController';
import { BASE_DRAPE_ID } from './DisplayController';

/** Callback type for emitting events back to the Treelet EventEmitter. */
type EmitFn = <K extends keyof TreeletEventMap>(event: K, data: TreeletEventMap[K]) => void;

export class LayerController {
  private readonly layerRegistry: LayerRegistry;
  private readonly terrainRenderer: TerrainRenderer;
  private readonly displayController: DisplayController;
  private readonly emitEvent: EmitFn;
  private readonly scheduleTiles: () => void;
  private readonly getIsRunning: () => boolean;

  constructor(
    layerRegistry: LayerRegistry,
    terrainRenderer: TerrainRenderer,
    displayController: DisplayController,
    emitEvent: EmitFn,
    scheduleTiles: () => void,
    getIsRunning: () => boolean,
  ) {
    this.layerRegistry = layerRegistry;
    this.terrainRenderer = terrainRenderer;
    this.displayController = displayController;
    this.emitEvent = emitEvent;
    this.scheduleTiles = scheduleTiles;
    this.getIsRunning = getIsRunning;
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
   * Reload terrain data and re-apply the layer's display settings, but only
   * when the active base layer actually changed — adding an inactive layer
   * must not wipe the atlas.
   */
  private onActiveBaseLayerMaybeChanged(before: BaseLayer | null): void {
    const after = this.layerRegistry.getActiveBaseLayer();
    if (after === before) return;
    this.terrainRenderer.reload();
    this.displayController.applyMaterialState();
    this.scheduleTiles();
  }

  // =========================================================================
  // Drape API (single-drape exclusivity)
  // =========================================================================

  addDrapeLayer(options: DrapeLayerOptions): LayerHandle {
    const handle = this.layerRegistry.addDrapeLayer(options);
    // Start with visible=false; user must explicitly activate
    this.layerRegistry.setDrapeLayerActive(handle, false);
    this.emitEvent('layeradd', { id: handle.id });
    this.emitEvent('layerchange', {});
    return handle;
  }

  removeDrapeLayer(handle: LayerHandle | string): boolean {
    const id = typeof handle === 'string' ? handle : handle.id;
    if (this.layerRegistry.removeDrapeLayer(handle)) {
      if (this.displayController.activeDrapeId === id) {
        this.displayController.activeDrapeId = null;
        this.displayController.clearAllDrapeTextures();
        this.displayController.applyMaterialState();
      }
      this.emitEvent('layerremove', { id });
      this.emitEvent('layerchange', {});
      return true;
    }
    return false;
  }

  /**
   * Activate a specific external drape layer (deactivates all others including BaseDrape).
   */
  activateDrapeLayer(handle: LayerHandle | string): void {
    const id = typeof handle === 'string' ? handle : handle.id;
    const drapeLayer = this.layerRegistry.getDrapeLayer(id);
    if (!drapeLayer) {
      console.warn(`treelet: drape layer "${id}" not found`);
      return;
    }

    // Deactivate all external drapes first
    this.deactivateAllDrapes();

    this.layerRegistry.setDrapeLayerActive(id, true);
    this.displayController.activeDrapeId = id;

    // Bind drape atlas to terrain renderer and start fetching tiles
    this.terrainRenderer.setActiveDrape(drapeLayer, drapeLayer.display.opacity);

    // Apply blend mode from layer display config
    this.terrainRenderer.setDrapeBlendMode(drapeLayer.display.blendMode);
    this.terrainRenderer.setHillshadeStrength(drapeLayer.display.hillshadeStrength);

    // Apply material state for texture mode
    this.displayController.applyMaterialState();

    // Render (and with it schedule drape fetches) on the next frame
    this.scheduleTiles();
    this.emitEvent('layerchange', {});
  }

  /**
   * Activate the virtual BaseDrape (elevation/slope/aspect coloring).
   */
  activateBaseDrape(mode?: BaseDrapeMode): void {
    if (mode) {
      // Directly set baseDrapeMode through DisplayController
      this.displayController.setBaseDrapeMode(mode, () => this.deactivateAllDrapes());
    } else {
      // Just switch to BaseDrape without changing mode
      this.deactivateAllDrapes();
      this.displayController.activeDrapeId = BASE_DRAPE_ID;
      this.displayController.clearAllDrapeTextures();
      this.displayController.applyMaterialState();
    }
    this.emitEvent('layerchange', {});
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

  // =========================================================================
  // Internal
  // =========================================================================

  /**
   * Deactivate all external drape layers.
   * Used when switching to BaseDrape or when activating a different drape.
   */
  deactivateAllDrapes(): void {
    for (const drape of this.layerRegistry.getAllDrapeLayers()) {
      drape.visible = false;
    }
  }
}
