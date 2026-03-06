[![npm](https://img.shields.io/npm/v/@geozelot/treelet)](https://www.npmjs.com/package/@geozelot/treelet)
[![CI](https://github.com/geozelot/treelet/actions/workflows/ci.yml/badge.svg)](https://github.com/geozelot/treelet/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@geozelot/treelet)](./LICENSE)
[![gzip](https://img.shields.io/bundlephobia/minzip/@geozelot/treelet)](https://bundlephobia.com/package/@geozelot/treelet)

# <img src="assets/treelet_logo.svg?sanitize=true" width="27"/> Treelet

#### A lightweight 3D terrain & overlay map library for the web - inspired by [Leaflet](https://leafletjs.com/) and powered by [Three.js](https://threejs.org/).

Treelet renders tiled elevation data as 3D terrain with drape overlays, LOD scheduling, and shader-based visualization - in the spirit of Leaflet's simple high-level API, solid low-level access, and zero bloat.

### [Live Demo](https://geozelot.github.io/Treelet/)

### Features

- **Tile sources** — XYZ, OGC WMS, OGC WMTS (RESTful + KVP)
- **Elevation decoding** — Terrain-RGB, Terrarium, Mapbox, custom decoders
- **Visualization modes** — Elevation, slope, aspect, contours, wireframe
- **Drape layers** — Overlay satellite, OSM, or any raster imagery onto terrain
- **LOD scheduling** — Nadir-based quadtree with cross-LOD seam resolution
- **Web Workers** — Off-thread tile fetch, decode, and mesh generation
- **Fluent API** — Chainable setters, Leaflet-style factory, EventEmitter

##

_This had been a project related to my PHD and that I needed to keep private until now - thoroughly overhauled and elevated to current tech standards. 3D terrain rendering has become more commonly supported, but this library still shines with simplicity, ease-of-use and performance. It's especially useful for self-hosted elevation and overlay data._


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
    center: { lng: 11.39, lat: 47.27 },
    zoom: 10,
  });
  // ...
  map.start();
</script>
```

### Minimal Example

```ts
import { Treelet } from '@geozelot/treelet';

const map = Treelet.map('map', {
  center: { lng: 11.39, lat: 47.27 },
  zoom: 10,
});

map.addBaseLayer({
  id: 'terrain',
  name: 'AWS Terrain',
  source: {
    type: 'xyz',
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    tileSize: 512,
    maxZoom: 15,
  },
  decoder: 'terrarium',
});

map.addDrapeLayer({
  id: 'osm',
  name: 'OpenStreetMap',
  source: {
    type: 'xyz',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileSize: 512,
    maxZoom: 19,
  },
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
| `center` | `LngLat` | *required* | Initial map center `{ lng, lat }` |
| `zoom` | `number` | *required* | Initial zoom level |
| `minZoom` | `number` | `0` | Minimum allowed zoom |
| `maxZoom` | `number` | `20` | Maximum allowed zoom |
| `tileSegments` | `number` | `128` | Mesh subdivisions per tile |
| `worldScale` | `number` | `40075.02` | CRS meters → scene units scale |
| `exaggeration` | `number` | `1.0` | Vertical exaggeration factor |
| `elevationRange` | `[number, number]` | `[0, 4000]` | Min/max elevation for color mapping |
| `contourInterval` | `number` | `100` | Contour line spacing in meters |
| `antialias` | `boolean` | `true` | WebGL antialiasing |
| `gui` | `boolean` | `true` | Show compass + layer panel |
| `minPitch` | `number` | `25` | Minimum pitch (most tilted) in degrees |
| `maxPitch` | `number` | `90` | Maximum pitch (top-down) in degrees |
| `compassPosition` | `UICorner` | `'top-right'` | Compass widget corner |
| `layerPosition` | `UICorner` | `'bottom-right'` | Layer panel corner |
| `workerCount` | `number` | `navigator.hardwareConcurrency` | Web Worker pool size |

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
| `addBaseLayer(options)` | `this` | Add an elevation data layer |
| `removeBaseLayer(id)` | `this` | Remove a base layer by ID |
| `setActiveBaseLayer(id)` | `this` | Switch active base layer |
| `getBaseLayers()` | `BaseLayer[]` | Get all registered base layers |

##### BaseLayerOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | *required* | Unique layer identifier |
| `name` | `string` | *required* | Display name |
| `source` | `LayerSourceOptions` | *required* | Tile source configuration |
| `decoder` | `DecoderType` | `'terrain-rgb'` | Elevation decoder |
| `decoderFn` | `CustomDecoderFn` | — | Custom per-pixel decoder function |
| `exaggeration` | `number` | `1.0` | Per-layer exaggeration multiplier |
| `active` | `boolean` | `true` | Set as active on add |

#### Drape Layers

Drape layers overlay raster imagery on the terrain mesh. Only one drape (external or BaseDrape) is active at a time.

| Method | Returns | Description |
|---|---|---|
| `addDrapeLayer(options)` | `this` | Add an imagery overlay layer |
| `removeDrapeLayer(id)` | `this` | Remove a drape layer by ID |
| `activateDrapeLayer(id)` | `this` | Activate an external drape |
| `activateBaseDrape(mode?)` | `this` | Switch to elevation-derived visualization |
| `setBaseDrapeMode(mode)` | `this` | Change BaseDrape mode |
| `getBaseDrapeMode()` | `BaseDrapeMode` | Get current BaseDrape mode |
| `getActiveDrapeId()` | `string \| null` | Active drape ID (`'__base_drape__'` for BaseDrape) |
| `isBaseDrapeActive()` | `boolean` | Check if BaseDrape is active |
| `setDrapeOpacity(id, opacity)` | `this` | Set drape opacity (0–1) |
| `getDrapeOpacity(id)` | `number` | Get drape opacity |
| `getDrapeLayers()` | `DrapeLayer[]` | Get all registered drape layers |

##### DrapeLayerOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | *required* | Unique layer identifier |
| `name` | `string` | *required* | Display name |
| `source` | `LayerSourceOptions` | *required* | Tile source configuration |
| `opacity` | `number` | `1.0` | Layer opacity |
| `blendMode` | `BlendMode` | `'normal'` | Blend mode: `'normal'`, `'multiply'`, `'screen'` |
| `active` | `boolean` | `true` | Set as active on add |

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
| `setExaggeration(value)` | `this` | Set global vertical exaggeration |
| `getExaggeration()` | `number` | Get exaggeration factor |
| `setContourInterval(meters)` | `this` | Set contour line spacing |
| `getContourInterval()` | `number` | Get contour interval |
| `setContourThickness(value)` | `this` | Set contour line thickness |
| `getContourThickness()` | `number` | Get contour thickness |
| `setContourColor(r, g, b)` | `this` | Set contour color (RGB, 0–1 each) |
| `getContourColor()` | `[r, g, b]` | Get contour color |
| `setWireframeWhite(white)` | `this` | Toggle wireframe flat-white mode |
| `getWireframeWhite()` | `boolean` | Get wireframe white state |

##### ColorRamp

| Ramp | Description |
|---|---|
| `'hypsometric'` | Green → tan → brown → white (elevation default) |
| `'viridis'` | Purple → teal → yellow (perceptually uniform) |
| `'inferno'` | Black → purple → orange → white (high contrast) |
| `'grayscale'` | Black → white |

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

All layers accept a `source` object conforming to `LayerSourceOptions`.

#### LayerSourceOptions

| Option | Type | Default | Used by | Description |
|---|---|---|---|---|
| `type` | `'xyz' \| 'wms' \| 'wmts'` | *required* | all | Source type |
| `url` | `string` | *required* | all | Endpoint URL or template |
| `subdomains` | `string[]` | `[]` | XYZ, WMTS | Subdomain rotation via `{s}` |
| `tileSize` | `number` | `256` | all | Tile pixel size |
| `maxZoom` | `number` | `22` | all | Maximum zoom level |
| `attribution` | `string` | `''` | all | Attribution text |
| `layers` | `string` | `''` | WMS, WMTS | Layer name(s) |
| `format` | `string` | `'image/png'` | WMS, WMTS | Image format |
| `crs` | `string` | `'EPSG:3857'` | WMS | Coordinate reference system |
| `style` | `string` | `'default'` | WMTS | WMTS style |
| `tilematrixSet` | `string` | `'EPSG:3857'` | WMTS | WMTS TileMatrixSet |

#### XYZ Source

Standard slippy-map tiles with `{z}/{x}/{y}` URL placeholders.

```ts
source: {
  type: 'xyz',
  url: 'https://{s}.tile.example.com/{z}/{x}/{y}.png',
  subdomains: ['a', 'b', 'c'],
  tileSize: 256,
  maxZoom: 19,
}
```

#### WMS Source

OGC WMS GetMap requests. Computes BBOX from tile coordinates with CRS reprojection.

```ts
source: {
  type: 'wms',
  url: 'https://example.com/geoserver/wms',
  layers: 'elevation',
  format: 'image/png',
  crs: 'EPSG:4326',
  tileSize: 256,
}
```

Supported CRS values: `EPSG:3857`, `EPSG:900913`, `EPSG:4326`, `CRS:84`.

#### WMTS Source

OGC WMTS GetTile requests. Two modes, auto-detected:

**RESTful** — URL contains `{z}` placeholder (treated like XYZ):

```ts
source: {
  type: 'wmts',
  url: 'https://example.com/wmts/rest/dem/default/EPSG3857/{z}/{y}/{x}.png',
}
```

**KVP** — URL without placeholders (constructs GetTile query):

```ts
source: {
  type: 'wmts',
  url: 'https://example.com/wmts',
  layers: 'dem',
  tilematrixSet: 'EPSG:3857',
  style: 'default',
  format: 'image/png',
}
```

---

### Elevation Decoders

Built-in decoders for common DEM tile formats:

| Decoder | Formula | Precision |
|---|---|---|
| `'terrain-rgb'` | `-10000 + (R×65536 + G×256 + B) × 0.1` | 0.1 m |
| `'mapbox'` | Alias for `terrain-rgb` | 0.1 m |
| `'terrarium'` | `R×256 + G + B/256 - 32768` | ~0.004 m |

#### Custom Decoder

```ts
import { createCustomDecoder, registerDecoder } from '@geozelot/treelet';

// Inline: pass directly as decoderFn
map.addBaseLayer({
  id: 'dem',
  name: 'Custom DEM',
  source: { type: 'xyz', url: '...' },
  decoder: 'custom',
  decoderFn: (r, g, b, a) => r * 100 + g,
});

// Or register globally by name
registerDecoder('myformat', createCustomDecoder((r, g, b, a) => r * 100 + g));
map.addBaseLayer({
  id: 'dem',
  name: 'Custom DEM',
  source: { type: 'xyz', url: '...' },
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
type BlendMode = 'normal' | 'multiply' | 'screen';
type DecoderType = 'terrain-rgb' | 'mapbox' | 'terrarium' | 'custom';
type UICorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
```

---

### Low-Level API

For advanced use, treelet re-exports its internal building blocks:

| Export | Description |
|---|---|
| `Treelet` | Main class with static `Treelet.map()` factory |
| `LayerSource` | Abstract source base class |
| `createSource()` | Factory: create a source from `LayerSourceOptions` |
| `XYZSource`, `WMSSource`, `WMTSSource` | Concrete tile sources |
| `BaseLayer`, `DrapeLayer` | Layer wrappers |
| `LayerRegistry` | Layer management registry |
| `DrapeCompositor` | Multi-resolution drape compositing |
| `SeamResolver` | Cross-LOD edge seam resolution |
| `CameraController` | Camera state + controls |
| `WebMercator` | EPSG:3857 projection utilities |
| `TileGrid` | Tile math (world ↔ tile coordinate conversion) |
| `EventEmitter` | Base event system |
| `createTerrainMaterial()` | Unified shader material factory |
| `terrainRGBDecoder`, `terrariumDecoder` | Decoder instances |
| `createCustomDecoder()`, `registerDecoder()` | Decoder registration |

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

**Slim** (`treelet.es.js`) — ~140 KB minified. Three.js is a peer dependency; install it alongside treelet via npm. Best for projects that already use Three.js or want control over the Three.js version.

**Standalone** (`treelet.cdn.standalone.js`) — ~580 KB minified. Bundles only the Three.js modules treelet actually uses (tree-shaken). Drop-in ready for CDN or direct `<script>` tag usage — zero external dependencies.

Both bundles require the `tileWorker` asset file (`dist/assets/tileWorker-*.js`) to be served from the same origin.

## Browser Support

Modern browsers with **WebGL2** and **Web Workers**. Requires ES2020+.


## What's next
- compositional overlay blend modes
- additional elevation-derived visualization modes
- support for more sources and formats


## License

[MIT](LICENSE)
