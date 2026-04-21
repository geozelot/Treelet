// ============================================================================
// Tests for src/cog/COGReader.ts
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  selectImage,
  zoomToResolution,
  getTileDescriptor,
  getZoomRange,
} from '../../src/cog/COGReader';
import type { COGMetadata, IFDInfo, GeoReference } from '../../src/cog/types';
import { SampleFormat, Compression as CompressionCode } from '../../src/cog/types';
import { WEB_MERCATOR_EXTENT } from '../../src/core/constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal IFDInfo for testing. */
function makeIFDInfo(overrides: Partial<IFDInfo> = {}): IFDInfo {
  return {
    imageWidth: 256,
    imageLength: 256,
    tileWidth: 256,
    tileLength: 256,
    bitsPerSample: 32,
    sampleFormat: SampleFormat.Float,
    samplesPerPixel: 1,
    compression: CompressionCode.Deflate,
    predictor: 1,
    photometricInterpretation: 1,
    planarConfiguration: 1,
    tileOffsets: new Float64Array([1000]),
    tileByteCounts: new Float64Array([5000]),
    tilesAcross: 1,
    tilesDown: 1,
    isOverview: false,
    pixelScaleX: 10,
    pixelScaleY: 10,
    noDataValue: null,
    ...overrides,
  };
}

/** Create a minimal COGMetadata for testing. */
function makeMetadata(overrides: Partial<COGMetadata> = {}): COGMetadata {
  const geo: GeoReference = {
    originX: -WEB_MERCATOR_EXTENT,
    originY: WEB_MERCATOR_EXTENT,
    pixelScaleX: 10,
    pixelScaleY: 10,
    epsg: 3857,
  };

  return {
    url: 'https://example.com/test.tif',
    isBigTiff: false,
    littleEndian: true,
    images: [makeIFDInfo()],
    geo,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// zoomToResolution
// ---------------------------------------------------------------------------

describe('zoomToResolution', () => {
  it('returns ~156543 m/px at zoom 0 for 256px tiles', () => {
    const res = zoomToResolution(0, 256);
    // ZOOM0_RESOLUTION = (2 * WEB_MERCATOR_EXTENT) / 256
    const expected = (2 * WEB_MERCATOR_EXTENT) / 256;
    expect(res).toBeCloseTo(expected, 0);
  });

  it('halves resolution at each successive zoom level', () => {
    const res0 = zoomToResolution(0, 256);
    const res1 = zoomToResolution(1, 256);
    const res2 = zoomToResolution(2, 256);

    expect(res1).toBeCloseTo(res0 / 2, 1);
    expect(res2).toBeCloseTo(res0 / 4, 1);
  });

  it('adjusts for tile size', () => {
    const res256 = zoomToResolution(5, 256);
    const res512 = zoomToResolution(5, 512);

    // 512px tiles → half the resolution per tile → res should be halved
    expect(res512).toBeCloseTo(res256 / 2, 1);
  });
});

// ---------------------------------------------------------------------------
// selectImage
// ---------------------------------------------------------------------------

describe('selectImage', () => {
  it('selects the only image when there is one', () => {
    const metadata = makeMetadata();
    const selected = selectImage(metadata, 100);
    expect(selected).toBe(metadata.images[0]);
  });

  it('selects the coarsest image with resolution <= target', () => {
    // Images sorted finest→coarsest: 10, 40, 160 m/px
    const images = [
      makeIFDInfo({ pixelScaleX: 10, imageWidth: 4096 }),
      makeIFDInfo({ pixelScaleX: 40, imageWidth: 1024, isOverview: true }),
      makeIFDInfo({ pixelScaleX: 160, imageWidth: 256, isOverview: true }),
    ];
    const metadata = makeMetadata({ images });

    // Target = 50 m/px → should select 40 m/px (coarsest ≤ 50)
    expect(selectImage(metadata, 50).pixelScaleX).toBe(40);

    // Target = 200 m/px → should select 160 m/px
    expect(selectImage(metadata, 200).pixelScaleX).toBe(160);

    // Target = 5 m/px → should select 10 m/px (finest, nothing coarser ≤ 5, fallback to first)
    // Actually the algorithm picks the last one ≤ target, starting from finest
    // 10 > 5, so none match → stays at images[0] (the initial best)
    expect(selectImage(metadata, 5).pixelScaleX).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// getTileDescriptor
// ---------------------------------------------------------------------------

describe('getTileDescriptor', () => {
  it('returns a descriptor for a tile within the COG extent', () => {
    // A COG covering the full web mercator extent
    // Full-res: 256x256 image, 256x256 tiles → 1 tile
    const fullWidth = (2 * WEB_MERCATOR_EXTENT);
    const pixelScale = fullWidth / 256;

    const image = makeIFDInfo({
      imageWidth: 256,
      imageLength: 256,
      tileWidth: 256,
      tileLength: 256,
      tilesAcross: 1,
      tilesDown: 1,
      pixelScaleX: pixelScale,
      pixelScaleY: pixelScale,
      tileOffsets: new Float64Array([10000]),
      tileByteCounts: new Float64Array([5000]),
      compression: CompressionCode.Deflate,
    });

    const geo: GeoReference = {
      originX: -WEB_MERCATOR_EXTENT,
      originY: WEB_MERCATOR_EXTENT,
      pixelScaleX: pixelScale,
      pixelScaleY: pixelScale,
      epsg: 3857,
    };

    const metadata = makeMetadata({ images: [image], geo });

    // Zoom 0, tile (0, 0) → entire world
    const desc = getTileDescriptor(metadata, { x: 0, y: 0, z: 0 });
    expect(desc).not.toBeNull();
    expect(desc!.url).toBe('https://example.com/test.tif');
    expect(desc!.offset).toBe(10000);
    expect(desc!.byteCount).toBe(5000);
    expect(desc!.compression).toBe(CompressionCode.Deflate);
    expect(desc!.tileWidth).toBe(256);
    expect(desc!.tileHeight).toBe(256);
  });

  it('returns null for a tile outside the COG extent', () => {
    // COG covers only a small area around (0, 0) in mercator
    const image = makeIFDInfo({
      imageWidth: 256,
      imageLength: 256,
      tileWidth: 256,
      tileLength: 256,
      tilesAcross: 1,
      tilesDown: 1,
      pixelScaleX: 1,
      pixelScaleY: 1,
      tileOffsets: new Float64Array([1000]),
      tileByteCounts: new Float64Array([500]),
    });

    const geo: GeoReference = {
      originX: -128,
      originY: 128,
      pixelScaleX: 1,
      pixelScaleY: 1,
      epsg: 3857,
    };

    const metadata = makeMetadata({ images: [image], geo });

    // Tile at zoom 0 covers the full mercator extent, but the COG only covers 256x256 meters
    // around origin. Pixel center would be way outside.
    // Actually, geoBoundsToPixels would map the full-extent tile to pixels,
    // and the center pixel would be inside the 256x256 image.
    // Let's use a tile that's clearly outside.
    // At zoom 10, tile (0, 0) is at the top-left corner of the mercator grid,
    // far from the COG at (0, 0).
    const desc = getTileDescriptor(metadata, { x: 0, y: 0, z: 10 });
    expect(desc).toBeNull();
  });

  it('computes crop region when COG tile is larger than XYZ tile', () => {
    // COG in EPSG:3857 covering a 2560m x 2560m area, stored in a single 1024x1024 tile
    // but image is only 256x256 → the XYZ tile at appropriate zoom maps to a sub-region
    const tileW = 1024;
    const imgW = 256;
    const areaSize = 2560; // meters
    const pixelScale = areaSize / imgW; // 10 m/px

    const image = makeIFDInfo({
      imageWidth: imgW,
      imageLength: imgW,
      tileWidth: tileW,
      tileLength: tileW,
      tilesAcross: 1,
      tilesDown: 1,
      pixelScaleX: pixelScale,
      pixelScaleY: pixelScale,
      tileOffsets: new Float64Array([10000]),
      tileByteCounts: new Float64Array([50000]),
    });

    // Place COG at center of mercator extent (origin = top-left corner)
    const geo: GeoReference = {
      originX: -areaSize / 2,
      originY: areaSize / 2,
      pixelScaleX: pixelScale,
      pixelScaleY: pixelScale,
      epsg: 3857,
    };

    const metadata = makeMetadata({ images: [image], geo });

    // At zoom 0, there's one tile covering the full mercator extent (~40M meters).
    // The COG is only 2560m wide, so the pixel bounds will be tiny.
    // Use a zoom level where the tile size is comparable to the COG.
    // At zoom 17, tile size ≈ 305m. The COG is 2560m → ~8 tiles across.
    // Center tile: x = 2^17 / 2 = 65536, y = 65536 (center of mercator)
    const desc = getTileDescriptor(metadata, { x: 65536, y: 65536, z: 17 });
    expect(desc).not.toBeNull();

    // The crop region should be a small portion of the 1024x1024 tile
    expect(desc!.cropWidth).toBeLessThan(tileW);
    expect(desc!.cropHeight).toBeLessThan(tileW);
    expect(desc!.outputSize).toBe(256);
    // Crop coordinates should be within tile bounds
    expect(desc!.cropX).toBeGreaterThanOrEqual(0);
    expect(desc!.cropY).toBeGreaterThanOrEqual(0);
    expect(desc!.cropX + desc!.cropWidth).toBeLessThanOrEqual(tileW);
    expect(desc!.cropY + desc!.cropHeight).toBeLessThanOrEqual(tileW);
  });

  it('returns null for empty tiles (offset=0)', () => {
    const fullWidth = (2 * WEB_MERCATOR_EXTENT);
    const pixelScale = fullWidth / 256;

    const image = makeIFDInfo({
      imageWidth: 256,
      imageLength: 256,
      tileWidth: 256,
      tileLength: 256,
      tilesAcross: 1,
      tilesDown: 1,
      pixelScaleX: pixelScale,
      pixelScaleY: pixelScale,
      tileOffsets: new Float64Array([0]), // empty tile
      tileByteCounts: new Float64Array([0]),
    });

    const geo: GeoReference = {
      originX: -WEB_MERCATOR_EXTENT,
      originY: WEB_MERCATOR_EXTENT,
      pixelScaleX: pixelScale,
      pixelScaleY: pixelScale,
      epsg: 3857,
    };

    const metadata = makeMetadata({ images: [image], geo });
    const desc = getTileDescriptor(metadata, { x: 0, y: 0, z: 0 });
    expect(desc).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getZoomRange
// ---------------------------------------------------------------------------

describe('getZoomRange', () => {
  it('returns a valid zoom range for a single-image COG', () => {
    const metadata = makeMetadata();
    const range = getZoomRange(metadata);

    expect(range.minZoom).toBeGreaterThanOrEqual(0);
    expect(range.maxZoom).toBeGreaterThanOrEqual(range.minZoom);
  });

  it('wider zoom range with overviews', () => {
    const images = [
      makeIFDInfo({ pixelScaleX: 10, pixelScaleY: 10 }),
      makeIFDInfo({ pixelScaleX: 160, pixelScaleY: 160, isOverview: true }),
    ];
    const metadata = makeMetadata({ images });

    const range = getZoomRange(metadata);
    // With overviews, the min zoom should be lower than without
    const singleRange = getZoomRange(makeMetadata());
    expect(range.minZoom).toBeLessThanOrEqual(singleRange.minZoom);
  });
});
