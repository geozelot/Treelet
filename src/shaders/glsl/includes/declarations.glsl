// Fragment shader declarations - uniforms and varyings.
// Must be prepended before all includes that reference these globals.

precision highp float;
precision highp int;
precision highp sampler2DArray;

// ==== Varyings from vertex shader ====
in vec2 vTileUV;
in float vMorph;
in float vMercScale;
in float vTileScale;
flat in vec4 vElev;
flat in vec4 vParent;
flat in vec4 vDrape;

// ==== Elevation ====
uniform float uElevationScale;

// ==== Shader mode: 0=base, 1=elevation, 2=slope, 3=aspect, 4=texture ====
uniform int uMode;

// ==== Color ramp: 0=hypsometric, 1=viridis, 2=inferno, 3=grayscale, 4=cyclic ====
uniform int uColorRamp;

// ==== Elevation range (meters) ====
uniform float uMinElevation;
uniform float uMaxElevation;

// ==== Slope range (degrees) ====
uniform float uSlopeMin;
uniform float uSlopeMax;

// ==== Lighting ====
uniform vec3 uSunDirection;

// ==== Wireframe: base mode renders flat white instead of normals ====
uniform bool uBaseWhite;

// ==== Isoline overlay ====
uniform bool uIsolineEnabled;
uniform float uIsolineInterval;
uniform float uIsolineThickness;
uniform vec3 uIsolineColor;

// ==== Drape texture array (sRGB, mipmapped) ====
uniform sampler2DArray uDrapeAtlas;
uniform float uDrapeOpacity;
uniform int uHasDrape;

// ==== Drape blend mode: 0=normal, 1=hillshade, 2=softlight ====
uniform int uDrapeBlendMode;
uniform float uHillshadeStrength;

// ==== Drape placeholder color (theme-aware, sRGB) ====
uniform vec3 uDrapePlaceholder;
