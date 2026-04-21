// treelet.js - Terrain Vertex Shader
// Per-instance VTF displacement from unified atlas with geomorphing.

precision highp float;

// ==== Per-instance attributes ====
attribute vec2 iTileWorld;       // tile center in world coordinates
attribute float iTileScale;      // tile size in world units
attribute vec3 iAtlasCoord;      // atlasU, atlasV, atlasScale
attribute float iTileLod;        // zoom level
attribute vec3 iParentAtlas;     // parentAtlasU, parentAtlasV, parentAtlasScale
attribute float iNeighborLod;    // packed edge LOD differences

// ==== Uniforms ====
uniform sampler2D uAtlas;
uniform float uAtlasSize;
uniform float uElevationScale;
uniform float uMorphWidth; // geomorph zone width as fraction of tile [0..0.5]

varying vec2 vAtlasUV;
varying vec2 vLocalUV;
varying float vElevation;
varying float vTileWorldSize;
varying float vTileLod;
varying float vAtlasScale; // atlas slot scale (slotSize / atlasSize) for correct normal computation
varying float vMorphFactor; // geomorphing blend factor (0 = fine, 1 = coarse)
varying vec4 vAtlasBounds; // min UV (xy), max UV (zw) for clamping normal samples
varying vec3 vParentAtlasCoord; // parent atlas U, V, scale (0 scale = no parent)

#include <fog_pars_vertex>

void main() {
  // ==== World position ====
  // Map local vertex [-0.5, +0.5] to world position via per-instance transform
  vec2 worldPos = iTileWorld + position.xy * iTileScale;

  // ==== Atlas UV ====
  // Map local UV [0, 1] to atlas UV via per-instance atlas coordinates
  // Flip V: mesh UV.y goes bottom->top, atlas Y goes top->bottom (tile Y convention)
  vec2 localUV = uv;
  vec2 atlasUV = iAtlasCoord.xy + vec2(localUV.x, 1.0 - localUV.y) * iAtlasCoord.z;

  // Clamp to slot bounds: at localUV edges (0.0 or 1.0), the raw UV lands exactly
  // on the first texel of the ADJACENT atlas slot, reading elevation from an unrelated
  // tile. Half-texel inset keeps all samples within this tile's slot.
  float halfTexel = 0.5 / uAtlasSize;
  vec2 slotMin = iAtlasCoord.xy + halfTexel;
  vec2 slotMax = iAtlasCoord.xy + iAtlasCoord.z - halfTexel;
  atlasUV = clamp(atlasUV, slotMin, slotMax);

  // Quantize to texel centers for stable nearest-neighbor sampling
  atlasUV = (floor(atlasUV * uAtlasSize) + 0.5) / uAtlasSize;

  // ==== Elevation sampling ====
  float elevation = sampleAtlasNearest(uAtlas, atlasUV, uAtlasSize);

  // ==== Geomorphing ====
  // Morph vertices near tile edges toward parent tile's coarser elevation
  // when the neighbor is at a coarser LOD, creating smooth LOD transitions.
  float morphFactor = 0.0;

  if (uMorphWidth > 0.0) {
    vec4 nLod = unpackNeighborLod(iNeighborLod);

    // Distance from each edge in local UV space [0, 1]
    float dLeft   = localUV.x;
    float dRight  = 1.0 - localUV.x;
    float dBottom = localUV.y;
    float dTop    = 1.0 - localUV.y;

    // Morph factor per edge: only morph toward coarser neighbors
    float mL = nLod.x > 0.0 ? smoothstep(uMorphWidth, 0.0, dLeft)   : 0.0;
    float mR = nLod.y > 0.0 ? smoothstep(uMorphWidth, 0.0, dRight)  : 0.0;
    float mB = nLod.z > 0.0 ? smoothstep(uMorphWidth, 0.0, dBottom) : 0.0;
    float mT = nLod.w > 0.0 ? smoothstep(uMorphWidth, 0.0, dTop)    : 0.0;

    morphFactor = max(max(mL, mR), max(mB, mT));

    if (morphFactor > 0.0 && iParentAtlas.z > 0.0) {
      // Sample parent tile's elevation at this vertex's position.
      // iParentAtlas is pre-adjusted to this child's quadrant within the parent.
      // Use bilinear to avoid staircase bands from coarse parent texels.
      vec2 parentUV = iParentAtlas.xy + vec2(localUV.x, 1.0 - localUV.y) * iParentAtlas.z;
      // Clamp parent UV to stay within the parent's quadrant in the atlas
      vec2 parentMin = iParentAtlas.xy + halfTexel;
      vec2 parentMax = iParentAtlas.xy + iParentAtlas.z - halfTexel;
      parentUV = clamp(parentUV, parentMin, parentMax);

      float coarseElev = sampleAtlasBilinear(uAtlas, parentUV, uAtlasSize);

      if (coarseElev > ELEVATION_SENTINEL && elevation > ELEVATION_SENTINEL) {
        elevation = mix(elevation, coarseElev, morphFactor);
      }
    }
  }

  // Sentinel fallback: no data loaded yet -> flat at zero
  if (elevation < ELEVATION_SENTINEL) elevation = 0.0;

  // ==== Skirt drop ====
  float skirtDrop = position.z < -0.5 ? 1000.0 : 0.0;

  // ==== Final position ====
  vec3 displaced = vec3(worldPos, (elevation - skirtDrop) * uElevationScale);
  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // ==== Varyings ====
  vAtlasUV = atlasUV;
  vLocalUV = localUV;
  vElevation = elevation;
  vTileWorldSize = iTileScale;
  vTileLod = iTileLod;
  vAtlasScale = iAtlasCoord.z;
  vMorphFactor = morphFactor;
  vParentAtlasCoord = iParentAtlas;

  // Atlas slot bounds for fragment normal sampling (reuse slotMin/slotMax from above)
  vAtlasBounds = vec4(slotMin, slotMax);

  #include <fog_vertex>
}
