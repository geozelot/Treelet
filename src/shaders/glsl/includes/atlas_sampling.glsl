// Atlas sampling utilities
// Nearest-neighbor and sentinel-aware bilinear sampling for elevation atlas.

#define ELEVATION_SENTINEL -99990.0

// Nearest-neighbor sampling for vertex displacement.
// Produces stable elevation values that don't shift with sub-texel UV changes,
// eliminating terrain "wiggling" during camera panning.
float sampleAtlasNearest(sampler2D atlas, vec2 uv, float size) {
  vec2 base = (floor(uv * size) + 0.5) / size;
  return texture2D(atlas, base).r;
}

// Check if any of 4 bilinear samples is a sentinel value.
// Used by both vertex and fragment bilinear samplers to detect
// loaded/unloaded tile boundaries.
bool hasSentinel(float v00, float v10, float v01, float v11) {
  return v00 < ELEVATION_SENTINEL || v10 < ELEVATION_SENTINEL
      || v01 < ELEVATION_SENTINEL || v11 < ELEVATION_SENTINEL;
}

// Bilinear sampling for morph-zone parent elevation.
// Sentinel-aware: falls back to nearest if any sample is sentinel.
float sampleAtlasBilinear(sampler2D atlas, vec2 uv, float size) {
  vec2 texel = uv * size - 0.5;
  vec2 f = fract(texel);
  vec2 base = (floor(texel) + 0.5) / size;
  float ts = 1.0 / size;
  float v00 = texture2D(atlas, base).r;
  float v10 = texture2D(atlas, base + vec2(ts, 0.0)).r;
  float v01 = texture2D(atlas, base + vec2(0.0, ts)).r;
  float v11 = texture2D(atlas, base + vec2(ts, ts)).r;

  if (hasSentinel(v00, v10, v01, v11)) {
    return texture2D(atlas, (floor(uv * size) + 0.5) / size).r;
  }

  return mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
}

// Fragment-shader bilinear for float textures.
// Sentinel-aware: avoids wild interpolation at loaded/unloaded tile boundaries.
// Falls back to the nearest quadrant sample (instead of simple nearest) for
// smoother fallback at sub-texel level.
float sampleAtlas(sampler2D atlas, vec2 uv, float size) {
  vec2 texel = uv * size - 0.5;
  vec2 f = fract(texel);
  vec2 base = (floor(texel) + 0.5) / size;
  float ts = 1.0 / size;
  float v00 = texture2D(atlas, base).r;
  float v10 = texture2D(atlas, base + vec2(ts, 0.0)).r;
  float v01 = texture2D(atlas, base + vec2(0.0, ts)).r;
  float v11 = texture2D(atlas, base + vec2(ts, ts)).r;

  if (hasSentinel(v00, v10, v01, v11)) {
    float near = (f.x < 0.5)
      ? ((f.y < 0.5) ? v00 : v01)
      : ((f.y < 0.5) ? v10 : v11);
    return near;
  }

  return mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
}
