// ============================================================================
// treelet.js - Display Controller
//
// Owns the visual state and its mutations: the coat stack's display
// (visibility, opacity, blend, analysis parameters and ramps), sun
// direction, exaggeration, wireframe, pitch. Turns the registry's stack
// into the coats the terrain renderer draws.
//
// Extracted from Treelet to keep the main orchestrator focused on wiring.
// ============================================================================

import { Vector3 } from 'three';
import type { TerrainRenderer } from '../terrain/TerrainRenderer';
import type { LayerRegistry, StackLayer } from '../layers/LayerRegistry';
import type { DrapeLayer } from '../layers/DrapeLayer';
import type { SceneManager } from '../scene/SceneManager';
import type { BaseLayer } from '../layers/BaseLayer';
import type { AnalysisLayer } from '../layers/AnalysisLayer';
import type { ResolvedTreeletOptions } from './types';
import type { LayerHandle } from '../layers/types';
import type { CoatBlendMode, LegendSpec, Ramp } from '../analysis/types';
import { IMAGERY_KIND, analysisKind, copyParams, isBlendMode } from '../analysis/registry';
import { resolveRamp, legendFor, RAMP_PRESET_FOR, isRampName } from '../analysis/ramps';
import type { CoatInput } from '../terrain/CoatStack';

/**
 * Whether `ramp` suits an analysis kind: class presets made for one kind
 * (avalanche → slope…) are refused for the others, with a warning.
 */
export function rampSuits(ramp: Ramp, analysisId: string): boolean {
  if (!isRampName(ramp)) return true;
  const only = RAMP_PRESET_FOR[ramp];
  if (only === undefined || only === analysisId) return true;
  console.warn(`treelet: ramp "${ramp}" is made for "${only}" layers, not "${analysisId}"`);
  return false;
}

export class DisplayController {
  private readonly terrainRenderer: TerrainRenderer;
  private readonly layerRegistry: LayerRegistry;
  private readonly sceneManager: SceneManager;
  private readonly options: ResolvedTreeletOptions;

  private _wireframe = false;
  /** Whether wireframe renders flat white (true) or the coats (false). */
  private _wireframeWhite = false;

  /** Sun azimuth in degrees (0–360, clockwise from north). Default 315° (north-west),
   *  the cartographic convention that avoids the relief-inversion illusion. */
  private _sunAzimuth = 315;

  /** Sun altitude in degrees above the horizon (5–90). 90° = straight down. */
  private _sunAltitude = 45;

  /** The manual sun (setSunAzimuth / setSunAltitude), restored when a sun time is cleared. */
  private _manualAzimuth = 315;
  private _manualAltitude = 45;

  /** Reusable Vector3 for sun direction computation. */
  private readonly _sunDir = new Vector3();

  constructor(
    terrainRenderer: TerrainRenderer,
    layerRegistry: LayerRegistry,
    sceneManager: SceneManager,
    options: ResolvedTreeletOptions,
  ) {
    this.terrainRenderer = terrainRenderer;
    this.layerRegistry = layerRegistry;
    this.sceneManager = sceneManager;
    this.options = options;
  }

  // =========================================================================
  // Coat stack display
  // =========================================================================

  private stackLayer(handle: LayerHandle | string): StackLayer | null {
    const layer = this.layerRegistry.getStackLayer(handle);
    if (!layer) {
      console.warn(`treelet: layer "${typeof handle === 'string' ? handle : handle.id}" is not in the coat stack`);
      return null;
    }
    return layer;
  }

  /** A layer with coat display settings: an analysis layer or any drape (active or not). */
  private displayLayer(handle: LayerHandle | string): AnalysisLayer | DrapeLayer | undefined {
    return this.layerRegistry.getAnalysisLayer(handle) ?? this.layerRegistry.getDrapeLayer(handle);
  }

  private analysisLayer(handle: LayerHandle | string): AnalysisLayer | null {
    const layer = this.layerRegistry.getAnalysisLayer(handle);
    if (!layer) {
      console.warn(`treelet: analysis layer "${typeof handle === 'string' ? handle : handle.id}" not found`);
      return null;
    }
    return layer;
  }

  /** Show or hide a coat (the active drape or an analysis layer). */
  setLayerVisible(handle: LayerHandle | string, visible: boolean): boolean {
    const layer = this.stackLayer(handle);
    if (!layer || layer.visible === visible) return false;
    layer.visible = visible;
    this.applyMaterialState();
    return true;
  }

  /**
   * Opacity of a coat: an analysis layer or a drape (an inactive drape
   * keeps it for when it becomes the imagery coat). Returns false when
   * nothing changed.
   */
  setLayerOpacity(handle: LayerHandle | string, opacity: number): boolean {
    if (!Number.isFinite(opacity)) return false;
    const layer = this.displayLayer(handle);
    if (!layer) {
      console.warn(`treelet: layer "${typeof handle === 'string' ? handle : handle.id}" has no coat opacity`);
      return false;
    }
    const value = Math.max(0, Math.min(1, opacity));
    if (layer.display.opacity === value) return false;
    (layer.display as { opacity: number }).opacity = value;
    this.applyMaterialState();
    return true;
  }

  getLayerOpacity(handle: LayerHandle | string): number {
    return this.displayLayer(handle)?.display.opacity ?? 1;
  }

  /** Blend mode of a coat (analysis layer or drape, active or not). Returns false when nothing changed. */
  setLayerBlendMode(handle: LayerHandle | string, mode: CoatBlendMode): boolean {
    if (!isBlendMode(mode)) {
      console.warn(`treelet: unknown blend mode "${String(mode)}"`);
      return false;
    }
    const layer = this.displayLayer(handle);
    if (!layer) {
      console.warn(`treelet: layer "${typeof handle === 'string' ? handle : handle.id}" has no coat blend mode`);
      return false;
    }
    if (layer.display.blendMode === mode) return false;
    (layer.display as { blendMode: CoatBlendMode }).blendMode = mode;
    this.applyMaterialState();
    return true;
  }

  getLayerBlendMode(handle: LayerHandle | string): CoatBlendMode {
    return this.displayLayer(handle)?.display.blendMode ?? 'normal';
  }

  setAnalysisParams(handle: LayerHandle | string, params: object): boolean {
    const layer = this.analysisLayer(handle);
    if (!layer) return false;
    layer.setParams(params);
    this.applyMaterialState();
    return true;
  }

  /** A copy of an analysis layer's parameters (changing it changes nothing). */
  getAnalysisParams(handle: LayerHandle | string): Record<string, unknown> | null {
    const layer = this.layerRegistry.getAnalysisLayer(handle);
    return layer ? copyParams(layer.params as Record<string, unknown>) : null;
  }

  setAnalysisRamp(handle: LayerHandle | string, ramp: Ramp): boolean {
    const layer = this.analysisLayer(handle);
    if (!layer) return false;
    resolveRamp(ramp); // validates (throws)
    if (!rampSuits(ramp, layer.descriptor.id)) return false;
    layer.ramp = ramp;
    this.applyMaterialState();
    return true;
  }

  getAnalysisRamp(handle: LayerHandle | string): Ramp | undefined {
    return this.layerRegistry.getAnalysisLayer(handle)?.ramp;
  }

  // =========================================================================
  // Legends
  // =========================================================================

  /** Value domain of an analysis layer's ramp, for the current visible elevation range. */
  getAnalysisDomain(layer: AnalysisLayer): [number, number] | null {
    const d = layer.descriptor;
    if (!d.domain) return null;
    return d.domain(layer.params, this.terrainRenderer.autoElevationRange);
  }

  /** Legend of a value analysis layer; null for color kinds and unknown layers. */
  getLegend(handle: LayerHandle | string): LegendSpec | null {
    const layer = this.layerRegistry.getAnalysisLayer(handle);
    if (!layer || !layer.isValueKind) return null;
    const domain = this.getAnalysisDomain(layer) ?? [0, 1];
    return legendFor(layer.id, layer.layerName, resolveRamp(layer.ramp ?? layer.descriptor.ramp!), domain, layer.unit);
  }

  /** Legends of the visible value analyses, top of the stack first. */
  getLegends(): LegendSpec[] {
    const out: LegendSpec[] = [];
    const stack = this.layerRegistry.getStack();
    for (let i = stack.length - 1; i >= 0; i--) {
      const layer = stack[i];
      if (!layer.visible || !('descriptor' in layer)) continue;
      const legend = this.getLegend(layer.id);
      if (legend) out.push(legend);
    }
    return out;
  }

  // =========================================================================
  // Sun Direction
  // =========================================================================

  setSunAzimuth(degrees: number): void {
    if (!Number.isFinite(degrees)) return;
    this._sunAzimuth = ((degrees % 360) + 360) % 360;
    this._manualAzimuth = this._sunAzimuth;
    this._sunAltitude = this._manualAltitude;
    this.updateSunDirection();
  }

  getSunAzimuth(): number {
    return this._sunAzimuth;
  }

  setSunAltitude(degrees: number): void {
    if (!Number.isFinite(degrees)) return;
    this._sunAltitude = Math.max(5, Math.min(90, degrees));
    this._manualAltitude = this._sunAltitude;
    this._sunAzimuth = this._manualAzimuth;
    this.updateSunDirection();
  }

  /** Put the sun back where setSunAzimuth / setSunAltitude left it (after a sun time). */
  restoreManualSun(): void {
    this._sunAzimuth = this._manualAzimuth;
    this._sunAltitude = this._manualAltitude;
    this.updateSunDirection();
  }

  getSunAltitude(): number {
    return this._sunAltitude;
  }

  /**
   * Place the sun where it actually is (from a date): altitudes down to
   * −10° are kept, so slopes facing the sun still catch light at dusk.
   */
  setSunPosition(azimuth: number, altitude: number): void {
    if (!Number.isFinite(azimuth) || !Number.isFinite(altitude)) return;
    this._sunAzimuth = ((azimuth % 360) + 360) % 360;
    this._sunAltitude = Math.max(-10, Math.min(90, altitude));
    this.updateSunDirection();
  }

  updateSunDirection(): void {
    const az = this._sunAzimuth * Math.PI / 180;
    const alt = this._sunAltitude * Math.PI / 180;
    const dir = this._sunDir.set(
      Math.sin(az) * Math.cos(alt),
      Math.cos(az) * Math.cos(alt),
      Math.sin(alt),
    ).normalize();
    this.terrainRenderer.setSunDirection(dir);
  }

  // =========================================================================
  // Exaggeration
  // =========================================================================

  setExaggeration(handleOrValue: LayerHandle | string | number, value?: number): void {
    let baseLayer: BaseLayer | null | undefined;
    let newValue: number;

    if (typeof handleOrValue === 'number') {
      baseLayer = this.layerRegistry.getActiveBaseLayer();
      newValue = handleOrValue;
    } else {
      baseLayer = this.layerRegistry.getBaseLayer(handleOrValue);
      newValue = value ?? 1.0;
    }
    if (!Number.isFinite(newValue)) return;

    if (baseLayer) {
      // Applied to the material every frame from the active layer's display state.
      (baseLayer.display as { exaggeration: number }).exaggeration = Math.max(0, Math.min(100, newValue));
      this.sceneManager.requestRender();
    }
  }

  getExaggeration(): number {
    const baseLayer = this.layerRegistry.getActiveBaseLayer();
    return baseLayer?.display.exaggeration ?? 1.0;
  }

  // =========================================================================
  // Wireframe
  // =========================================================================

  setWireframe(enabled: boolean): void {
    this._wireframe = enabled;
    this.terrainRenderer.setWireframe(enabled);
    this.terrainRenderer.setBaseWhite(enabled && this._wireframeWhite);
  }

  getWireframe(): boolean {
    return this._wireframe;
  }

  setWireframeWhite(white: boolean): void {
    this._wireframeWhite = white;
    this.terrainRenderer.setBaseWhite(this._wireframe && white);
  }

  getWireframeWhite(): boolean {
    return this._wireframeWhite;
  }

  // =========================================================================
  // Pitch Constraints
  // =========================================================================

  setMinPitch(degrees: number): void {
    if (!Number.isFinite(degrees)) return;
    (this.options.mapDisplay as { minPitch: number }).minPitch = degrees;
    this.sceneManager.cameraController.setMinPitch(degrees);
  }

  getMinPitch(): number {
    return this.options.mapDisplay.minPitch;
  }

  setMaxPitch(degrees: number): void {
    if (!Number.isFinite(degrees)) return;
    (this.options.mapDisplay as { maxPitch: number }).maxPitch = degrees;
    this.sceneManager.cameraController.setMaxPitch(degrees);
  }

  getMaxPitch(): number {
    return this.options.mapDisplay.maxPitch;
  }

  // =========================================================================
  // Material State Resolution
  // =========================================================================

  /**
   * Hand the visible coats, bottom first, to the terrain renderer (it skips
   * coats outside their zoom range or at opacity 0, and keeps a shadow map
   * while a drawn coat reads one). Public so LayerController can call it
   * after layer changes.
   */
  applyMaterialState(): void {
    const coats: CoatInput[] = [];
    for (const layer of this.layerRegistry.getStack()) {
      if (!layer.visible) continue;
      if ('descriptor' in layer) {
        const coat = this.analysisCoat(layer);
        if (layer.owner !== null) {
          // An overlay's fills: drawn with the overlay (shown, in its zoom range, its opacity)
          const owner = this.layerRegistry.getOverlayLayer(layer.owner);
          if (!owner || !owner.visible) continue;
          coat.opacity *= owner.display.opacity;
          coat.minZoom = owner.minZoom;
          coat.maxZoom = owner.maxZoom;
        }
        coats.push(coat);
      } else {
        coats.push({
          id: layer.id,
          kind: IMAGERY_KIND,
          blendMode: layer.display.blendMode,
          opacity: layer.display.opacity,
          ramp: null,
          domain: [0, 1],
          minZoom: layer.minZoom,
          maxZoom: layer.maxZoom,
          pack: () => ({ p0: [0, 0, 0, 0], p1: [0, 0, 0, 0] }),
        });
      }
    }
    // Imagery that isn't drawn isn't fetched either
    const drape = this.layerRegistry.getActiveDrape();
    this.terrainRenderer.setDrapeShown(drape !== null && drape.visible && drape.display.opacity > 0);
    this.terrainRenderer.setCoats(coats);
  }

  private analysisCoat(layer: AnalysisLayer): CoatInput {
    const d = layer.descriptor;
    const params = layer.params;
    const domainOf = d.domain;
    return {
      id: layer.id,
      kind: analysisKind(d.id),
      blendMode: layer.display.blendMode,
      opacity: layer.display.opacity,
      ramp: layer.isValueKind ? resolveRamp(layer.ramp ?? d.ramp!) : null,
      domain: domainOf ? (visible) => domainOf(params, visible) : [0, 1],
      raster: d.raster ? this.terrainRenderer.rasterSlot(layer.id) : -1,
      minZoom: layer.minZoom,
      maxZoom: layer.maxZoom,
      shadowMap: d.shadowMap === true,
      pack: (dom) => d.pack(params, dom),
    };
  }
}
