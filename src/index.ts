// ============================================================================
// treelet.js - Public API
// ============================================================================

// Re-export types for consumers
export type {
  TreeletOptions,
  ResolvedTreeletOptions,
  LngLat,
  WorldPoint,
  TileCoord,
  TileBounds,
  VisibleExtent,
  BaseLayerOptions,
  DrapeLayerOptions,
  LayerSourceOptions,
  BaseDrapeMode,
  ShaderMode,
  ColorRamp,
  BlendMode,
  DecoderType,
  CustomDecoderFn,
  UICorner,
  TreeletEventMap,
  ScheduleResult,
} from './core/types';

// Re-export core classes
export { Treelet } from './core/Treelet';
export { EventEmitter } from './core/EventEmitter';
export { WebMercator } from './crs/WebMercator';
export { TileGrid } from './tiles/TileGrid';
export { CameraController } from './scene/CameraController';
export type { CameraState } from './scene/CameraController';

// Re-export layer classes
export { LayerSource } from './layers/LayerSource';
export { createSource } from './layers/createSource';
export { XYZSource } from './layers/XYZSource';
export { WMSSource } from './layers/WMSSource';
export { WMTSSource } from './layers/WMTSSource';
export { BaseLayer } from './layers/base/BaseLayer';
export { DrapeLayer } from './layers/drape/DrapeLayer';
export { DrapeCompositor } from './layers/drape/DrapeCompositor';
export { LayerRegistry } from './layers/LayerRegistry';

// Re-export elevation decoder API
export {
  type ElevationDecoder,
  terrainRGBDecoder,
  terrariumDecoder,
  mapboxTerrainDecoder,
  createCustomDecoder,
  registerDecoder,
  getDecoder,
  resolveDecoder,
} from './layers/base/ElevationDecoder';

// Re-export seam resolver
export { SeamResolver } from './layers/base/SeamResolver';

// Re-export terrain material API
export {
  createTerrainMaterial,
  setMaterialMode,
  setMaterialColorRamp,
  setMaterialContourEnabled,
  setMaterialWireframe,
  setMaterialElevationRange,
  setMaterialElevationScale,
  setMaterialSunDirection,
  setMaterialContourSettings,
  setMaterialDrape,
  isTerrainMaterial,
  type TerrainMaterialOptions,
} from './shaders/TerrainMaterial';

// Re-export UI components
export { TreeletPanel } from './ui/TreeletPanel';
export { TreeletCompass } from './ui/TreeletCompass';
export { TreeletAttribution } from './ui/TreeletAttribution';

