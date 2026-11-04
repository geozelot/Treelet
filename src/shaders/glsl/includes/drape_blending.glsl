// Drape texture blending: normal, hillshade, softlight.
// The drape array is sRGB: samples come back linear and are converted to
// sRGB here so blending (tuned in display space) and output stay in the same
// space as the color ramps.

vec3 textureMode(float h, vec3 normal, vec2 drapeUV, vec2 dUVdx, vec2 dUVdy) {
  if (uHasDrape == 0) return elevationMode(h, normal);

  float alpha = 0.0;
  vec3 drapeColor = uDrapePlaceholder;
  if (vDrape.w > 0.0) {
    vec4 drape = textureGrad(uDrapeAtlas, vec3(drapeUV, vDrape.x), dUVdx, dUVdy);
    drapeColor = sRGBTransferOETF(vec4(drape.rgb, 1.0)).rgb;
    alpha = drape.a * uDrapeOpacity;
  }

  // Terrain light factor for hillshade/softlight blending:
  // contrast 0.35, ambient 0.65 - relief visible but not overpowering.
  float light = max(dot(normal, uSunDirection), 0.0) * 0.35 + 0.65;

  vec3 blended = drapeColor;
  if (uDrapeBlendMode == 1) {
    // Hillshade: drape modulated by terrain illumination
    blended = drapeColor * mix(1.0, light, uHillshadeStrength);
  } else if (uDrapeBlendMode == 2) {
    // Soft light (Pegtop): (1-2b)*base^2 + 2b*base, b = light (0.5 = neutral)
    float l = mix(0.5, light, uHillshadeStrength);
    blended = (1.0 - 2.0 * l) * drapeColor * drapeColor + 2.0 * l * drapeColor;
  }

  return mix(uDrapePlaceholder, blended, alpha);
}
