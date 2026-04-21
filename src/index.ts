// ============================================================================
// treelet.js - Public API
// ============================================================================

// Re-export core types
export type {
  TreeletOptions,
  ResolvedTreeletOptions,
  GuiDisplayOptions,
  MapDisplayOptions,
  LngLat,
  WorldPoint,
  TileCoord,
  TileBounds,
  VisibleExtent,
  BaseDrapeMode,
  ShaderMode,
  ColorRamp,
  BlendMode,
  UICorner,
  TreeletEventMap,
} from './core/types';

// Re-export core classes
export { Treelet } from './core/Treelet';
export { EventEmitter } from './core/EventEmitter';
export { WebMercator } from './crs/WebMercator';
export { TileGrid } from './tiles/TileGrid';
export { CameraController } from './scene/CameraController';
export type { CameraState } from './scene/CameraController';

// Re-export source architecture
export type { TileSource } from './sources/TileSource';
export type { TileSourceOptions, XYZSourceOptions, WMTSSourceOptions } from './sources/types';
export { UrlTileSource } from './sources/UrlTileSource';
export { XYZSource } from './sources/XYZSource';
export { WMTSSource } from './sources/WMTSSource';

// Re-export layer architecture
export type { Layer } from './layers/Layer';
export type {
  BaseLayerOptions,
  BaseLayerDisplay,
  TerrainDisplay,
  DrapeLayerOptions,
  DrapeLayerDisplay,
  OverlayLayerOptions,
  OverlayLayerDisplay,
  LayerHandle,
  DecoderName,
} from './layers/types';
export { BaseLayer } from './layers/BaseLayer';
export { DrapeLayer } from './layers/DrapeLayer';
export { OverlayLayer } from './layers/OverlayLayer';
export { LayerRegistry } from './layers/LayerRegistry';

// Re-export elevation decoder API
export {
  type ElevationDecoder,
  RawRGBDecoder,
  MapboxDecoder,
  TerrariumDecoder,
  registerDecoder,
  getDecoder,
  resolveDecoder,
} from './decoders/ElevationDecoder';

// Re-export UI components
export { TreeletPanel } from './ui/TreeletPanel';
export { TreeletCompass } from './ui/TreeletCompass';
export { TreeletAttribution } from './ui/TreeletAttribution';
