// Per-pixel normal computation from heightmap atlas
// Uses nearest-neighbor to prevent bilinear bleeding into adjacent slots.
// Adaptive central difference adjusts for clamped samples at boundaries.

vec3 computeNormalFromSlot(vec2 centerUV, vec4 bounds, float atlasScale, float tileWorldSize) {
  float ts = 1.0 / uAtlasSize;

  vec2 uvL = clamp(centerUV + vec2(-ts, 0.0), bounds.xy, bounds.zw);
  vec2 uvR = clamp(centerUV + vec2( ts, 0.0), bounds.xy, bounds.zw);
  vec2 uvD = clamp(centerUV + vec2(0.0, -ts), bounds.xy, bounds.zw);
  vec2 uvU = clamp(centerUV + vec2(0.0,  ts), bounds.xy, bounds.zw);

  float hL = texture2D(uAtlas, (floor(uvL * uAtlasSize) + 0.5) / uAtlasSize).r;
  float hR = texture2D(uAtlas, (floor(uvR * uAtlasSize) + 0.5) / uAtlasSize).r;
  float hD = texture2D(uAtlas, (floor(uvD * uAtlasSize) + 0.5) / uAtlasSize).r;
  float hU = texture2D(uAtlas, (floor(uvU * uAtlasSize) + 0.5) / uAtlasSize).r;

  if (hL < ELEVATION_SENTINEL || hR < ELEVATION_SENTINEL || hD < ELEVATION_SENTINEL || hU < ELEVATION_SENTINEL) {
    return vec3(0.0, 0.0, 1.0);
  }

  float dxUV = uvR.x - uvL.x;
  float dyUV = uvU.y - uvD.y;
  float dxWorld = dxUV / atlasScale * tileWorldSize;
  float dyWorld = dyUV / atlasScale * tileWorldSize;

  if (dxWorld < 1e-6 || dyWorld < 1e-6) return vec3(0.0, 0.0, 1.0);

  float dzdx = (hR - hL) * uElevationScale / dxWorld;
  float dzdy = (hU - hD) * uElevationScale / dyWorld;

  return normalize(vec3(-dzdx, dzdy, 1.0));
}

vec3 computeNormal() {
  // Fine normal from this tile's atlas slot
  vec3 fineNormal = computeNormalFromSlot(vAtlasUV, vAtlasBounds, vAtlasScale, vTileWorldSize);

  // In geomorph zones, blend with parent tile's coarser normal
  // to eliminate the shading discontinuity at LOD boundaries.
  if (vMorphFactor > 0.0 && vParentAtlasCoord.z > 0.0) {
    // Compute parent atlas UV for this fragment
    vec2 parentUV = vParentAtlasCoord.xy + vec2(vLocalUV.x, 1.0 - vLocalUV.y) * vParentAtlasCoord.z;
    parentUV = (floor(parentUV * uAtlasSize) + 0.5) / uAtlasSize;

    // Parent slot bounds (half-texel inset)
    float halfTexel = 0.5 / uAtlasSize;
    vec4 parentBounds = vec4(
      vParentAtlasCoord.xy + halfTexel,
      vParentAtlasCoord.xy + vParentAtlasCoord.z - halfTexel
    );

    // Parent tile is 2x world size (one LOD coarser)
    vec3 coarseNormal = computeNormalFromSlot(parentUV, parentBounds, vParentAtlasCoord.z, vTileWorldSize * 2.0);

    // Both inputs are unit vectors; mix produces length ~0.7–1.0.
    // Skip normalize - the imperceptible length variance saves 1 inversesqrt/fragment.
    fineNormal = mix(fineNormal, coarseNormal, vMorphFactor);
  }

  return fineNormal;
}
