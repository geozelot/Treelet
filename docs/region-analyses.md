# Region analyses and rasters

[Documentation](README.md) · [Getting started](getting-started.md) · [The map](map.md) · [Terrain](terrain.md) · [Coats](coats.md) · [Region analyses](region-analyses.md) · [Overlays and tools](overlays-and-tools.md) · [Reference](reference.md)

Analyses computed in a worker over a region of the terrain, and raster layers for your own grids; both are drawn as coats in the [coat stack](coats.md#the-coat-stack).

## Region analyses

Analyses that need more than one point of the surface run in a dedicated worker over a *region*: the elevation tiles covering a box, at the finest zoom that needs no more than `maxTiles` tiles (default 64, i.e. about 2048 × 2048 cells), assembled into one grid. The result is shown as a coat (a raster layer of the analysis' kind) and returned with its data. The worker keeps the last two regions, so several analyses of the same view load the tiles once.

| Method | Returns | Description |
|---|---|---|
| `computeViewshed(observer, options?)` | `Promise<ViewshedResult>` | Ground visible from `observer` (lng/lat) |
| `computeSunHours(options?)` | `Promise<SunHoursResult>` | Hours of direct sun on a day, with terrain shadows |
| `computeSkyView(options?)` | `Promise<GridResult>` | Sky-view factor: the visible fraction of the sky (1 open, lower in valleys) |
| `computeTpi(options?)` | `Promise<GridResult>` | Topographic position index: meters above (+) or below (−) the surrounding mean |
| `computeAnalysis(kind, options?)` | `Promise<…>` | Any of the above by kind (`'viewshed'` needs `observer`; `REGION_ANALYSIS_INPUT[kind]` says which kinds need a point) |
| `getRegionAnalyses()` | `RegionAnalysisKind[]` | The kinds `computeAnalysis` takes |
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

Every result carries `bounds`, `width`, `height`, `zoom`, `cellSize` (meters) and `missingTiles`. A job that can't run (no active base layer, no terrain in view, or no raster slot for its coat, counting the slots runs still going will take) fails before loading anything: it is reported like any other, with an `'analysisstart'` and an `'analysisend'` with `'error'`, so the controls list the failure. `'done'` is reported once the result is shown (a failure to show it ends the job with `'error'`). A region whose tiles failed to load is loaded again by the next analysis (the failed tiles are retried). The viewshed casts rays from the observer to every cell on the edge of the search square and drops distant ground by the Earth's curvature less refraction (`d² (1 − k) / 2R`). Sun hours sweep the terrain's shadow along the sun's azimuth for every sun position of the day; terrain outside the region casts no shadow. Without a radius the sky view searches the whole region exactly (one sweep per direction); with one it samples up to 128 cells per direction, which is slower. While an analysis runs, the hub's column shows its progress and a cancel button (in the Layers page's Overlay group, at the foot of the Measure page; the tree box at rest shows a progress line); *Add layer* runs them over the view (the viewshed asks for a click on the observer first), and a new run of a kind takes the place of one still going.

```ts
const summit = { lng: 11.3853, lat: 47.3122 };
const { visibleArea, layer } = await map.computeViewshed(summit, { radius: 12000, eyeHeight: 2 });
console.log(`${(visibleArea / 1e6).toFixed(1)} km² visible`);
map.getRasterValue(layer!, { lng: 11.3928, lat: 47.2654 }); // 1: Innsbruck is in view

const sun = await map.computeSunHours({ date: new Date(2026, 11, 21) });
console.log(`${sun.daylight} h of daylight`);
```

## Raster layers

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
| `ramp`, `unit`, `layerName`, `layerDisplay` | | `'viridis'` | As for [analysis layers](coats.md#analysislayeroptions) |

```ts
const temps = new Float32Array(200 * 100); // …filled row by row from the north
map.addRasterLayer({
  data: temps, width: 200, height: 100,
  bounds: { west: 10, south: 46, east: 13, north: 48 }, crs: 'EPSG:4326',
  ramp: 'inferno', unit: '°C', layerName: 'Temperature', layerDisplay: { opacity: 0.7 },
});
```

Value rasters are filtered bilinearly between cell centers in the shader (no-data cells are skipped), so they work on GPUs without float-texture filtering.
