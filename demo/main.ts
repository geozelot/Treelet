// ============================================================================
// treelet.js - Full Demo
// Showcases the layer architecture: base layer = geometry, drape = coloring.
// Base mesh defaults to wireframe. Drapes (BaseDrape or external) color it.
// ============================================================================

import { Treelet } from '../src/index';

const map = Treelet.map('map', {
  center: { lng: 11.39, lat: 47.27 }, // Innsbruck, Austria - surrounded by Alps
  zoom: 10,
  minZoom: 2,
  maxZoom: 14,
  tileSegments: 128,
  exaggeration: 1.8,
  elevationRange: [0, 4000],
  contourInterval: 100,
  gui: true,
  compassPosition: 'top-right',
  layerPosition: 'bottom-right',
  antialias: true,
  workerCount: 4,
});

// =========================================================================
// Base Layer - AWS Terrain Tiles (Terrarium encoding, free, no API key)
// =========================================================================
map.addBaseLayer({
  id: 'terrain',
  name: 'AWS Terrain Tiles',
  source: {
    type: 'xyz',
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    tileSize: 512,
    maxZoom: 15,
    attribution: '© Mapzen, © AWS',
  },
  decoder: 'terrarium',
  exaggeration: 1.0,
  active: true,
});

// =========================================================================
// Drape Layer 1 - OpenStreetMap
// =========================================================================
map.addDrapeLayer({
  id: 'osm',
  name: 'OpenStreetMap (XYZ)',
  source: {
    type: 'xyz',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileSize: 512,
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors',
  },
});

// =========================================================================
// Drape Layer 2 - ESRI World Imagery (Satellite)
// =========================================================================
map.addDrapeLayer({
  id: 'satellite',
  name: 'ESRI Satellite (XYZ)',
  source: {
    type: 'xyz',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    tileSize: 512,
    maxZoom: 18,
    attribution: '© Esri, Maxar, Earthstar Geographics',
  },
});

// =========================================================================
// Drape Layer 3 - terrestris OSM (WMS)
// OGC WMS — server-rendered tiles via GetMap requests.
// =========================================================================
map.addDrapeLayer({
  id: 'osm-wms',
  name: 'OSM (WMS)',
  source: {
    type: 'wms',
    url: 'https://ows.terrestris.de/osm/service',
    layers: 'OSM-WMS',
    format: 'image/png',
    tileSize: 512,
    maxZoom: 18,
    attribution: '© terrestris, © OpenStreetMap contributors',
  },
});

// =========================================================================
// Drape Layer 4 - basemap.at Orthofoto (WMTS RESTful)
// OGC WMTS — pre-rendered Austrian orthophoto tiles.
// RESTful mode is auto-detected by the {z} placeholder in the URL.
// =========================================================================
map.addDrapeLayer({
  id: 'basemap-ortho',
  name: 'basemap.at Ortho (WMTS)',
  source: {
    type: 'wmts',
    url: 'https://maps.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg',
    tileSize: 256,
    maxZoom: 18,
    attribution: '© basemap.at',
  },
});

// Start!
map.start();

// Expose for console debugging
(window as unknown as Record<string, unknown>).map = map;
(window as unknown as Record<string, unknown>).Treelet = Treelet;

console.log(`treelet.js v${Treelet.version} - Full Demo`);
console.log('Navigate: Left-click drag to pan, scroll to zoom, right-click drag to orbit');
console.log('Default: elevation mode. Use panel to switch visualization and drapes.');
