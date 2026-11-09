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
import type { SceneManager } from '../scene/SceneManager';
import type { BaseLayer } from '../layers/BaseLayer';
import type { AnalysisLayer } from '../layers/AnalysisLayer';
import type { ResolvedTreeletOptions } from './types';
import type { LayerHandle } from '../layers/types';
import type { CoatBlendMode, LegendSpec, Ramp } from '../analysis/types';
import { IMAGERY_KIND, MAX_COATS, analysisKind } from '../analysis/registry';
import { resolveRamp, legendFor } from '../analysis/ramps';
import type { CoatInput } from '../terrain/CoatStack';

const BLEND_MODES: readonly CoatBlendMode[] = ['normal', 'multiply', 'screen', 'softlight'];

/** Passed to descriptors' `domain()`; returned as-is it means "follow the visible range". */
const AUTO_DOMAIN: [number, number] = [0, 1];

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

  /** Reusable Vector3 for sun direction computation. */
  private readonly _sunDir = new Vector3();

  private coatLimitWarned = false;

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

  setLayerOpacity(handle: LayerHandle | string, opacity: number): boolean {
    if (!Number.isFinite(opacity)) return false;
    const layer = this.stackLayer(handle);
    if (!layer) return false;
    (layer.display as { opacity: number }).opacity = Math.max(0, Math.min(1, opacity));
    this.applyMaterialState();
    return true;
  }

  getLayerOpacity(handle: LayerHandle | string): number {
    return this.layerRegistry.getStackLayer(handle)?.display.opacity ?? 1;
  }

  setLayerBlendMode(handle: LayerHandle | string, mode: CoatBlendMode): boolean {
    if (!BLEND_MODES.includes(mode)) {
      console.warn(`treelet: unknown blend mode "${mode}"`);
      return false;
    }
    const layer = this.stackLayer(handle);
    if (!layer) return false;
    (layer.display as { blendMode: CoatBlendMode }).blendMode = mode;
    this.applyMaterialState();
    return true;
  }

  getLayerBlendMode(handle: LayerHandle | string): CoatBlendMode {
    return this.layerRegistry.getStackLayer(handle)?.display.blendMode ?? 'normal';
  }

  setAnalysisParams(handle: LayerHandle | string, params: object): boolean {
    const layer = this.analysisLayer(handle);
    if (!layer) return false;
    layer.setParams(params);
    this.applyMaterialState();
    return true;
  }

  getAnalysisParams(handle: LayerHandle | string): Record<string, unknown> | null {
    const layer = this.layerRegistry.getAnalysisLayer(handle);
    return layer ? { ...layer.params } : null;
  }

  setAnalysisRamp(handle: LayerHandle | string, ramp: Ramp): boolean {
    const layer = this.analysisLayer(handle);
    if (!layer) return false;
    resolveRamp(ramp); // validates (throws)
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

  /** Value domain of an analysis layer's ramp ('auto' resolved to the visible range). */
  getAnalysisDomain(layer: AnalysisLayer): [number, number] | null {
    const d = layer.descriptor;
    if (!d.domain) return null;
    const domain = d.domain(layer.params, AUTO_DOMAIN);
    return domain === AUTO_DOMAIN ? this.terrainRenderer.autoElevationRange : domain;
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
    this.updateSunDirection();
  }

  getSunAzimuth(): number {
    return this._sunAzimuth;
  }

  setSunAltitude(degrees: number): void {
    if (!Number.isFinite(degrees)) return;
    this._sunAltitude = Math.max(5, Math.min(90, degrees));
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
   * Hand the visible coats, bottom first, to the terrain renderer.
   * Public so LayerController can call it after layer changes.
   */
  applyMaterialState(): void {
    const coats: CoatInput[] = [];
    let shadows = false;
    for (const layer of this.layerRegistry.getStack()) {
      if (!layer.visible) continue;
      if ('descriptor' in layer) {
        coats.push(this.analysisCoat(layer));
        if (layer.descriptor.shadowMap && coats.length <= MAX_COATS) shadows = true;
      }
      else {
        coats.push({
          id: layer.id,
          kind: IMAGERY_KIND,
          blendMode: layer.display.blendMode,
          opacity: layer.display.opacity,
          ramp: null,
          domain: [0, 1],
          pack: () => ({ p0: [0, 0, 0, 0], p1: [0, 0, 0, 0] }),
        });
      }
    }
    if (coats.length > MAX_COATS && !this.coatLimitWarned) {
      this.coatLimitWarned = true;
      console.warn(`treelet: only the lowest ${MAX_COATS} visible coats are drawn (${coats.length} visible)`);
    }
    this.terrainRenderer.setCoats(coats);
    this.terrainRenderer.setShadowsEnabled(shadows);
  }

  private analysisCoat(layer: AnalysisLayer): CoatInput {
    const d = layer.descriptor;
    const params = layer.params;
    let domain: [number, number] | 'auto' = [0, 1];
    if (d.domain) {
      const dom = d.domain(params, AUTO_DOMAIN);
      domain = dom === AUTO_DOMAIN ? 'auto' : dom;
    }
    return {
      id: layer.id,
      kind: analysisKind(d.id),
      blendMode: layer.display.blendMode,
      opacity: layer.display.opacity,
      ramp: layer.isValueKind ? resolveRamp(layer.ramp ?? d.ramp!) : null,
      domain,
      raster: d.raster ? this.terrainRenderer.rasterSlot(layer.id) : -1,
      pack: (dom) => d.pack(params, dom),
    };
  }
}
