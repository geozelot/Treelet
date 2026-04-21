// Drape texture blending: normal, hillshade, softlight

vec3 textureMode(vec3 normal) {
  if (uHasDrape == 0) return elevationMode(normal);

  vec4 drape = texture2D(uDrapeAtlas, vAtlasUV);
  float alpha = drape.a * uDrapeOpacity;

  // Compute terrain light factor for hillshade/softlight blending.
  // Same Lambertian dot-product as elevationMode, tuned for drape overlay:
  // contrast 0.35, ambient 0.65 - terrain relief visible but not overpowering.
  float light = max(dot(normal, uSunDirection), 0.0) * 0.35 + 0.65;

  // Apply selected blend mode
  vec3 blended = drape.rgb;

  if (uDrapeBlendMode == 1) {
    // Hillshade: drape modulated by terrain illumination
    float strength = uHillshadeStrength;
    float factor = mix(1.0, light, strength);
    blended = drape.rgb * factor;
  } else if (uDrapeBlendMode == 2) {
    // Soft light: Pegtop formula - preserves mid-tones better than multiply.
    // softlight(base, blend) = (1-2b)*base^2 + 2b*base  where b=light
    float strength = uHillshadeStrength;
    float l = mix(0.5, light, strength); // 0.5 = neutral (no effect)
    vec3 base = drape.rgb;
    blended = (1.0 - 2.0 * l) * base * base + 2.0 * l * base;
  }
  // else uDrapeBlendMode == 0: normal - blended stays drape.rgb (flat, no terrain shading)

  // Theme-aware flat placeholder where drape hasn't loaded yet.
  // uDrapePlaceholder is set from JS based on OS color-scheme preference.
  vec3 placeholder = uDrapePlaceholder;
  return mix(placeholder, blended, alpha);
}
