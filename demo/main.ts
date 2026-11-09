// ============================================================================
// treelet.js - Full Demo
// Showcases the layer architecture: the base layer is the geometry; the
// coat stack (imagery and analyses such as elevation, slope, contours,
// water and hillshade) colors it. Three presets switch between stacks.
// ============================================================================

import { Treelet, XYZSource, WMTSSource } from '../src/index';

// @ts-ignore - expose for debugging
const map = (window as any).__treelet = Treelet.map('map', {
  initCenter: { lng: 11.39, lat: 47.27 }, // Innsbruck, Austria - surrounded by Alps
  initZoom: 10,
  minZoom: 4,
  maxZoom: 18,
  mapDisplay: {
    horizonDistance: 24,
    atlasSegments: 64,
    antialias: true,
    drapeSlotSize: 512,
  },
  guiDisplay: {
    enabled: true,
    glass: true,
    compassPosition: 'top-right',
    layerPosition: 'bottom-right',
  },
});

// =========================================================================
// Base Layer - AWS Terrain Tiles (Terrarium encoding, free, no API key)
// =========================================================================
const terrain = map.addBaseLayer({
  layerName: 'AWS Terrain Tiles',
  layerSource: new XYZSource({
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    tileSize: 256,
    maxZoom: 15,
    attribution: '© Mapzen, © AWS',
  }),
  decoder: 'terrarium',
  layerDisplay: { exaggeration: 1.3 },
});

// =========================================================================
// Drape Layer 1 - OpenStreetMap
// =========================================================================
const osm = map.addDrapeLayer({
  layerName: 'OpenStreetMap (XYZ)',
  layerSource: new XYZSource({
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileSize: 256,
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors',
  }),
});

// =========================================================================
// Drape Layer 2 - ESRI World Imagery (Satellite)
// =========================================================================
const satellite = map.addDrapeLayer({
  layerName: 'ESRI Satellite (XYZ)',
  layerSource: new XYZSource({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    tileSize: 256,
    maxZoom: 19,
    attribution: '© Esri, Maxar, Earthstar Geographics',
  }),
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
    tileSize: 256,
    maxZoom: 19,
    attribution: '© basemap.at',
  }),
});

// =========================================================================
// Presets - a few coat stacks. The map starts with a hillshade coat; each
// preset adds its own analyses on top of the imagery it picks. Open the
// Overlay stack in the layer panel to change them.
// =========================================================================
type Preset = 'relief' | 'avalanche' | 'flood';
let presetLayers: ReturnType<typeof map.addAnalysisLayer>[] = [];

function applyPreset(name: Preset): void {
  for (const h of presetLayers) map.removeAnalysisLayer(h);
  presetLayers = [];

  if (name === 'relief') {
    // Elevation colors under the hillshade, no imagery
    map.deactivateDrapeLayer();
    presetLayers.push(map.addAnalysisLayer({ analysis: 'elevation', params: { range: [0, 4000] } }));
  } else if (name === 'avalanche') {
    // Avalanche terrain: slope classes (nothing below 30°) over the orthophoto, with contours
    map.activateDrapeLayer(basemapOrtho);
    presetLayers.push(
      map.addAnalysisLayer({ analysis: 'slope', ramp: 'avalanche', layerDisplay: { opacity: 0.7 } }),
      map.addAnalysisLayer({ analysis: 'contours', params: { interval: 100, index: 5 } }),
    );
  } else {
    // Rising water over the satellite imagery: the level animates up through the visible range
    map.activateDrapeLayer(satellite);
    const [lo, hi] = map.getVisibleElevationRange();
    const water = map.addAnalysisLayer({ analysis: 'water', params: { level: lo } });
    presetLayers.push(water);
    void map.animateAnalysisParams(water, { level: [lo, lo + 0.45 * (hi - lo)] }, 4000);
  }

  document.querySelectorAll<HTMLButtonElement>('#presets button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.preset === name));
  });
}

document.getElementById('presets')?.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-preset]');
  if (button) applyPreset(button.dataset.preset as Preset);
});

applyPreset('relief');

// Start!
map.start();

// Expose for console debugging
(window as unknown as Record<string, unknown>).map = map;
(window as unknown as Record<string, unknown>).Treelet = Treelet;

console.log(`treelet.js v${Treelet.version} - Full Demo`);
console.log('Navigate: Left-click drag to pan, scroll to zoom, right-click drag to orbit (touch: 1 finger pans, 2 fingers zoom/rotate)');
console.log('Inspect: map.sampleTerrain({ lng, lat }), map.pick(x, y), map.getElevationProfile(a, b), map.getStats()');
console.log('Coats: map.addAnalysisLayer({ analysis: "slope", ramp: "avalanche" }), map.getLayerStack(), map.getLegends()');
console.log('Water: const w = map.addAnalysisLayer({ analysis: "water" }); map.animateAnalysisParams(w, { level: 2000 }, 3000)');
