# Changelog

## 0.3.0

### Breaking changes

- **Zoom follows the standard web-map scale.** At zoom `z` the world spans `256 · 2^z` CSS pixels at the orbit target (as in Leaflet/Mapbox), and zoom is fractional. `initZoom`, `setView()` and `getZoom()` keep their names but show a different scale than 0.2.x.
- **Adding a base layer no longer activates it**, except the first one or when `layerDisplay.visible === true`.
- `getTileCount()` returns the number of tiles drawn (it previously always returned 1).
- `getCenter()` returns the orbit target, the terrain at the screen center (0.2.x returned the center of the ground footprint).
- **The camera keeps its height while panning and zooming** instead of riding up and down with the terrain at the screen center. The zoom follows the distance to that terrain (panning onto a mountain zooms in). The camera only rises where it would touch the terrain, or, smoothly, where moving brings the terrain ahead closer than half the zoom's distance. Past the obstacle it glides back down to the zoom it had, but never below its own height. The visible range follows the zoom, so it stays steady while the camera passes over relief.
- `setView()` keeps the current pitch and bearing.
- `'ready'` fires when the map starts; `'move'` now fires once per frame while the camera moves.
- Default sun is north-west at 45° (cartographic convention); aspect defaults to the new `'cyclic'` ramp; slope is mapped in degrees over `slopeRange` (default 0–60°).
- WMTS KVP and WMS query values are URL-encoded.
- `TerrainRenderer`, the atlases and `TilePool` were rewritten; their internal APIs changed.
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
- `guiDisplay.glass`: optional frosted-glass controls (translucent, with the map blurred behind).
- SSR-safe imports, `"sideEffects": false`, explicit `defineTreeletElements()`.
- New options: `workerUrl`, `mapDisplay.drapeSlotSize`, `maxPixelRatio`, `lodQuality`, `morphWidth`, `renderOnDemand`, `tileCacheSize`, `horizonDistance`, `fog`; methods `setHorizonDistance()`, `setFog()`.
