// Color ramp functions for elevation-based visualizations

vec3 hypsometricColor(float t) {
  vec3 c0 = vec3(0.08, 0.32, 0.18);
  vec3 c1 = vec3(0.30, 0.58, 0.22);
  vec3 c2 = vec3(0.62, 0.72, 0.32);
  vec3 c3 = vec3(0.80, 0.72, 0.40);
  vec3 c4 = vec3(0.64, 0.48, 0.34);
  vec3 c5 = vec3(0.72, 0.68, 0.65);
  vec3 c6 = vec3(0.96, 0.96, 0.98);

  if (t < 0.0)  return c0;
  if (t < 0.08) return mix(c0, c1, t / 0.08);
  if (t < 0.20) return mix(c1, c2, (t - 0.08) / 0.12);
  if (t < 0.38) return mix(c2, c3, (t - 0.20) / 0.18);
  if (t < 0.55) return mix(c3, c4, (t - 0.38) / 0.17);
  if (t < 0.78) return mix(c4, c5, (t - 0.55) / 0.23);
  return mix(c5, c6, clamp((t - 0.78) / 0.22, 0.0, 1.0));
}

vec3 viridisColor(float t) {
  vec3 c0 = vec3(0.267, 0.004, 0.329);
  vec3 c1 = vec3(0.282, 0.140, 0.458);
  vec3 c2 = vec3(0.127, 0.566, 0.551);
  vec3 c3 = vec3(0.369, 0.789, 0.383);
  vec3 c4 = vec3(0.993, 0.906, 0.144);

  t = clamp(t, 0.0, 1.0);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.50) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.50) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

vec3 infernoColor(float t) {
  vec3 c0 = vec3(0.001, 0.000, 0.014);
  vec3 c1 = vec3(0.341, 0.062, 0.429);
  vec3 c2 = vec3(0.735, 0.215, 0.330);
  vec3 c3 = vec3(0.988, 0.645, 0.040);
  vec3 c4 = vec3(0.988, 0.998, 0.645);

  t = clamp(t, 0.0, 1.0);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.50) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.50) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

vec3 grayscaleColor(float t) {
  t = clamp(t, 0.0, 1.0);
  return vec3(t);
}

vec3 applyRamp(float t) {
  if (uColorRamp == 0) return hypsometricColor(t);
  if (uColorRamp == 1) return viridisColor(t);
  if (uColorRamp == 2) return infernoColor(t);
  return grayscaleColor(t);
}
