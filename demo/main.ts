// ============================================================================
// treelet.js - Full Demo
// Showcases the layer architecture: base layer = geometry, drape = coloring.
// Base mesh defaults to wireframe. Drapes (BaseDrape or external) color it.
// ============================================================================

import { Treelet, XYZSource, WMTSSource } from '../src/index';

// @ts-ignore - expose for debugging
const map = (window as any).__treelet = Treelet.map('map', {
  initCenter: { lng: 11.39, lat: 47.27 }, // Innsbruck, Austria - surrounded by Alps
  initZoom: 10,
  minZoom: 4,
  maxZoom: 15,
  mapDisplay: {
    atlasSegments: 64,
    antialias: true,
  },
  guiDisplay: {
    enabled: true,
    compassPosition: 'top-right',
    layerPosition: 'bottom-right',
  },
  workerCount: 8,
});

// =========================================================================
// Base Layer - AWS Terrain Tiles (Terrarium encoding, free, no API key)
// =========================================================================
const terrain = map.addBaseLayer({
  layerName: 'AWS Terrain Tiles',
  layerSource: new XYZSource({
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    tileSize: 512,
    maxZoom: 15,
    attribution: '© Mapzen, © AWS',
  }),
  decoder: 'terrarium',
  layerDisplay: { exaggeration: 1.3 },
  terrainDisplay: {
    rampInterpolationRange: [0, 6000],
    isoplethInterval: 10,
  },
});

// =========================================================================
// Drape Layer 1 - OpenStreetMap
// =========================================================================
const osm = map.addDrapeLayer({
  layerName: 'OpenStreetMap (XYZ)',
  layerSource: new XYZSource({
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileSize: 512,
    maxZoom: 16,
    attribution: '© OpenStreetMap contributors',
  }),
  lodOffset: 2,
});

// =========================================================================
// Drape Layer 2 - ESRI World Imagery (Satellite)
// =========================================================================
const satellite = map.addDrapeLayer({
  layerName: 'ESRI Satellite (XYZ)',
  layerSource: new XYZSource({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    tileSize: 512,
    maxZoom: 16,
    attribution: '© Esri, Maxar, Earthstar Geographics',
  }),
  lodOffset: 2,
});

// =========================================================================
// Drape Layer 3 - basemap.at Orthofoto (WMTS RESTful)
// OGC WMTS — pre-rendered Austrian orthophoto tiles.
// RESTful mode is auto-detected by the {z} placeholder in the URL.
// =========================================================================
const basemapOrtho = map.addDrapeLayer({
  layerName: 'basemap.at Ortho (WMTS)',
  layerSource: new WMTSSource({
    url: 'https://maps.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg',
    tileSize: 512,
    maxZoom: 16,
    attribution: '© basemap.at',
  }),
});

// Start!
map.start();

// Expose for console debugging
(window as unknown as Record<string, unknown>).map = map;
(window as unknown as Record<string, unknown>).Treelet = Treelet;

console.log(`treelet.js v${Treelet.version} - Full Demo`);
console.log('Navigate: Left-click drag to pan, scroll to zoom, right-click drag to orbit');
console.log('Default: elevation mode. Use panel to switch visualization and drapes.');
