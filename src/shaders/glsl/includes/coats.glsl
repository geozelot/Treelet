// The coat stack: imagery and analyses composited bottom to top over a
// neutral base. `evalAnalysis` is generated from the analysis registry.
// All branches depend on uniforms only, so control flow stays uniform.

const vec3 COAT_BASE_COLOR = vec3(0.72);

vec3 blendCoat(int mode, vec3 base, vec3 c, float a) {
  vec3 r;
  if (mode == BLEND_MULTIPLY) r = base * c;
  else if (mode == BLEND_SCREEN) r = 1.0 - (1.0 - base) * (1.0 - c);
  else if (mode == BLEND_SOFTLIGHT) r = (1.0 - 2.0 * c) * base * base + 2.0 * c * base; // Pegtop
  else r = c; // BLEND_NORMAL
  return mix(base, r, clamp(a, 0.0, 1.0));
}

// The active drape: sRGB imagery, the placeholder color where none is loaded yet.
vec4 imageryCoat(vec4 drape) {
  if (uHasDrape == 0) return vec4(0.0);
  vec3 c = uDrapePlaceholder;
  if (vDrape.w > 0.0) {
    c = mix(uDrapePlaceholder, sRGBTransferOETF(vec4(drape.rgb, 1.0)).rgb, drape.a);
  }
  return vec4(c, 1.0);
}

// Nearest texel of the coat's ramp row at the normalized value t (with alpha).
vec4 rampColor(float row, float t) {
  float u = clamp(t, 0.0, 1.0) * (1.0 - 1.0 / uRampSize.x) + 0.5 / uRampSize.x;
  float v = (row + 0.5) / uRampSize.y;
  return texture(uRampTex, vec2(u, v));
}

vec3 applyCoats(Surface s, vec4 drape) {
  vec3 color = COAT_BASE_COLOR;
  for (int i = 0; i < MAX_COATS; i++) {
    if (i >= uCoatCount) break;
    int kind = uCoatKind[i];
    gCoatRaster = uCoatRaster[i];
    vec4 c = kind == IMAGERY_KIND ? imageryCoat(drape) : evalAnalysis(kind, s, uCoatP0[i], uCoatP1[i]);
    if (uCoatRamp[i] >= 0.0) {
      vec4 rc = rampColor(uCoatRamp[i], c.x);
      c = vec4(rc.rgb, c.w * rc.a);
    }
    color = blendCoat(uCoatBlend[i], color, c.rgb, c.w * uCoatOpacity[i]);
  }
  return color;
}
