# Getting started

[Documentation](README.md) · [Getting started](getting-started.md) · [The map](map.md) · [Terrain](terrain.md) · [Coats](coats.md) · [Region analyses](region-analyses.md) · [Overlays and tools](overlays-and-tools.md) · [Reference](reference.md)

How to install Treelet or load it from a CDN, a minimal map, and the bundles and browsers it supports.

## Installation

```bash
npm install @geozelot/treelet three
```

## CDN / Script Tag

For direct browser use without a bundler, use the **standalone** build which bundles Three.js and inlines the tile worker (no extra files to serve). It defines a global `Treelet` holding the library's exports: the map class is `Treelet.Treelet`, the sources `Treelet.XYZSource` and so on.

```html
<script src="https://unpkg.com/@geozelot/treelet/dist/treelet.cdn.standalone.js"></script>
<script>
  const map = Treelet.Treelet.map('map', {
    initCenter: { lng: 11.39, lat: 47.27 },
    initZoom: 10,
  });
  map.addBaseLayer({
    layerName: 'AWS Terrain',
    layerSource: new Treelet.XYZSource({ url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', maxZoom: 15 }),
    decoder: 'terrarium',
  });
  map.start();
</script>
```

## Minimal Example

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

const osm = map.addDrapeLayer({
  layerName: 'OpenStreetMap',
  layerSource: new XYZSource({
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileSize: 256,
    maxZoom: 19,
  }),
});

// The ground is a stack of coats: imagery at the bottom, analyses above it.
// A new map starts with a hillshade coat.
map.activateDrapeLayer(osm);
map.addAnalysisLayer({ analysis: 'slope', layerDisplay: { opacity: 0.6 } });
map.addAnalysisLayer({ analysis: 'contours', params: { interval: 50 } });

map.start();
```

## Bundles

Treelet ships three minified files:

| File | Format | Three.js | Use case |
|---|---|---|---|
| `treelet.es.js` | ESM | External | Bundlers (Vite, Webpack, Rollup) |
| `treelet.cdn.standalone.js` | IIFE | Included | `<script>` tag, CDN, no dependencies |
| `treelet.worker.js` | ESM worker | - | Optional: self-hosted worker for strict CSP (`workerUrl`) |

**Slim** (`treelet.es.js`) - ~500 KB minified (~145 KB gzipped). Three.js is a peer dependency; install it alongside treelet via npm. Best for projects that already use Three.js or want control over the Three.js version.

**Standalone** (`treelet.cdn.standalone.js`) - ~850 KB minified (~235 KB gzipped). Bundles only the Three.js modules treelet actually uses (tree-shaken). Drop-in ready for CDN or direct `<script>` tag usage - zero external dependencies.

Both bundles **inline the tile worker** and start it from a `blob:` URL, so nothing else needs to be served and they work from any CDN or bundler. If your Content-Security-Policy does not allow `worker-src blob:`, serve `dist/treelet.worker.js` from your own origin and pass its URL as `workerUrl`.

The package is side-effect free (`"sideEffects": false`) and safe to import during server-side rendering; the map itself needs a browser.

## Browser Support

Modern browsers with **WebGL2**, module **Web Workers** and **OffscreenCanvas** (Chrome/Edge 80+, Firefox 105+, Safari 16.4+). Requires ES2022.
