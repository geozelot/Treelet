// Fragment shader declarations - uniforms and varyings.
// Must be prepended before all includes that reference these globals.

precision highp float;

// ==== Varyings from vertex shader ====
varying vec2 vAtlasUV;
varying vec2 vLocalUV;
varying float vElevation;
varying float vTileWorldSize;
varying float vTileLod;
varying float vAtlasScale;
varying float vMorphFactor;
varying vec4 vAtlasBounds;
varying vec3 vParentAtlasCoord;

// ==== Unified elevation atlas ====
uniform sampler2D uAtlas;
uniform float uAtlasSize;
uniform float uElevationScale;

// ==== Shader mode: 0=base, 1=elevation, 2=slope, 3=aspect, 4=texture ====
uniform int uMode;

// ==== Color ramp: 0=hypsometric, 1=viridis, 2=inferno, 3=grayscale ====
uniform int uColorRamp;

// ==== Elevation range (meters) ====
uniform float uMinElevation;
uniform float uMaxElevation;

// ==== Lighting ====
uniform vec3 uSunDirection;

// ==== Wireframe: base mode renders flat white instead of normals ====
uniform bool uBaseWhite;

// ==== Isoline overlay ====
uniform bool uIsolineEnabled;
uniform float uIsolineInterval;
uniform float uIsolineThickness;
uniform vec3 uIsolineColor;

// ==== Drape texture ====
uniform sampler2D uDrapeAtlas;
uniform float uDrapeOpacity;
uniform int uHasDrape;

// ==== Drape blend mode: 0=normal, 1=hillshade, 2=softlight ====
uniform int uDrapeBlendMode;
uniform float uHillshadeStrength;

// ==== Drape placeholder color (theme-aware: white for light, dark grey for dark) ====
uniform vec3 uDrapePlaceholder;
