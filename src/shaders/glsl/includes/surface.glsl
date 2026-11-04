// Per-fragment surface reconstruction from the elevation atlas.
//
// Fetches the 12 texels around the fragment (a 4x4 block without corners),
// computes central-difference gradients at the 4 inner texels and
// interpolates both elevation and gradient bilinearly. This gives smooth,
// continuous shading under magnification instead of per-texel facets, and
// an elevation that matches the DEM (not the coarser vertex mesh) for
// color ramps and isolines.

struct Surface {
  float h;      // elevation in meters
  vec3 n;       // unit normal (true scale, unexaggerated)
  bool valid;
};

float surfTap(int layer, ivec2 p, int imax, float fallback) {
  float v = elevTexel(layer, clamp(p, ivec2(0), ivec2(imax)));
  return v > NODATA_THRESHOLD ? v : fallback;
}

// Gradient (dh/dtexel, x east, y south) at an inner texel from its
// neighbours, using the true index span when clamped at slot borders.
vec2 surfGradient(ivec2 p, int imax, float hL, float hR, float hU, float hD) {
  float spanX = float(min(p.x + 1, imax) - max(p.x - 1, 0));
  float spanY = float(min(p.y + 1, imax) - max(p.y - 1, 0));
  return vec2((hR - hL) / max(spanX, 1.0), (hD - hU) / max(spanY, 1.0));
}

// tileWorldSize: world edge length of the tile being shaded (not of the slot).
Surface sampleSurface(vec4 ref, vec2 tileUV, float tileWorldSize, float mercScale) {
  Surface s;
  s.valid = false;
  s.h = 0.0;
  s.n = vec3(0.0, 0.0, 1.0);

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

  float hm0 = surfTap(layer, p + ivec2(-1, 0), imax, h00);
  float hm1 = surfTap(layer, p + ivec2(-1, 1), imax, h01);
  float h20 = surfTap(layer, p + ivec2(2, 0), imax, h10);
  float h21 = surfTap(layer, p + ivec2(2, 1), imax, h11);
  float h0m = surfTap(layer, p + ivec2(0, -1), imax, h00);
  float h1m = surfTap(layer, p + ivec2(1, -1), imax, h10);
  float h02 = surfTap(layer, p + ivec2(0, 2), imax, h01);
  float h12 = surfTap(layer, p + ivec2(1, 2), imax, h11);

  vec2 g00 = surfGradient(p, imax, hm0, h10, h0m, h01);
  vec2 g10 = surfGradient(p + ivec2(1, 0), imax, h00, h20, h1m, h11);
  vec2 g01 = surfGradient(p + ivec2(0, 1), imax, hm1, h11, h00, h02);
  vec2 g11 = surfGradient(p + ivec2(1, 1), imax, h01, h21, h10, h12);
  vec2 g = mix(mix(g00, g10, f.x), mix(g01, g11, f.x), f.y);

  s.h = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);

  // World distance between texels of the referenced slot.
  float texelWorld = (tileWorldSize / max(ref.w, 1e-9)) / max(uSlotSize - 1.0, 1.0);
  float zs = uElevationScale * mercScale / texelWorld;
  // Texel y runs south; world y runs north.
  s.n = normalize(vec3(-g.x * zs, g.y * zs, 1.0));
  s.valid = true;
  return s;
}

Surface terrainSurface() {
  Surface s = sampleSurface(vElev, vTileUV, vTileScale, vMercScale);
  if (vMorph > 0.0 && vParent.w > 0.0) {
    Surface p = sampleSurface(vParent, vTileUV, vTileScale, vMercScale);
    if (p.valid && s.valid) {
      s.h = mix(s.h, p.h, vMorph);
      s.n = normalize(mix(s.n, p.n, vMorph));
    } else if (p.valid) {
      s = p;
    }
  }
  return s;
}
