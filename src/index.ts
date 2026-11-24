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
  ColorRamp,
  BlendMode,
  UICorner,
  TreeletEventMap,
  TerrainPick,
  TerrainSample,
  ProfileSample,
  LineOfSightResult,
  TreeletStats,
} from './core/types';

// Overlays (GeoJSON on the terrain) and measuring tools
export type {
  GeoJSON,
  Feature,
  FeatureCollection,
  Geometry,
  Position,
  PointGeometry,
  MultiPointGeometry,
  LineStringGeometry,
  MultiLineStringGeometry,
  PolygonGeometry,
  MultiPolygonGeometry,
  GeometryCollection,
  OverlayStyle,
  OverlayStyleSpec,
  ColorValue,
} from './overlays/types';
export type { PathMeasure, AreaMeasure } from './tools/measure';
export type { ToolMode, ToolResult } from './tools/ToolController';
export { formatDistance, formatArea, formatElevation } from './tools/format';

// Region analyses (viewshed, sun hours, sky view, TPI, elevation grids)
export type {
  RegionOptions,
  ResultLayerOptions,
  RegionInfo,
  ElevationGrid,
  ViewshedOptions,
  ViewshedResult,
  SunHoursOptions,
  SunHoursResult,
  SkyViewOptions,
  TpiOptions,
  GridResult,
  AnalysisJob,
  RegionAnalysisKind,
} from './core/AnalysisController';
export { REGION_ANALYSES, REGION_ANALYSIS_INPUT } from './core/AnalysisController';

// Re-export core classes
export { Treelet } from './core/Treelet';
export { EventEmitter, type EventHandler } from './core/EventEmitter';
export { WebMercator } from './crs/WebMercator';
export { TileGrid } from './tiles/TileGrid';
export { CameraController } from './scene/CameraController';
export type { CameraState } from './scene/CameraController';

// Re-export source architecture
export type { TileSource, TileRequestInit } from './sources/TileSource';
export type { TileSourceOptions, XYZSourceOptions, WMTSSourceOptions } from './sources/types';
export { UrlTileSource } from './sources/UrlTileSource';
export { XYZSource } from './sources/XYZSource';
export { WMTSSource } from './sources/WMTSSource';

// Re-export layer architecture
export type { Layer } from './layers/Layer';
export type {
  BaseLayerOptions,
  BaseLayerDisplay,
  DrapeLayerOptions,
  DrapeLayerDisplay,
  AnalysisLayerOptions,
  AnalysisLayerDisplay,
  RasterLayerOptions,
  ResolvedBaseLayerDisplay,
  ResolvedDrapeLayerDisplay,
  ResolvedAnalysisLayerDisplay,
  ResolvedOverlayLayerDisplay,
  OverlayLayerOptions,
  OverlayLayerDisplay,
  LayerHandle,
  DecoderName,
} from './layers/types';
export { BaseLayer } from './layers/BaseLayer';
export { DrapeLayer } from './layers/DrapeLayer';
export { AnalysisLayer } from './layers/AnalysisLayer';
export { OverlayLayer } from './layers/OverlayLayer';
export { LayerRegistry, type StackLayer } from './layers/LayerRegistry';

// Re-export analysis architecture (descriptors, ramps, legends)
export * from './analysis';

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
export { TreeletInfo, type InfoPage } from './ui/TreeletInfo';
export { TreeletHub, type HubPage } from './ui/TreeletHub';
export { TreeletJobs } from './ui/TreeletJobs';
export { TreeletLegend } from './ui/TreeletLegend';
export { TreeletReadout } from './ui/TreeletReadout';
export { TreeletLabels, type PlacedLabel } from './ui/TreeletLabels';
export { TreeletProfile, type ProfileData } from './ui/TreeletProfile';
export type { ProfilePoint } from './ui/profileChart';
export { TreeletToolbar } from './ui/TreeletToolbar';
export { defineTreeletElements } from './ui/elements';
