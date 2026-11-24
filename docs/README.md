# Treelet documentation

[Documentation](README.md) · [Getting started](getting-started.md) · [The map](map.md) · [Terrain](terrain.md) · [Coats](coats.md) · [Region analyses](region-analyses.md) · [Overlays and tools](overlays-and-tools.md) · [Reference](reference.md)

A map draws one **base layer** as terrain (elevation tiles decoded into a 3D surface) and colors it with a **coat stack**: the active drape (imagery) and any number of analysis layers, each with an opacity and a blend mode. Region analyses compute grids in a worker and add them as coats; **overlays** draw GeoJSON on the terrain; **tools** measure on it. Every layer is added with an `add…Layer` method that returns a `LayerHandle`, and changed or removed through that handle (`setLayerVisible`, `setLayerOpacity`, `removeLayer`, …). The pages below follow that order; the [API reference](https://geozelot.github.io/Treelet/api/) lists every class, method and type.

## Pages

- [Getting started](getting-started.md) - installation, the CDN script tag, a minimal example, the bundles and browser support.
- [The map](map.md) - creating a map, its options and controls, view, camera, input, lifecycle and events.
- [Terrain](terrain.md) - base layers, tile sources (XYZ, WMTS, the WMS plugin) and elevation decoders, custom ones included.
- [Coloring the ground](coats.md) - the coat stack, drape and analysis layers (built-in and custom), color ramps, and light, shadow and exaggeration.
- [Region analyses and rasters](region-analyses.md) - viewshed, sun hours, sky-view factor and TPI computed in a worker, and your own raster layers.
- [Overlays and tools](overlays-and-tools.md) - GeoJSON overlay layers, terrain inspection and sampling, and the measuring tools.
- [API reference](reference.md) - the main types and the low-level exports.

## More

- [Changelog](../CHANGELOG.md) - what changed in each release, with a [migration guide from 0.3](../CHANGELOG.md#migrating-from-03).
- [Generated API reference](https://geozelot.github.io/Treelet/api/) - every class, method and type, generated from the source with TypeDoc.
- [Live demo](https://geozelot.github.io/Treelet/)
