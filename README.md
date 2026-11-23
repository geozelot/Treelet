[![npm](https://img.shields.io/npm/v/@geozelot/treelet)](https://www.npmjs.com/package/@geozelot/treelet)
[![CI](https://github.com/geozelot/treelet/actions/workflows/ci.yml/badge.svg)](https://github.com/geozelot/treelet/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@geozelot/treelet)](./LICENSE)
[![gzip](https://img.shields.io/bundlephobia/minzip/@geozelot/treelet)](https://bundlephobia.com/package/@geozelot/treelet)

# <img src="assets/treelet_logo.svg?sanitize=true" width="33"/> Treelet.js

#### A GPU-driven, lightweight 3D elevation & overlay mapping engine for web-based terrain exploration and beautiful landscapes - inspired by the simplicity of [Leaflet.js](https://leafletjs.com/) and powered by [Three.js](https://threejs.org/).

Treelet provides a slim, high-level API for rendering elevation data as a continuous 3D surface, colored by a stack of *coats*: drape imagery (satellite, topographic maps) and terrain analyses (elevation, slope, aspect, contours, hillshade, shadows, viewsheds, sun hours…) blended over each other, with GeoJSON overlays and measuring tools on top.

Treelet aims to allow fast, web-based DEM exploration and visualization of self-hosted data-sets - easily integrated and enriched with available global-coverage data sources.

The library is designed to be easily extendable - via registry or plugin packages - and ships with a slim, themed UI panel for layer management and map control.

##
#### Rendering & Performance:

- **Single draw call rendering** - All visible tiles in one instanced GPU call from texture-array atlases
- **Screen-space LOD with CDLOD geomorphing** - Tile detail follows on-screen size at any zoom, tilt or viewport; vertices morph continuously into the coarser level, so LOD boundaries are watertight and never pop; while tiles load, skirts as deep as the relief in view close the gaps between tiles drawn from different data
- **Seamless, true-to-scale relief** - Shared tile edges are stitched on load and slopes at tile edges use the neighbouring tile's heights, so shading is continuous across tiles; heights are Mercator-corrected so slope, aspect and hillshade are accurate at every latitude
- **High-precision rendering** - Floating render origin and adaptive clip planes keep street-level zooms stable anywhere on the globe
- **Off-main-thread data pipeline** - Fetch, decode, resampling and mipmapping run in workers; failed tiles back off instead of retrying in a loop
- **Render on demand** - No GPU work while the view and data are idle

##

##
### [Live Demo](https://geozelot.github.io/Treelet/)

##
### Features

- #### **Data Sources:**
  - **XYZ** - _Slippy map_ | TMS
  - **WMTS** - RESTful | KVP
  - **WMS** - _via plugin_

- #### Terrain decoders:
  - **Terrain-RGB | Mapbox**
  - **Terrarium**
  - **Custom** (_via interface or registry_)

- #### Coat stack:
  - **Imagery** - one drape layer at a time, with opacity and blend mode
  - **Analyses** - any number, stacked over the imagery with opacity and blend mode:
    - **Elevation** - topographic coloring (fixed or auto range)
    - **Slope** - slope angle in degrees, optionally only for an aspect sector (avalanche classes preset)
    - **Aspect** - downslope bearing (cyclic ramp or eight sectors)
    - **Curvature** - profile, plan or total curvature on a diverging ramp
    - **Contours** - lines computed from the DEM per pixel, with index lines
    - **Water level** - flooding below a level, animatable
    - **Hillshade** - terrain light from the map's sun (placed by date and time if you like), one light or four (multidirectional)
    - **Shadows** - terrain-cast shadows of the sun, from a shadow map
  - **Region analyses** - computed in a worker over a loaded region, shown as coats:
    - **Viewshed** - ground visible from an observer (Earth curvature and refraction)
    - **Sun hours** - hours of direct sun on a date, with terrain shadows
    - **Sky-view factor** and **topographic position index**
  - **Raster layers** - your own value grids or images as coats (`addRasterLayer`)
  - **Ramps** - built-in or custom color stops and classes (with alpha), with legends
  - **Custom analyses** - a GLSL snippet plus a parameter schema (`registerAnalysis`)

- #### Overlays:
  - **GeoJSON** - points, lines and polygons draped on the terrain, with labels; fills as a coat

- #### Inspection and tools:
  - **Controls** - a compass with navigation, and two corner boxes that open into columns of rows: the tree (Layers, Measure) and the info box (Legend, Map, credits); full width on phones
  - **Cursor readout** - elevation, slope and aspect under the pointer
  - **Terrain sampling** - `sampleTerrain(lngLat)`, `pick(x, y)`: elevation, slope, aspect, curvature, normal
  - **Measuring** - distance and area on the map and along the terrain, ascent and descent
  - **Elevation profiles** - a chart with hover, CSV and PNG export
  - **Line of sight** - with Earth curvature and refraction
  - **Measuring tools** - distance, area, profile, line of sight and viewshed on the map (the tree's Measure page)

###
###

## Quick Start


### Installation

```bash
npm install @geozelot/treelet three
```

### CDN / Script Tag

For direct browser use without a bundler, use the **standalone** build which bundles Three.js and inlines the tile worker (no extra files to serve):

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
    tileSize: 256,
    maxZoom: 15,
  }),
  decoder: 'terrarium',
});

const osm = map.addDrapeLayer({
  layerName: 'OpenStreetMap',
  layerSource: new XYZSource({
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileSize: 256,
    maxZoom: 19,
  }),
});

// The ground is a stack of coats: imagery at the bottom, analyses above it.
// Parameters set from code are clamped to each parameter's limits (with a warning), not to the panel's slider range: contours take any positive interval, elevation and water ranges any elevation (bathymetry included); the panel's sliders widen to show such values.

A new map starts with a hillshade coat.
map.activateDrapeLayer(osm);
map.addAnalysisLayer({ analysis: 'slope', layerDisplay: { opacity: 0.6 } });
map.addAnalysisLayer({ analysis: 'contours', params: { interval: 50 } });

map.start();
```

## Guide

A map draws one **base layer** as terrain (elevation tiles decoded into a 3D surface) and colors it with a **coat stack**: the active drape (imagery) and any number of analysis layers, each with an opacity and a blend mode. Region analyses compute grids in a worker and add them as coats; **overlays** draw GeoJSON on the terrain; **tools** measure on it. Every layer is added with an `add…Layer` method that returns a `LayerHandle`, and changed or removed through that handle (`setLayerVisible`, `setLayerOpacity`, `removeLayer`, …). The sections below follow that order; the [API reference](https://geozelot.github.io/Treelet/api/) lists every class, method and type.

### The map

A `Treelet` is the map: it owns the canvas, the camera and the layers, and emits events (it extends `EventEmitter`).

#### Creating a map

Create a new Treelet map instance (static factory).

| Param | Type | Description |
|---|---|---|
| `container` | `string \| HTMLElement` | DOM element or element ID |
| `options` | `TreeletOptions` | Map configuration |

Returns `Treelet`. Equivalent to `new Treelet(container, options)`.

`Treelet.version` is the library version.

#### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `initCenter` | `LngLat` | *required* | Initial map center `{ lng, lat }` |
| `initZoom` | `number` | *required* | Initial zoom level |
| `minZoom` | `number` | `0` | Minimum allowed zoom |
| `maxZoom` | `number` | `20` | Maximum allowed zoom (≤ 22) |
| `mapDisplay` | `MapDisplayOptions` | `{}` | Rendering options (see below) |
| `guiDisplay` | `GuiDisplayOptions` | `{}` | UI widget options (see below) |
| `workerCount` | `number` | cores − 1, clamped to 1–4 | Web Worker pool size |
| `workerUrl` | `string \| URL` | inlined | URL of `dist/treelet.worker.js`, for CSPs without `worker-src blob:` |

Zoom follows the standard web-map scale: at zoom `z` the world spans `256 · 2^z` CSS pixels at the orbit target, as in Leaflet or Mapbox. Zoom is fractional. Options are validated on construction; invalid values throw a descriptive error.

##### MapDisplayOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `atlasSegments` | `number` | `64` | Mesh subdivisions per tile (even, ≤ `slotSize`) |
| `antialias` | `boolean` | `true` | WebGL antialiasing |
| `worldScale` | `number` | `40075.02` | CRS meters to scene units scale |
| `minPitch` | `number` | `25` | Minimum pitch (most tilted) in degrees |
| `maxPitch` | `number` | `90` | Maximum pitch (top-down) in degrees |
| `tileCacheSize` | `number` | `256` | Tiles kept in GPU memory (64–2048); up to 60% of them can be on screen. ~0.5 MB per tile, plus ~0.35 MB with a drape active (~1.4 MB with `drapeSlotSize: 512`) |
| `slotSize` | `number` | `256` | Elevation texels per tile edge |
| `drapeSlotSize` | `number` | `slotSize` | Drape pixels per tile edge. Each tile fetches imagery as fine as this holds: with 256-px source tiles, `512` loads one zoom finer (4 source tiles per terrain tile), sharp on high-DPI screens at ~4× the drape memory and requests |
| `maxInstances` | `number` | `512` | Tile budget per frame (capped at 60% of `tileCacheSize`) |
| `maxConcurrentFetches` | `number` | `12` | Concurrent requests per layer |
| `maxPixelRatio` | `number` | `2` | Device-pixel-ratio cap |
| `lodQuality` | `number` | `1` | LOD multiplier: > 1 finer tiles, < 1 coarser |
| `morphWidth` | `number` | `0.3` | Fraction of each LOD range used for geomorphing |
| `horizonDistance` | `number` | `16` | Visible range as a multiple of the camera's height (what the zoom and tilt give it above the terrain it looks at, or its actual height where that is more; 4–64); terrain fades into the horizon there |
| `fog` | `boolean` | `true` | Atmospheric haze over distant terrain; when `false`, terrain stays clear and only blends into the horizon over the last 20% of the range |
| `renderOnDemand` | `boolean` | `true` | Render only when the view, data or settings change |

The defaults fit a typical view in well under the tile budget at any screen size. Treelet logs a one-time note when a view needs more tiles than `tileCacheSize` allows (it then reduces distant detail rather than leaving holes). To raise the limit, set a larger `tileCacheSize`, e.g. `512`; memory grows with it.

##### GuiDisplayOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Show the controls (compass, hub, info box); the credits show either way |
| `compassPosition` | `UICorner` | `'top-right'` | Corner of the compass |
| `navigation` | `boolean` | `true` | Zoom, rotate and tilt buttons beside the compass (hidden on narrow maps) |
| `layerPosition` | `UICorner` | `'bottom-right'` | Corner of the hub: the tree box with the Layers and Measure pages |
| `infoPosition` | `UICorner \| false` | `'bottom-left'` | Corner of the info box with the Legend and Map pages and the credits, or `false` for none (the credits then show as a tag in a bottom corner) |
| `readout` | `boolean` | `true` | The terrain under the pointer on the Legend page (elevation, slope, aspect and the value of the topmost other analysis coat; after a tap on touch screens) |
| `tools` | `boolean` | `true` | The hub's Measure page: the measuring tools, their results and the elevation profile |
| `glass` | `boolean` | `false` | Frosted-glass controls (translucent, map blurred behind); costs some GPU time while the map redraws |

##### The controls

Every control is built from the same parts: rows 24 px high and 2 apart, a column padded 6, text 8 in from a row's edge. The selected choice has the active fill and a 2px line in the accent green; values are *scrub rows* (the row is the slider: drag it, tap or click a place in it, or use the arrow keys).

- **Compass** (60 box): its arrow follows the camera; a click resets the orientation. With `navigation`, wings beside it zoom (±1 level), rotate (±15°) and tilt (±5°).
- **Hub** (the tree, 56 box) and **info box** (56 box): a tap, click, Enter or Space turns the box into a column (264 wide) with a slim rail on its outer side. The box's icon sits at the rail's far end and closes the column; the page buttons stay by the corner it opened from. Escape steps back out of a sub-page, then closes the column. A click on the map leaves it open (the tools need those clicks).
  - **Layers**: the coat stack, top first (eye, then the coat's page: opacity, blend, its parameters rendered from the schema, ramp, order, removal), *Add layer* (analysis kinds and imagery), running region analyses with progress and cancel; then the terrain: source, exaggeration, light (a manual sun or a day and time) and mesh.
  - **Measure**: the tools, the live result, and the elevation profile.
  - **Legend**: the legends of the visible analyses and the terrain under the pointer.
  - **Map**: zoom, tiles, pitch and bearing; the center and extent, copied as EPSG:4326 or EPSG:3857 coordinates.
  - The credits (the active base layer's, the imagery's and the visible overlays') sit at the info column's foot.
- **Narrow maps** (under 600 px): the columns span the map's width, one is open at a time (the other box steps aside), and the compass has no wings.
- Two controls asking for the same corner: the later one takes the next free corner (with a warning).

The elements (`<treelet-compass>`, `<treelet-hub>`, `<treelet-info>` and the pages' `<treelet-panel>`, `<treelet-toolbar>`, `<treelet-profile>`, `<treelet-legend>`, `<treelet-readout>`, `<treelet-attribution>`) are exported; `TreeletHub` and `TreeletInfo` have `open(page?)`, `close()`, `isOpen` and `page`.

#### View

| Method | Returns | Description |
|---|---|---|
| `setView(center, zoom)` | `this` | Set map center and zoom (keeps pitch and bearing) |
| `getCenter()` | `LngLat` | Get the orbit target (the point the camera looks at) |
| `getZoom()` | `number` | Get current (fractional) zoom |
| `getBounds()` | `{ sw, ne } \| null` | Get visible bounding box |
| `getTileCount()` | `number` | Number of terrain tiles drawn in the last frame |
| `getStats()` | `TreeletStats` | Tiles, atlas use, pending and failed requests, coats, rasters, overlays, shadows, frame time |
| `setLodQuality(q)` | `this` | Change the LOD multiplier at runtime |
| `setHorizonDistance(factor)` | `this` | Visible range as a multiple of the camera's height (4–64) |
| `getHorizonDistance()` | `number` | Get the visible range factor |
| `setFog(enabled)` | `this` | Toggle atmospheric haze over distant terrain |
| `requestRender()` | `this` | Force a redraw (with `renderOnDemand`) |

#### Camera

The camera keeps its height while you pan or zoom. The orbit target is the terrain at the screen center, so the zoom follows the distance to it: panning onto a mountain zooms in. The camera only rises where it would otherwise touch the terrain (at once, so the terrain never cuts into the view), or, smoothly and keeping its pitch, where moving brings the terrain at the screen center closer than half the zoom's distance. Rotating into a mountain lifts the camera over it, still looking at the same point. Once past the obstacle, the camera glides back down until it shows your zoom again, but never below the height you were at, so it doesn't dive into valleys.

| Method | Returns | Description |
|---|---|---|
| `setMinPitch(degrees)` | `this` | Set minimum pitch (most tilted), 0–90 |
| `getMinPitch()` | `number` | Get minimum pitch |
| `setMaxPitch(degrees)` | `this` | Set maximum pitch (top-down), 0–90 |
| `getMaxPitch()` | `number` | Get maximum pitch |
| `getCameraController()` | `CameraController` | Direct camera access |

#### Input

| Input | Action |
|---|---|
| Left-click drag / one-finger drag | Pan |
| Scroll wheel / pinch | Zoom (towards the cursor) |
| Right-click drag / two-finger rotate | Orbit (rotate + tilt) |
| Arrow keys (canvas focused) | Pan |
| Compass click | Reset orientation |

#### Lifecycle

| Method | Returns | Description |
|---|---|---|
| `start()` | `this` | Begin rendering and tile loading |
| `stop()` | `this` | Pause rendering |
| `destroy()` | `void` | Release all resources, including the WebGL context (idempotent) |

#### Events

```ts
map.on('ready', () => { /* map started */ });
map.on('move', ({ center }) => { /* every frame the camera moves */ });
map.on('tileerror', ({ coord, layer, error }) => { /* request failed; retried with backoff */ });
```

| Event | Data | Description |
|---|---|---|
| `'ready'` | `{}` | Map started |
| `'zoom'` | `{ zoom }` | Zoom changed |
| `'move'` | `{ center: LngLat }` | Camera moved (once per frame) |
| `'moveend'` | `{ center, zoom }` | Camera movement settled (debounced) |
| `'tileload'` | `{ coord: TileCoord }` | Elevation tile loaded |
| `'tileunload'` | `{ coord: TileCoord }` | Elevation tile evicted |
| `'tileerror'` | `{ coord, layer, error }` | Tile request failed (`layer`: `'elevation' \| 'drape'`) |
| `'layeradd'` | `{ id }` | Layer added |
| `'layerremove'` | `{ id }` | Layer removed |
| `'layerchange'` | `{}` | Layers added, removed, shown, hidden or reordered; the active base or drape layer; an overlay's data |
| `'layerupdate'` | `{ id }` | A layer's values changed: analysis parameters or ramp, opacity, blend mode, an overlay's style (fires often while a slider is dragged or an animation runs) |
| `'rangechange'` | `{ min, max }` | Visible elevation range changed (`'auto'` ramps) |
| `'analysisstart'` | `{ id, kind, label }` | A region analysis started |
| `'analysisprogress'` | `{ id, kind, label, stage, progress }` | `stage`: `'loading'` (tiles) or `'computing'`; `progress` 0–1 of the stage |
| `'analysisend'` | `{ id, kind, label, status, error? }` | `status`: `'done' \| 'cancelled' \| 'error'` |
| `'sunchange'` | `{ azimuth, altitude, time }` | The sun moved |
| `'pickstart'` / `'pickend'` | `{ prompt }` / `{}` | `pickLocation()` waits for a click / stopped waiting |
| `'toolchange'` | `{ mode, drawing }` | A tool started, finished drawing or stopped |
| `'measure'` | `{ mode, final, result }` | A tool's result changed (`final` when drawing ended; `result` null when cleared) |

### Terrain

The active base layer is the terrain: elevation tiles from a tile source, decoded into meters.

#### Base layers

Only one base layer is active at a time. The active base layer provides elevation data for the terrain mesh. The first layer added becomes active; later ones only become active with `setActiveBaseLayer()` or `layerDisplay: { visible: true }`.

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
| `layerDisplay` | `BaseLayerDisplay` | `{}` | `{ visible?, exaggeration? }` (`visible: true` activates the layer on add) |
| `layerAttribution` | `string` | source attribution | Attribution text |
| `minZoom` | `number` | `0` | Minimum zoom level |
| `maxZoom` | `number` | `22` | Maximum zoom level (≤ 22) |

#### Tile sources

Layers accept `TileSource` instances via the `layerSource` option. Construct sources directly using `XYZSource` or `WMTSSource`.

##### Shared options (TileSourceOptions)

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | *required* | Endpoint URL or template |
| `tileSize` | `number` | `256` | Pixel size of the source's tiles (with `retina`, of the 1× tiles). Drapes use it to decide how many source tiles fill a slot until the first tile shows the real size; a mismatch is logged |
| `minZoom` | `number` | `0` | Minimum zoom level |
| `maxZoom` | `number` | `22` | Maximum zoom level |
| `attribution` | `string` | `''` | Attribution text (simple HTML links allowed; sanitized) |
| `accessToken` | `string` | - | Substituted for `{accessToken}`, otherwise appended as `access_token=` |
| `headers` | `Record<string, string>` | - | Extra request headers (e.g. `Authorization`) |
| `credentials` | `RequestCredentials` | `'same-origin'` | Fetch credentials mode |
| `referrerPolicy` | `ReferrerPolicy` | - | Fetch referrer policy |
| `retina` | `boolean \| string` | `''` | Value for `{r}`: `true` → `'@2x'` on high-DPI screens |
| `maxConcurrency` | `number` | `12` | Concurrent requests for this source |

Tiles answering **404 / 410 / 204** (or an empty body) are treated as nonexistent: elevation renders at sea level and drapes fall back to coarser imagery. Other failures are retried with exponential backoff (1 s → 60 s), never in a loop.

##### XYZ source

Standard slippy-map tiles. Placeholders: `{z}`, `{x}`, `{y}`, `{-y}` (TMS row), `{s}` (subdomain), `{quadkey}` (Bing), `{r}` (retina suffix), `{accessToken}`.

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

##### WMTS source

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

##### WMS source (plugin)

```ts
// Source lives in the repository under plugins/source/wms (not part of the npm bundle)
import { WMSSource } from './plugins/source/wms';

const source = new WMSSource({
  url: 'https://example.com/geoserver/wms',
  layers: 'dem',
  crs: 'EPSG:4326',
  version: '1.3.0', // lat/lon axis order for EPSG:4326
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `layers` | `string` | *required* | WMS layer list |
| `styles` | `string` | `''` | WMS styles |
| `format` | `string` | `'image/png'` | Image format |
| `crs` | `string` | `'EPSG:3857'` | `EPSG:3857`, `EPSG:900913`, `EPSG:4326` or `CRS:84` |
| `version` | `'1.1.1' \| '1.3.0'` | `'1.1.1'` | WMS version |
| `transparent` | `boolean` | `true` | Request transparent images |

#### Elevation decoders

Built-in decoders for common DEM tile formats:

| Decoder | Formula | Precision |
|---|---|---|
| `'terrain-rgb'` | `-10000 + (R×65536 + G×256 + B) × 0.1` | 0.1 m |
| `'mapbox'` | Alias for `terrain-rgb` | 0.1 m |
| `'terrarium'` | `R×256 + G + B/256 - 32768` | ~0.004 m |

Pixels with alpha 0 are treated as **nodata** for every decoder. Images are decoded with color management and premultiplication disabled, so encoded RGB values reach the decoder bit-exact.

##### Custom decoder

A decoder receives the tile's RGBA pixels and returns one elevation per pixel (meters, `NaN` for nodata). Decoders run inside the workers: they must be self-contained pure functions (they are serialized and compiled there, so the page's CSP must allow `unsafe-eval` for custom decoders).

```ts
import { registerDecoder, XYZSource } from '@geozelot/treelet';

// Inline: pass a function directly as the decoder
map.addBaseLayer({
  layerName: 'Custom DEM',
  layerSource: new XYZSource({ url: '...' }),
  decoder: (pixels, width, height) => {
    const out = new Float32Array(width * height);
    for (let i = 0; i < out.length; i++) out[i] = pixels[i * 4] * 10 - 500;
    return out;
  },
});

// Or register globally by name for reuse
registerDecoder('myformat', (pixels, width, height) => { /* ... */ return new Float32Array(width * height); });
map.addBaseLayer({
  layerName: 'Custom DEM',
  layerSource: new XYZSource({ url: '...' }),
  decoder: 'myformat' as any,
});
```

### Coloring the ground

The ground color is a stack of coats, bottom first: the active drape (imagery) and analysis layers. Each coat has an opacity and a blend mode; value analyses map their value through a color ramp and show a legend.

#### The coat stack

| Method | Returns | Description |
|---|---|---|
| `getLayerStack()` | `(DrapeLayer \| AnalysisLayer)[]` | The coats in drawing order, bottom first |
| `moveLayer(handle, index)` | `this` | Move a coat (0 = bottom) |
| `setLayerVisible(handle, visible)` | `this` | Show or hide a coat or an overlay (for a base layer, `true` activates it) |
| `setLayerOpacity(handle, opacity)` | `this` | Opacity 0–1 of a coat (an analysis layer or a drape; an inactive drape keeps it for when it is shown) or an overlay |
| `getLayerOpacity(handle)` | `number` | |
| `removeLayer(handle)` | `this` | Remove a layer of any kind (base, drape, analysis, raster, overlay) |
| `setLayerBlendMode(handle, mode)` | `this` | `'normal' \| 'multiply' \| 'screen' \| 'softlight'` (any drape, active or not) |
| `getLayerBlendMode(handle)` | `BlendMode` | |

At most 6 coats are drawn (the lowest ones; a coat at opacity 0 or outside its `minZoom`–`maxZoom` isn't drawn and doesn't count). An active drape outside its zoom range shows the coats below it. The hub's Layers page lists the stack: visibility, and each coat's page with its settings (rendered from its parameter schema), order and removal.

#### Drape layers

Drape layers render raster imagery onto the terrain. One drape is active at a time: it forms the **imagery coat** at the bottom of the coat stack.

| Method | Returns | Description |
|---|---|---|
| `addDrapeLayer(options)` | `LayerHandle` | Register an imagery layer (inactive until activated) |
| `removeDrapeLayer(handle)` | `this` | Remove a drape layer |
| `activateDrapeLayer(handle)` | `this` | Make a drape the imagery coat (replaces the active one) |
| `deactivateDrapeLayer()` | `this` | Remove the imagery coat (the layer stays registered) |
| `getActiveDrapeId()` | `string \| null` | Active drape ID |
| `getDrapeLayers()` | `DrapeLayer[]` | Get all registered drape layers |

##### DrapeLayerOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `layerName` | `string` | *required* | Display name |
| `layerSource` | `TileSource` | *required* | Tile source instance |
| `layerDisplay` | `DrapeLayerDisplay` | `{}` | `{ visible?, opacity?, blendMode? }` |
| `layerAttribution` | `string` | source attribution | Attribution text |
| `minZoom` | `number` | `0` | Minimum zoom level |
| `maxZoom` | `number` | `22` | Maximum zoom level |

#### Analysis layers

An analysis layer is a coat computed from the terrain: elevation, slope, aspect, curvature, contours, water or hillshade (or a kind you register). Any number can be stacked over the imagery, each with opacity and a blend mode. Kinds that map a value (elevation, slope, aspect, curvature) use a color **ramp** and have a legend; contours, water and hillshade produce a color directly.

| Method | Returns | Description |
|---|---|---|
| `addAnalysisLayer(options)` | `LayerHandle` | Add a coat. Value kinds go in just above the imagery and the other value coats; contours and hillshade go on top |
| `removeAnalysisLayer(handle)` | `this` | Remove the coat |
| `setAnalysisParams(handle, params)` | `this` | Merge parameters (see the kind's parameters below) |
| `getAnalysisParams(handle)` | `object \| null` | A copy of the current parameters |
| `animateAnalysisParams(handle, targets, duration?)` | `Promise<boolean>` | Tween numeric parameters to `value` or from `[from, to]` over `duration` ms (default 1000); resolves `false` when replaced or the layer is removed |
| `getAnalysisValue(handle, lngLat)` | `number \| null` | The value a value coat colors at a position, in its unit (computed on the CPU like the shader; a raster's value for raster kinds) |
| `setAnalysisRamp(handle, ramp)` | `this` | Ramp of a value kind: a built-in name or stops / classes |
| `getAnalysisRamp(handle)` | `Ramp \| undefined` | Current ramp |
| `getLegend(handle)` | `LegendSpec \| null` | Legend of a value coat (title, unit, domain, stops or classes) |
| `getLegends()` | `LegendSpec[]` | Legends of the visible value coats, top first |
| `getAnalysisLayers()` | `AnalysisLayer[]` | All analysis layers |

##### AnalysisLayerOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `analysis` | `string` | *required* | Kind: `'elevation' \| 'slope' \| 'aspect' \| 'curvature' \| 'contours' \| 'water' \| 'hillshade' \| 'shadows'` or a registered id |
| `layerName` | `string` | the kind's label | Display name |
| `params` | `object` | kind defaults | Parameters (below) |
| `ramp` | `Ramp` | kind default | Color ramp (value kinds) |
| `layerDisplay` | `AnalysisLayerDisplay` | `{}` | `{ visible?, opacity?, blendMode? }` |

##### Built-in analyses

| Kind | Parameters | Ramp | Default display |
|---|---|---|---|
| `'elevation'` | `range: [min, max] \| 'auto'` (m; `'auto'` fits the visible data) | `'hypsometric'` | normal, opacity 1 |
| `'slope'` | `range: [min, max]` (degrees), `aspectMask: [from, to] \| null` (draw only slopes facing this sector, clockwise; `[315, 45]` is north; ends are taken modulo 360°, and a clockwise span of a whole turn, e.g. `[0, 360]`, is every bearing) | `'viridis'` | normal, opacity 1 |
| `'aspect'` | — (0° = north; transparent below 1° of slope, fully drawn from 5°) | `'cyclic'` | normal, opacity 1 |
| `'curvature'` | `mode: 'total' \| 'profile' \| 'plan'`, `range: [min, max]` (1/km; convex positive) | `'diverging'` | normal, opacity 1 |
| `'contours'` | `interval` (m), `thickness` (px), `index` (every Nth line bolder, 0 = off), `color: [r, g, b]` | — | normal, opacity 0.75 |
| `'water'` | `level` (m), `color: [r, g, b]`, `depthFade` (m over which the water darkens), `shoreline` (m of fade at the shore) | — | normal, opacity 0.85 |
| `'hillshade'` | `mode: 'single' \| 'multi'`, `ambient` (light on slopes facing away from the sun, 0–1) | — | multiply, opacity 0.6 |
| `'shadows'` | `darkness` (0–1, default 0.5) | — | multiply, opacity 1 |

The `'multi'` hillshade lights the terrain from four directions at the sun's altitude (the sun azimuth, 45° on either side of it and 90° counter-clockwise), each weighted by cos² of the angle between its azimuth and the slope's aspect (multidirectional oblique weighting, Mark 1992): the light in line with a slope, across the ridge or valley it belongs to, counts most, so ridges and valleys running toward the sun keep their relief instead of going flat, and slopes facing the sun get a little less glare.

`'shadows'` darkens ground that the terrain hides from the sun. While a shadows coat is visible the renderer keeps a shadow map: the terrain drawn into a 2048 × 2048 depth texture from the sun, fitted with a margin around the part of the view where terrain is seen (at most four times the camera's distance, a third of the visible range), snapped to whole texels so it doesn't shimmer, and drawn again only when the sun moves, the view leaves the fitted area or zooming in calls for more detail (finer terrain as it loads at most every 150 ms). Shadows fade out at its far edge, are filtered over 3 × 3 texels, and follow the drawn terrain (exaggeration included). Only terrain in view casts them, so a mountain behind the camera doesn't. Place the sun with `setSunTime(date)` for the shadows of a given moment.

A new map starts with a hillshade coat. Slope, aspect and curvature are true-scale (unaffected by exaggeration); curvature is computed at the rendered tile's resolution, so its values grow as finer tiles load. A new water coat starts a third of the way up the visible elevation range unless `level` is given.

```ts
// Avalanche terrain over imagery: nothing below 30°, then yellow, orange, red, violet
const slope = map.addAnalysisLayer({
  analysis: 'slope',
  ramp: 'avalanche',
  params: { aspectMask: [315, 45] }, // north-facing slopes only
  layerDisplay: { opacity: 0.7 },
});
map.getLegend(slope); // { type: 'classes', classes: [{ color, label: '30–35°' }, …] }

// Rising water
const water = map.addAnalysisLayer({ analysis: 'water' });
const [lo, hi] = map.getVisibleElevationRange();
await map.animateAnalysisParams(water, { level: [lo, (lo + hi) / 2] }, 4000);
```

##### Custom analyses

`registerAnalysis(descriptor)` adds a kind. The descriptor's `glsl` defines `vec4 analysis_<id>(Surface s, vec4 p0, vec4 p1)`; `s.h` is the elevation in meters, `s.n` the true-scale unit normal (x east, y north, z up), `s.g` the gradient (dh/dx east, dh/dy north, m/m), `s.c` the second derivatives (hxx, hyy, hxy in 1/m), `s.fw` the screen-space derivative of `s.h`, and `uSunDirection` the sun. A value kind (with a `ramp`) returns the normalized value in `.x` and the alpha in `.w`; a color kind returns `rgb` and alpha. `params` is the schema the panel renders (`range`, `span`, `select`, `color`, `boolean`; a `span` may be `optional` and `wrap` for compass sectors, a `range` may take its slider `bounds` from the visible elevation; `min`–`max` is the slider range and `limits` the range values are clamped to, by default the same), `pack(params, domain)` fills `p0`/`p1`, `domain(params, visible)` gives the ramp's value range for the visible elevation range (evaluated again as it changes, so a domain derived from it follows the view), `initialParams(visible)` derives defaults from the visible elevation range, and `cpu(sample, params)` computes the same value on the CPU (`getAnalysisValue`, the readout). `registerAnalysis` checks the ramp and blend mode. See `src/analysis/builtins/` for examples.

#### Color ramps

| Ramp | Description |
|---|---|
| `'hypsometric'` | Green, tan, brown, white (elevation default) |
| `'viridis'` | Purple, teal, yellow (perceptually uniform) |
| `'inferno'` | Black, purple, orange, white (high contrast) |
| `'grayscale'` | Black to white |
| `'cyclic'` | Hue wheel for circular data (aspect default) |
| `'diverging'` | Blue, white, red (curvature default) |
| `'avalanche'` | Slope classes: nothing below 30°, then 30–35° yellow, 35–40° orange, 40–45° red, ≥ 45° violet |
| `'aspect8'` | Eight compass sectors (N, NE, … NW) |
| `'visibility'` | Viewshed: hidden ground shaded, visible ground green |

A ramp can also be given as data: `{ type: 'continuous', stops: [[t, [r, g, b]], …] }` with `t` in 0–1 over the value range, or `{ type: 'classes', breaks: [...], colors: [...], labels? }` with breaks in the analysis' units (one more color than breaks). Colors may be `[r, g, b, a]`; a class with alpha 0 draws nothing and is left out of the legend. Legends, the panel preview and the shader all read the same spec.

### Light, shadow and exaggeration

The sun lights the hillshade and casts the shadows coat; place it by hand or by date and time. Exaggeration stretches the relief (analyses stay true to scale).

#### Visualization

| Method | Returns | Description |
|---|---|---|
| `setExaggeration(value)` | `this` | Set vertical exaggeration on active base layer |
| `setExaggeration(handle, value)` | `this` | Set exaggeration on a specific base layer |
| `getExaggeration()` | `number` | Get exaggeration factor |
| `setWireframe(enabled)` | `this` | Draw the mesh as a wireframe (colored by the coats) |
| `getWireframe()` | `boolean` | |
| `setWireframeWhite(white)` | `this` | Flat-white wireframe |
| `getWireframeWhite()` | `boolean` | |
| `setSunAzimuth(degrees)` | `this` | Sun azimuth for hillshade (default 315°, north-west) |
| `getSunAzimuth()` | `number` | |
| `setSunAltitude(degrees)` | `this` | Sun altitude for hillshade (default 45°) |
| `getSunAltitude()` | `number` | |
| `setSunTime(date \| null)` | `this` | Place the sun where it stands at `date` over the map center (it follows the map as it moves); `null` returns to the manual sun where it was |
| `getSunTime()` | `Date \| null` | |
| `getSunPosition(date?, lngLat?)` | `SunPosition` | `{ azimuth, altitude, declination, equationOfTime }` (NOAA algorithm, refraction-corrected) |

Setting the azimuth or altitude by hand clears the sun time. The *Light* page (the hub's Layers page) switches between a manual sun and a day and time.

### Region analyses and rasters

#### Region analyses

Analyses that need more than one point of the surface run in a dedicated worker over a *region*: the elevation tiles covering a box, at the finest zoom that needs no more than `maxTiles` tiles (default 64, i.e. about 2048 × 2048 cells), assembled into one grid. The result is shown as a coat (a raster layer of the analysis' kind) and returned with its data. The worker keeps the last two regions, so several analyses of the same view load the tiles once.

| Method | Returns | Description |
|---|---|---|
| `computeViewshed(observer, options?)` | `Promise<ViewshedResult>` | Ground visible from `observer` (lng/lat) |
| `computeSunHours(options?)` | `Promise<SunHoursResult>` | Hours of direct sun on a day, with terrain shadows |
| `computeSkyView(options?)` | `Promise<GridResult>` | Sky-view factor: the visible fraction of the sky (1 open, lower in valleys) |
| `computeTpi(options?)` | `Promise<GridResult>` | Topographic position index: meters above (+) or below (−) the surrounding mean |
| `computeAnalysis(kind, options?)` | `Promise<…>` | Any of the above by kind (`'viewshed'` needs `observer`; `REGION_ANALYSIS_INPUT[kind]` says which kinds need a point) |
| `getElevationGrid(options?)` | `Promise<ElevationGrid>` | The region's elevations (`data`, `min`, `max`) |
| `getAnalysisJobs()` | `AnalysisJob[]` | Running analyses `{ id, kind, label, stage, progress }` |
| `cancelAnalysis(id)` | `this` | Cancel one; its promise rejects with an `AbortError` |

Options of every region analysis (`RegionOptions`, `ResultLayerOptions`):

| Option | Type | Default | Description |
|---|---|---|---|
| `bounds` | `TileBounds` | the area in view | Region in degrees (the viewshed's default is a square around the observer) |
| `zoom` | `number` | source's finest | Finest zoom of the elevation tiles |
| `maxTiles` | `number` | `64` | Tile budget; the zoom drops until the region fits |
| `signal` | `AbortSignal` | — | Cancels the job |
| `addLayer` | `boolean` | `true` | Show the result as a coat |
| `layerName`, `layerDisplay` | | | Name and `{ opacity, blendMode, visible }` of the coat |
| `replaceLayer` | `LayerHandle \| string` | — | A coat the result replaces: removed once the result is shown, which takes its place in the stack |

| Analysis | Own options | Result |
|---|---|---|
| Viewshed | `eyeHeight` (1.7 m), `targetHeight` (0), `radius` (10 000 m), `fov` (360°), `bearing` (0°), `curvature` (true), `refraction` (0.13), `clearance` | `visible` (1 / 0 / NaN outside), `clearance` (m a hidden target must rise), `visibleArea` (m²), `observerElevation` |
| Sun hours | `date` (the sun time, or today), `stepMinutes` (15), `utcOffset` (this browser's) | `hours`, `firstSun` / `lastSun` (time of day), `daylight` (h) |
| Sky view | `radius` (whole region), `directions` (16) | `data` (0–1) |
| TPI | `radius` (500 m), `innerRadius` (0: a box; > 0: a ring) | `data` (m) |

Every result carries `bounds`, `width`, `height`, `zoom`, `cellSize` (meters) and `missingTiles`. A job that would have no raster slot for its coat fails before loading anything; `'done'` is reported once the result is shown (a failure to show it ends the job with `'error'`). A region whose tiles failed to load is loaded again by the next analysis (the failed tiles are retried). The viewshed casts rays from the observer to every cell on the edge of the search square and drops distant ground by the Earth's curvature less refraction (`d² (1 − k) / 2R`). Sun hours sweep the terrain's shadow along the sun's azimuth for every sun position of the day; terrain outside the region casts no shadow. Without a radius the sky view searches the whole region exactly (one sweep per direction); with one it samples up to 128 cells per direction, which is slower. While an analysis runs, the hub's Layers page shows its progress and a cancel button (and the tree box at rest a progress line); *Add layer* runs them over the view (the viewshed asks for a click on the observer first).

```ts
const summit = { lng: 11.3853, lat: 47.3122 };
const { visibleArea, layer } = await map.computeViewshed(summit, { radius: 12000, eyeHeight: 2 });
console.log(`${(visibleArea / 1e6).toFixed(1)} km² visible`);
map.getRasterValue(layer!, { lng: 11.3928, lat: 47.2654 }); // 1: Innsbruck is in view

const sun = await map.computeSunHours({ date: new Date(2026, 11, 21) });
console.log(`${sun.daylight} h of daylight`);
```

#### Raster layers

Your own grids, drawn like any coat: single-band values (`Float32Array`, colored by a ramp, with a legend) or images (RGBA bytes). Rows run from north to south; `bounds` are the outer edges of the cells. At most 4 raster coats (including analysis results) are shown at once.

| Method | Returns | Description |
|---|---|---|
| `addRasterLayer(options)` | `LayerHandle` | Add a raster coat (remove it with `removeAnalysisLayer`) |
| `getRasterInfo(handle)` | `{ width, height, bounds, range, color } \| null` | Size, bounds and value range |
| `getRasterValue(handle, lngLat)` | `number \| null` | Value at a position, filtered as drawn |

| Option | Type | Default | Description |
|---|---|---|---|
| `data` | `Float32Array \| Uint8Array \| Uint8ClampedArray` | *required* | `width·height` values (NaN = no data) or `width·height·4` RGBA bytes (straight alpha) |
| `width`, `height` | `number` | *required* | Grid size in cells |
| `bounds` | `TileBounds` | *required* | Outer edges in degrees |
| `crs` | `'EPSG:3857' \| 'EPSG:4326'` | `'EPSG:3857'` | Rows evenly spaced in Web Mercator (like map tiles) or in latitude (resampled once) |
| `nodata` | `number` | — | A value that marks missing data (matched as the float32 it is stored as, so e.g. `-3.4e38` works) |
| `range` | `[number, number]` | data min / max | Ramp range (either order) |
| `ramp`, `unit`, `layerName`, `layerDisplay` | | `'viridis'` | As for analysis layers |

```ts
const temps = new Float32Array(200 * 100); // …filled row by row from the north
map.addRasterLayer({
  data: temps, width: 200, height: 100,
  bounds: { west: 10, south: 46, east: 13, north: 48 }, crs: 'EPSG:4326',
  ramp: 'inferno', unit: '°C', layerName: 'Temperature', layerDisplay: { opacity: 0.7 },
});
```

Value rasters are filtered bilinearly between cell centers in the shader (no-data cells are skipped), so they work on GPUs without float-texture filtering.

### Overlays

#### Overlay layers

GeoJSON features drawn on the terrain: lines draped along it (densified to the terrain in view; where finer tiles load, their heights are updated in place), points as round markers, polygon fills rasterized into a coat (so they lie exactly on the ground; they take one of the 4 raster slots), labels from a property. Terrain in front hides them; a translucent line covers each pixel once. The fill coat belongs to its overlay: it shows only while the overlay is visible and in its zoom range, at the overlay's opacity times its own, and keeps its place in the stack (and its blend mode) when the data or style changes; removing it from the stack turns the overlay's fills off. A visible overlay's `layerAttribution` shows in the map's credits. Positions must be numbers (or numeric strings); others are skipped with a warning.

| Method | Returns | Description |
|---|---|---|
| `addOverlayLayer(options)` | `LayerHandle` | Add an overlay |
| `setOverlayData(handle, data)` | `this` | Replace its features |
| `setOverlayStyle(handle, style)` | `this` | Replace its style |
| `setLayerVisible(handle, visible)` | `this` | Show or hide it (with its fill coat) |
| `setLayerOpacity(handle, opacity)` | `this` | Lines, points, labels and the fill coat |
| `removeLayer(handle)` | `this` | Remove it (`removeOverlayLayer` does the same) |
| `getOverlayLayers()` | `OverlayLayer[]` | |

| Option | Type | Default | Description |
|---|---|---|---|
| `layerName` | `string` | *required* | Display name (also of the fill coat) |
| `data` | `GeoJSON` | — | FeatureCollection, Feature or Geometry in lng/lat; z values are ignored |
| `style` | `OverlayStyle \| (feature) => OverlayStyle` | — | One style, or one per feature |
| `fills` | `boolean` | `true` | Draw polygon fills as a coat |
| `minZoom`, `maxZoom` | `number` | `0`, `20` | Zoom range the overlay shows in |
| `layerDisplay` | `{ visible?, opacity? }` | | |

| Style | Default | Description |
|---|---|---|
| `color` | `'#ff6a00'` | Default for lines, points and fills (CSS color or `[r, g, b]`) |
| `opacity` | `1` | Lines and points |
| `lineWidth`, `lineColor` | `2.5`, `color` | Width in CSS pixels |
| `fillColor`, `fillOpacity` | `color`, `0.3` | `fillColor: null` for no fill |
| `pointRadius`, `pointColor` | `5`, `color` | Radius in CSS pixels |
| `pointStroke`, `pointStrokeWidth` | white, `1.5` | Marker outline |
| `label` | — | A property name, or `(properties) => text` |
| `labelColor`, `labelHalo`, `labelSize` | dark, white, `12` | |

```ts
map.addOverlayLayer({
  layerName: 'Huts',
  data: huts, // a GeoJSON FeatureCollection of points
  style: (f) => ({ color: f.properties?.open ? '#2f9e44' : '#868e96', label: 'name' }),
});
```

### Inspection and tools

#### Inspection

| Method | Returns | Description |
|---|---|---|
| `getElevation(lngLat)` | `number \| null` | Elevation in meters from the finest loaded tile |
| `sampleTerrain(lngLat)` | `TerrainSample \| null` | `{ elevation, slope, aspect, curvature, normal }` at a position (true scale; aspect is `null` on flat ground) |
| `pick(x, y)` | `TerrainPick \| null` | The same plus `lngLat` for the terrain under container-relative pixel `(x, y)` |
| `getElevationProfile(from, to, samples?)` | `ProfileSample[]` | `{ lngLat, distance, elevation }` samples along a line (distance in meters) |
| `getVisibleElevationRange()` | `[number, number]` | Min and max elevation of the tiles on screen |
| `getElevationGrid(options?)` | `Promise<ElevationGrid>` | Elevations of a region as one grid (see [Region analyses](#region-analyses)) |
| `pickLocation(options?)` | `Promise<TerrainPick \| null>` | Wait for a click on the terrain (crosshair cursor; `prompt` shown on the hub's Layers page); `null` after Escape or `cancelPick()` |
| `project(lngLat)` | `{ x, y } \| null` | Screen position (container pixels) of the terrain at a position |
| `measureDistance(points)` | `PathMeasure` | `{ distance, surfaceDistance, gain, loss, minElevation, maxElevation, profile }` of a path |
| `measureArea(ring)` | `AreaMeasure` | `{ area, surfaceArea, perimeter, minElevation, maxElevation }` of a polygon |
| `lineOfSight(from, to, options?)` | `LineOfSightResult \| null` | `{ visible, obstruction, clearance, distance, profile }`; options `fromHeight` (1.7 m), `toHeight` (0), `curvature`, `refraction` |
| `showProfile(path \| lineOfSight, options?)` | `this` | Show the elevation profile of a path or a line-of-sight result (on the hub's Measure page) |
| `hideProfile()` | `this` | Close it |

Slope, aspect and curvature come from the same 12-texel surface the shader shades, at the finest loaded tile's resolution.

```ts
map.on('moveend', () => {
  const pick = map.pick(200, 150);
  if (pick) console.log(`${pick.elevation.toFixed(1)} m, ${pick.slope.toFixed(1)}°`, pick.lngLat);
});
```

Distances are geodesic (WGS84 ellipsoid); `surfaceDistance` follows the terrain, sampled at the loaded tiles' resolution. Areas are computed on the authalic sphere (within about 0.5 % of the ellipsoid for regional polygons); `surfaceArea` adds the slopes. A line of sight drops distant terrain by the Earth's curvature less refraction, like the viewshed.

#### Tools

`startTool(mode)` starts a measuring tool on the map: `'distance'`, `'area'`, `'profile'` (a path whose profile opens when finished) or `'sight'` (observer, then target). Click (tap) to add points, drag a point to move it, double-click, Enter or a long press to finish, Backspace to remove the last point, Escape to stop. The geometry stays until `clearTool()` or the next tool.

| Method | Returns | Description |
|---|---|---|
| `startTool(mode)` | `this` | Start a tool |
| `finishTool()` | `this` | Finish drawing |
| `clearTool()` | `this` | Stop and remove its geometry |
| `getTool()` | `{ mode, drawing, points, result }` | The tool's state |

```ts
map.on('measure', ({ mode, final, result }) => {
  if (final && result?.mode === 'distance') console.log(formatDistance(result.path.surfaceDistance));
});
map.startTool('distance');
```

The hub's Measure page (`guiDisplay.tools`) offers the tools, plus the viewshed from a clicked point, and shows the live result with *Profile*, *Finish* and *Clear*; `showProfile` opens the profile there (or, without a Measure page, in a card at the bottom of the map).

## API Reference

The full reference, generated from the source with TypeDoc, is published with the demo: **[geozelot.github.io/Treelet/api](https://geozelot.github.io/Treelet/api/)** (`npm run docs:api` builds it into `docs/api/`).

### Types

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
interface ProfileSample { lngLat: LngLat; distance: number; elevation: number | null }
interface TreeletStats {
  tiles: number; drawCalls: number; coats: number; rasters: number; overlays: number; shadows: boolean;
  frameTime: number; atlasUsed: number; atlasCapacity: number;
  drapeTiles: number; pendingElevation: number; pendingDrape: number; failedTiles: number;
}
```

### Low-level API

For advanced use, Treelet re-exports its internal building blocks:

| Export | Description |
|---|---|
| `Treelet` | Main class with static `Treelet.map()` factory |
| `UrlTileSource` | Base tile source class |
| `XYZSource`, `WMTSSource` | Concrete tile sources |
| `BaseLayer`, `DrapeLayer`, `AnalysisLayer`, `OverlayLayer` | Layer classes (what `getLayerStack()`, `getBaseLayers()` … return) |
| `registerAnalysis()`, `getAnalysis()`, `listAnalyses()`, `resolveParams()` | Analysis registry |
| `BUILTIN_RAMPS`, `resolveRamp()`, `rampColorAt()`, `rampGradientCss()`, `legendFor()` | Ramps and legends |
| `sunPosition()`, `sunPathOfDay()` | NOAA solar position |
| `planRegion()` | The tiles a region analysis loads |
| `LayerRegistry` | Layer management registry |
| `CameraController` | Camera state + controls |
| `WebMercator` | EPSG:3857 projection utilities |
| `TileGrid` | Tile math (world / tile coordinate conversion) |
| `EventEmitter` | Base event system |
| `RawRGBDecoder`, `MapboxDecoder`, `TerrariumDecoder` | Built-in decoder instances |
| `registerDecoder()`, `resolveDecoder()` | Decoder registration and lookup |
| `TreeletPanel`, `TreeletCompass`, `TreeletAttribution`, `TreeletLegend`, `TreeletReadout`, `TreeletToolbar`, `TreeletProfile`, `TreeletLabels` | UI components |
| `geodesicDistance`, `pathLength`, `ringArea`, `polygonArea`, `lineOfSightProfile` | Geodesy and line of sight |
| `formatDistance`, `formatArea`, `formatElevation` | Measurement formatting |
| `defineTreeletElements()` | Register the UI custom elements (done automatically by `Treelet`) |

## Migrating from 0.3

1.0 replaces the base-drape modes with the coat stack and removes deprecated options. The [changelog](CHANGELOG.md#migrating-from-03) maps every removed call to its replacement.

## Bundles

Treelet ships three minified files:

| File | Format | Three.js | Use case |
|---|---|---|---|
| `treelet.es.js` | ESM | External | Bundlers (Vite, Webpack, Rollup) |
| `treelet.cdn.standalone.js` | IIFE | Included | `<script>` tag, CDN, no dependencies |
| `treelet.worker.js` | ESM worker | - | Optional: self-hosted worker for strict CSP (`workerUrl`) |

**Slim** (`treelet.es.js`) - ~460 KB minified (~130 KB gzipped). Three.js is a peer dependency; install it alongside treelet via npm. Best for projects that already use Three.js or want control over the Three.js version.

**Standalone** (`treelet.cdn.standalone.js`) - ~850 KB minified (~230 KB gzipped). Bundles only the Three.js modules treelet actually uses (tree-shaken). Drop-in ready for CDN or direct `<script>` tag usage - zero external dependencies.

Both bundles **inline the tile worker** and start it from a `blob:` URL, so nothing else needs to be served and they work from any CDN or bundler. If your Content-Security-Policy does not allow `worker-src blob:`, serve `dist/treelet.worker.js` from your own origin and pass its URL as `workerUrl`.

The package is side-effect free (`"sideEffects": false`) and safe to import during server-side rendering; the map itself needs a browser.

## Browser Support

Modern browsers with **WebGL2**, module **Web Workers** and **OffscreenCanvas** (Chrome/Edge 80+, Firefox 105+, Safari 16.4+). Requires ES2022.

## License

[MIT](LICENSE)
