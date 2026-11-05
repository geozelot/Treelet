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

- **Single draw call rendering** - All visible tiles in one instanced GPU call from texture-array atlases
- **Screen-space LOD with CDLOD geomorphing** - Tile detail follows on-screen size at any zoom, tilt or viewport; vertices morph continuously into the coarser level, so LOD boundaries are watertight and never pop
- **Seamless, true-to-scale relief** - Shared tile edges are stitched on load; heights are Mercator-corrected so slope, aspect and hillshade are accurate at every latitude
- **High-precision rendering** - Floating render origin and adaptive clip planes keep street-level zooms stable anywhere on the globe
- **Off-main-thread data pipeline** - Fetch, decode, resampling and mipmapping run in workers; failed tiles back off instead of retrying in a loop
- **Render on demand** - No GPU work while the view and data are idle

##
### [Live Demo](https://geozelot.github.io/Treelet/)

##
### Current Features (v0.3.0):

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
  - **Elevation** - topographic coloring (fixed or auto range)
  - **Slope** - slope angle in degrees
  - **Aspect** - downslope bearing (cyclic ramp)
  - **Isoline** - contour overlay computed from the DEM per pixel

- #### Inspection:
  - **Elevation readout** - `getElevation(lngLat)`
  - **Terrain picking** - `pick(x, y)`
  - **Elevation profiles** - `getElevationProfile(from, to)`

###
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

map.addDrapeLayer({
  layerName: 'OpenStreetMap',
  layerSource: new XYZSource({
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileSize: 256,
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
| `tileCacheSize` | `number` | `256` | Tiles kept in GPU memory (64–2048); up to 60% of them can be on screen. ~0.5 MB per tile, plus ~0.35 MB with a drape active |
| `atlasSize` | `number` | — | *Deprecated*: use `tileCacheSize`. Holds `(atlasSize / slotSize)²` tiles; the former default `4096` equals `tileCacheSize: 256` |
| `slotSize` | `number` | `256` | Elevation texels per tile edge |
| `drapeSlotSize` | `number` | `slotSize` | Drape pixels per tile edge |
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
| `enabled` | `boolean` | `true` | Show compass + layer panel |
| `compassPosition` | `UICorner` | `'top-right'` | Compass widget corner |
| `layerPosition` | `UICorner` | `'bottom-right'` | Layer panel corner |
| `glass` | `boolean` | `false` | Frosted-glass controls (translucent, map blurred behind); costs some GPU time while the map redraws |

The controls open on mouse hover, on a tap (touch screens; a tap elsewhere closes them) and with the keyboard (Tab to a control, Escape to close). On a touch screen the first tap on the compass opens its panel and the next one resets the orientation. On narrow maps the compass panel drops its Map and Viewport sections and the layer panel shrinks to fit.

---

### Treelet

The main map class. Extends `EventEmitter`.

#### View

| Method | Returns | Description |
|---|---|---|
| `setView(center, zoom)` | `this` | Set map center and zoom (keeps pitch and bearing) |
| `getCenter()` | `LngLat` | Get the orbit target (the point the camera looks at) |
| `getZoom()` | `number` | Get current (fractional) zoom |
| `getBounds()` | `{ sw, ne } \| null` | Get visible bounding box |
| `getTileCount()` | `number` | Number of terrain tiles drawn in the last frame |
| `getStats()` | `TreeletStats` | Tiles, atlas use, pending and failed requests |
| `setLodQuality(q)` | `this` | Change the LOD multiplier at runtime |
| `setHorizonDistance(factor)` | `this` | Visible range as a multiple of the camera's height (4–64) |
| `getHorizonDistance()` | `number` | Get the visible range factor |
| `setFog(enabled)` | `this` | Toggle atmospheric haze over distant terrain |
| `requestRender()` | `this` | Force a redraw (with `renderOnDemand`) |

#### Inspection

| Method | Returns | Description |
|---|---|---|
| `getElevation(lngLat)` | `number \| null` | Elevation in meters from the finest loaded tile |
| `pick(x, y)` | `TerrainPick \| null` | Terrain hit `{ lngLat, elevation }` under container-relative pixel `(x, y)` |
| `getElevationProfile(from, to, samples?)` | `ProfileSample[]` | `{ lngLat, distance, elevation }` samples along a line (distance in meters) |

```ts
map.on('moveend', () => {
  const pick = map.pick(200, 150);
  if (pick) console.log(`${pick.elevation.toFixed(1)} m`, pick.lngLat);
});
```

#### Base Layers

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
| `terrainDisplay` | `TerrainDisplay` | `{}` | Isoline, color ramp defaults (see below) |
| `layerAttribution` | `string` | source attribution | Attribution text |
| `minZoom` | `number` | `0` | Minimum zoom level |
| `maxZoom` | `number` | `22` | Maximum zoom level (≤ 22) |

##### TerrainDisplay

| Option | Type | Default | Description |
|---|---|---|---|
| `isoplethInterval` | `number` | `100` | Contour line spacing in meters |
| `isolineStrength` | `number` | `1.5` | Contour line thickness |
| `isolineColor` | `[r, g, b]` | `[0.12, 0.08, 0.04]` | Contour color (0-1 each) |
| `rampInterpolationRange` | `[min, max] \| 'auto'` | `[0, 4000]` | Elevation range for color mapping; `'auto'` fits the visible data |
| `slopeRange` | `[min, max]` | `[0, 60]` | Slope range in degrees for slope coloring |
| `rampDefaultElevation` | `ColorRamp` | `'hypsometric'` | Default ramp for elevation mode |
| `rampDefaultSlope` | `ColorRamp` | `'viridis'` | Default ramp for slope mode |
| `rampDefaultAspect` | `ColorRamp` | `'cyclic'` | Default ramp for aspect mode |

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
| `lodOffset` | `1 \| 2 \| 3` | `1` | Drape source zoom = tile zoom + `lodOffset − 1` (2 = 4 sub-tiles, 3 = 16), capped at the source's `maxZoom` |
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
| `'slope'` | Slope angle in degrees (true scale, unaffected by exaggeration) |
| `'aspect'` | Downslope bearing (0° = north), flat ground in neutral gray |
| `'contours'` | Elevation coloring with contour line overlay |

#### Visualization

| Method | Returns | Description |
|---|---|---|
| `setColorRamp(ramp)` | `this` | Set color ramp for current BaseDrape mode |
| `getColorRamp()` | `ColorRamp` | Get current color ramp |
| `setElevationRange(range)` | `this` | Elevation ramp range `[min, max]` in meters, or `'auto'` |
| `getElevationRange()` | `[min, max] \| 'auto'` | Get elevation ramp range |
| `setSlopeRange(min, max)` | `this` | Slope ramp range in degrees |
| `getSlopeRange()` | `[min, max]` | Get slope ramp range |
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
| `setSunAzimuth(degrees)` | `this` | Set sun azimuth for hillshade lighting (default 315°, north-west) |
| `getSunAzimuth()` | `number` | Get sun azimuth |
| `setSunAltitude(degrees)` | `this` | Set sun altitude for hillshade lighting (default 45°) |
| `getSunAltitude()` | `number` | Get sun altitude |

##### ColorRamp

| Ramp | Description |
|---|---|
| `'hypsometric'` | Green, tan, brown, white (elevation default) |
| `'viridis'` | Purple, teal, yellow (perceptually uniform) |
| `'inferno'` | Black, purple, orange, white (high contrast) |
| `'grayscale'` | Black to white |
| `'cyclic'` | Hue wheel for circular data (aspect default) |

#### Camera

The camera keeps its height while you pan or zoom. The orbit target is the terrain at the screen center, so the zoom follows the distance to it: panning onto a mountain zooms in. The camera only rises where it would otherwise touch the terrain (at once, so the terrain never cuts into the view), or, smoothly and keeping its pitch, where moving brings the terrain at the screen center closer than half the zoom's distance. Rotating into a mountain lifts the camera over it, still looking at the same point. Once past the obstacle, the camera glides back down until it shows your zoom again, but never below the height you were at, so it doesn't dive into valleys.

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
| `attribution` | `string` | `''` | Attribution text (simple HTML links allowed; sanitized) |
| `accessToken` | `string` | - | Substituted for `{accessToken}`, otherwise appended as `access_token=` |
| `headers` | `Record<string, string>` | - | Extra request headers (e.g. `Authorization`) |
| `credentials` | `RequestCredentials` | `'same-origin'` | Fetch credentials mode |
| `referrerPolicy` | `ReferrerPolicy` | - | Fetch referrer policy |
| `retina` | `boolean \| string` | `''` | Value for `{r}`: `true` → `'@2x'` on high-DPI screens |
| `maxConcurrency` | `number` | `12` | Concurrent requests for this source |

Tiles answering **404 / 410 / 204** (or an empty body) are treated as nonexistent: elevation renders at sea level and drapes fall back to coarser imagery. Other failures are retried with exponential backoff (1 s → 60 s), never in a loop.

#### XYZ Source

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

#### WMS Source (plugin)

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

---

### Elevation Decoders

Built-in decoders for common DEM tile formats:

| Decoder | Formula | Precision |
|---|---|---|
| `'terrain-rgb'` | `-10000 + (R×65536 + G×256 + B) × 0.1` | 0.1 m |
| `'mapbox'` | Alias for `terrain-rgb` | 0.1 m |
| `'terrarium'` | `R×256 + G + B/256 - 32768` | ~0.004 m |

Pixels with alpha 0 are treated as **nodata** for every decoder. Images are decoded with color management and premultiplication disabled, so encoded RGB values reach the decoder bit-exact.

#### Custom Decoder

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

---

### Types

```ts
interface LngLat { lng: number; lat: number }
interface WorldPoint { x: number; y: number }
interface TileCoord { z: number; x: number; y: number }
interface TileBounds { west: number; south: number; east: number; north: number }

type BaseDrapeMode = 'wireframe' | 'elevation' | 'slope' | 'aspect' | 'contours';
type ColorRamp = 'hypsometric' | 'viridis' | 'inferno' | 'grayscale' | 'cyclic';
type BlendMode = 'normal' | 'hillshade' | 'softlight';
type DecoderName = 'terrain-rgb' | 'mapbox' | 'terrarium';
type UICorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface TerrainPick { lngLat: LngLat; elevation: number }
interface ProfileSample { lngLat: LngLat; distance: number; elevation: number | null }
interface TreeletStats {
  tiles: number; drawCalls: number; atlasUsed: number; atlasCapacity: number;
  drapeTiles: number; pendingElevation: number; pendingDrape: number; failedTiles: number;
}
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
| `defineTreeletElements()` | Register the UI custom elements (done automatically by `Treelet`) |

---

## Controls

| Input | Action |
|---|---|
| Left-click drag / one-finger drag | Pan |
| Scroll wheel / pinch | Zoom (towards the cursor) |
| Right-click drag / two-finger rotate | Orbit (rotate + tilt) |
| Arrow keys (canvas focused) | Pan |
| Compass click | Reset orientation |

## Bundles

Treelet ships three minified files:

| File | Format | Three.js | Use case |
|---|---|---|---|
| `treelet.es.js` | ESM | External | Bundlers (Vite, Webpack, Rollup) |
| `treelet.cdn.standalone.js` | IIFE | Included | `<script>` tag, CDN, no dependencies |
| `treelet.worker.js` | ESM worker | - | Optional: self-hosted worker for strict CSP (`workerUrl`) |

**Slim** (`treelet.es.js`) - ~240 KB minified. Three.js is a peer dependency; install it alongside treelet via npm. Best for projects that already use Three.js or want control over the Three.js version.

**Standalone** (`treelet.cdn.standalone.js`) - ~665 KB minified. Bundles only the Three.js modules treelet actually uses (tree-shaken). Drop-in ready for CDN or direct `<script>` tag usage - zero external dependencies.

Both bundles **inline the tile worker** and start it from a `blob:` URL, so nothing else needs to be served and they work from any CDN or bundler. If your Content-Security-Policy does not allow `worker-src blob:`, serve `dist/treelet.worker.js` from your own origin and pass its URL as `workerUrl`.

The package is side-effect free (`"sideEffects": false`) and safe to import during server-side rendering; the map itself needs a browser.

## Browser Support

Modern browsers with **WebGL2**, module **Web Workers** and **OffscreenCanvas** (Chrome/Edge 80+, Firefox 105+, Safari 16.4+). Requires ES2022.


## License

[MIT](LICENSE)
