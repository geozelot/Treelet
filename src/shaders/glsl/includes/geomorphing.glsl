// Geomorphing utilities
// Unpack neighbor LOD differences and compute morph factor.

// Unpack 4 neighbor LOD differences from a single float.
// Packing: L + R*16 + B*256 + T*4096 (4 bits each, range 0-15)
vec4 unpackNeighborLod(float packed) {
  float p = packed;
  float l = mod(p, 16.0);
  p = floor(p / 16.0);
  float r = mod(p, 16.0);
  p = floor(p / 16.0);
  float b = mod(p, 16.0);
  float t = floor(p / 16.0);
  return vec4(l, r, b, t);
}
