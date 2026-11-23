# Changelog

## 1.0.0

The API is frozen for 1.x: methods, options, events and types reachable from the package entry are public (see the [API reference](https://geozelot.github.io/Treelet/api/)); everything else may change in minor releases. Upgrading from 0.3? See [Migrating from 0.3](#migrating-from-03) below.

### Breaking changes

- **The ground is a stack of coats.** Imagery (the active drape) and any number of analysis layers (elevation, slope, aspect, contours, hillshade) are drawn in order, each with opacity and a blend mode (`normal`, `multiply`, `screen`, `softlight`), so analyses can sit over imagery. The virtual "BaseDrape" and its modes are gone:
  - `setBaseDrapeMode(mode)` / `activateBaseDrape()` → `addAnalysisLayer({ analysis: mode })`; `'contours'` is its own coat over an `'elevation'` coat; `'wireframe'` is `setWireframe(true)`.
  - `setColorRamp`, `setElevationRange`, `setSlopeRange`, `setIsolineInterval/Thickness/Color` and their getters → `setAnalysisRamp(handle, ramp)` / `setAnalysisParams(handle, { range | interval | thickness | color })` on the coat.
  - `BaseLayerOptions.terrainDisplay` → the parameters of the analysis layers.
  - `DrapeLayerOptions.layerDisplay.blendMode: 'hillshade'` and `hillshadeStrength`, `setDrapeBlendMode`, `setHillshadeStrength` → a `'hillshade'` analysis coat (every new map has one; its opacity is the strength). Drape `blendMode` now takes the coat blend modes (default `'normal'`); `'hillshade'` and other unknown modes are reported and drawn as `'normal'`. `'softlight'` now blends the imagery over the coats below it (in 0.3 it blended the terrain's light into the imagery).
  - An active drape outside its `minZoom` / `maxZoom` shows the coats below it (0.3 fell back to the elevation ramp).
  - `getActiveDrapeId()` returns the drape id or `null` (never `'__base_drape__'`); `isBaseDrapeActive()`, `getBaseDrapeMode()`, `BASE_DRAPE_ID`, `BaseDrapeMode` and `ShaderMode` are removed.
  - The deprecated `DrapeLayerOptions.lodOffset` is removed.
- The deprecated `mapDisplay.atlasSize` is removed (it is ignored with a warning); set `mapDisplay.tileCacheSize`, a tile count.
- `setDrapeOpacity` / `getDrapeOpacity` are removed: `setLayerOpacity` / `getLayerOpacity` take any layer (an inactive drape keeps its opacity and blend mode for when it is shown).
- `LayerRegistry` (low-level): `setDrapeLayerActive(handle, active)` → `setActiveDrape(handle | null)`; a drape added to the registry is inactive (`visible: false`) until it is activated.
- A new map starts with a hillshade coat over neutral gray instead of the elevation ramp; add `addAnalysisLayer({ analysis: 'elevation' })` for the 0.3 look.
- **New controls.** Every control follows one grid (rows of 24, 2 apart; the selected choice is a fill plus a 2px accent line; values are scrub rows):
  - The compass is a reset-orientation box with optional navigation wings (zoom, rotate, tilt; `guiDisplay.navigation`). Its slide-out panel is gone: the view and the center / extent copy moved to the info box's Map page.
  - The tree (`<treelet-hub>`, `guiDisplay.layerPosition`) opens into a column with the **Layers** page (the coat stack, top first, each coat on its own page with its settings rendered from the parameter schema, order and removal; *Add layer* for analyses and imagery; running region analyses; the terrain's source, exaggeration, light and mesh), the **Themes** page (while the map has themes) and the **Measure** page (the tools, their result, the elevation profile).
  - The info box (`<treelet-info>`, `guiDisplay.infoPosition`) opens into a column with the **Legend** page (legends, the terrain under the pointer) and the **Map** page, with the map's credits at its foot.
  - On maps narrower than 600 px the columns span the width and one is open at a time.
  - `TreeletCompass.attach` takes `{ compassPosition, navigation, glass }`; its `panel` and `updateTileCount` are gone. `TreeletPanel.attach(map, { glass })` (no longer `vPos`, `hPos`). `TreeletAttribution.attach(map, side?, options?)`: without a side it is a row for a column's footer.

### Added

- Analysis layers: `addAnalysisLayer`, `removeAnalysisLayer`, `setAnalysisParams`, `setAnalysisRamp`, `getLegend`, `getLegends`; stack control with `getLayerStack`, `moveLayer`, `setLayerVisible`, `setLayerOpacity`, `setLayerBlendMode`; `deactivateDrapeLayer`.
- Color ramps as data: built-in names (plus `'diverging'`) or custom `{ stops }` / `{ breaks, colors }` classes, usable on every value analysis (e.g. avalanche slope classes). Ramps live in a texture row per coat, so legends, panel previews and the shader always agree.
- `<treelet-legend>`: ramp bars with their range, or class swatches, for the visible analyses (on the info box's Legend page).
- `registerAnalysis(descriptor)`: a custom analysis is a GLSL snippet plus a parameter schema; the panel renders its settings.
- Contours: index lines (every Nth line bolder).
- `'rangechange'` event when the visible elevation range used by `'auto'` ramps changes; a descriptor's `domain(params, visible)` is evaluated again as it changes, so any range derived from the visible one follows the view.
- The visible elevation range (`getVisibleElevationRange()`, `'auto'` ramps, new water levels, the shadow map's reach) uses each tile's range without its few most extreme texels, so isolated spikes in the source data (as in some AWS Terrarium tiles) don't stretch it.
- `'layerupdate'` event (`{ id }`) when a layer's values change (analysis parameters or ramp, opacity, blend mode, an overlay's style); `'layerchange'` stays for layers added, removed, shown, hidden or reordered. The layer panel updates values in place, so a dragged slider keeps working.
- Parameter `limits`: values set from code are clamped to them (with a warning), not to the panel's slider range, so e.g. a 5 m contour interval or a bathymetric elevation range works as in 0.3; the panel's sliders widen to show such values. `registerAnalysis` checks the descriptor's ramp and blend mode.
- `getAnalysisValue(handle, lngLat)`: the value a coat colors at a position (from the descriptor's `cpu` twin, or the raster); the readout shows it for the topmost analysis coat besides elevation, slope and aspect.
- Slope: `aspectMask: [from, to]` draws only slopes facing a compass sector (through north with `[315, 45]`); built-in class presets `'avalanche'` (nothing below 30°, then 30–35–40–45° in the usual avalanche-map colors) and `'aspect8'` (eight compass sectors). Ramp colors may carry alpha: a class with alpha 0 draws nothing and is left out of the legend.
- `'water'` analysis: fills the terrain below a `level` with water that darkens with depth (`depthFade`) and fades along the shore (`shoreline`); a new water coat starts a third of the way up the visible range. `animateAnalysisParams(handle, { level: [from, to] }, duration)` tweens numeric parameters of any analysis.
- `'curvature'` analysis (`mode: 'profile' | 'plan' | 'total'`, 1/km, convex positive) on a diverging ramp. The surface the shader and the CPU see now includes the true-scale gradient and second derivatives (`s.g`, `s.c`), computed at the rendered tile's resolution.
- Cursor readout: `<treelet-readout>` (on the info box's Legend page; `guiDisplay.readout`) shows elevation, slope and aspect under the mouse (after a tap on touch screens). `pick(x, y)` returns `slope`, `aspect`, `curvature` and `normal` along with the elevation; `sampleTerrain(lngLat)` gives the same for a position; `getVisibleElevationRange()` the elevation range on screen.
- `getStats().frameTime` is the smoothed CPU time per rendered frame.
- Region analyses in a dedicated worker: `computeViewshed(observer, options)` (eye and target height, radius, field of view, Earth curvature with refraction k = 0.13, optional vertical clearance), `computeSunHours({ date })` (terrain shadows swept along the sun's azimuth every few minutes; hours plus first and last sun), `computeSkyView()` (exact horizons over the whole region, or up to a radius) and `computeTpi({ radius, innerRadius })`. Each loads the elevation tiles of a region at the finest zoom within a tile budget (`maxTiles`, default 64), assembles them into one grid in the worker, and shows the result as a coat with a legend. Jobs report progress (`analysisstart` / `analysisprogress` / `analysisend` events, `getAnalysisJobs()`), can be cancelled (`cancelAnalysis(id)`, an `AbortSignal`), and appear on the hub's Layers page with a progress bar and a cancel button (the tree box at rest shows a progress line). `getElevationGrid()` returns a region's elevations.
- Raster coats: `addRasterLayer({ data, width, height, bounds, crs? })` draws your own value grids (ramp, legend, nodata) or RGBA images; up to 4 at once. `getRasterInfo`, `getRasterValue`. EPSG:4326 grids are resampled to Mercator rows once.
- Sun position from a date: `setSunTime(date)` places the sun (NOAA solar position) over the map center and keeps it there as the map moves; `getSunPosition(date?, lngLat?)`. The *Light* page (the hub's Layers page) switches between a manual sun and a day and time.
- *Add layer* on the Layers page (and the viewshed tool) runs the region analyses over the view (the viewshed asks for a click on the observer; `REGION_ANALYSIS_INPUT` says which kinds need a point); a new run replaces the previous result in its place in the stack. `pickLocation()` waits for a click on the terrain (and stops a measuring tool).
- `'visibility'` ramp preset (hidden / visible) for viewsheds.
- Overlay layers draw GeoJSON on the terrain (the 0.3 stub is now real): `addOverlayLayer({ layerName, data, style })` with lines draped along the terrain (densified to the terrain in view, heights updated in place where finer tiles load, wide lines in CSS pixels, translucent ones covering each pixel once), round point markers, polygon fills rasterized into a coat the overlay owns (`AnalysisLayer.owner`: drawn with the overlay's visibility, opacity and zoom range, keeping its place in the stack across data and style changes), and labels from a property (hidden behind terrain and where they would overlap). Overlay attributions show in the map's credits. Styles are objects or functions of each feature. `setOverlayData`, `setOverlayStyle`; visibility and opacity through `setLayerVisible` / `setLayerOpacity`.
- Measuring: `measureDistance(points)` (geodesic length on WGS84, length along the terrain, ascent, descent, lowest and highest point, profile), `measureArea(ring)` (geodesic and surface area, perimeter), `lineOfSight(from, to)` (curvature and refraction, first obstruction, sight line), `project(lngLat)`.
- Tools on the map: `startTool('distance' | 'area' | 'profile' | 'sight')` with click / drag / double-click / Enter / Backspace / Escape and long press on touch; `'measure'` and `'toolchange'` events; `finishTool`, `clearTool`, `getTool`.
- Elevation profile (`<treelet-profile>`, `showProfile(path | lineOfSight)`) on the hub's Measure page: SVG chart, hover marks the point on the terrain, statistics, CSV and PNG export.
- Measuring tools on the hub's Measure page (`<treelet-toolbar>`, `guiDisplay.tools`): distance, area, profile, line of sight and viewshed, with the live result and Profile / Finish / Clear.
- Themes: `setThemes([{ id, name, description?, apply(map), clear?(map) }])`, `applyTheme(id | null)`, `getThemes()`, `getActiveTheme()` and the `'themechange'` event. A theme is a named setup of imagery, coats and view; `clear` takes it down before the next one is applied. The hub's Themes page lists them (the demo's presets moved there).
- Hillshade `mode: 'multi'`: four lights around the sun azimuth, each weighted by cos² of the angle between its azimuth and the slope's aspect (multidirectional oblique weighting, Mark 1992), so ridges and valleys running toward the sun keep their relief.
- `'shadows'` analysis: terrain-cast shadows from a 2048² shadow map of the terrain seen from the sun (same vertex program as the terrain, so morphing and exaggeration match), fitted with a margin around the visible terrain, snapped to texels, 3 × 3 filtered, faded at its edge, redrawn only when the sun moves, the view leaves the fitted area or finer terrain loads (at most every 150 ms). Combined with `setSunTime`, shows the shadows of a given moment.
- One way to handle any layer: `removeLayer(handle)` removes a base, drape, analysis, raster or overlay layer; `setLayerVisible` / `setLayerOpacity` also take overlays (and `setLayerVisible(base, true)` activates a base layer).
- `getStats()` reports `coats`, `rasters`, `overlays` and `shadows` as well.
- API reference generated with TypeDoc (`npm run docs:api`), published with the demo; CI checks that every type the public API references is exported and that the library's GLSL parses (with undeclared names as errors).

### Fixed

- Gaps between tiles while terrain loads, most visible in tilted views. A tile without its own data is drawn from the nearest loaded ancestor, and neighbours drawn from different data could disagree by hundreds of meters, more than the skirts covered (1.5 % of a tile's width). Now:
  - while any tile is drawn from stand-in data, the skirts reach down by the elevation range of the data in view, which bounds any such mismatch (once every tile has its own data and parent they follow the tile size again);
  - a tile only morphs toward its loaded parent. Before, a coarser ancestor stood in until the parent arrived, which pulled the far part of loaded tiles down to very coarse heights and blurred it;
  - when the nearest loaded ancestor is more than three levels coarser, a tile three levels up is requested first (one request fills up to 64 tiles), so new terrain no longer starts from very coarse data.
- Shading seams along tile edges. Slopes were one-sided at a tile's border (it had only its own texels there), so the shading stepped along every tile edge. Each tile now also keeps its neighbours' texels one step past each border (a small second texture), and slopes at tile edges are central differences like everywhere else. `sampleTerrain`, `pick` and the readout use the same.

### Migrating from 0.3

Most 0.3 code needs a few renames. The ground used to show one *mode* of a virtual "base drape" (or a drape blended with hillshade); in 1.0 it shows a stack of coats, so modes become analysis layers you add, combine and remove.

```ts
// 0.3
map.setBaseDrapeMode('slope');
map.setSlopeRange(0, 50);
map.setColorRamp('inferno');

// 1.0
const slope = map.addAnalysisLayer({ analysis: 'slope', params: { range: [0, 50] }, ramp: 'inferno' });
```

```ts
// 0.3: contours over the elevation ramp
map.setBaseDrapeMode('contours');
map.setIsolineInterval(50);

// 1.0: two coats, the lines above the colors
map.addAnalysisLayer({ analysis: 'elevation' });
map.addAnalysisLayer({ analysis: 'contours', params: { interval: 50 } });
```

```ts
// 0.3: imagery with hillshade
const ortho = map.addDrapeLayer({ layerName: 'Ortho', layerSource, layerDisplay: { blendMode: 'hillshade', hillshadeStrength: 0.6 } });
map.activateDrapeLayer(ortho);

// 1.0: every map starts with a hillshade coat (multiply, opacity 0.6) above the imagery
const ortho = map.addDrapeLayer({ layerName: 'Ortho', layerSource });
map.activateDrapeLayer(ortho);
map.setLayerOpacity(map.getAnalysisLayers().find((l) => l.descriptor.id === 'hillshade')!, 0.6);
```

| 0.3 | 1.0 |
|---|---|
| `setBaseDrapeMode(mode)`, `activateBaseDrape()` | `addAnalysisLayer({ analysis: mode })` (`'wireframe'` is `setWireframe(true)`) |
| `getBaseDrapeMode()`, `isBaseDrapeActive()` | `getLayerStack()`, `getAnalysisLayers()` |
| `setColorRamp(ramp)` | `setAnalysisRamp(handle, ramp)` on the coat |
| `setElevationRange(min, max)`, `setSlopeRange(min, max)` | `setAnalysisParams(handle, { range: [min, max] })` (clamped to the parameter's limits, not the slider range) |
| `setIsolineInterval / Thickness / Color` | `setAnalysisParams(handle, { interval / thickness / color })` |
| `BaseLayerOptions.terrainDisplay` | the analysis layers' `params` |
| `DrapeLayerOptions.layerDisplay.blendMode: 'hillshade'`, `hillshadeStrength`, `setDrapeBlendMode`, `setHillshadeStrength` | the `'hillshade'` coat (its opacity is the strength); drapes blend with `'normal' \| 'multiply' \| 'screen' \| 'softlight'` |
| `getActiveDrapeId() === '__base_drape__'`, `BASE_DRAPE_ID` | `getActiveDrapeId() === null` |
| `setDrapeOpacity`, `getDrapeOpacity` | `setLayerOpacity`, `getLayerOpacity` |
| `mapDisplay.atlasSize` | `mapDisplay.tileCacheSize` (tiles; the old default 4096 = 256 tiles) |
| `DrapeLayerOptions.lodOffset` | `mapDisplay.drapeSlotSize` |
| `BaseDrapeMode`, `ShaderMode` types | `ColorRamp`, `Ramp`, analysis kinds as strings |

A new map shows shaded relief over neutral gray; add `addAnalysisLayer({ analysis: 'elevation' })` for the 0.3 default look.

## 0.3.0

### Breaking changes

- **Zoom follows the standard web-map scale.** At zoom `z` the world spans `256 · 2^z` CSS pixels at the orbit target (as in Leaflet/Mapbox), and zoom is fractional. `initZoom`, `setView()` and `getZoom()` keep their names but show a different scale than 0.2.x.
- **Adding a base layer no longer activates it**, except the first one or when `layerDisplay.visible === true`.
- `getTileCount()` returns the number of tiles drawn (it previously always returned 1).
- `getCenter()` returns the orbit target, the terrain at the screen center (0.2.x returned the center of the ground footprint).
- **The camera keeps its height while panning and zooming** instead of riding up and down with the terrain at the screen center. The zoom follows the distance to that terrain (panning onto a mountain zooms in). The camera only rises where it would touch the terrain, or, smoothly, where moving brings the terrain ahead closer than half the zoom's distance. Past the obstacle it glides back down to the zoom it had, but never below its own height. The visible range never drops below what the zoom and tilt show, so terrain passing below doesn't shorten it, and reaches further while the camera is higher (lifted over a ridge, or above a deep valley).
- `setView()` keeps the current pitch and bearing.
- `'ready'` fires when the map starts; `'move'` now fires once per frame while the camera moves.
- Default sun is north-west at 45° (cartographic convention); aspect defaults to the new `'cyclic'` ramp; slope is mapped in degrees over `slopeRange` (default 0–60°).
- WMTS KVP and WMS query values are URL-encoded.
- `TerrainRenderer`, the atlases and `TilePool` were rewritten; their internal APIs changed.
- A `mapDisplay.drapeSlotSize` larger than the drape source's tiles now fills each slot with finer source tiles (e.g. `512` with 256-px tiles: 4 requests per terrain tile instead of 1 enlarged tile). Mind public tile servers' usage policies.
- `mapDisplay.atlasSize` is deprecated in favour of `mapDisplay.tileCacheSize` (a tile count). `atlasSize` still works and maps to `(atlasSize / slotSize)²` tiles, with a console warning.

### Fixed

- Failed tiles were retried in a tight loop (thousands of requests per second, starving all other tiles); synchronous failures could freeze the page. Failures now back off exponentially, 404/410/204 tiles are treated as nonexistent, and errors are logged in aggregate.
- The published ES and standalone bundles loaded their worker from a root-absolute `/assets/…` URL and could not work from npm or a CDN. The worker is now inlined; `workerUrl` + `dist/treelet.worker.js` cover strict CSPs.
- Drape imagery rendered too dark (sRGB-decoded texture written without conversion).
- The camera near plane was fixed at 1 km, clipping terrain from zoom ~17. Clip planes now adapt every frame.
- Relief was flattened by cos(latitude) (slope at 47° N read ~34° for a true 45°). Heights now use the Mercator scale factor.
- Vertex jitter at high zoom away from (0, 0) (float32 precision). Rendering now uses a floating origin.
- Drape races: zoom changes during composite loads left stale quadrants; slow fetches could write into a reassigned slot; switching layers mixed imagery.
- `destroy()` left fetches running and leaked the WebGL context.
- DEM decoding applied color management / premultiplication; transparent nodata pixels decoded to −10000 m / −32768 m spikes.
- Layer names were inserted into the panel as HTML (XSS).
- Overzoomed parents were fetched and decoded once per child.
- Hard tile budget truncation punched holes; atlas capacity vs. `maxInstances` and zoom limits weren't validated.
- Distant terrain ended in a jagged edge that shifted as the view rotated: culling cut the far range along a straight line while fog was based on view depth. Terrain now dissolves into a sky gradient at a circular horizon.
- Motion prefetch widened the view in every direction, pushing the selection over budget while moving; the LOD then coarsened during interaction and snapped back afterwards (distant popping). Prefetch now extends only in the direction of motion, is dropped before any detail, and budget-driven LOD changes have hysteresis.
- Mountains just outside the ground footprint were culled even when they rose into view (culling ignored terrain height).
- Mobile: the map flashed white when the canvas was resized (toolbars showing/hiding) or the GPU context was lost; the canvas is now redrawn in the same frame and its background matches the horizon.
- The startup note about the per-frame tile limit was printed on every load and suggested a misleading fix; it now appears only when a view actually exceeds the limit.
- Layer panel: a section title with a single source (e.g. one terrain layer) opened an empty dropdown on hover; it is now a plain label.
- Phones: the compass and layer panels ran off-screen on narrow maps. The compass panel now drops its Map and Viewport sections when there is no room, and the layer panel shrinks to the map width (long source names are truncated).
- Touch and keyboard: the controls only opened on mouse hover. A tap now opens them (a tap elsewhere closes them; on the compass the first tap opens and the next resets), and they work with the keyboard: Tab to a control, Enter to open a list, Escape to close, with visible focus rings and labelled buttons.
- The Viewport tile count only updated when the camera moved; it now follows tiles as they load.
- Half-texel offset and point sampling of vertex heights; contours were drawn from the coarse mesh instead of the DEM.
- Undefined-behaviour `smoothstep` calls (reversed edges; zero width on flat ground).
- Switching base layers kept the previous layer's ramp/isoline settings; `'auto'` elevation range was a fixed 0–4000 m.
- Drape overzoom crops below one source pixel threw; teleports polluted prefetch; terrain following was frame-rate dependent.
- The camera could pass into the terrain when tilted and moved into a mountain (only the ground straight below it was checked, against whatever data was loaded there, and the orbit sank back as the target dropped behind a ridge). A clearance sphere around the camera now contains the near plane, fast moves are checked along their path so the camera is carried over ridges, and rotating into a slope lifts the camera while it keeps looking at the target.
- Documented-but-missing behaviour: `accessToken` was ignored, `tileload`/`tileunload`/`zoom` events never fired.
- Drape imagery on flat ground seen at a low angle was blurred while slopes at the same distance stayed sharp: the shader sampled with explicit gradients (`textureGrad`), for which some GPU drivers skip anisotropic filtering. It now samples with implicit derivatives (in uniform control flow), and anisotropy goes up to 16× where the GPU supports it.
- Drape imagery near the camera was blurrier than the source allows: `lodOffset` fetched 4×/16× finer source tiles and then shrank them into the same 256-px slot. Each terrain tile now fetches exactly the detail its slot holds (one source tile per tile by default, or finer ones with a larger `mapDisplay.drapeSlotSize`, e.g. `512` for sharp imagery on high-DPI screens), based on the source's real image size (measured from the first tile; retina `{r}` tiles count double until then). `lodOffset` is deprecated and ignored.

### Added

- CDLOD geomorphing with screen-space-error LOD: watertight LOD boundaries, no popping, consistent detail at any zoom, tilt and viewport; budget-fitted.
- Texture-array atlases (no slot bleeding), per-layer mipmapped and anisotropically filtered drapes with gamma-correct mips.
- Seamless tiles: shared edges and corners are stitched on load, blended over about one source pixel.
- Per-fragment DEM elevation and smooth normals for shading, color ramps and contours.
- Render on demand, device-pixel-ratio cap, WebGL context-loss recovery (logged).
- Horizon: a sky gradient with radial atmospheric haze that terrain fades into, culled at a circular visible range; 3D frustum culling against per-tile height bounds; coarse-first loading so newly exposed regions fill in with one request.
- Worker pipeline: decode, resample and mipmap off the main thread; URL-affinity routing with decode cache and in-flight dedupe; request cancellation.
- Inspection API: `getElevation()`, `pick()`, `getElevationProfile()`, `getStats()`, `setElevationRange('auto' | [min, max])`, `setSlopeRange()`, `setLodQuality()`, `requestRender()`, `'tileerror'` event.
- Sources: `{-y}`, `{quadkey}`, `{r}`, `{accessToken}` tokens; `headers`, `credentials`, `referrerPolicy`, `retina` options; WMS 1.3.0 axis order, `styles`, `transparent`.
- Touch panning with one finger, zoom-to-cursor, keyboard panning.
- Sanitized HTML attributions with links; attribution overflow handling.
- Controls refresh: the layer button and panel match the compass size; titles with other sources to choose from show a chevron that flips while their list is open; the selected source and buttons are shown at full strength instead of faded; the settings gear is always faintly visible; one type scale, two corner radii and the logo green as accent; lists and settings fade in like the side panels; the overlay groups are named Analysis and Layers.
- `guiDisplay.glass`: optional frosted-glass controls and menus (translucent, with the map blurred behind).
- SSR-safe imports, `"sideEffects": false`, explicit `defineTreeletElements()`.
- New options: `workerUrl`, `mapDisplay.drapeSlotSize`, `maxPixelRatio`, `lodQuality`, `morphWidth`, `renderOnDemand`, `tileCacheSize`, `horizonDistance`, `fog`; methods `setHorizonDistance()`, `setFog()`.
