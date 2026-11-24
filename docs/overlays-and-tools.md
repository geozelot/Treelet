# Overlays and tools

[Documentation](README.md) · [Getting started](getting-started.md) · [The map](map.md) · [Terrain](terrain.md) · [Coats](coats.md) · [Region analyses](region-analyses.md) · [Overlays and tools](overlays-and-tools.md) · [Reference](reference.md)

GeoJSON overlays drawn on the terrain, the methods that inspect and sample the terrain, and the measuring tools.

## Overlay layers

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
| `layerAttribution` | `string` | `''` | Credits shown while the overlay is visible |
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

## Inspection

| Method | Returns | Description |
|---|---|---|
| `getElevation(lngLat)` | `number \| null` | Elevation in meters from the finest loaded tile |
| `sampleTerrain(lngLat)` | `TerrainSample \| null` | `{ elevation, slope, aspect, curvature, normal }` at a position (true scale; aspect is `null` on flat ground) |
| `pick(x, y)` | `TerrainPick \| null` | The same plus `lngLat` for the terrain under container-relative pixel `(x, y)` |
| `getElevationProfile(from, to, samples?)` | `ProfileSample[]` | `{ lngLat, distance, elevation }` samples along a line (distance in meters) |
| `getVisibleElevationRange()` | `[number, number]` | Min and max elevation of the tiles on screen |
| `getElevationGrid(options?)` | `Promise<ElevationGrid>` | Elevations of a region as one grid (see [Region analyses](region-analyses.md#region-analyses)) |
| `pickLocation(options?)` | `Promise<TerrainPick \| null>` | Wait for a click on the terrain (crosshair cursor; `prompt` shown with the running analyses in the hub's column); `null` after Escape or `cancelPick()` |
| `cancelPick()` | `this` | Stop a pending `pickLocation()` (it resolves `null`) |
| `isPicking()` | `boolean` | Whether a `pickLocation()` is waiting for a click |
| `project(lngLat)` | `{ x, y } \| null` | Screen position (container pixels) of the terrain at a position |
| `measureDistance(points)` | `PathMeasure` | `{ distance, surfaceDistance, gain, loss, minElevation, maxElevation, profile }` of a path |
| `measureArea(ring, options?)` | `AreaMeasure` | `{ area, surfaceArea, perimeter, minElevation, maxElevation }` of a polygon (`cells`: the surface grid's resolution) |
| `lineOfSight(from, to, options?)` | `LineOfSightResult \| null` | `{ visible, obstruction, clearance, distance, profile }`, sampled at the loaded terrain's spacing and at least 64 times; options `fromHeight` (1.7 m), `toHeight` (0), `curvature`, `refraction` |
| `showProfile(path \| lineOfSight, options?)` | `this` | Show the elevation profile of a path or a line-of-sight result (on the hub's Measure page) |
| `hideProfile()` | `this` | Close it |

Slope, aspect and curvature come from the same 12-texel surface the shader shades, at the finest loaded tile's resolution.

```ts
map.on('moveend', () => {
  const pick = map.pick(200, 150);
  if (pick) console.log(`${pick.elevation.toFixed(1)} m, ${pick.slope.toFixed(1)}°`, pick.lngLat);
});
```

Distances are geodesic (WGS84 ellipsoid); `surfaceDistance` follows the terrain, sampled at the loaded tiles' resolution. Areas are computed on the authalic sphere (within about 0.5 % of the ellipsoid for regional polygons); `surfaceArea` adds the slopes. A line of sight drops distant terrain by the Earth's curvature less refraction, like the [viewshed](region-analyses.md#region-analyses).

## Tools

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
