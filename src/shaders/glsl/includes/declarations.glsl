// Fragment shader declarations - uniforms and varyings.
// Must be prepended before all includes that reference these globals.

precision highp float;
precision highp int;
precision highp sampler2DArray;

// Coats the stack can hold (kept in sync with MAX_COATS in src/analysis/registry.ts).
#define MAX_COATS 6

// ==== Varyings from vertex shader ====
in vec2 vTileUV;
in float vMorph;
in float vMercScale;
in float vTileScale;
flat in vec4 vElev;
flat in vec4 vParent;
flat in vec4 vDrape;
in vec3 vCamVec;

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
uniform int uCoatBlend[MAX_COATS];      // 0 normal, 1 multiply, 2 screen, 3 soft light
uniform float uCoatOpacity[MAX_COATS];
uniform float uCoatRamp[MAX_COATS];     // ramp texture row, or -1 for color kinds
uniform vec4 uCoatP0[MAX_COATS];
uniform vec4 uCoatP1[MAX_COATS];

// ==== Ramp texture: one RGBA row per coat (sRGB, nearest-filtered) ====
uniform sampler2D uRampTex;
uniform vec2 uRampSize;

// ==== Drape texture array (sRGB, mipmapped) ====
uniform sampler2DArray uDrapeAtlas;
uniform int uHasDrape;

// ==== Drape placeholder color (theme-aware, sRGB) ====
uniform vec3 uDrapePlaceholder;
