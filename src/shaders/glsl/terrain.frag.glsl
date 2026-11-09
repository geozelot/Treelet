// treelet.js - Terrain Fragment Shader
// Per-fragment DEM elevation and smooth normals from the elevation array,
// composited coats (imagery, analyses) from the ramp texture and the
// registered analysis functions, mipmapped drape array.
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
  if (uHasDrape != 0) {
    drape = texture(uDrapeAtlas, vec3(vDrape.yz + vTileUV * vDrape.w, vDrape.x));
  }

  Surface s = terrainSurface();
  if (!s.valid) s.h = 0.0;
  s.fw = fwidth(s.h);
  if (uShadowOn != 0) gShadowLit = terrainShadow(s);

  vec3 color = uBaseWhite ? vec3(1.0) : applyCoats(s, drape);

  float haze = smoothstep(uFogRange.x, uFogRange.y, length(vCamVec));
  gl_FragColor = vec4(mix(color, uFogColor, haze), 1.0);
}
