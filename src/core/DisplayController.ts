// ============================================================================
// treelet.js - Display Controller
//
// Owns all visual/material state and mutations: drape mode, sun direction,
// exaggeration, isolines, color ramps, wireframe, drape blend, pitch.
//
// Extracted from Treelet to keep the main orchestrator focused on wiring.
// ============================================================================

import { Vector3 } from 'three';
import type { TerrainRenderer } from '../terrain/TerrainRenderer';
import type { LayerRegistry } from '../layers/LayerRegistry';
import type { SceneManager } from '../scene/SceneManager';
import type { BaseLayer } from '../layers/BaseLayer';
import type { DrapeLayer } from '../layers/DrapeLayer';
import type {
  ResolvedTreeletOptions,
  BaseDrapeMode,
  BlendMode,
  ShaderMode,
  ColorRamp,
} from './types';
import type { LayerHandle } from '../layers/types';

/** Special ID for the virtual BaseDrape layer. */
export const BASE_DRAPE_ID = '__base_drape__';

export class DisplayController {
  private readonly terrainRenderer: TerrainRenderer;
  private readonly layerRegistry: LayerRegistry;
  private readonly sceneManager: SceneManager;
  private readonly options: ResolvedTreeletOptions;

  /** Currently active drape: BASE_DRAPE_ID=BaseDrape, or external drape ID. */
  private _activeDrapeId: string | null = BASE_DRAPE_ID;

  /** BaseDrape sub-mode: wireframe, elevation, slope, aspect, or contours. */
  private _baseDrapeMode: BaseDrapeMode = 'elevation';

  /** Whether wireframe renders flat white (true) or normals coloring (false). */
  private _wireframeWhite = false;

  /** Sun azimuth in degrees (0–360, clockwise from north). Default 315° (north-west),
   *  the cartographic convention that avoids the relief-inversion illusion. */
  private _sunAzimuth = 315;

  /** Sun altitude in degrees above the horizon (5–90). 90° = straight down. */
  private _sunAltitude = 45;

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
  // Drape ID State (read/write for LayerController coordination)
  // =========================================================================

  get activeDrapeId(): string | null {
    return this._activeDrapeId;
  }

  set activeDrapeId(id: string | null) {
    this._activeDrapeId = id;
  }

  get baseDrapeMode(): BaseDrapeMode {
    return this._baseDrapeMode;
  }

  // =========================================================================
  // BaseDrape Mode
  // =========================================================================

  /**
   * Set the BaseDrape sub-mode (wireframe, elevation, slope, aspect, contours).
   * If an external drape is active, switches back to BaseDrape first.
   * @param deactivateDrapes - callback to deactivate all external drapes (avoids circular dep)
   */
  setBaseDrapeMode(mode: BaseDrapeMode, deactivateDrapes: () => void): void {
    this._baseDrapeMode = mode;

    // If an external drape was active, switch to BaseDrape
    if (this._activeDrapeId !== BASE_DRAPE_ID) {
      deactivateDrapes();
      this._activeDrapeId = BASE_DRAPE_ID;
      this.clearAllDrapeTextures();
    }

    this.applyMaterialState();
  }

  getBaseDrapeMode(): BaseDrapeMode {
    return this._baseDrapeMode;
  }

  getActiveDrapeId(): string | null {
    return this._activeDrapeId;
  }

  isBaseDrapeActive(): boolean {
    return this._activeDrapeId === BASE_DRAPE_ID;
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
  // Isolines
  // =========================================================================

  setIsolineInterval(interval: number): void {
    if (!Number.isFinite(interval) || interval <= 0) return;
    const baseLayer = this.layerRegistry.getActiveBaseLayer();
    if (baseLayer) {
      (baseLayer.terrainDisplay as { isoplethInterval: number }).isoplethInterval = interval;
    }
    this.terrainRenderer.setIsolineSettings(
      interval,
      baseLayer?.terrainDisplay.isolineStrength ?? 1.5,
    );
  }

  getIsolineInterval(): number {
    const baseLayer = this.layerRegistry.getActiveBaseLayer();
    return baseLayer?.terrainDisplay.isoplethInterval ?? 100;
  }

  setIsolineThickness(thickness: number): void {
    if (!Number.isFinite(thickness) || thickness < 0) return;
    const baseLayer = this.layerRegistry.getActiveBaseLayer();
    if (baseLayer) {
      (baseLayer.terrainDisplay as { isolineStrength: number }).isolineStrength = thickness;
    }
    this.terrainRenderer.setIsolineSettings(
      baseLayer?.terrainDisplay.isoplethInterval ?? 100,
      thickness,
    );
  }

  getIsolineThickness(): number {
    const baseLayer = this.layerRegistry.getActiveBaseLayer();
    return baseLayer?.terrainDisplay.isolineStrength ?? 1.5;
  }

  setIsolineColor(r: number, g: number, b: number): void {
    const baseLayer = this.layerRegistry.getActiveBaseLayer();
    if (baseLayer) {
      (baseLayer.terrainDisplay as { isolineColor: [number, number, number] }).isolineColor = [r, g, b];
    }
    this.terrainRenderer.setIsolineColor(r, g, b);
  }

  getIsolineColor(): [number, number, number] {
    const baseLayer = this.layerRegistry.getActiveBaseLayer();
    const c = baseLayer?.terrainDisplay.isolineColor ?? [0.12, 0.08, 0.04];
    return [...c] as [number, number, number];
  }

  // =========================================================================
  // Ramp ranges
  // =========================================================================

  /** Elevation ramp range in meters, or 'auto' to fit the visible tiles' data. */
  setElevationRange(range: [number, number] | 'auto'): void {
    const baseLayer = this.layerRegistry.getActiveBaseLayer();
    if (range !== 'auto' && !(Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[1] > range[0])) return;
    if (baseLayer) {
      (baseLayer.terrainDisplay as { rampInterpolationRange: [number, number] | 'auto' }).rampInterpolationRange =
        range === 'auto' ? 'auto' : [range[0], range[1]];
    }
    this.applyElevationRange();
  }

  getElevationRange(): [number, number] | 'auto' {
    const r = this.layerRegistry.getActiveBaseLayer()?.terrainDisplay.rampInterpolationRange ?? [0, 4000];
    return r === 'auto' ? 'auto' : [r[0], r[1]];
  }

  /** Slope ramp range in degrees. */
  setSlopeRange(min: number, max: number): void {
    if (!(Number.isFinite(min) && Number.isFinite(max) && max > min)) return;
    const lo = Math.max(0, min);
    const hi = Math.min(90, max);
    const baseLayer = this.layerRegistry.getActiveBaseLayer();
    if (baseLayer) {
      (baseLayer.terrainDisplay as { slopeRange: [number, number] }).slopeRange = [lo, hi];
    }
    this.terrainRenderer.setSlopeRange(lo, hi);
  }

  getSlopeRange(): [number, number] {
    const r = this.layerRegistry.getActiveBaseLayer()?.terrainDisplay.slopeRange ?? [0, 60];
    return [r[0], r[1]];
  }

  private applyElevationRange(): void {
    const range = this.layerRegistry.getActiveBaseLayer()?.terrainDisplay.rampInterpolationRange ?? [0, 4000];
    if (range === 'auto') this.terrainRenderer.setAutoElevationRange();
    else this.terrainRenderer.setElevationRange(range[0], range[1]);
  }

  // =========================================================================
  // Color Ramp + Wireframe
  // =========================================================================

  setColorRamp(ramp: ColorRamp): void {
    const baseLayer = this.layerRegistry.getActiveBaseLayer();
    if (baseLayer) {
      const td = baseLayer.terrainDisplay as {
        rampDefaultElevation: ColorRamp;
        rampDefaultSlope: ColorRamp;
        rampDefaultAspect: ColorRamp;
      };
      const mode = this._baseDrapeMode;
      if (mode === 'elevation' || mode === 'contours') td.rampDefaultElevation = ramp;
      else if (mode === 'slope') td.rampDefaultSlope = ramp;
      else if (mode === 'aspect') td.rampDefaultAspect = ramp;
    }
    this.terrainRenderer.setColorRamp(ramp);
  }

  getColorRamp(): ColorRamp {
    const baseLayer = this.layerRegistry.getActiveBaseLayer();
    if (!baseLayer) return 'hypsometric';
    const td = baseLayer.terrainDisplay;
    const mode = this._baseDrapeMode;
    if (mode === 'elevation' || mode === 'contours') return td.rampDefaultElevation;
    if (mode === 'slope') return td.rampDefaultSlope;
    if (mode === 'aspect') return td.rampDefaultAspect;
    return td.rampDefaultElevation;
  }

  setWireframeWhite(white: boolean): void {
    this._wireframeWhite = white;
    this.terrainRenderer.setBaseWhite(white);
  }

  getWireframeWhite(): boolean {
    return this._wireframeWhite;
  }

  // =========================================================================
  // Drape Display
  // =========================================================================

  setDrapeOpacity(handle: LayerHandle | string, opacity: number): void {
    if (!Number.isFinite(opacity)) return;
    const id = typeof handle === 'string' ? handle : handle.id;
    const drape = this.layerRegistry.getDrapeLayer(id);
    if (drape) {
      (drape.display as { opacity: number }).opacity = Math.max(0, Math.min(1, opacity));
      if (this._activeDrapeId === id) {
        this.terrainRenderer.setDrapeOpacity(drape.display.opacity);
      }
    }
  }

  getDrapeOpacity(handle: LayerHandle | string): number {
    const drape = this.layerRegistry.getDrapeLayer(handle);
    return drape?.display.opacity ?? 1.0;
  }

  setDrapeBlendMode(mode: BlendMode): void {
    const drape = this.getActiveDrape();
    if (drape) {
      (drape.display as { blendMode: BlendMode }).blendMode = mode;
    }
    this.terrainRenderer.setDrapeBlendMode(mode);
  }

  getDrapeBlendMode(): BlendMode {
    const drape = this.getActiveDrape();
    return drape?.display.blendMode ?? 'hillshade';
  }

  setHillshadeStrength(strength: number): void {
    const clamped = Math.max(0, Math.min(1, strength));
    const drape = this.getActiveDrape();
    if (drape) {
      (drape.display as { hillshadeStrength: number }).hillshadeStrength = clamped;
    }
    this.terrainRenderer.setHillshadeStrength(clamped);
  }

  getHillshadeStrength(): number {
    const drape = this.getActiveDrape();
    return drape?.display.hillshadeStrength ?? 0.5;
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
   * Resolve material configuration from the current drape state.
   */
  resolveMaterialConfig(): { shaderMode: ShaderMode; wireframe: boolean; isolineEnabled: boolean } {
    if (this._activeDrapeId === BASE_DRAPE_ID || this._activeDrapeId === null) {
      const mode = this._baseDrapeMode;
      if (mode === 'wireframe') {
        return { shaderMode: 'base', wireframe: true, isolineEnabled: false };
      } else if (mode === 'contours') {
        return { shaderMode: 'elevation', wireframe: false, isolineEnabled: true };
      } else {
        return { shaderMode: mode, wireframe: false, isolineEnabled: false };
      }
    } else {
      return { shaderMode: 'texture', wireframe: false, isolineEnabled: false };
    }
  }

  /**
   * Apply the correct material state to the terrain renderer.
   * Reads display settings from the active layer's display objects.
   * Public so LayerController can call it after layer changes.
   */
  applyMaterialState(): void {
    const { shaderMode, wireframe, isolineEnabled } = this.resolveMaterialConfig();
    const baseLayer = this.layerRegistry.getActiveBaseLayer();
    const td = baseLayer?.terrainDisplay;

    this.terrainRenderer.setMode(shaderMode);
    this.terrainRenderer.setWireframe(wireframe);
    this.terrainRenderer.setIsolineEnabled(isolineEnabled);
    this.terrainRenderer.setColorRamp(this.getColorRamp());
    this.terrainRenderer.setBaseWhite(this._wireframeWhite);

    // Isoline settings from active base layer's terrainDisplay
    const isolineColor = td?.isolineColor ?? [0.12, 0.08, 0.04];
    this.terrainRenderer.setIsolineColor(isolineColor[0], isolineColor[1], isolineColor[2]);
    this.terrainRenderer.setIsolineSettings(
      td?.isoplethInterval ?? 100,
      td?.isolineStrength ?? 1.5,
    );

    // Ramp ranges from active base layer's terrainDisplay
    this.applyElevationRange();
    const slope = td?.slopeRange ?? [0, 60];
    this.terrainRenderer.setSlopeRange(slope[0], slope[1]);
  }

  /**
   * Clear drape textures from the terrain material.
   */
  clearAllDrapeTextures(): void {
    this.terrainRenderer.clearDrapes();
  }

  /**
   * Get the currently active external drape layer, or null.
   */
  getActiveDrape(): DrapeLayer | null {
    if (!this._activeDrapeId || this._activeDrapeId === BASE_DRAPE_ID) return null;
    return this.layerRegistry.getDrapeLayer(this._activeDrapeId) ?? null;
  }
}
