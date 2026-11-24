# Terrain

[Documentation](README.md) · [Getting started](getting-started.md) · [The map](map.md) · [Terrain](terrain.md) · [Coats](coats.md) · [Region analyses](region-analyses.md) · [Overlays and tools](overlays-and-tools.md) · [Reference](reference.md)

The active base layer is the terrain: elevation tiles from a tile source, decoded into meters. This page covers base layers, the tile sources they load from and the decoders that turn tile pixels into elevations.

## Base layers

Only one base layer is active at a time. The active base layer provides elevation data for the terrain mesh. The first layer added becomes active; later ones only become active with `setActiveBaseLayer()` or `layerDisplay: { visible: true }`.

| Method | Returns | Description |
|---|---|---|
| `addBaseLayer(options)` | `LayerHandle` | Add an elevation data layer |
| `removeBaseLayer(handle)` | `this` | Remove a base layer |
| `setActiveBaseLayer(handle)` | `this` | Switch active base layer |
| `getBaseLayers()` | `BaseLayer[]` | Get all registered base layers |

### BaseLayerOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `layerName` | `string` | *required* | Display name |
| `layerSource` | `TileSource` | *required* | Tile source instance (`XYZSource`, `WMTSSource`, etc.) |
| `decoder` | `DecoderName \| ElevationDecoder` | `'terrain-rgb'` | Elevation decoder |
| `layerDisplay` | `BaseLayerDisplay` | `{}` | `{ visible?, exaggeration? }` (`visible: true` activates the layer on add) |
| `layerAttribution` | `string` | source attribution | Attribution text |
| `minZoom` | `number` | `0` | Minimum zoom level |
| `maxZoom` | `number` | `22` | Maximum zoom level (≤ 22) |

## Tile sources

Layers accept `TileSource` instances via the `layerSource` option. Construct sources directly using `XYZSource` or `WMTSSource`.

### Shared options (TileSourceOptions)

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | *required* | Endpoint URL or template |
| `tileSize` | `number` | `256` | Pixel size of the source's tiles (with `retina`, of the 1× tiles). Drapes use it to decide how many source tiles fill a slot until the first tile shows the real size; a mismatch is logged |
| `minZoom` | `number` | `0` | Minimum zoom level |
| `maxZoom` | `number` | `22` | Maximum zoom level |
| `attribution` | `string` | `''` | Attribution text (simple HTML links allowed; sanitized) |
| `accessToken` | `string` | - | Substituted for `{accessToken}` or `{token}`, otherwise appended as `access_token=` |
| `headers` | `Record<string, string>` | - | Extra request headers (e.g. `Authorization`) |
| `credentials` | `RequestCredentials` | `'same-origin'` | Fetch credentials mode |
| `referrerPolicy` | `ReferrerPolicy` | - | Fetch referrer policy |
| `retina` | `boolean \| string` | `''` | Value for `{r}`: `true` → `'@2x'` on high-DPI screens |
| `maxConcurrency` | `number` | `12` | Concurrent requests for this source |

Tiles answering **404 / 410 / 204** (or an empty body) are treated as nonexistent: elevation renders at sea level and drapes fall back to coarser imagery. Other failures are retried with exponential backoff (1 s → 60 s), never in a loop.

### XYZ source

Standard slippy-map tiles. Placeholders: `{z}`, `{x}`, `{y}`, `{-y}` (TMS row), `{s}` (subdomain), `{quadkey}` (Bing), `{r}` (retina suffix), `{accessToken}` / `{token}`.

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

### WMTS source

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

### WMS source (plugin)

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

## Elevation decoders

Built-in decoders for common DEM tile formats:

| Decoder | Formula | Precision |
|---|---|---|
| `'terrain-rgb'` | `-10000 + (R×65536 + G×256 + B) × 0.1` | 0.1 m |
| `'mapbox'` | Alias for `terrain-rgb` | 0.1 m |
| `'terrarium'` | `R×256 + G + B/256 - 32768` | ~0.004 m |

Pixels with alpha 0 are treated as **nodata** for every decoder. Images are decoded with color management and premultiplication disabled, so encoded RGB values reach the decoder bit-exact.

### Custom decoder

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
