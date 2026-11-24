# The map

[Documentation](README.md) · [Getting started](getting-started.md) · [The map](map.md) · [Terrain](terrain.md) · [Coats](coats.md) · [Region analyses](region-analyses.md) · [Overlays and tools](overlays-and-tools.md) · [Reference](reference.md)

A `Treelet` is the map: it owns the canvas, the camera and the layers, and emits events (it extends `EventEmitter`). This page covers creating one, its options and controls, the view, the camera, input, the lifecycle and events.

## Creating a map

`Treelet.map(container, options)` creates a map (a static factory).

| Param | Type | Description |
|---|---|---|
| `container` | `string \| HTMLElement` | DOM element or element ID |
| `options` | `TreeletOptions` | Map configuration |

Returns `Treelet`. Equivalent to `new Treelet(container, options)`.

`Treelet.version` is the library version.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `initCenter` | `LngLat` | *required* | Initial map center `{ lng, lat }` |
| `initZoom` | `number` | *required* | Initial zoom level |
| `minZoom` | `number` | `0` | Minimum allowed zoom |
| `maxZoom` | `number` | `20` | Maximum allowed zoom (≤ 22) |
| `mapDisplay` | `MapDisplayOptions` | `{}` | Rendering options (see below) |
| `guiDisplay` | `GuiDisplayOptions` | `{}` | UI widget options (see below) |
| `workerCount` | `number` | cores − 1, clamped to 1–4 | Web Worker pool size (a value given is rounded and clamped to 1–16) |
| `workerUrl` | `string \| URL` | inlined | URL of `dist/treelet.worker.js`, for CSPs without `worker-src blob:` |

Zoom follows the standard web-map scale: at zoom `z` the world spans `256 · 2^z` CSS pixels at the orbit target, as in Leaflet or Mapbox. Zoom is fractional. Options are validated on construction: invalid values (a missing center, a non-finite number, a slot size that is not a power of two) throw a descriptive error; values outside soft limits (zooms 0–22, pitch 0–90, the ranges noted below) are clamped.

### MapDisplayOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `atlasSegments` | `number` | `64` | Mesh subdivisions per tile (even, ≤ `slotSize`) |
| `antialias` | `boolean` | `true` | WebGL antialiasing |
| `worldScale` | `number` | `40075.02` | CRS meters to scene units scale |
| `minPitch` | `number` | `25` | Minimum pitch (most tilted) in degrees |
| `maxPitch` | `number` | `90` | Maximum pitch (top-down) in degrees |
| `tileCacheSize` | `number` | `256` | Tiles kept in GPU memory (64–2048); up to 60% of them can be on screen. ~0.5 MB per tile, plus ~0.35 MB with a drape active (~1.4 MB with `drapeSlotSize: 512`) |
| `slotSize` | `number` | `256` | Elevation texels per tile edge (a power of two) |
| `drapeSlotSize` | `number` | `slotSize` | Drape pixels per tile edge (a power of two). Each tile fetches imagery as fine as this holds: with 256-px source tiles, `512` loads one zoom finer (4 source tiles per terrain tile), sharp on high-DPI screens at ~4× the drape memory and requests |
| `maxInstances` | `number` | `512` | Tile budget per frame (capped at 60% of `tileCacheSize`) |
| `maxConcurrentFetches` | `number` | `12` | Concurrent requests per layer |
| `maxPixelRatio` | `number` | `2` | Device-pixel-ratio cap |
| `lodQuality` | `number` | `1` | LOD multiplier: > 1 finer tiles, < 1 coarser (0.25–4) |
| `morphWidth` | `number` | `0.3` | Fraction of each LOD range used for geomorphing (0.05–0.5) |
| `horizonDistance` | `number` | `16` | Visible range as a multiple of the camera's height (what the zoom and tilt give it above the terrain it looks at, or its actual height where that is more; 4–64); terrain fades into the horizon there |
| `fog` | `boolean` | `true` | Atmospheric haze over distant terrain; when `false`, terrain stays clear and only blends into the horizon over the last 20% of the range |
| `renderOnDemand` | `boolean` | `true` | Render only when the view, data or settings change |

The defaults fit a typical view in well under the tile budget at any screen size. Treelet logs a one-time note when a view needs more tiles than `tileCacheSize` allows (it then reduces distant detail rather than leaving holes). To raise the limit, set a larger `tileCacheSize`, e.g. `512`; memory grows with it.

### GuiDisplayOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Show the controls (compass, hub, info box); the credits show either way (at the foot of the info column, or as a tag in a bottom corner without an info box) |
| `compassPosition` | `UICorner` | `'top-right'` | Corner of the compass |
| `navigation` | `boolean` | `true` | Zoom, rotate and tilt buttons beside the compass (hidden on narrow maps) |
| `layerPosition` | `UICorner` | `'bottom-right'` | Corner of the hub: the tree box with the Layers and Measure pages |
| `infoPosition` | `UICorner \| false` | `'bottom-left'` | Corner of the info box with the Legend and Map pages and the credits, or `false` for none (the credits then show as a tag in a bottom corner) |
| `readout` | `boolean` | `true` | The terrain under the pointer on the Legend page (elevation, slope, aspect and the value of the topmost other analysis coat; after a tap on touch screens) |
| `tools` | `boolean` | `true` | The hub's Measure page: the measuring tools, their results and the elevation profile |
| `glass` | `boolean` | `false` | Frosted-glass controls (translucent, map blurred behind); costs some GPU time while the map redraws |

## The controls

The compass, the hub and the info box are set up with `guiDisplay` (see [GuiDisplayOptions](#guidisplayoptions)).

Every control is built from the same parts: rows 24 px high and 2 apart, a column padded 6, text 8 in from a row's edge. The selected choice has the active fill and a 2px line in the accent green; values are *scrub rows* (the row is the slider: drag it, tap or click a place in it, or use the arrow keys).

- **Compass** (60 box): its arrow follows the camera; a click resets the orientation. With `navigation`, wings beside it zoom (±1 level), rotate (±15°) and tilt (±5°).
- **Hub** (the tree, 56 box) and **info box** (56 box): a tap, click, Enter or Space turns the box into a column (264 wide) with a slim rail on its outer side. The box's icon sits at the rail's far end and closes the column; the page buttons stay by the corner it opened from (from them, Tab goes into the page; the arrow keys move along them). Escape steps back out of a sub-page, then closes the column. A click on the map leaves it open (the tools need those clicks).
  - **Layers**: running region analyses with progress and cancel, a pending pick and failures (`<treelet-jobs>`; also at the foot of the Measure page, and beside the tree box while the column is closed); the coat stack, top first (eye, then the coat's page: opacity, blend, its parameters rendered from the schema, ramp, order, removal); *Add layer* (analysis kinds and imagery); then the terrain: source, exaggeration, light (a manual sun or a day and time) and mesh.
  - **Measure**: the tools, the live result, and the elevation profile.
  - **Legend**: the legends of the analyses drawn (a coat outside its zoom range has none) and the terrain under the pointer.
  - **Map**: zoom, tiles, pitch and bearing; the center and extent, copied as EPSG:4326 or EPSG:3857 coordinates.
  - The credits (the active base layer's, the imagery's and the visible overlays') sit at the info column's foot.
- **Narrow maps** (under 600 px): the columns span the map's width, one is open at a time (the other box steps aside), and the compass has no wings; a column on the compass's edge starts past it.
- Two controls asking for the same corner: the later one takes the next free corner (with a warning).

The elements (`<treelet-compass>`, `<treelet-hub>`, `<treelet-info>` and the pages' `<treelet-panel>`, `<treelet-jobs>`, `<treelet-toolbar>`, `<treelet-profile>`, `<treelet-legend>`, `<treelet-readout>`, `<treelet-attribution>`) are exported; `TreeletHub` and `TreeletInfo` have `open(page?)`, `close()`, `isOpen` and `page`, and follow new options when attached again.

## View

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
| `getContainer()` | `HTMLElement` | The map's container element |

## Camera

The camera keeps its height while you pan or zoom. The orbit target is the terrain at the screen center, so the zoom follows the distance to it: panning onto a mountain zooms in. The camera only rises where it would otherwise touch the terrain (at once, so the terrain never cuts into the view), or, smoothly and keeping its pitch, where moving brings the terrain at the screen center closer than half the zoom's distance. Rotating into a mountain lifts the camera over it, still looking at the same point. Once past the obstacle, the camera glides back down until it shows your zoom again, but never below the height you were at, so it doesn't dive into valleys.

| Method | Returns | Description |
|---|---|---|
| `setMinPitch(degrees)` | `this` | Set minimum pitch (most tilted), 0–90 |
| `getMinPitch()` | `number` | Get minimum pitch |
| `setMaxPitch(degrees)` | `this` | Set maximum pitch (top-down), 0–90 |
| `getMaxPitch()` | `number` | Get maximum pitch |
| `getCameraController()` | `CameraController` | Direct camera access |

## Input

| Input | Action |
|---|---|
| Left-click drag / one-finger drag | Pan |
| Scroll wheel / pinch | Zoom (towards the cursor) |
| Right-click drag / two-finger rotate | Orbit (rotate + tilt) |
| Arrow keys (canvas focused) | Pan |
| Compass click | Reset orientation |

## Lifecycle

| Method | Returns | Description |
|---|---|---|
| `start()` | `this` | Begin rendering and tile loading |
| `stop()` | `this` | Pause rendering |
| `destroy()` | `void` | Release all resources, including the WebGL context (idempotent) |

## Events

```ts
map.on('ready', () => { /* map started */ });
map.on('move', ({ center }) => { /* every frame the camera moves */ });
map.on('tileerror', ({ coord, layer, error }) => { /* request failed; retried with backoff */ });
```

`on(event, handler)` adds a handler, `once(event, handler)` one that runs once, `off(event, handler)` removes it, and `listenerCount(event)` counts them.

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
| `'layerupdate'` | `{ id }` | A layer's values changed: analysis parameters or ramp, opacity, blend mode, a base layer's exaggeration, an overlay's style (fires often while a slider is dragged or an animation runs) |
| `'meshchange'` | `{ wireframe, white }` | The mesh's look changed (`setWireframe`, `setWireframeWhite`) |
| `'rangechange'` | `{ min, max }` | Visible elevation range changed (`'auto'` ramps) |
| `'analysisstart'` | `{ id, kind, label }` | A region analysis started |
| `'analysisprogress'` | `{ id, kind, label, stage, progress }` | `stage`: `'loading'` (tiles) or `'computing'`; `progress` 0–1 of the stage |
| `'analysisend'` | `{ id, kind, label, status, error? }` | `status`: `'done' \| 'cancelled' \| 'error'` |
| `'sunchange'` | `{ azimuth, altitude, time }` | The sun moved |
| `'pickstart'` / `'pickend'` | `{ prompt }` / `{}` | `pickLocation()` waits for a click / stopped waiting |
| `'toolchange'` | `{ mode, drawing }` | A tool started, finished drawing or stopped |
| `'measure'` | `{ mode, final, result }` | A tool's result changed (`final` when drawing ended; `result` null when cleared) |
