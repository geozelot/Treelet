// treelet.js - Terrain Fragment Shader
// Per-pixel normals via central differences, 5 shader modes,
// 4 color ramps, isoline overlay, drape texture.
//
// All uniform/varying declarations live in includes/declarations.glsl
// and are prepended before this file during assembly.

#include <fog_pars_fragment>

void main() {
  vec3 normal = computeNormal();
  vec3 color;

  if (uMode == 0) color = baseMode(normal);
  else if (uMode == 1) color = elevationMode(normal);
  else if (uMode == 2) color = slopeMode(normal);
  else if (uMode == 3) color = aspectMode(normal);
  else color = textureMode(normal);

  // Isoline overlay
  color = applyIsolineOverlay(color);

  gl_FragColor = vec4(color, 1.0);
  #include <fog_fragment>
}
