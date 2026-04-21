// Shader mode functions: base, elevation, slope, aspect

vec3 baseMode(vec3 normal) {
  if (uBaseWhite) return vec3(1.0);
  return normal * 0.5 + 0.5;
}

vec3 elevationMode(vec3 normal) {
  float t = (vElevation - uMinElevation) / max(uMaxElevation - uMinElevation, 1.0);
  vec3 color = applyRamp(t);
  float light = max(dot(normal, uSunDirection), 0.0) * 0.55 + 0.45;
  return color * light;
}

vec3 slopeMode(vec3 normal) {
  // Use 1 - cos(angle) as a cheap slope proxy - avoids the expensive acos()
  // transcendental. Produces a similar 0→1 ramp: 0 = flat, 1 = vertical.
  float cosAngle = clamp(dot(normal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
  float t = 1.0 - cosAngle;
  vec3 color = applyRamp(t);
  float light = cosAngle * 0.3 + 0.7;
  return color * light;
}

vec3 aspectMode(vec3 normal) {
  float flatness = normal.z;
  float angle = atan(normal.x, normal.y);
  float t = (angle + 3.14159265) / 6.28318530;
  vec3 color = applyRamp(t);
  color = mix(color, vec3(0.65), 1.0 - smoothstep(0.0, 0.15, 1.0 - flatness));
  return color;
}
