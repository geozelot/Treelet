// Fragment shader declarations - uniforms and varyings.
// Must be prepended before all includes that reference these globals.

precision highp float;
precision highp int;
precision highp sampler2DArray;

// MAX_COATS, MAX_RASTERS, IMAGERY_KIND, the BLEND_* codes,
// RASTER_NODATA_THRESHOLD and SHADOW_NIGHT_SUN_Z are generated from their
// TypeScript sources (shaderConstants() in TerrainMaterial.ts).

// ==== Varyings from vertex shader ====
in vec2 vTileUV;
in float vMorph;
in float vMercScale;
in float vTileScale;
flat in vec4 vElev;
flat in vec4 vParent;
flat in vec4 vDrape;
in vec3 vCamVec;
in vec2 vWorldLocal;

// ==== Distance haze (sRGB color; camera distances where it starts / is opaque) ====
uniform vec3 uFogColor;
uniform vec2 uFogRange;

// ==== Elevation ====
uniform float uElevationScale;

// ==== Lighting (unit vector toward the sun; x east, y north, z up) ====
uniform vec3 uSunDirection;

// ==== Wireframe: render flat white instead of the coats ====
uniform bool uBaseWhite;

// ==== Coat stack (bottom first): kind 0 = imagery, others = registered analyses ====
uniform int uCoatCount;
uniform int uCoatKind[MAX_COATS];
uniform int uCoatBlend[MAX_COATS];      // BLEND_NORMAL, BLEND_MULTIPLY, BLEND_SCREEN, BLEND_SOFTLIGHT
uniform float uCoatOpacity[MAX_COATS];
uniform float uCoatRamp[MAX_COATS];     // ramp texture row, or -1 for color kinds
uniform vec4 uCoatP0[MAX_COATS];
uniform vec4 uCoatP1[MAX_COATS];
uniform int uCoatRaster[MAX_COATS];     // raster slot the coat draws, or -1

// ==== Rasters (value grids or color images) sampled by world position ====
// Value rasters are R32F (nodata below RASTER_NODATA_THRESHOLD), sampled with
// texelFetch and a nodata-aware bilinear filter; color rasters are RGBA8 with
// premultiplied alpha. One sampler per slot, uRaster0 … uRaster<MAX_RASTERS-1>:
// @RASTER_SAMPLERS
uniform vec4 uRasterXform[MAX_RASTERS]; // NW corner relative to the render origin (xy), texels per world unit (zw)
uniform vec4 uRasterInfo[MAX_RASTERS];  // width, height, color (1) or value (0), unused

// ==== Ramp texture: one RGBA row per coat (sRGB, nearest-filtered) ====
uniform sampler2D uRampTex;
uniform vec2 uRampSize;

// ==== Drape texture array (sRGB, mipmapped) ====
uniform sampler2DArray uDrapeAtlas;
uniform int uHasDrape;

// ==== Drape placeholder color (theme-aware, sRGB) ====
uniform vec3 uDrapePlaceholder;
