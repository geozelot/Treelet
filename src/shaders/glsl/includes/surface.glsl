// Per-fragment surface reconstruction from the elevation atlas.
//
// Fetches the 12 texels around the fragment (a 4x4 block without corners),
// computes central-difference gradients at the 4 inner texels and
// interpolates elevation, gradient and the gradient's change (second
// derivatives) bilinearly. This gives smooth, continuous shading under
// magnification instead of per-texel facets, and an elevation that matches
// the DEM (not the coarser vertex mesh) for color ramps and isolines.
// Taps one texel past a slot border read the neighbouring tile's texels
// from the halo texture, so slopes at tile edges are central differences
// too and the shading has no step along tile edges.
// The CPU sampler (src/analysis/surface.ts) mirrors this exactly.

// Halo: per slot, the same-level neighbours' texels one step past each
// border (S wide, one row per edge; nodata where no neighbour is loaded).
uniform highp sampler2DArray uElevHalo;

#define HALO_TOP 0
#define HALO_BOTTOM 1
#define HALO_LEFT 2
#define HALO_RIGHT 3

struct Surface {
  float h;      // elevation in meters
  vec3 n;       // unit normal (true scale, unexaggerated)
  vec2 g;       // gradient dh/dx (east), dh/dy (north) in m/m, true scale
  vec3 c;       // second derivatives (hxx, hyy, hxy) in 1/m
  float fw;     // screen-space derivative of h (set by the caller)
  bool valid;
};

// Elevation one step from an inner texel. Inside the slot: that texel. Past
// a border: the neighbouring tile's texel from the halo. `reach` is 1 when
// the tap is a real neighbour and 0 when there is none: the tap is then
// `fallback` (the inner texel itself) and a difference using it one-sided.
float surfTap(int layer, ivec2 p, int imax, float fallback, out float reach) {
  reach = 1.0;
  float v;
  if (p.x < 0) v = texelFetch(uElevHalo, ivec3(p.y, HALO_LEFT, layer), 0).r;
  else if (p.x > imax) v = texelFetch(uElevHalo, ivec3(p.y, HALO_RIGHT, layer), 0).r;
  else if (p.y < 0) v = texelFetch(uElevHalo, ivec3(p.x, HALO_TOP, layer), 0).r;
  else if (p.y > imax) v = texelFetch(uElevHalo, ivec3(p.x, HALO_BOTTOM, layer), 0).r;
  else {
    v = elevTexel(layer, p);
    return v > NODATA_THRESHOLD ? v : fallback;
  }
  if (v > NODATA_THRESHOLD) return v;
  reach = 0.0;
  return fallback;
}

// Gradient (dh/dtexel, x east, y south) at an inner texel from its
// neighbours, over the span in texels they actually lie apart (2 for a
// central difference, 1 where one side has no neighbour).
vec2 surfGradient(float hL, float hR, float hU, float hD, float spanX, float spanY) {
  return vec2((hR - hL) / max(spanX, 1.0), (hD - hU) / max(spanY, 1.0));
}

// tileWorldSize: world edge length of the tile being shaded (not of the slot).
Surface sampleSurface(vec4 ref, vec2 tileUV, float tileWorldSize, float mercScale) {
  Surface s;
  s.valid = false;
  s.h = 0.0;
  s.n = vec3(0.0, 0.0, 1.0);
  s.g = vec2(0.0);
  s.c = vec3(0.0);
  s.fw = 0.0;

  int imax = int(uSlotSize) - 1;
  vec2 t = elevTexelCoord(ref, tileUV);
  vec2 i0f = min(floor(t), vec2(float(max(imax - 1, 0))));
  vec2 f = clamp(t - i0f, 0.0, 1.0);
  ivec2 p = ivec2(i0f);
  int layer = int(ref.x + 0.5);

  float h00 = elevTexel(layer, p);
  float h10 = elevTexel(layer, min(p + ivec2(1, 0), ivec2(imax)));
  float h01 = elevTexel(layer, min(p + ivec2(0, 1), ivec2(imax)));
  float h11 = elevTexel(layer, min(p + ivec2(1, 1), ivec2(imax)));

  vec4 inner = vec4(h00, h10, h01, h11);
  vec4 valid = step(vec4(NODATA_THRESHOLD), inner);
  float validCount = dot(valid, vec4(1.0));
  if (validCount < 0.5) return s;

  // Fill missing inner taps with the mean of the valid ones.
  float mean = dot(inner * valid, vec4(1.0)) / validCount;
  inner = mix(vec4(mean), inner, valid);
  h00 = inner.x; h10 = inner.y; h01 = inner.z; h11 = inner.w;

  float rm0, rm1, r20, r21, r0m, r1m, r02, r12;
  float hm0 = surfTap(layer, p + ivec2(-1, 0), imax, h00, rm0);
  float hm1 = surfTap(layer, p + ivec2(-1, 1), imax, h01, rm1);
  float h20 = surfTap(layer, p + ivec2(2, 0), imax, h10, r20);
  float h21 = surfTap(layer, p + ivec2(2, 1), imax, h11, r21);
  float h0m = surfTap(layer, p + ivec2(0, -1), imax, h00, r0m);
  float h1m = surfTap(layer, p + ivec2(1, -1), imax, h10, r1m);
  float h02 = surfTap(layer, p + ivec2(0, 2), imax, h01, r02);
  float h12 = surfTap(layer, p + ivec2(1, 2), imax, h11, r12);

  // The inner texels are one step apart (unless the slot is a single texel)
  float one = imax > 0 ? 1.0 : 0.0;
  vec2 g00 = surfGradient(hm0, h10, h0m, h01, rm0 + one, r0m + one);
  vec2 g10 = surfGradient(h00, h20, h1m, h11, one + r20, r1m + one);
  vec2 g01 = surfGradient(hm1, h11, h00, h02, rm1 + one, one + r02);
  vec2 g11 = surfGradient(h01, h21, h10, h12, one + r21, one + r12);
  vec2 g = mix(mix(g00, g10, f.x), mix(g01, g11, f.x), f.y);

  // Second derivatives (per texel²) from the change of the inner gradients.
  float hxx = mix(g10.x - g00.x, g11.x - g01.x, f.y);
  float hyy = mix(g01.y - g00.y, g11.y - g10.y, f.x);
  float hxy = 0.5 * (mix(g10.y - g00.y, g11.y - g01.y, f.y) + mix(g01.x - g00.x, g11.x - g10.x, f.x));

  s.h = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);

  // Ground distance between texels of the referenced slot, in meters.
  float texelWorld = (tileWorldSize / max(ref.w, 1e-9)) / max(uSlotSize - 1.0, 1.0);
  float tm = max(texelWorld / (uElevationScale * mercScale), 1e-9);
  // Texel y runs south; world y runs north.
  s.g = vec2(g.x, -g.y) / tm;
  s.c = vec3(hxx, hyy, -hxy) / (tm * tm);
  s.n = normalize(vec3(-s.g, 1.0));
  s.valid = true;
  return s;
}

Surface terrainSurface() {
  Surface s = sampleSurface(vElev, vTileUV, vTileScale, vMercScale);
  if (vMorph > 0.0 && vParent.w > 0.0) {
    Surface p = sampleSurface(vParent, vTileUV, vTileScale, vMercScale);
    if (p.valid && s.valid) {
      s.h = mix(s.h, p.h, vMorph);
      s.g = mix(s.g, p.g, vMorph);
      s.c = mix(s.c, p.c, vMorph);
      s.n = normalize(mix(s.n, p.n, vMorph));
    } else if (p.valid) {
      s = p;
    }
  }
  return s;
}
