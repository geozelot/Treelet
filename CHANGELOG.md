# Changelog

## 0.3.0

### Breaking changes

- **Zoom follows the standard web-map scale.** At zoom `z` the world spans `256 · 2^z` CSS pixels at the orbit target (as in Leaflet/Mapbox), and zoom is fractional. `initZoom`, `setView()` and `getZoom()` keep their names but show a different scale than 0.2.x.
- **Adding a base layer no longer activates it**, except the first one or when `layerDisplay.visible === true`.
- `getTileCount()` returns the number of tiles drawn (it previously always returned 1).
- `getCenter()` returns the orbit target instead of the screen-center ground intersection.
- `setView()` keeps the current pitch and bearing.
- `'ready'` fires when the map starts; `'move'` now fires once per frame while the camera moves.
- Default sun is north-west at 45° (cartographic convention); aspect defaults to the new `'cyclic'` ramp; slope is mapped in degrees over `slopeRange` (default 0–60°).
- WMTS KVP and WMS query values are URL-encoded.
- `TerrainRenderer`, the atlases and `TilePool` were rewritten; their internal APIs changed.

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
- Half-texel offset and point sampling of vertex heights; contours were drawn from the coarse mesh instead of the DEM.
- Undefined-behaviour `smoothstep` calls (reversed edges; zero width on flat ground).
- Switching base layers kept the previous layer's ramp/isoline settings; `'auto'` elevation range was a fixed 0–4000 m.
- Drape overzoom crops below one source pixel threw; teleports polluted prefetch; terrain following was frame-rate dependent and the camera could enter terrain.
- Documented-but-missing behaviour: `accessToken` was ignored, `tileload`/`tileunload`/`zoom` events never fired.

### Added

- CDLOD geomorphing with screen-space-error LOD: watertight LOD boundaries, no popping, consistent detail at any zoom, tilt and viewport; budget-fitted.
- Texture-array atlases (no slot bleeding), per-layer mipmapped and anisotropically filtered drapes with gamma-correct mips.
- Seamless tiles: shared edges and corners are stitched on load, blended over about one source pixel.
- Per-fragment DEM elevation and smooth normals for shading, color ramps and contours.
- Render on demand, device-pixel-ratio cap, WebGL context-loss recovery.
- Worker pipeline: decode, resample and mipmap off the main thread; URL-affinity routing with decode cache and in-flight dedupe; request cancellation.
- Inspection API: `getElevation()`, `pick()`, `getElevationProfile()`, `getStats()`, `setElevationRange('auto' | [min, max])`, `setSlopeRange()`, `setLodQuality()`, `requestRender()`, `'tileerror'` event.
- Sources: `{-y}`, `{quadkey}`, `{r}`, `{accessToken}` tokens; `headers`, `credentials`, `referrerPolicy`, `retina` options; WMS 1.3.0 axis order, `styles`, `transparent`.
- Touch panning with one finger, zoom-to-cursor, keyboard panning.
- Sanitized HTML attributions with links; attribution overflow handling.
- SSR-safe imports, `"sideEffects": false`, explicit `defineTreeletElements()`.
- New options: `workerUrl`, `mapDisplay.drapeSlotSize`, `maxPixelRatio`, `lodQuality`, `morphWidth`, `renderOnDemand`.
