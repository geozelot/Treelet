// ============================================================================
// treelet.js - Pluggable Elevation Decoder
//
// Provides a decoder registry and interface for converting raw tile image
// pixel data into floating-point elevation arrays. New decoders are
// registered by name and can be selected per base layer.
// ============================================================================

/**
 * Interface for all elevation decoders.
 *
 * A decoder receives raw RGBA pixel data (as a flat Uint8ClampedArray)
 * and returns a Float32Array of elevation values in meters.
 *
 * Decoders run inside Web Workers, so they must be pure functions
 * with no DOM or Three.js dependencies.
 */
export interface ElevationDecoder {
  /**
   * Decode raw RGBA pixel buffer into elevation values (meters).
   *
   * @param pixels - Flat RGBA pixel array (length = width * height * 4)
   * @param width  - Tile width in pixels
   * @param height - Tile height in pixels
   * @returns Float32Array of elevation values (length = width * height)
   */
  decode(pixels: Uint8ClampedArray, width: number, height: number): Float32Array;
}

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
export const terrainRGBDecoder: ElevationDecoder = {
  decode(pixels: Uint8ClampedArray, width: number, height: number): Float32Array {
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
  },
};

/**
 * Mapbox Terrain DEM v1 decoder (same as Terrain-RGB).
 * Alias provided for clarity.
 */
export const mapboxTerrainDecoder = terrainRGBDecoder;

/**
 * Terrarium encoding decoder (used by some Tilezen/Nextzen sources).
 *
 * height = (R * 256 + G + B / 256) - 32768
 *
 * @see https://github.com/tilezen/joerd/blob/master/docs/formats.md
 */
export const terrariumDecoder: ElevationDecoder = {
  decode(pixels: Uint8ClampedArray, width: number, height: number): Float32Array {
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
  },
};

/**
 * Create a custom decoder from a per-pixel function.
 *
 * @param fn - Function that takes (r, g, b, a) and returns elevation in meters
 */
export function createCustomDecoder(
  fn: (r: number, g: number, b: number, a: number) => number,
): ElevationDecoder {
  return {
    decode(pixels: Uint8ClampedArray, width: number, height: number): Float32Array {
      const count = width * height;
      const elevations = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        const offset = i * 4;
        elevations[i] = fn(
          pixels[offset],
          pixels[offset + 1],
          pixels[offset + 2],
          pixels[offset + 3],
        );
      }

      return elevations;
    },
  };
}

// ============================================================================
// Decoder Registry
// ============================================================================

const decoderRegistry = new Map<string, ElevationDecoder>([
  ['terrain-rgb', terrainRGBDecoder],
  ['mapbox', mapboxTerrainDecoder],
  ['terrarium', terrariumDecoder],
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
 * Resolve a decoder from layer options.
 * Supports string names (from registry) or inline custom functions.
 */
export function resolveDecoder(
  decoderType?: string,
  customFn?: (r: number, g: number, b: number, a: number) => number,
): ElevationDecoder {
  if (customFn) {
    return createCustomDecoder(customFn);
  }
  const name = decoderType ?? 'terrain-rgb';
  const decoder = decoderRegistry.get(name);
  if (!decoder) {
    throw new Error(`treelet: unknown elevation decoder "${name}". Register it with registerDecoder().`);
  }
  return decoder;
}
