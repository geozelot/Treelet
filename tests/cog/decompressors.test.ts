// ============================================================================
// Tests for src/cog/decompressors.ts
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  decompressTile,
  reversePredictor,
  interpretElevation,
  interpretRGBA,
} from '../../src/cog/decompressors';
import {
  Compression,
  Predictor,
  SampleFormat,
} from '../../src/cog/types';

// ---------------------------------------------------------------------------
// decompressTile
// ---------------------------------------------------------------------------

describe('decompressTile', () => {
  it('returns data unchanged for Compression.None', async () => {
    const input = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const result = await decompressTile(input, Compression.None);
    expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('decompresses Deflate (zlib) data', async () => {
    // Create data, compress with CompressionStream, then verify decompressTile reverses it
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i & 0xff;

    // Compress using native API
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();
    writer.write(original);
    writer.close();

    const chunks: Uint8Array[] = [];
    let totalLen = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLen += value.byteLength;
    }
    const compressed = new Uint8Array(totalLen);
    let off = 0;
    for (const c of chunks) {
      compressed.set(c, off);
      off += c.byteLength;
    }

    // Now decompress with our function
    const decompressed = await decompressTile(compressed.buffer, Compression.Deflate);
    expect(new Uint8Array(decompressed)).toEqual(original);
  });

  it('decompresses LZW data', async () => {
    // We'll test LZW by encoding a known simple sequence manually
    // LZW encoding for the byte sequence [0, 0, 0, 0] with TIFF MSB-first packing:
    //
    // Initial state: code size = 9 bits, table has 0-255, CLEAR=256, EOI=257
    //
    // Emit CLEAR (256) = 0b100000000 = 9 bits
    // Emit code 0     = 0b000000000 = 9 bits
    // Add code 258 = [0, 0]
    // Emit code 258   = 0b100000010 = 9 bits  (code for [0, 0])
    // Add code 259 = [0, 0, 0]
    // Emit EOI (257)  = 0b100000001 = 9 bits
    //
    // Bits (MSB first): 100000000 000000000 100000010 100000001
    //                   = 0x80 0x00 0x81 0x01
    // But we need to pack these bits into bytes MSB-first:
    // Bit stream: 1 0000 0000 | 0 0000 0000 | 1 0000 0010 | 1 0000 0001
    // Pack into bytes:
    // byte[0]: 10000000 = 0x80
    // byte[1]: 00000000 = 0x00
    // byte[2]: 01000000 = 0x40 (bit 9 of code 258 goes here, remaining bits 0)
    // Wait, let me just test with a round-trip through actual data instead.

    // Since LZW encoding is complex, let's test decompression of a known pattern.
    // We'll use our decompressor and verify it doesn't throw on Compression.None
    // and test the actual LZW with a small hand-verified stream.

    // Actually, let's build LZW encoded data programmatically:
    const lzwData = encodeLZW(new Uint8Array([65, 66, 65, 66, 65, 66])); // "ABABAB"
    const result = await decompressTile(lzwData, Compression.LZW);
    const decoded = new Uint8Array(result);
    expect(decoded).toEqual(new Uint8Array([65, 66, 65, 66, 65, 66]));
  });

  it('throws on unsupported compression', async () => {
    const input = new ArrayBuffer(4);
    await expect(decompressTile(input, 99)).rejects.toThrow('unsupported COG compression');
  });
});

// ---------------------------------------------------------------------------
// LZW encoder helper for testing (TIFF-compatible MSB-first bit packing)
// ---------------------------------------------------------------------------

function encodeLZW(data: Uint8Array): ArrayBuffer {
  const CLEAR = 256;
  const EOI = 257;
  let nextCode = 258;
  let codeSize = 9;

  // Simple string table: key = comma-separated byte string, value = code
  const table = new Map<string, number>();
  for (let i = 0; i < 256; i++) {
    table.set(String(i), i);
  }

  const codes: number[] = [];
  codes.push(CLEAR);

  let w = '';
  for (let i = 0; i < data.length; i++) {
    const c = String(data[i]);
    const wc = w ? `${w},${c}` : c;

    if (table.has(wc)) {
      w = wc;
    } else {
      codes.push(table.get(w)!);
      if (nextCode <= 4095) {
        table.set(wc, nextCode++);
      }
      w = c;
    }
  }
  if (w) {
    codes.push(table.get(w)!);
  }
  codes.push(EOI);

  // Pack codes into bytes with MSB-first bit order (TIFF LZW)
  const output = new Uint8Array(codes.length * 2 + 4);
  let bitBuffer = 0;
  let bitsInBuffer = 0;
  let outPos = 0;
  codeSize = 9;
  nextCode = 258;

  for (const code of codes) {
    if (code === CLEAR) {
      codeSize = 9;
      nextCode = 258;
    }

    // Write code MSB-first
    bitBuffer = (bitBuffer << codeSize) | code;
    bitsInBuffer += codeSize;

    while (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      output[outPos++] = (bitBuffer >> bitsInBuffer) & 0xff;
    }

    if (code !== CLEAR && code !== EOI) {
      nextCode++;
      if (nextCode > (1 << codeSize) - 1 && codeSize < 12) {
        codeSize++;
      }
    }
  }

  // Flush remaining bits
  if (bitsInBuffer > 0) {
    output[outPos++] = (bitBuffer << (8 - bitsInBuffer)) & 0xff;
  }

  return output.buffer.slice(0, outPos);
}

// ---------------------------------------------------------------------------
// reversePredictor
// ---------------------------------------------------------------------------

describe('reversePredictor', () => {
  it('does nothing for Predictor.None', () => {
    const data = new Uint8Array([10, 20, 30, 40]);
    const original = new Uint8Array(data);
    reversePredictor(data.buffer, Predictor.None, 4, 1, 1, 8, SampleFormat.Uint);
    expect(data).toEqual(original);
  });

  it('reverses horizontal differencing for 8-bit data', () => {
    // 1 row, 4 pixels, 1 sample/pixel, 8 bps
    // Original pixels: [100, 110, 120, 130]
    // After forward diff: [100, 10, 10, 10]
    const data = new Uint8Array([100, 10, 10, 10]);
    reversePredictor(data.buffer, Predictor.HorizontalDiff, 4, 1, 1, 8, SampleFormat.Uint);
    expect(data).toEqual(new Uint8Array([100, 110, 120, 130]));
  });

  it('reverses horizontal differencing for 16-bit data', () => {
    // 1 row, 3 pixels, 1 sample/pixel, 16 bps
    // Original: [1000, 1100, 1200]
    // After forward diff: [1000, 100, 100]
    const buf = new ArrayBuffer(6);
    const u16 = new Uint16Array(buf);
    u16[0] = 1000;
    u16[1] = 100;
    u16[2] = 100;

    reversePredictor(buf, Predictor.HorizontalDiff, 3, 1, 1, 16, SampleFormat.Uint);
    expect(u16[0]).toBe(1000);
    expect(u16[1]).toBe(1100);
    expect(u16[2]).toBe(1200);
  });

  it('reverses horizontal differencing for multi-band 8-bit data', () => {
    // 1 row, 2 pixels, 3 samples/pixel (RGB), 8 bps
    // Original: [100, 50, 200, 110, 60, 210]
    // Forward diff (interleaved): [100, 50, 200, 10, 10, 10]
    const data = new Uint8Array([100, 50, 200, 10, 10, 10]);
    reversePredictor(data.buffer, Predictor.HorizontalDiff, 2, 1, 3, 8, SampleFormat.Uint);
    expect(data).toEqual(new Uint8Array([100, 50, 200, 110, 60, 210]));
  });

  it('reverses floating-point predictor for Float32 data', () => {
    // 1 row, 4 pixels, 1 sample/pixel, 32 bps (Float32)
    // Original Float32 values: [647.0, 648.5, 650.0, 651.5]
    const original = new Float32Array([647.0, 648.5, 650.0, 651.5]);
    const origBytes = new Uint8Array(original.buffer);

    // Simulate TIFF floating-point predictor encoding:
    // Step 1: Byte shuffle — rearrange into byte-planes (MSB-first)
    // For each pixel, byte 3 (MSB in LE) goes to plane 0, byte 2 to plane 1, etc.
    const width = 4;
    const bytesPerSample = 4;
    const rowPixels = width;
    const shuffled = new Uint8Array(16);
    for (let px = 0; px < rowPixels; px++) {
      for (let b = 0; b < bytesPerSample; b++) {
        // MSB-first: plane b gets byte (bytesPerSample-1-b) of each pixel
        shuffled[b * rowPixels + px] = origBytes[px * bytesPerSample + (bytesPerSample - 1 - b)];
      }
    }

    // Step 2: Horizontal byte differencing (forward)
    const encoded = new Uint8Array(shuffled);
    for (let i = encoded.length - 1; i >= 1; i--) {
      encoded[i] = (encoded[i] - encoded[i - 1]) & 0xff;
    }

    // Now reverse with our function
    reversePredictor(
      encoded.buffer,
      Predictor.FloatingPoint,
      4, // width
      1, // height
      1, // samplesPerPixel
      32, // bitsPerSample
      SampleFormat.Float,
    );

    // Should recover the original Float32 values
    const result = new Float32Array(encoded.buffer);
    expect(result[0]).toBeCloseTo(647.0, 2);
    expect(result[1]).toBeCloseTo(648.5, 2);
    expect(result[2]).toBeCloseTo(650.0, 2);
    expect(result[3]).toBeCloseTo(651.5, 2);
  });

  it('reverses floating-point predictor for multi-row data', () => {
    // 2 rows, 3 pixels each, 1 sample/pixel, 32 bps
    const original = new Float32Array([100.0, 200.0, 300.0, 400.0, 500.0, 600.0]);
    const origBytes = new Uint8Array(original.buffer);

    const width = 3;
    const height = 2;
    const bytesPerSample = 4;
    const rowPixels = width;
    const rowBytes = rowPixels * bytesPerSample;
    const encoded = new Uint8Array(24);

    // Encode each row independently
    for (let row = 0; row < height; row++) {
      const rowOff = row * rowBytes;
      const srcRowOff = row * rowPixels * bytesPerSample;

      // Shuffle
      for (let px = 0; px < rowPixels; px++) {
        for (let b = 0; b < bytesPerSample; b++) {
          encoded[rowOff + b * rowPixels + px] = origBytes[srcRowOff + px * bytesPerSample + (bytesPerSample - 1 - b)];
        }
      }

      // Horizontal diff
      for (let i = rowBytes - 1; i >= 1; i--) {
        encoded[rowOff + i] = (encoded[rowOff + i] - encoded[rowOff + i - 1]) & 0xff;
      }
    }

    reversePredictor(
      encoded.buffer,
      Predictor.FloatingPoint,
      3, 2, 1, 32,
      SampleFormat.Float,
    );

    const result = new Float32Array(encoded.buffer);
    expect(result[0]).toBeCloseTo(100.0, 2);
    expect(result[1]).toBeCloseTo(200.0, 2);
    expect(result[2]).toBeCloseTo(300.0, 2);
    expect(result[3]).toBeCloseTo(400.0, 2);
    expect(result[4]).toBeCloseTo(500.0, 2);
    expect(result[5]).toBeCloseTo(600.0, 2);
  });

  it('handles multiple rows independently', () => {
    // 2 rows, 3 pixels each, 1 sample/pixel, 8 bps
    // Row 0 original: [10, 20, 30] → diff: [10, 10, 10]
    // Row 1 original: [50, 60, 70] → diff: [50, 10, 10]
    const data = new Uint8Array([10, 10, 10, 50, 10, 10]);
    reversePredictor(data.buffer, Predictor.HorizontalDiff, 3, 2, 1, 8, SampleFormat.Uint);
    expect(data).toEqual(new Uint8Array([10, 20, 30, 50, 60, 70]));
  });
});

// ---------------------------------------------------------------------------
// interpretElevation
// ---------------------------------------------------------------------------

describe('interpretElevation', () => {
  it('interprets Float32 data (native byte order, single band)', () => {
    const f32 = new Float32Array([100.5, 200.0, -50.25, 0.0]);
    const result = interpretElevation(
      f32.buffer,
      SampleFormat.Float,
      32,
      true, // assume LE platform
      null,
    );
    expect(result).toHaveLength(4);
    expect(result[0]).toBeCloseTo(100.5);
    expect(result[1]).toBeCloseTo(200.0);
    expect(result[2]).toBeCloseTo(-50.25);
    expect(result[3]).toBeCloseTo(0.0);
  });

  it('replaces NoData values with 0', () => {
    const f32 = new Float32Array([100.0, -9999.0, 200.0, -9999.0]);
    const result = interpretElevation(
      f32.buffer,
      SampleFormat.Float,
      32,
      true,
      -9999.0,
    );
    expect(result[0]).toBeCloseTo(100.0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBeCloseTo(200.0);
    expect(result[3]).toBe(0);
  });

  it('interprets Int16 data', () => {
    const i16 = new Int16Array([500, -100, 32767, -32768]);
    const result = interpretElevation(
      i16.buffer,
      SampleFormat.Int,
      16,
      true,
      null,
    );
    expect(result).toHaveLength(4);
    expect(result[0]).toBe(500);
    expect(result[1]).toBe(-100);
    expect(result[2]).toBe(32767);
    expect(result[3]).toBe(-32768);
  });

  it('interprets Uint8 data', () => {
    const u8 = new Uint8Array([0, 128, 255, 42]);
    const result = interpretElevation(
      u8.buffer,
      SampleFormat.Uint,
      8,
      true,
      null,
    );
    expect(result).toHaveLength(4);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(128);
    expect(result[2]).toBe(255);
    expect(result[3]).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// interpretRGBA
// ---------------------------------------------------------------------------

describe('interpretRGBA', () => {
  it('converts RGB (3-band) to RGBA with alpha=255', () => {
    // 2x1 image, 3 samples/pixel
    const rgb = new Uint8Array([255, 0, 0, 0, 255, 0]);
    const result = interpretRGBA(rgb.buffer, 3, 2, 1);

    expect(result).toHaveLength(8); // 2 pixels × 4 channels
    // Pixel 0: red
    expect(result[0]).toBe(255);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
    expect(result[3]).toBe(255); // alpha
    // Pixel 1: green
    expect(result[4]).toBe(0);
    expect(result[5]).toBe(255);
    expect(result[6]).toBe(0);
    expect(result[7]).toBe(255); // alpha
  });

  it('passes through RGBA (4-band) data', () => {
    const rgba = new Uint8Array([255, 0, 0, 128, 0, 255, 0, 64]);
    const result = interpretRGBA(rgba.buffer, 4, 2, 1);

    expect(result).toEqual(new Uint8ClampedArray([255, 0, 0, 128, 0, 255, 0, 64]));
  });

  it('converts single-band to grayscale RGBA', () => {
    const gray = new Uint8Array([100, 200]);
    const result = interpretRGBA(gray.buffer, 1, 2, 1);

    expect(result).toHaveLength(8);
    // Pixel 0: gray 100
    expect(result[0]).toBe(100);
    expect(result[1]).toBe(100);
    expect(result[2]).toBe(100);
    expect(result[3]).toBe(255);
    // Pixel 1: gray 200
    expect(result[4]).toBe(200);
    expect(result[5]).toBe(200);
    expect(result[6]).toBe(200);
    expect(result[7]).toBe(255);
  });
});
