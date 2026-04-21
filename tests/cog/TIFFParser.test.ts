// ============================================================================
// Tests for src/cog/TIFFParser.ts
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  parseTIFFHeader,
  parseIFDChain,
  buildIFDInfo,
  buildGeoReference,
  readTagValue,
  readTagValues,
  readTagString,
} from '../../src/cog/TIFFParser';
import {
  BYTE_ORDER_LE,
  BYTE_ORDER_BE,
  TIFF_MAGIC,
  BIGTIFF_MAGIC,
  Tag,
  SampleFormat,
  Compression as CompressionCode,
} from '../../src/cog/types';
import type { TagEntry, TIFFHeader } from '../../src/cog/types';

// ---------------------------------------------------------------------------
// Helpers: build synthetic TIFF buffers for testing
// ---------------------------------------------------------------------------

/**
 * Build a minimal classic TIFF header + single IFD with the given tags.
 * Returns an ArrayBuffer ready for parsing.
 */
function buildClassicTIFF(
  le: boolean,
  tags: { tag: number; type: number; count: number; value: number }[],
): ArrayBuffer {
  // Layout:
  //  0-1: byte order
  //  2-3: magic (42)
  //  4-7: first IFD offset (8)
  //  8-9: entry count
  // 10..: entries (12 bytes each)
  // after entries: next IFD offset (0 = none)
  const entryCount = tags.length;
  const ifdStart = 8;
  const headerSize = ifdStart + 2 + entryCount * 12 + 4;
  // Extra space for out-of-line tag data
  const buffer = new ArrayBuffer(headerSize + 1024);
  const view = new DataView(buffer);

  // Header
  view.setUint16(0, le ? BYTE_ORDER_LE : BYTE_ORDER_BE, false);
  view.setUint16(2, TIFF_MAGIC, le);
  view.setUint32(4, ifdStart, le);

  // IFD entry count
  view.setUint16(ifdStart, entryCount, le);

  let pos = ifdStart + 2;
  for (const t of tags) {
    view.setUint16(pos, t.tag, le);
    view.setUint16(pos + 2, t.type, le);
    view.setUint32(pos + 4, t.count, le);
    // For simplicity, store value inline (works for count=1 of SHORT/LONG)
    if (t.type === 3) {
      // SHORT
      view.setUint16(pos + 8, t.value, le);
    } else {
      view.setUint32(pos + 8, t.value, le);
    }
    pos += 12;
  }

  // Next IFD offset = 0
  view.setUint32(pos, 0, le);

  return buffer;
}

/**
 * Build a minimal BigTIFF header + single IFD.
 */
function buildBigTIFF(
  le: boolean,
  tags: { tag: number; type: number; count: number; value: number }[],
): ArrayBuffer {
  // BigTIFF header: 16 bytes
  //  0-1: byte order
  //  2-3: magic (43)
  //  4-5: offset size (8)
  //  6-7: reserved (0)
  //  8-15: first IFD offset (16)
  // IFD at 16:
  //  16-23: entry count (8 bytes)
  //  24..: entries (20 bytes each)
  //  after entries: next IFD offset (8 bytes, 0)
  const entryCount = tags.length;
  const ifdStart = 16;
  const headerSize = ifdStart + 8 + entryCount * 20 + 8;
  const buffer = new ArrayBuffer(headerSize + 1024);
  const view = new DataView(buffer);

  // Header
  view.setUint16(0, le ? BYTE_ORDER_LE : BYTE_ORDER_BE, false);
  view.setUint16(2, BIGTIFF_MAGIC, le);
  view.setUint16(4, 8, le); // offset size
  view.setUint16(6, 0, le); // reserved

  // First IFD offset as 64-bit
  if (le) {
    view.setUint32(8, ifdStart, true);
    view.setUint32(12, 0, true);
  } else {
    view.setUint32(8, 0, false);
    view.setUint32(12, ifdStart, false);
  }

  // IFD entry count (64-bit)
  if (le) {
    view.setUint32(ifdStart, entryCount, true);
    view.setUint32(ifdStart + 4, 0, true);
  } else {
    view.setUint32(ifdStart, 0, false);
    view.setUint32(ifdStart + 4, entryCount, false);
  }

  let pos = ifdStart + 8;
  for (const t of tags) {
    view.setUint16(pos, t.tag, le);
    view.setUint16(pos + 2, t.type, le);
    // count as 64-bit
    if (le) {
      view.setUint32(pos + 4, t.count, true);
      view.setUint32(pos + 8, 0, true);
    } else {
      view.setUint32(pos + 4, 0, false);
      view.setUint32(pos + 8, t.count, false);
    }
    // value/offset at pos + 12 (inline if fits in 8 bytes)
    if (t.type === 3) {
      view.setUint16(pos + 12, t.value, le);
    } else {
      view.setUint32(pos + 12, t.value, le);
    }
    pos += 20;
  }

  // Next IFD offset = 0 (8 bytes)
  view.setUint32(pos, 0, le);
  view.setUint32(pos + 4, 0, le);

  return buffer;
}

// ---------------------------------------------------------------------------
// parseTIFFHeader
// ---------------------------------------------------------------------------

describe('parseTIFFHeader', () => {
  it('parses a classic little-endian TIFF header', () => {
    const buf = buildClassicTIFF(true, []);
    const header = parseTIFFHeader(buf);

    expect(header.littleEndian).toBe(true);
    expect(header.isBigTiff).toBe(false);
    expect(header.firstIFDOffset).toBe(8);
  });

  it('parses a classic big-endian TIFF header', () => {
    const buf = buildClassicTIFF(false, []);
    const header = parseTIFFHeader(buf);

    expect(header.littleEndian).toBe(false);
    expect(header.isBigTiff).toBe(false);
    expect(header.firstIFDOffset).toBe(8);
  });

  it('parses a BigTIFF little-endian header', () => {
    const buf = buildBigTIFF(true, []);
    const header = parseTIFFHeader(buf);

    expect(header.littleEndian).toBe(true);
    expect(header.isBigTiff).toBe(true);
    expect(header.firstIFDOffset).toBe(16);
  });

  it('parses a BigTIFF big-endian header', () => {
    const buf = buildBigTIFF(false, []);
    const header = parseTIFFHeader(buf);

    expect(header.littleEndian).toBe(false);
    expect(header.isBigTiff).toBe(true);
    expect(header.firstIFDOffset).toBe(16);
  });

  it('throws on invalid magic number', () => {
    const buf = new ArrayBuffer(16);
    const view = new DataView(buf);
    view.setUint16(0, BYTE_ORDER_LE, false);
    view.setUint16(2, 99, true); // invalid magic

    expect(() => parseTIFFHeader(buf)).toThrow('not a TIFF file');
  });
});

// ---------------------------------------------------------------------------
// parseIFDChain
// ---------------------------------------------------------------------------

describe('parseIFDChain', () => {
  it('parses a single-IFD classic TIFF', () => {
    const tags = [
      { tag: Tag.ImageWidth, type: 3 /* SHORT */, count: 1, value: 512 },
      { tag: Tag.ImageLength, type: 3, count: 1, value: 512 },
      { tag: Tag.BitsPerSample, type: 3, count: 1, value: 32 },
    ];
    const buf = buildClassicTIFF(true, tags);
    const header = parseTIFFHeader(buf);
    const ifds = parseIFDChain(buf, header);

    expect(ifds).toHaveLength(1);
    expect(ifds[0]).toHaveLength(3);
    expect(ifds[0][0].tag).toBe(Tag.ImageWidth);
    expect(ifds[0][1].tag).toBe(Tag.ImageLength);
    expect(ifds[0][2].tag).toBe(Tag.BitsPerSample);
  });

  it('parses a single-IFD BigTIFF', () => {
    const tags = [
      { tag: Tag.ImageWidth, type: 4 /* LONG */, count: 1, value: 1024 },
    ];
    const buf = buildBigTIFF(true, tags);
    const header = parseTIFFHeader(buf);
    const ifds = parseIFDChain(buf, header);

    expect(ifds).toHaveLength(1);
    expect(ifds[0]).toHaveLength(1);
    expect(ifds[0][0].tag).toBe(Tag.ImageWidth);
  });
});

// ---------------------------------------------------------------------------
// readTagValue / readTagValues
// ---------------------------------------------------------------------------

describe('readTagValue', () => {
  it('reads a SHORT value inline', () => {
    const buf = buildClassicTIFF(true, [
      { tag: Tag.Compression, type: 3, count: 1, value: CompressionCode.LZW },
    ]);
    const header = parseTIFFHeader(buf);
    const ifds = parseIFDChain(buf, header);
    const entry = ifds[0][0];
    const view = new DataView(buf);

    expect(readTagValue(view, entry, true)).toBe(CompressionCode.LZW);
  });

  it('reads a LONG value inline', () => {
    const buf = buildClassicTIFF(true, [
      { tag: Tag.ImageWidth, type: 4, count: 1, value: 65536 },
    ]);
    const header = parseTIFFHeader(buf);
    const ifds = parseIFDChain(buf, header);
    const entry = ifds[0][0];
    const view = new DataView(buf);

    expect(readTagValue(view, entry, true)).toBe(65536);
  });
});

describe('readTagValues', () => {
  it('reads multiple SHORT values at an offset', () => {
    // Build a buffer with a SHORT array tag pointing to offset 200
    const buf = new ArrayBuffer(512);
    const view = new DataView(buf);
    const le = true;

    // Write 3 SHORT values at offset 200
    view.setUint16(200, 100, le);
    view.setUint16(202, 200, le);
    view.setUint16(204, 300, le);

    const entry: TagEntry = {
      tag: Tag.BitsPerSample,
      type: 3, // SHORT
      count: 3,
      value: 200,
      inline: false,
    };

    const values = readTagValues(view, entry, le);
    expect(values).toHaveLength(3);
    expect(values[0]).toBe(100);
    expect(values[1]).toBe(200);
    expect(values[2]).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// readTagString
// ---------------------------------------------------------------------------

describe('readTagString', () => {
  it('reads a null-terminated ASCII string', () => {
    const buf = new ArrayBuffer(256);
    const str = '-9999\0';
    const bytes = new TextEncoder().encode(str);
    new Uint8Array(buf, 100).set(bytes);

    const entry: TagEntry = {
      tag: Tag.GDALNoData,
      type: 2, // ASCII
      count: bytes.length,
      value: 100,
      inline: false,
    };

    expect(readTagString(buf, entry)).toBe('-9999');
  });
});

// ---------------------------------------------------------------------------
// buildIFDInfo
// ---------------------------------------------------------------------------

describe('buildIFDInfo', () => {
  it('builds IFDInfo from basic image tags', () => {
    const le = true;
    const tags = [
      { tag: Tag.ImageWidth, type: 3, count: 1, value: 256 },
      { tag: Tag.ImageLength, type: 3, count: 1, value: 256 },
      { tag: Tag.TileWidth, type: 3, count: 1, value: 256 },
      { tag: Tag.TileLength, type: 3, count: 1, value: 256 },
      { tag: Tag.BitsPerSample, type: 3, count: 1, value: 32 },
      { tag: Tag.SampleFormat, type: 3, count: 1, value: SampleFormat.Float },
      { tag: Tag.SamplesPerPixel, type: 3, count: 1, value: 1 },
      { tag: Tag.Compression, type: 3, count: 1, value: CompressionCode.Deflate },
    ];

    const buf = buildClassicTIFF(le, tags);
    const header = parseTIFFHeader(buf);
    const ifds = parseIFDChain(buf, header);
    const info = buildIFDInfo(buf, ifds[0], le);

    expect(info.imageWidth).toBe(256);
    expect(info.imageLength).toBe(256);
    expect(info.tileWidth).toBe(256);
    expect(info.tileLength).toBe(256);
    expect(info.bitsPerSample).toBe(32);
    expect(info.sampleFormat).toBe(SampleFormat.Float);
    expect(info.samplesPerPixel).toBe(1);
    expect(info.compression).toBe(CompressionCode.Deflate);
    expect(info.tilesAcross).toBe(1);
    expect(info.tilesDown).toBe(1);
    expect(info.isOverview).toBe(false);
  });

  it('calculates tilesAcross and tilesDown correctly', () => {
    const le = true;
    const tags = [
      { tag: Tag.ImageWidth, type: 4, count: 1, value: 1000 },
      { tag: Tag.ImageLength, type: 4, count: 1, value: 500 },
      { tag: Tag.TileWidth, type: 3, count: 1, value: 256 },
      { tag: Tag.TileLength, type: 3, count: 1, value: 256 },
    ];

    const buf = buildClassicTIFF(le, tags);
    const header = parseTIFFHeader(buf);
    const ifds = parseIFDChain(buf, header);
    const info = buildIFDInfo(buf, ifds[0], le);

    expect(info.tilesAcross).toBe(4); // ceil(1000/256) = 4
    expect(info.tilesDown).toBe(2);   // ceil(500/256) = 2
  });

  it('identifies overview IFDs via NewSubfileType', () => {
    const le = true;
    const tags = [
      { tag: Tag.NewSubfileType, type: 4, count: 1, value: 1 }, // bit 0 = reduced resolution
      { tag: Tag.ImageWidth, type: 4, count: 1, value: 128 },
      { tag: Tag.ImageLength, type: 4, count: 1, value: 128 },
    ];

    const buf = buildClassicTIFF(le, tags);
    const header = parseTIFFHeader(buf);
    const ifds = parseIFDChain(buf, header);
    const info = buildIFDInfo(buf, ifds[0], le);

    expect(info.isOverview).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildGeoReference
// ---------------------------------------------------------------------------

describe('buildGeoReference', () => {
  it('extracts pixel scale and origin from ModelPixelScale + ModelTiepoint', () => {
    // Build a buffer with DOUBLE arrays for pixel scale and tiepoint
    const buf = new ArrayBuffer(2048);
    const view = new DataView(buf);
    const le = true;

    // Write ModelPixelScaleTag doubles at offset 500: [scaleX=10.0, scaleY=10.0, scaleZ=0.0]
    view.setFloat64(500, 10.0, le);
    view.setFloat64(508, 10.0, le);
    view.setFloat64(516, 0.0, le);

    // Write ModelTiepointTag doubles at offset 600: [I=0, J=0, K=0, X=-20037508, Y=20037508, Z=0]
    view.setFloat64(600, 0.0, le);  // I
    view.setFloat64(608, 0.0, le);  // J
    view.setFloat64(616, 0.0, le);  // K
    view.setFloat64(624, -20037508.0, le); // X
    view.setFloat64(632, 20037508.0, le);  // Y
    view.setFloat64(640, 0.0, le);  // Z

    const entries: TagEntry[] = [
      { tag: Tag.ModelPixelScaleTag, type: 12 /* DOUBLE */, count: 3, value: 500, inline: false },
      { tag: Tag.ModelTiepointTag, type: 12, count: 6, value: 600, inline: false },
    ];

    const geo = buildGeoReference(buf, entries, le);

    expect(geo.pixelScaleX).toBe(10.0);
    expect(geo.pixelScaleY).toBe(10.0);
    expect(geo.originX).toBe(-20037508.0);
    expect(geo.originY).toBe(20037508.0);
  });

  it('extracts EPSG code from GeoKeyDirectory (ProjectedCSTypeGeoKey)', () => {
    const buf = new ArrayBuffer(2048);
    const view = new DataView(buf);
    const le = true;

    // GeoKeyDirectoryTag at offset 700
    // Format: [version=1, revision=1, minor=0, numKeys=1, key1Id, key1Loc, key1Count, key1Value]
    const geoKeyOffset = 700;
    // Type 3 (SHORT), so each entry is 2 bytes
    view.setUint16(geoKeyOffset + 0, 1, le);    // version
    view.setUint16(geoKeyOffset + 2, 1, le);    // revision
    view.setUint16(geoKeyOffset + 4, 0, le);    // minor
    view.setUint16(geoKeyOffset + 6, 1, le);    // numKeys
    // Key: ProjectedCSTypeGeoKey (3072), location=0 (inline), count=1, value=3857
    view.setUint16(geoKeyOffset + 8, 3072, le); // keyId
    view.setUint16(geoKeyOffset + 10, 0, le);   // location
    view.setUint16(geoKeyOffset + 12, 1, le);   // count
    view.setUint16(geoKeyOffset + 14, 3857, le); // value

    const entries: TagEntry[] = [
      { tag: Tag.GeoKeyDirectoryTag, type: 3 /* SHORT */, count: 8, value: geoKeyOffset, inline: false },
    ];

    const geo = buildGeoReference(buf, entries, le);
    expect(geo.epsg).toBe(3857);
  });

  it('falls back to GeographicTypeGeoKey when no ProjectedCSTypeGeoKey', () => {
    const buf = new ArrayBuffer(2048);
    const view = new DataView(buf);
    const le = true;

    const geoKeyOffset = 700;
    view.setUint16(geoKeyOffset + 0, 1, le);
    view.setUint16(geoKeyOffset + 2, 1, le);
    view.setUint16(geoKeyOffset + 4, 0, le);
    view.setUint16(geoKeyOffset + 6, 1, le);
    // GeographicTypeGeoKey (2048)
    view.setUint16(geoKeyOffset + 8, 2048, le);
    view.setUint16(geoKeyOffset + 10, 0, le);
    view.setUint16(geoKeyOffset + 12, 1, le);
    view.setUint16(geoKeyOffset + 14, 4326, le);

    const entries: TagEntry[] = [
      { tag: Tag.GeoKeyDirectoryTag, type: 3, count: 8, value: geoKeyOffset, inline: false },
    ];

    const geo = buildGeoReference(buf, entries, le);
    expect(geo.epsg).toBe(4326);
  });
});
