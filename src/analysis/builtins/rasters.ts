// treelet.js - Raster-backed analyses: kinds whose coat draws a raster bound
// to the layer (computed in a worker, or supplied with addRasterLayer)
// instead of a quantity of the terrain surface.

import type { AnalysisDescriptor } from '../types';

/** GLSL of a value kind that maps its raster over `range` (p0.xy). */
function valueGlsl(id: string): string {
  return /* glsl */ `
vec4 analysis_${id}(Surface s, vec4 p0, vec4 p1) {
  vec4 r = coatRaster();
  return vec4((r.x - p0.x) / max(p0.y - p0.x, 1e-6), 0.0, 0.0, r.w);
}`;
}

export interface RangeParams extends Record<string, unknown> {
  /** Value range the ramp spans. */
  range: [number, number];
}

const rangePack = (_p: RangeParams, domain: [number, number]) => ({
  p0: [domain[0], domain[1], 0, 0] as [number, number, number, number],
  p1: [0, 0, 0, 0] as [number, number, number, number],
});

/** A user-supplied value grid (`addRasterLayer` with Float32 data). */
export const raster: AnalysisDescriptor<RangeParams> = {
  id: 'raster',
  label: 'Raster',
  raster: true,
  glsl: valueGlsl('raster'),
  params: [
    { key: 'range', label: 'Range', type: 'span', min: -1e9, max: 1e9, step: 1, bounds: 'data' },
  ],
  defaults: { range: [0, 1] },
  ramp: 'viridis',
  domain: (p) => p.range,
  pack: rangePack,
};

/** A user-supplied color image (`addRasterLayer` with RGBA bytes). */
export const image: AnalysisDescriptor<Record<string, never>> = {
  id: 'image',
  label: 'Image',
  raster: true,
  glsl: /* glsl */ `
vec4 analysis_image(Surface s, vec4 p0, vec4 p1) {
  return coatRaster();
}`,
  params: [],
  defaults: {},
  pack: () => ({ p0: [0, 0, 0, 0], p1: [0, 0, 0, 0] }),
};

/** Ground visible from an observer: 1 visible, 0 hidden, nodata outside the radius. */
export const viewshed: AnalysisDescriptor<Record<string, never>> = {
  id: 'viewshed',
  label: 'Viewshed',
  raster: true,
  glsl: valueGlsl('viewshed'),
  params: [],
  defaults: {},
  ramp: 'visibility',
  domain: () => [0, 1],
  pack: () => ({ p0: [0, 1, 0, 0], p1: [0, 0, 0, 0] }),
};

/** Hours of direct sun on a date. */
export const sunhours: AnalysisDescriptor<RangeParams> = {
  id: 'sunhours',
  label: 'Sun hours',
  unit: 'h',
  raster: true,
  glsl: valueGlsl('sunhours'),
  params: [
    { key: 'range', label: 'Range', type: 'span', min: 0, max: 24, step: 0.5, unit: 'h' },
  ],
  defaults: { range: [0, 12] },
  ramp: 'inferno',
  domain: (p) => p.range,
  pack: rangePack,
};

/** Sky-view factor: the visible fraction of the sky hemisphere (1 = open plain). */
export const skyview: AnalysisDescriptor<RangeParams> = {
  id: 'skyview',
  label: 'Sky view',
  raster: true,
  glsl: valueGlsl('skyview'),
  params: [
    { key: 'range', label: 'Range', type: 'span', min: 0, max: 1, step: 0.01 },
  ],
  defaults: { range: [0.6, 1] },
  ramp: 'grayscale',
  domain: (p) => p.range,
  pack: rangePack,
};

/** Topographic position index: elevation above (+) or below (−) the mean of its surroundings. */
export const tpi: AnalysisDescriptor<RangeParams> = {
  id: 'tpi',
  label: 'Topographic position',
  unit: 'm',
  raster: true,
  glsl: valueGlsl('tpi'),
  params: [
    { key: 'range', label: 'Range', type: 'span', min: -500, max: 500, step: 5, unit: 'm' },
  ],
  defaults: { range: [-50, 50] },
  ramp: 'diverging',
  domain: (p) => p.range,
  pack: rangePack,
};
