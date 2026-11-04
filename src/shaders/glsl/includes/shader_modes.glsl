// Shader mode functions: base, elevation, slope, aspect.
// `h` is the per-fragment DEM elevation (meters), `normal` the true-scale
// surface normal (unexaggerated, Mercator-corrected).

vec3 baseMode(vec3 normal) {
  if (uBaseWhite) return vec3(1.0);
  return normal * 0.5 + 0.5;
}

vec3 elevationMode(float h, vec3 normal) {
  float t = (h - uMinElevation) / max(uMaxElevation - uMinElevation, 1e-3);
  vec3 color = applyRamp(t);
  float light = max(dot(normal, uSunDirection), 0.0) * 0.55 + 0.45;
  return color * light;
}

// Slope in degrees mapped linearly over [uSlopeMin, uSlopeMax].
vec3 slopeMode(vec3 normal) {
  float cosAngle = clamp(normal.z, 0.0, 1.0);
  float slopeDeg = degrees(acos(cosAngle));
  float t = (slopeDeg - uSlopeMin) / max(uSlopeMax - uSlopeMin, 1e-3);
  vec3 color = applyRamp(t);
  float light = cosAngle * 0.3 + 0.7;
  return color * light;
}

// Aspect: compass bearing of the downslope direction (0 = north, 0.25 = east).
vec3 aspectMode(vec3 normal) {
  float angle = atan(normal.x, normal.y);
  float t = fract(angle / 6.283185307179586 + 1.0);
  vec3 color = applyRamp(t);
  // Flat terrain has no meaningful aspect: fade to neutral gray.
  float flatness = clamp(normal.z, 0.0, 1.0);
  return mix(color, vec3(0.65), 1.0 - smoothstep(0.0, 0.15, 1.0 - flatness));
}
