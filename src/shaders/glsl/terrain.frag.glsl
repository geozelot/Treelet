// treelet.js - Terrain Fragment Shader
// Per-fragment DEM elevation and smooth normals from the elevation array,
// 5 shader modes, 5 color ramps, isoline overlay, mipmapped drape array.
//
// All uniform/varying declarations live in includes/declarations.glsl
// and are prepended before this file during assembly. Colors are produced
// in sRGB (display) space, matching three's convention for unlit materials.
// Haze is radial (camera distance, not view depth) so the horizon doesn't
// shift as the view rotates, and reaches the sky's horizon color exactly at
// the visible range: terrain dissolves into the sky instead of ending.

void main() {
  // The drape is sampled first, in uniform control flow, with implicit
  // derivatives: only those reliably get the GPU's anisotropic filtering
  // (some drivers ignore it for textureGrad, which left flat ground seen at
  // a low angle blurred while slopes stayed sharp).
  vec4 drape = vec4(0.0);
  if (uMode == 4 && uHasDrape != 0) {
    drape = texture(uDrapeAtlas, vec3(vDrape.yz + vTileUV * vDrape.w, vDrape.x));
  }

  Surface s = terrainSurface();
  float h = s.valid ? s.h : 0.0;
  vec3 normal = s.n;

  float interval = max(uIsolineInterval, 1e-3);
  float scaled = h / interval;
  float fw = fwidth(scaled);

  vec3 color;
  if (uMode == 0) color = baseMode(normal);
  else if (uMode == 1) color = elevationMode(h, normal);
  else if (uMode == 2) color = slopeMode(normal);
  else if (uMode == 3) color = aspectMode(normal);
  else color = textureMode(h, normal, drape);

  color = applyIsolineOverlay(color, scaled, fw);

  float haze = smoothstep(uFogRange.x, uFogRange.y, length(vCamVec));
  gl_FragColor = vec4(mix(color, uFogColor, haze), 1.0);
}
