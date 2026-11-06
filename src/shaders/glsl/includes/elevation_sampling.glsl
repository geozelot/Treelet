// Elevation atlas sampling (shared by vertex and fragment stages).
//
// The atlas is an R32F texture array, one tile per layer, with
// corner-aligned texels: texel (0,0) is the tile's NW corner and
// (S-1,S-1) its SE corner. An atlas reference vec4(layer, offset.xy, scale)
// addresses a tile's own data (offset 0, scale 1) or a sub-region of an
// ancestor tile while the tile itself is still loading.

precision highp sampler2DArray;

uniform sampler2DArray uElevAtlas;
uniform float uSlotSize;

#define NODATA_THRESHOLD -99990.0
#define NODATA_VALUE -99999.0

float elevTexel(int layer, ivec2 p) {
  return texelFetch(uElevAtlas, ivec3(p, layer), 0).r;
}

// Texel-space position of tile-normalized uv (v down) inside a reference.
vec2 elevTexelCoord(vec4 ref, vec2 tileUV) {
  float smax = uSlotSize - 1.0;
  return clamp((ref.yz + tileUV * ref.w) * smax, vec2(0.0), vec2(smax));
}

// Nodata-aware bilinear elevation in meters (NODATA_VALUE if no valid tap).
float sampleElevation(vec4 ref, vec2 tileUV) {
  int imax = int(uSlotSize) - 1;
  vec2 t = elevTexelCoord(ref, tileUV);
  vec2 i0f = floor(t);
  vec2 f = t - i0f;
  ivec2 i0 = ivec2(i0f);
  ivec2 i1 = min(i0 + 1, ivec2(imax));
  int layer = int(ref.x + 0.5);
  vec4 v = vec4(
    elevTexel(layer, i0),
    elevTexel(layer, ivec2(i1.x, i0.y)),
    elevTexel(layer, ivec2(i0.x, i1.y)),
    elevTexel(layer, i1)
  );
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  vec4 valid = step(vec4(NODATA_THRESHOLD), v);
  float ws = dot(w, valid);
  return ws > 1e-6 ? dot(w * valid, v) / ws : NODATA_VALUE;
}
