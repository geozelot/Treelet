// Terrain-cast shadows: the fragment's depth from the sun compared with the
// shadow map (3×3 percentage-closer filtering, a bias growing with the
// slope away from the sun). Surfaces turned away from the sun are in their
// own shadow; beyond the shadow range the effect fades out. The result is
// in gShadowLit (1 lit, 0 shadowed), read by the shadows analysis.

uniform highp sampler2D uShadowMap;
uniform int uShadowOn;
uniform vec4 uShadowParams; // texel (uv), depth per texel, fade start, fade end (camera distance)
in vec4 vShadowCoord;

float gShadowLit = 1.0;

float terrainShadow(Surface s) {
  if (uSunDirection.z <= SHADOW_NIGHT_SUN_Z) return 0.0; // the sun is down (same threshold as the map)
  float fade = smoothstep(uShadowParams.z, uShadowParams.w, length(vCamVec));
  if (fade >= 1.0) return 1.0;
  float nl = dot(s.n, uSunDirection);
  if (nl <= 0.0) return fade;
  vec3 c = vShadowCoord.xyz / vShadowCoord.w;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
  float tanT = sqrt(max(1.0 - nl * nl, 0.0)) / max(nl, 0.05);
  float bias = uShadowParams.y * (1.5 + 2.0 * min(tanT, 8.0));
  float lit = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float d = textureLod(uShadowMap, c.xy + vec2(float(x), float(y)) * uShadowParams.x, 0.0).r;
      lit += step(c.z - bias, d);
    }
  }
  return mix(lit / 9.0, 1.0, fade);
}
