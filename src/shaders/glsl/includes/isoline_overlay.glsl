// Isoline (contour) overlay computed from the per-fragment DEM elevation.
// `scaled` = h / interval and its screen-space derivative are computed by the
// caller in uniform control flow.

vec3 applyIsolineOverlay(vec3 color, float scaled, float fw) {
  if (uIsolineEnabled) {
    float d = fract(scaled);
    float dist = min(d, 1.0 - d);
    // Guard fw = 0 on perfectly flat terrain (edge0 == edge1 is undefined).
    float line = 1.0 - smoothstep(0.0, max(uIsolineThickness * fw, 1e-5), dist);
    color = mix(color, uIsolineColor, line * 0.75);
  }
  return color;
}
