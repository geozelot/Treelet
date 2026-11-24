# Coloring the ground

[Documentation](README.md) · [Getting started](getting-started.md) · [The map](map.md) · [Terrain](terrain.md) · [Coats](coats.md) · [Region analyses](region-analyses.md) · [Overlays and tools](overlays-and-tools.md) · [Reference](reference.md)

How the terrain is colored: the coat stack of imagery and analysis layers, color ramps and legends, and the light, shadows and exaggeration of the relief.

## The coat stack

The ground color is a stack of coats, bottom first: the active drape (imagery) and analysis layers. Each coat has an opacity and a blend mode; value analyses map their value through a color ramp and show a legend.

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

## Drape layers

Drape layers render raster imagery onto the terrain. One drape is active at a time: it forms the **imagery coat** at the bottom of the coat stack.

| Method | Returns | Description |
|---|---|---|
| `addDrapeLayer(options)` | `LayerHandle` | Register an imagery layer (inactive until activated) |
| `removeDrapeLayer(handle)` | `this` | Remove a drape layer |
| `activateDrapeLayer(handle)` | `this` | Make a drape the imagery coat (replaces the active one) |
| `deactivateDrapeLayer()` | `this` | Remove the imagery coat (the layer stays registered) |
| `getActiveDrapeId()` | `string \| null` | Active drape ID |
| `getDrapeLayers()` | `DrapeLayer[]` | Get all registered drape layers |

### DrapeLayerOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `layerName` | `string` | *required* | Display name |
| `layerSource` | `TileSource` | *required* | Tile source instance |
| `layerDisplay` | `DrapeLayerDisplay` | `{}` | `{ opacity?, blendMode? }` (a drape is added inactive: show it with `activateDrapeLayer`; `visible` is ignored) |
| `layerAttribution` | `string` | source attribution | Attribution text |
| `minZoom` | `number` | `0` | Minimum zoom level |
| `maxZoom` | `number` | `22` | Maximum zoom level |

## Analysis layers

An analysis layer is a coat computed from the terrain: elevation, slope, aspect, curvature, contours, water, hillshade or shadows (or a kind you register). Any number can be stacked over the imagery, each with opacity and a blend mode. Kinds that map a value (elevation, slope, aspect, curvature) use a color **ramp** and have a legend; contours, water, hillshade and shadows produce a color directly.

Parameters set from code are clamped to each parameter's limits (with a warning), not to the panel's slider range: contours take any positive interval, elevation and water ranges any elevation (bathymetry included); the panel's sliders widen to show such values.

| Method | Returns | Description |
|---|---|---|
| `addAnalysisLayer(options)` | `LayerHandle` | Add a coat. Value kinds go in just above the imagery and the other value coats; color kinds (contours, water, hillshade, shadows) go on top |
| `removeAnalysisLayer(handle)` | `this` | Remove the coat |
| `setAnalysisParams(handle, params)` | `this` | Merge parameters (see the kind's parameters below) |
| `getAnalysisParams(handle)` | `object \| null` | A copy of the current parameters |
| `animateAnalysisParams(handle, targets, duration?)` | `Promise<boolean>` | Tween numeric parameters to `value` or from `[from, to]` over `duration` ms (default 1000); resolves `false` when replaced or the layer is removed |
| `getAnalysisValue(handle, lngLat)` | `number \| null` | The value a value coat colors at a position, in its unit (computed on the CPU like the shader; a raster's value for raster kinds) |
| `setAnalysisRamp(handle, ramp)` | `this` | Ramp of a value kind: a built-in name or stops / classes |
| `getAnalysisRamp(handle)` | `Ramp \| undefined` | Current ramp |
| `getLegend(handle)` | `LegendSpec \| null` | Legend of a value coat (title, unit, domain, stops or classes) |
| `getLegends()` | `LegendSpec[]` | Legends of the value coats drawn now, top first (not those hidden, outside their zoom range, at opacity 0 or past the coat limit) |
| `getAnalysisLayers()` | `AnalysisLayer[]` | All analysis layers |

### AnalysisLayerOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `analysis` | `string` | *required* | Kind: `'elevation' \| 'slope' \| 'aspect' \| 'curvature' \| 'contours' \| 'water' \| 'hillshade' \| 'shadows'` or a registered id |
| `layerName` | `string` | the kind's label | Display name |
| `params` | `object` | kind defaults | Parameters (below) |
| `ramp` | `Ramp` | kind default | Color ramp (value kinds) |
| `unit` | `string` | the kind's unit | Unit of the values (legend, readout) |
| `minZoom` | `number` | `0` | Drawn from this zoom |
| `maxZoom` | `number` | `22` | Drawn up to this zoom |
| `layerDisplay` | `AnalysisLayerDisplay` | `{}` | `{ visible?, opacity?, blendMode? }` |

### Built-in analyses

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

### Custom analyses

`registerAnalysis(descriptor)` adds a kind. The descriptor's `glsl` defines `vec4 analysis_<id>(Surface s, vec4 p0, vec4 p1)`; `s.h` is the elevation in meters, `s.n` the true-scale unit normal (x east, y north, z up), `s.g` the gradient (dh/dx east, dh/dy north, m/m), `s.c` the second derivatives (hxx, hyy, hxy in 1/m), `s.fw` the screen-space derivative of `s.h`, and `uSunDirection` the sun. A value kind (with a `ramp`) returns the normalized value in `.x` and the alpha in `.w`; a color kind returns `rgb` and alpha. `params` is the schema the panel renders (`range`, `span`, `select`, `color`, `boolean`; a `span` may be `optional` and `wrap` for compass sectors, a `range` may take its slider `bounds` from the visible elevation; `min`–`max` is the slider range and `limits` the range values are clamped to, by default the same), `pack(params, domain)` fills `p0`/`p1`, `domain(params, visible)` gives the ramp's value range for the visible elevation range (evaluated again as it changes, so a domain derived from it follows the view), `initialParams(visible)` derives defaults from the visible elevation range, and `cpu(sample, params)` computes the same value on the CPU (`getAnalysisValue`, the readout). `registerAnalysis` checks the ramp and blend mode. See `src/analysis/builtins/` for examples.

## Color ramps

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

## Light, shadow and exaggeration

The sun lights the hillshade and casts the shadows coat; place it by hand or by date and time. Exaggeration stretches the relief (analyses stay true to scale).

### Visualization

| Method | Returns | Description |
|---|---|---|
| `setExaggeration(value)` | `this` | Set vertical exaggeration on active base layer (clamped to 0–100; reported as the layer's `'layerupdate'`) |
| `setExaggeration(handle, value)` | `this` | Set exaggeration on a specific base layer |
| `getExaggeration()` | `number` | Get exaggeration factor |
| `setWireframe(enabled)` | `this` | Draw the mesh as a wireframe (colored by the coats); reported as `'meshchange'`, as is the next one |
| `getWireframe()` | `boolean` | |
| `setWireframeWhite(white)` | `this` | Flat-white wireframe |
| `getWireframeWhite()` | `boolean` | |
| `setSunAzimuth(degrees)` | `this` | Sun azimuth for hillshade (default 315°, north-west; a non-finite value is ignored) |
| `getSunAzimuth()` | `number` | |
| `setSunAltitude(degrees)` | `this` | Sun altitude for hillshade, 5–90° (default 45°; a non-finite value is ignored) |
| `getSunAltitude()` | `number` | |
| `setSunTime(date \| null)` | `this` | Place the sun where it stands at `date` over the map center (it follows the map as it moves); `null` returns to the manual sun where it was |
| `getSunTime()` | `Date \| null` | |
| `getSunPosition(date?, lngLat?)` | `SunPosition` | `{ azimuth, altitude, declination, equationOfTime }` (NOAA algorithm, refraction-corrected) |

Setting the azimuth or altitude by hand clears the sun time. The *Light* page (the hub's Layers page) switches between a manual sun and a day and time.
