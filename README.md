[![npm](https://img.shields.io/npm/v/@geozelot/treelet)](https://www.npmjs.com/package/@geozelot/treelet)
[![CI](https://github.com/geozelot/treelet/actions/workflows/ci.yml/badge.svg)](https://github.com/geozelot/treelet/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@geozelot/treelet)](./LICENSE)
[![gzip](https://img.shields.io/bundlephobia/minzip/@geozelot/treelet)](https://bundlephobia.com/package/@geozelot/treelet)

# <img src="assets/treelet_logo.svg?sanitize=true" width="33"/> Treelet.js

#### A GPU-driven, lightweight 3D elevation & overlay mapping engine for web-based terrain exploration and beautiful landscapes - inspired by the simplicity of [Leaflet.js](https://leafletjs.com/) and powered by [Three.js](https://threejs.org/).

Treelet provides a slim, high-level API for rendering elevation data as a continuous 3D surface, superimposed with data-driven, hypsometric modes (_topography, slope, aspect, isopleths_) or common drape imagery overlays (e.g. satellite imagery, topology maps).

Treelet aims to allow fast, web-based DEM exploration and visualization of self-hosted data-sets - easily integrated and enriched with available global-coverage data sources.

The library is designed to be easily extendable - via registry or plugin packages - and ships with a slim, themed UI panel for layer management and map control.

##
#### Rendering & Performance:

- **Single draw call rendering** - All visible tiles in one instanced GPU call from a unified atlas
- **Adaptive LOD with geomorphing** - Camera-driven quadtree selects per-tile detail; vertices blend smoothly between LOD levels
- **Vertex displacement** - Displaces shared grid mesh per-instance using vertex texture fetch (VTF)

##
### [Live Demo](https://geozelot.github.io/Treelet/)

##
### Current Features (v0.2.0):

- #### **Data Sources:**
  - **XYZ** - _Slippy map_ | TMS
  - **WMTS** - RESTful | KVP
  - **WMS** - _via plugin_

- #### Terrain decoders:
  - **Terrain-RGB | Mapbox**
  - **Terrarium**
  - **Custom** (_via interface or registry_)

- #### Terrain mode:
  - **Relief** - 3D terrain relief
  - **Isopleth** - 3D stepped relief


- #### Hypsometric overlays:
  - **Elevation** - topographic coloring
  - **Slope** - slope angle coloring
  - **Aspect** - aspect angle coloring
  - **Isoline** - isoline overlay

###
###
###

## Quick Start

### Installation

```bash
npm install @geozelot/treelet three
```

### CDN / Script Tag

For direct browser use without a bundler, use the **standalone** build which bundles Three.js:

```html
<script src="https://unpkg.com/@geozelot/treelet/dist/treelet.cdn.standalone.js"></script>
<script>
  const map = Treelet.map('map', {
    initCenter: { lng: 11.39, lat: 47.27 },
    initZoom: 10,
  });
  // ...
  map.start();
</script>
```

### Minimal Example

```ts
import { Treelet, XYZSource } from '@geozelot/treelet';

const map = Treelet.map('map', {
  initCenter: { lng: 11.39, lat: 47.27 },
  initZoom: 10,
});

map.addBaseLayer({
  layerName: 'AWS Terrain',
  layerSource: new XYZSource({
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    tileSize: 512,
    maxZoom: 15,
  }),
  decoder: 'terrarium',
});

map.addDrapeLayer({
  layerName: 'OpenStreetMap',
  layerSource: new XYZSource({
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileSize: 512,
    maxZoom: 19,
  }),
  lodOffset: 2, // fetch drape 1 zoom finer than elevation (4 sub-tiles per slot)
});

map.start();
```

---

## API Reference

### Factory

#### `Treelet.map(container, options)`

Create a new Treelet map instance (static factory).

| Param | Type | Description |
|---|---|---|
| `container` | `string \| HTMLElement` | DOM element or element ID |
| `options` | `TreeletOptions` | Map configuration |

Returns `Treelet`. Equivalent to `new Treelet(container, options)`.

#### `Treelet.version`

Library version string (static).

---

### TreeletOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `initCenter` | `LngLat` | *required* | Initial map center `{ lng, lat }` |
| `initZoom` | `number` | *required* | Initial zoom level |
| `minZoom` | `number` | `0` | Minimum allowed zoom |
| `maxZoom` | `number` | `20` | Maximum allowed zoom |
| `mapDisplay` | `MapDisplayOptions` | `{}` | Rendering options (see below) |
| `guiDisplay` | `GuiDisplayOptions` | `{}` | UI widget options (see below) |
| `workerCount` | `number` | `navigator.hardwareConcurrency` | Web Worker pool size |

##### MapDisplayOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `atlasSegments` | `number` | `64` | Mesh subdivisions per tile |
| `antialias` | `boolean` | `true` | WebGL antialiasing |
| `worldScale` | `number` | `40075.02` | CRS meters to scene units scale |
| `minPitch` | `number` | `25` | Minimum pitch (most tilted) in degrees |
| `maxPitch` | `number` | `90` | Maximum pitch (top-down) in degrees |

##### GuiDisplayOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Show compass + layer panel |
| `compassPosition` | `UICorner` | `'top-right'` | Compass widget corner |
| `layerPosition` | `UICorner` | `'bottom-right'` | Layer panel corner |

---

### Treelet

The main map class. Extends `EventEmitter`.

#### View

| Method | Returns | Description |
|---|---|---|
| `setView(center, zoom)` | `this` | Set map center and zoom |
| `getCenter()` | `LngLat` | Get current map center |
| `getZoom()` | `number` | Get current zoom level |
| `getBounds()` | `{ sw, ne } \| null` | Get visible bounding box |
| `getTileCount()` | `number` | Get number of cached tiles |

#### Base Layers

Only one base layer is active at a time. The active base layer provides elevation data for the terrain mesh.

| Method | Returns | Description |
|---|---|---|
| `addBaseLayer(options)` | `LayerHandle` | Add an elevation data layer |
| `removeBaseLayer(handle)` | `this` | Remove a base layer |
| `setActiveBaseLayer(handle)` | `this` | Switch active base layer |
| `getBaseLayers()` | `BaseLayer[]` | Get all registered base layers |

##### BaseLayerOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `layerName` | `string` | *required* | Display name |
| `layerSource` | `TileSource` | *required* | Tile source instance (`XYZSource`, `WMTSSource`, etc.) |
| `decoder` | `DecoderName \| ElevationDecoder` | `'terrain-rgb'` | Elevation decoder |
| `layerDisplay` | `BaseLayerDisplay` | `{}` | `{ visible?, exaggeration? }` |
| `terrainDisplay` | `TerrainDisplay` | `{}` | Isoline, color ramp defaults (see below) |
| `layerAttribution` | `string` | source attribution | Attribution text |
| `minZoom` | `number` | `0` | Minimum zoom level |
| `maxZoom` | `number` | `22` | Maximum zoom level |

##### TerrainDisplay

| Option | Type | Default | Description |
|---|---|---|---|
| `isoplethInterval` | `number` | `100` | Contour line spacing in meters |
| `isolineStrength` | `number` | `1.5` | Contour line thickness |
| `isolineColor` | `[r, g, b]` | `[0.12, 0.08, 0.04]` | Contour color (0-1 each) |
| `rampInterpolationRange` | `[min, max]` | `[0, 4000]` | Elevation range for color mapping |
| `rampDefaultElevation` | `ColorRamp` | `'hypsometric'` | Default ramp for elevation mode |
| `rampDefaultSlope` | `ColorRamp` | `'viridis'` | Default ramp for slope mode |
| `rampDefaultAspect` | `ColorRamp` | `'inferno'` | Default ramp for aspect mode |

#### Drape Layers

Drape layers render raster imagery onto the terrain mesh. Only one drape (external or BaseDrape) is active at a time.

| Method | Returns | Description |
|---|---|---|
| `addDrapeLayer(options)` | `LayerHandle` | Add an imagery overlay layer |
| `removeDrapeLayer(handle)` | `this` | Remove a drape layer |
| `activateDrapeLayer(handle)` | `this` | Activate an external drape |
| `activateBaseDrape(mode?)` | `this` | Switch to elevation-derived visualization |
| `setBaseDrapeMode(mode)` | `this` | Change BaseDrape mode |
| `getBaseDrapeMode()` | `BaseDrapeMode` | Get current BaseDrape mode |
| `getActiveDrapeId()` | `string \| null` | Active drape ID (`'__base_drape__'` for BaseDrape) |
| `isBaseDrapeActive()` | `boolean` | Check if BaseDrape is active |
| `setDrapeOpacity(handle, opacity)` | `this` | Set drape opacity (0-1) |
| `getDrapeOpacity(handle)` | `number` | Get drape opacity |
| `setDrapeBlendMode(mode)` | `this` | Set active drape blend mode |
| `getDrapeBlendMode()` | `BlendMode` | Get active drape blend mode |
| `setHillshadeStrength(value)` | `this` | Set hillshade blend strength (0-1) |
| `getHillshadeStrength()` | `number` | Get hillshade strength |
| `getDrapeLayers()` | `DrapeLayer[]` | Get all registered drape layers |

##### DrapeLayerOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `layerName` | `string` | *required* | Display name |
| `layerSource` | `TileSource` | *required* | Tile source instance |
| `lodOffset` | `1 \| 2 \| 3` | `1` | Drape zoom offset vs elevation (2 = 4 sub-tiles, 3 = 16) |
| `layerDisplay` | `DrapeLayerDisplay` | `{}` | `{ visible?, opacity?, blendMode?, hillshadeStrength? }` |
| `layerAttribution` | `string` | source attribution | Attribution text |
| `minZoom` | `number` | `0` | Minimum zoom level |
| `maxZoom` | `number` | `22` | Maximum zoom level |

##### BaseDrapeMode

Elevation-derived visualization modes:

| Mode | Description |
|---|---|
| `'wireframe'` | Mesh wireframe (normals-colored or flat white) |
| `'elevation'` | Elevation-colored with lighting |
| `'slope'` | Slope angle visualization |
| `'aspect'` | Cardinal direction coloring |
| `'contours'` | Elevation coloring with contour line overlay |

#### Visualization

| Method | Returns | Description |
|---|---|---|
| `setColorRamp(ramp)` | `this` | Set color ramp for current BaseDrape mode |
| `getColorRamp()` | `ColorRamp` | Get current color ramp |
| `setExaggeration(value)` | `this` | Set vertical exaggeration on active base layer |
| `setExaggeration(handle, value)` | `this` | Set exaggeration on a specific base layer |
| `getExaggeration()` | `number` | Get exaggeration factor |
| `setIsolineInterval(meters)` | `this` | Set contour line spacing |
| `getIsolineInterval()` | `number` | Get contour interval |
| `setIsolineThickness(value)` | `this` | Set contour line thickness |
| `getIsolineThickness()` | `number` | Get contour thickness |
| `setIsolineColor(r, g, b)` | `this` | Set contour color (RGB, 0-1 each) |
| `getIsolineColor()` | `[r, g, b]` | Get contour color |
| `setWireframeWhite(white)` | `this` | Toggle wireframe flat-white mode |
| `getWireframeWhite()` | `boolean` | Get wireframe white state |
| `setSunAzimuth(degrees)` | `this` | Set sun azimuth for hillshade lighting |
| `getSunAzimuth()` | `number` | Get sun azimuth |
| `setSunAltitude(degrees)` | `this` | Set sun altitude for hillshade lighting |
| `getSunAltitude()` | `number` | Get sun altitude |

##### ColorRamp

| Ramp | Description |
|---|---|
| `'hypsometric'` | Green, tan, brown, white (elevation default) |
| `'viridis'` | Purple, teal, yellow (perceptually uniform) |
| `'inferno'` | Black, purple, orange, white (high contrast) |
| `'grayscale'` | Black to white |

#### Camera

| Method | Returns | Description |
|---|---|---|
| `setMinPitch(degrees)` | `this` | Set minimum pitch (most tilted), 0–90 |
| `getMinPitch()` | `number` | Get minimum pitch |
| `setMaxPitch(degrees)` | `this` | Set maximum pitch (top-down), 0–90 |
| `getMaxPitch()` | `number` | Get maximum pitch |
| `getCameraController()` | `CameraController` | Direct camera access |

#### Lifecycle

| Method | Returns | Description |
|---|---|---|
| `start()` | `this` | Begin rendering and tile loading |
| `stop()` | `this` | Pause rendering |
| `destroy()` | `void` | Clean up all resources |

#### Events

```ts
map.on('ready', () => { /* initial tiles loaded */ });
map.on('move', ({ center }) => { /* camera moving */ });
```

| Event | Data | Description |
|---|---|---|
| `'ready'` | `{}` | Initial tiles loaded |
| `'zoom'` | `{ zoom }` | Zoom level changed |
| `'move'` | `{ center: LngLat }` | Camera moving |
| `'moveend'` | `{ center, zoom }` | Camera movement complete |
| `'tileload'` | `{ coord: TileCoord }` | Tile loaded |
| `'tileunload'` | `{ coord: TileCoord }` | Tile unloaded |
| `'layeradd'` | `{ id }` | Layer added |
| `'layerremove'` | `{ id }` | Layer removed |
| `'layerchange'` | `{}` | Layer configuration changed |

---

### Tile Sources

Layers accept `TileSource` instances via the `layerSource` option. Construct sources directly using `XYZSource` or `WMTSSource`.

##### Shared options (TileSourceOptions)

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | *required* | Endpoint URL or template |
| `tileSize` | `number` | `256` | Tile pixel size |
| `minZoom` | `number` | `0` | Minimum zoom level |
| `maxZoom` | `number` | `22` | Maximum zoom level |
| `attribution` | `string` | `''` | Attribution text |
| `accessToken` | `string` | - | Access token appended to requests |

#### XYZ Source

Standard slippy-map tiles with `{z}/{x}/{y}` URL placeholders.

```ts
import { XYZSource } from '@geozelot/treelet';

const source = new XYZSource({
  url: 'https://{s}.tile.example.com/{z}/{x}/{y}.png',
  subdomains: ['a', 'b', 'c'],
  tileSize: 256,
  maxZoom: 19,
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `subdomains` | `string[]` | `[]` | Subdomain rotation via `{s}` |

#### WMTS Source

OGC WMTS GetTile requests. Two modes, auto-detected:

**RESTful** - URL contains `{z}` placeholder (treated like XYZ):

```ts
import { WMTSSource } from '@geozelot/treelet';

const source = new WMTSSource({
  url: 'https://example.com/wmts/rest/dem/default/EPSG3857/{z}/{y}/{x}.png',
});
```

**KVP** - URL without placeholders (constructs `GetTile` query):

```ts
const source = new WMTSSource({
  url: 'https://example.com/wmts',
  layers: 'dem',
  tilematrixSet: 'EPSG:3857',
  style: 'default',
  format: 'image/png',
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `layers` | `string` | `''` | WMTS layer name |
| `style` | `string` | `'default'` | WMTS style |
| `tilematrixSet` | `string` | `'EPSG:3857'` | WMTS TileMatrixSet |
| `format` | `string` | `'image/png'` | Image format |
| `subdomains` | `string[]` | `[]` | Subdomain rotation via `{s}` |

---

### Elevation Decoders

Built-in decoders for common DEM tile formats:

| Decoder | Formula | Precision |
|---|---|---|
| `'terrain-rgb'` | `-10000 + (R×65536 + G×256 + B) × 0.1` | 0.1 m |
| `'mapbox'` | Alias for `terrain-rgb` | 0.1 m |
| `'terrarium'` | `R×256 + G + B/256 - 32768` | ~0.004 m |

#### Custom Decoder

Pass a decoder function directly, or register one globally by name:

```ts
import { registerDecoder, XYZSource } from '@geozelot/treelet';

// Inline: pass a function directly as the decoder
map.addBaseLayer({
  layerName: 'Custom DEM',
  layerSource: new XYZSource({ url: '...' }),
  decoder: (r, g, b, a) => r * 100 + g,
});

// Or register globally by name for reuse
registerDecoder('myformat', (r, g, b, a) => r * 100 + g);
map.addBaseLayer({
  layerName: 'Custom DEM',
  layerSource: new XYZSource({ url: '...' }),
  decoder: 'myformat' as any,
});
```

---

### Types

```ts
interface LngLat { lng: number; lat: number }
interface WorldPoint { x: number; y: number }
interface TileCoord { z: number; x: number; y: number }
interface TileBounds { west: number; south: number; east: number; north: number }

type BaseDrapeMode = 'wireframe' | 'elevation' | 'slope' | 'aspect' | 'contours';
type ColorRamp = 'hypsometric' | 'viridis' | 'inferno' | 'grayscale';
type BlendMode = 'normal' | 'hillshade' | 'softlight';
type DecoderType = 'terrain-rgb' | 'mapbox' | 'terrarium' | 'custom';
type UICorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
```

---

### Low-Level API

For advanced use, Treelet re-exports its internal building blocks:

| Export | Description |
|---|---|
| `Treelet` | Main class with static `Treelet.map()` factory |
| `UrlTileSource` | Base tile source class |
| `XYZSource`, `WMTSSource` | Concrete tile sources |
| `BaseLayer`, `DrapeLayer`, `OverlayLayer` | Layer wrappers |
| `LayerRegistry` | Layer management registry |
| `CameraController` | Camera state + controls |
| `WebMercator` | EPSG:3857 projection utilities |
| `TileGrid` | Tile math (world / tile coordinate conversion) |
| `EventEmitter` | Base event system |
| `RawRGBDecoder`, `MapboxDecoder`, `TerrariumDecoder` | Built-in decoder instances |
| `registerDecoder()`, `resolveDecoder()` | Decoder registration and lookup |
| `TreeletPanel`, `TreeletCompass`, `TreeletAttribution` | UI components |

---

## Controls

| Input | Action |
|---|---|
| Left-click drag | Pan |
| Scroll wheel | Zoom |
| Right-click drag | Orbit (rotate + tilt) |
| Compass click | Reset orientation |

## Bundles

Treelet ships two minified bundles:

| File | Format | Three.js | Use case |
|---|---|---|---|
| `treelet.es.js` | ESM | External | Bundlers (Vite, Webpack, Rollup) |
| `treelet.cdn.standalone.js` | IIFE | Included | `<script>` tag, CDN, no dependencies |

**Slim** (`treelet.es.js`) - ~140 KB minified. Three.js is a peer dependency; install it alongside treelet via npm. Best for projects that already use Three.js or want control over the Three.js version.

**Standalone** (`treelet.cdn.standalone.js`) - ~580 KB minified. Bundles only the Three.js modules treelet actually uses (tree-shaken). Drop-in ready for CDN or direct `<script>` tag usage - zero external dependencies.

Both bundles require the `tileWorker` asset file (`dist/assets/tileWorker-*.js`) to be served from the same origin.

## Browser Support

Modern browsers with **WebGL2** and **Web Workers**. Requires ES2020+.


## License

[MIT](LICENSE)
