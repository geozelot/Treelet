// Rasters bound to coats: grids computed in workers (viewshed, sun hours…)
// or supplied by the user, sampled by world position. Rasters are
// cell-registered with row 0 to the north: texel (i, j) covers the cell
// [i, i+1] × [j, j+1] of the raster's bounds, its value sits at the center.
//
// An analysis that draws a raster calls coatRaster(): the coat loop sets
// gCoatRaster to the slot of the coat being evaluated.

int gCoatRaster = -1;

// rasterTexel(slot, p) and rasterColor(slot, uv) are generated per slot:
// branches select the sampler (sampler arrays need constant indices); the
// slot comes from a uniform, so control flow stays uniform.
// @RASTER_ACCESSORS

// Value rasters: (value, 0, 0, 1) where there is data, vec4(0) outside the
// raster or on nodata. Color rasters: their RGBA.
vec4 sampleRaster(int slot) {
  if (slot < 0 || slot >= MAX_RASTERS) return vec4(0.0);
  vec4 xf = uRasterXform[slot];
  vec4 info = uRasterInfo[slot];
  vec2 p = vec2((vWorldLocal.x - xf.x) * xf.z, (xf.y - vWorldLocal.y) * xf.w);
  if (p.x < 0.0 || p.y < 0.0 || p.x > info.x || p.y > info.y) return vec4(0.0);
  if (info.z > 0.5) {
    // Premultiplied texels, filtered; back to straight alpha
    vec4 c = rasterColor(slot, p / info.xy);
    return c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0);
  }

  // Bilinear between cell centers, ignoring nodata taps
  vec2 t = p - 0.5;
  vec2 i0f = floor(t);
  vec2 f = t - i0f;
  ivec2 imax = ivec2(info.xy) - 1;
  ivec2 a = clamp(ivec2(i0f), ivec2(0), imax);
  ivec2 b = clamp(ivec2(i0f) + 1, ivec2(0), imax);
  vec4 v = vec4(
    rasterTexel(slot, a),
    rasterTexel(slot, ivec2(b.x, a.y)),
    rasterTexel(slot, ivec2(a.x, b.y)),
    rasterTexel(slot, b)
  );
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  vec4 valid = step(vec4(RASTER_NODATA_THRESHOLD), v);
  float ws = dot(w, valid);
  if (ws < 1e-4) return vec4(0.0);
  return vec4(dot(w * valid, v) / ws, 0.0, 0.0, 1.0);
}

// The raster of the coat being evaluated.
vec4 coatRaster() {
  return sampleRaster(gCoatRaster);
}
