// treelet.js - Terrain Vertex Shader
// Instanced VTF displacement from the elevation texture array with
// CDLOD-style geomorphing and Mercator-correct vertical scale.

precision highp float;
precision highp int;

// ==== Per-instance attributes ====
attribute vec2 iTileWorld;   // tile center relative to the render origin
attribute float iTileScale;  // tile edge length (world units)
attribute vec4 iElev;        // elevation ref: layer, offset.xy, scale
attribute vec4 iParent;      // parent elevation ref (scale 0 = none)
attribute vec4 iDrape;       // drape ref (scale 0 = none)
attribute vec2 iMorph;       // morph start / end camera distance

// ==== Uniforms ====
uniform float uGridSize;        // quads per tile edge
uniform float uElevationScale;  // meters -> scene units at the equator
uniform float uExaggeration;
uniform vec3 uCameraLocal;      // camera position relative to the render origin
uniform float uRefZ;            // height of the LOD reference plane
uniform float uOriginY;         // absolute world Y of the render origin
uniform float uWorldScale;

out vec2 vTileUV;
out float vMorph;
out float vMercScale;
out float vTileScale;
flat out vec4 vElev;
flat out vec4 vParent;
flat out vec4 vDrape;

#include <fog_pars_vertex>

void main() {
  // ==== Geomorph ====
  // Snap to exact grid indices, measure the camera distance with the same
  // metric the CPU selection uses, and slide odd vertices onto the coarse
  // (parent) grid as the vertex approaches the end of its LOD range.
  vec2 grid = floor(uv * uGridSize + 0.5);
  vec2 base = iTileWorld + (grid / uGridSize - 0.5) * iTileScale;
  float dist = length(vec3(base - uCameraLocal.xy, uRefZ - uCameraLocal.z));
  float morph = clamp((dist - iMorph.x) / max(iMorph.y - iMorph.x, 1e-9), 0.0, 1.0);
  vec2 morphedGrid = grid - fract(grid * 0.5) * 2.0 * morph;
  vec2 muv = morphedGrid / uGridSize;          // 0..1, v up
  vec2 world = iTileWorld + (muv - 0.5) * iTileScale;
  vec2 tileUV = vec2(muv.x, 1.0 - muv.y);      // 0..1, v down (north = 0)

  // ==== Elevation ====
  float h = sampleElevation(iElev, tileUV);
  if (morph > 0.0 && iParent.w > 0.0) {
    float hp = sampleElevation(iParent, tileUV);
    if (hp > NODATA_THRESHOLD) h = h > NODATA_THRESHOLD ? mix(h, hp, morph) : hp;
  }
  if (h <= NODATA_THRESHOLD) h = 0.0;

  // Mercator stretches ground distances by k = 1/cos(lat) = cosh(y/R);
  // scaling heights by the same factor keeps relief true to scale.
  float k = cosh((uOriginY + world.y) * 6.283185307179586 / uWorldScale);
  float z = h * uElevationScale * k * uExaggeration;

  // Skirt vertices drop below the surface, proportionally to tile size.
  if (position.z < -0.5) {
    z -= clamp(iTileScale * 0.015, 5.0 * uElevationScale, 1500.0 * uElevationScale) * max(uExaggeration, 1.0);
  }

  vec4 mvPosition = modelViewMatrix * vec4(world, z, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  vTileUV = tileUV;
  vMorph = morph;
  vMercScale = k;
  vTileScale = iTileScale;
  vElev = iElev;
  vParent = iParent;
  vDrape = iDrape;

  #include <fog_vertex>
}
