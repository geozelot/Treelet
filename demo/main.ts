// ============================================================================
// treelet.js - Full Demo
// Showcases the layer architecture: the base layer is the geometry; the
// coat stack (imagery and analyses such as elevation, slope, contours,
// water and hillshade) colors it. Presets switch between stacks, including
// region analyses computed in a worker (a viewshed, sun hours on a date).
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
    tools: 'top-left',
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
type Preset = 'relief' | 'avalanche' | 'flood' | 'viewshed' | 'sun' | 'peaks' | 'shadows';
/** The running sun animation of the Shadows preset (stopped by any other preset). */
let sunAnimation = 0;
let presetLayers: ReturnType<typeof map.addAnalysisLayer>[] = [];
let presetOverlay: ReturnType<typeof map.addOverlayLayer> | null = null;

/** Demo data: a few summits around Innsbruck (approximate positions) and a route up the Nordkette. */
const PEAKS = {
  type: 'FeatureCollection' as const,
  features: [
    { name: 'Hafelekarspitze', ele: 2334, at: [11.3858, 47.3125] },
    { name: 'Patscherkofel', ele: 2246, at: [11.4613, 47.2087] },
    { name: 'Nockspitze', ele: 2404, at: [11.3207, 47.1870] },
    { name: 'Glungezer', ele: 2677, at: [11.5277, 47.2273] },
    { name: 'Serles', ele: 2717, at: [11.3870, 47.1290] },
  ].map((p) => ({ type: 'Feature' as const, properties: { name: p.name, ele: p.ele }, geometry: { type: 'Point' as const, coordinates: p.at } })),
};
const ROUTE = {
  type: 'Feature' as const,
  properties: { name: 'Nordkette route' },
  geometry: { type: 'LineString' as const, coordinates: [
    [11.3933, 47.2690], [11.3905, 47.2805], [11.3862, 47.2905], [11.3812, 47.2985], [11.3838, 47.3065], [11.3858, 47.3125],
  ] },
};

/** Hafelekar (2256 m) on the Nordkette, straight above Innsbruck. */
const SUMMIT = { lng: 11.3853, lat: 47.3122 };

function applyPreset(name: Preset): void {
  sunAnimation++;
  for (const job of map.getAnalysisJobs()) map.cancelAnalysis(job.id);
  map.cancelPick();
  for (const h of presetLayers) map.removeAnalysisLayer(h);
  presetLayers = [];
  if (presetOverlay) map.removeOverlayLayer(presetOverlay);
  presetOverlay = null;
  if (name !== 'sun' && name !== 'shadows' && map.getSunTime()) {
    // Back to the default sun from the north-west
    map.setSunTime(null);
    map.setSunAzimuth(315);
    map.setSunAltitude(45);
  }
  const keep = (p: Promise<{ layer: ReturnType<typeof map.addAnalysisLayer> | null }>) => {
    p.then((r) => { if (r.layer) presetLayers.push(r.layer); })
      .catch((err) => { if (err?.name !== 'AbortError') console.warn(err); });
  };

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
  } else if (name === 'flood') {
    // Rising water over the satellite imagery: the level animates up through the visible range
    map.activateDrapeLayer(satellite);
    const [lo, hi] = map.getVisibleElevationRange();
    const water = map.addAnalysisLayer({ analysis: 'water', params: { level: lo } });
    presetLayers.push(water);
    void map.animateAnalysisParams(water, { level: [lo, lo + 0.45 * (hi - lo)] }, 4000);
  } else if (name === 'viewshed') {
    // What the summit sees within 12 km (computed in a worker; progress in the legend)
    map.activateDrapeLayer(basemapOrtho);
    map.setView({ lng: SUMMIT.lng, lat: SUMMIT.lat - 0.04 }, 10.8);
    keep(map.computeViewshed(SUMMIT, { radius: 12000, eyeHeight: 2, layerDisplay: { opacity: 0.8 } }));
  } else if (name === 'shadows') {
    // A winter day: terrain shadows follow the sun from morning to afternoon
    map.deactivateDrapeLayer();
    map.setView({ lng: 11.40, lat: 47.27 }, 11.3);
    presetLayers.push(
      map.addAnalysisLayer({ analysis: 'elevation', params: { range: [0, 4000] } }),
      map.addAnalysisLayer({ analysis: 'shadows', params: { darkness: 0.55 } }),
    );
    const year = new Date().getFullYear();
    const from = new Date(year, 11, 21, 8, 30).getTime();
    const to = new Date(year, 11, 21, 15, 30).getTime();
    const token = sunAnimation;
    const start = performance.now();
    const step = (now: number) => {
      if (token !== sunAnimation) return;
      const t = Math.min(1, (now - start) / 14000);
      map.setSunTime(new Date(from + (to - from) * t));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  } else if (name === 'peaks') {
    // A GeoJSON overlay: summits with labels and a route draped over the satellite imagery
    map.activateDrapeLayer(satellite);
    map.setView({ lng: 11.41, lat: 47.24 }, 10.8);
    presetOverlay = map.addOverlayLayer({
      layerName: 'Peaks',
      data: { type: 'FeatureCollection', features: [...PEAKS.features, ROUTE] },
      style: { color: '#ff6a00', lineWidth: 3, pointRadius: 5, label: (p) => (p.ele ? `${p.name} ${p.ele} m` : null) },
    });
  } else {
    // Winter solstice: hours of direct sun in the Inn valley, sun placed at 10:30
    map.deactivateDrapeLayer();
    map.setView({ lng: 11.39, lat: 47.27 }, 11);
    const day = new Date(new Date().getFullYear(), 11, 21, 10, 30);
    map.setSunTime(day);
    keep(map.computeSunHours({ date: day, layerDisplay: { opacity: 0.85 } }));
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
console.log('Regions: map.computeViewshed({ lng, lat }), map.computeSunHours({ date }), map.computeSkyView(), map.computeTpi(), map.getElevationGrid()');
console.log('Tools: map.startTool("distance" | "area" | "profile" | "sight"), map.lineOfSight(a, b), map.showProfile([a, b]), map.addOverlayLayer({ layerName, data: geojson })');
