// ============================================================================
// treelet.js - Pluggable Elevation Decoder
//
// Function-based decoder system for converting raw tile image pixel data
// into floating-point elevation arrays. Each decoder is a simple function
// that takes RGBA pixel data and returns a Float32Array.
//
// Shipped decoders:
//   RawRGBDecoder    - Terrain-RGB encoding (Mapbox style)
//   MapboxDecoder    - Alias for RawRGBDecoder
//   TerrariumDecoder - Terrarium encoding (Tilezen/Nextzen)
//
// Custom decoders can be passed directly as the `elevationDecoder`
// option on a BaseLayer.
// ============================================================================

/**
 * Elevation decoder function type.
 *
 * A decoder receives raw RGBA pixel data (as a flat Uint8ClampedArray)
 * and returns a Float32Array of elevation values in meters.
 *
 * Decoders run inside Web Workers, so they must be pure functions
 * with no DOM or Three.js dependencies.
 *
 * @param pixels - Flat RGBA pixel array (length = width * height * 4)
 * @param width  - Tile width in pixels
 * @param height - Tile height in pixels
 * @returns Float32Array of elevation values (length = width * height)
 */
export type ElevationDecoder = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) => Float32Array;

/**
 * Mapbox Terrain-RGB decoder.
 *
 * Elevation is encoded in the RGB channels of a PNG tile:
 *   height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
 *
 * This gives a range of approximately -10000m to +1667721.5m
 * with 0.1m precision.
 *
 * @see https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-rgb-v1/
 */
export const RawRGBDecoder: ElevationDecoder = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array => {
  const count = width * height;
  const elevations = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    elevations[i] = -10000 + (r * 65536 + g * 256 + b) * 0.1;
  }

  return elevations;
};

/**
 * Mapbox Terrain DEM v1 decoder (same as Terrain-RGB).
 * Alias provided for clarity.
 */
export const MapboxDecoder: ElevationDecoder = RawRGBDecoder;

/**
 * Terrarium encoding decoder (used by some Tilezen/Nextzen sources).
 *
 * height = (R * 256 + G + B / 256) - 32768
 *
 * @see https://github.com/tilezen/joerd/blob/master/docs/formats.md
 */
export const TerrariumDecoder: ElevationDecoder = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array => {
  const count = width * height;
  const elevations = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    elevations[i] = r * 256 + g + b / 256 - 32768;
  }

  return elevations;
};

// ============================================================================
// Decoder Registry
// ============================================================================

const decoderRegistry = new Map<string, ElevationDecoder>([
  ['terrain-rgb', RawRGBDecoder],
  ['mapbox', MapboxDecoder],
  ['terrarium', TerrariumDecoder],
]);

/**
 * Register a named decoder so it can be referenced by string in layer options.
 */
export function registerDecoder(name: string, decoder: ElevationDecoder): void {
  decoderRegistry.set(name, decoder);
}

/**
 * Retrieve a decoder by name.
 */
export function getDecoder(name: string): ElevationDecoder | undefined {
  return decoderRegistry.get(name);
}

/**
 * Resolve a decoder from a name string.
 */
export function resolveDecoder(decoderType?: string): ElevationDecoder {
  const name = decoderType ?? 'terrain-rgb';
  const decoder = decoderRegistry.get(name);
  if (!decoder) {
    throw new Error(`treelet: unknown elevation decoder "${name}". Register it with registerDecoder().`);
  }
  return decoder;
}
