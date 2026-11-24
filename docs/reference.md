# API reference

[Documentation](README.md) · [Getting started](getting-started.md) · [The map](map.md) · [Terrain](terrain.md) · [Coats](coats.md) · [Region analyses](region-analyses.md) · [Overlays and tools](overlays-and-tools.md) · [Reference](reference.md)

The types the API uses and the low-level building blocks Treelet exports.

The full reference, generated from the source with TypeDoc, is published with the demo: **[geozelot.github.io/Treelet/api](https://geozelot.github.io/Treelet/api/)** (`npm run docs:api` builds it into `docs/api/`).

## Types

```ts
interface LngLat { lng: number; lat: number }
interface WorldPoint { x: number; y: number }
interface TileCoord { z: number; x: number; y: number }
interface TileBounds { west: number; south: number; east: number; north: number }

type RGB = [number, number, number];
type RGBA = [number, number, number, number];
type ColorRamp = 'hypsometric' | 'viridis' | 'inferno' | 'grayscale' | 'cyclic' | 'diverging' | 'avalanche' | 'aspect8' | 'visibility';
type Ramp = ColorRamp | { type: 'continuous'; stops: [number, RGB | RGBA][] } | { type: 'classes'; breaks: number[]; colors: (RGB | RGBA)[]; labels?: string[] };
type BlendMode = 'normal' | 'multiply' | 'screen' | 'softlight';
interface LegendSpec { id: string; title: string; unit?: string; type: 'continuous' | 'classes'; domain: [number, number]; stops?: [number, RGBA][]; classes?: { color: RGBA; label: string }[] }
type DecoderName = 'terrain-rgb' | 'mapbox' | 'terrarium';
type UICorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface TerrainSample { elevation: number; slope: number; aspect: number | null; curvature: number; normal: [number, number, number] }
interface RegionInfo { bounds: TileBounds; width: number; height: number; zoom: number; cellSize: number; missingTiles: number }
interface ElevationGrid extends RegionInfo { data: Float32Array; min: number; max: number }
interface AnalysisJob { id: string; kind: string; label: string; stage: 'loading' | 'computing'; progress: number }
interface SunPosition { azimuth: number; altitude: number; declination: number; equationOfTime: number }
interface TerrainPick extends TerrainSample { lngLat: LngLat }
interface PathMeasure { distance: number; surfaceDistance: number; gain: number; loss: number; minElevation: number | null; maxElevation: number | null; vertexDistances: number[]; profile: ProfileSample[] }
interface AreaMeasure { area: number; surfaceArea: number; perimeter: number; minElevation: number | null; maxElevation: number | null }
interface LineOfSightResult { visible: boolean; distance: number; clearance: number; eyeElevation: number; targetElevation: number; obstruction: { lngLat: LngLat; distance: number; elevation: number } | null; profile: (ProfileSample & { sight: number })[] }
type ToolMode = 'distance' | 'area' | 'profile' | 'sight';
type ToolResult =
  | { mode: 'distance' | 'profile'; points: LngLat[]; path: PathMeasure }
  | { mode: 'area'; points: LngLat[]; area: AreaMeasure }
  | { mode: 'sight'; points: LngLat[]; sight: LineOfSightResult | null };
interface ProfileSample { lngLat: LngLat; distance: number; elevation: number | null }
interface LayerHandle { readonly id: string; readonly layerName: string }
interface ViewshedResult extends RegionInfo { layer: LayerHandle | null; visible: Float32Array; clearance: Float32Array | null; visibleArea: number; observerElevation: number }
interface SunHoursResult extends RegionInfo { layer: LayerHandle | null; hours: Float32Array; firstSun: Float32Array; lastSun: Float32Array; daylight: number }
interface GridResult extends RegionInfo { layer: LayerHandle | null; data: Float32Array }
interface TreeletStats {
  tiles: number; drawCalls: number; coats: number; rasters: number; overlays: number; shadows: boolean;
  frameTime: number; atlasUsed: number; atlasCapacity: number;
  drapeTiles: number; pendingElevation: number; pendingDrape: number; failedTiles: number;
}
```

## Low-level API

For advanced use, Treelet re-exports its internal building blocks:

| Export | Description |
|---|---|
| `Treelet` | Main class with static `Treelet.map()` factory |
| `UrlTileSource` | Base tile source class |
| `XYZSource`, `WMTSSource` | Concrete tile sources |
| `BaseLayer`, `DrapeLayer`, `AnalysisLayer`, `OverlayLayer` | Layer classes (what `getLayerStack()`, `getBaseLayers()` … return) |
| `registerAnalysis()`, `getAnalysis()`, `listAnalyses()`, `resolveParams()`, `MAX_COATS` | Analysis registry |
| `registerBuiltinAnalyses()` and the built-ins' helpers (`slopeDegrees`, `aspectDegrees`, `inSector`, `curvatureOf`, `curvatureValue`, `waterDepth`, `hillshadeLight`, `MDOW_OFFSETS`, `WATER_COLORS`, `CONTOUR_COLORS`) | The built-in analyses' CPU side, for custom kinds that build on them |
| `sampleSurfaceGrid()` | The 12-texel surface (elevation, gradient, curvature) the shader shades, on a CPU grid |
| `BUILTIN_RAMPS`, `BUILTIN_RAMP_NAMES`, `RAMP_PRESET_FOR`, `rampNamesFor()`, `resolveRamp()`, `rampColorAt()`, `rampGradientCss()`, `cssColor()`, `legendFor()` | Ramps and legends |
| `REGION_ANALYSES`, `REGION_ANALYSIS_INPUT` | The region analysis kinds, and which need a point |
| `sunPosition()`, `sunPathOfDay()` | NOAA solar position |
| `planRegion()` | The tiles a region analysis loads |
| `LayerRegistry` | Layer management registry |
| `CameraController` | Camera state + controls |
| `WebMercator` | EPSG:3857 projection utilities |
| `TileGrid` | Tile math (world / tile coordinate conversion) |
| `EventEmitter` | Base event system |
| `RawRGBDecoder`, `MapboxDecoder`, `TerrariumDecoder` | Built-in decoder instances |
| `registerDecoder()`, `getDecoder()`, `resolveDecoder()` | Decoder registration and lookup |
| `TreeletHub`, `TreeletInfo`, `TreeletCompass`, `TreeletPanel`, `TreeletJobs`, `TreeletToolbar`, `TreeletProfile`, `TreeletLegend`, `TreeletReadout`, `TreeletAttribution`, `TreeletLabels` | UI components |
| `geodesicDistance`, `pathLength`, `ringArea`, `polygonArea`, `lineOfSightProfile` | Geodesy and line of sight |
| `formatDistance`, `formatArea`, `formatElevation` | Measurement formatting |
| `defineTreeletElements()` | Register the UI custom elements (done automatically by `Treelet`) |
