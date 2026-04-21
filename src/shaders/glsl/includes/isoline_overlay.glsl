// Isoline (contour) overlay computation

vec3 applyIsolineOverlay(vec3 color) {
  if (uIsolineEnabled) {
    float d = fract(vElevation / uIsolineInterval);
    float fw = fwidth(vElevation / uIsolineInterval);
    float line = 1.0 - smoothstep(0.0, uIsolineThickness * fw, min(d, 1.0 - d));
    color = mix(color, uIsolineColor, line * 0.75);
  }
  return color;
}
