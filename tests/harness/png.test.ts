import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng, pixelStats } from "../../scripts/lib/png.mjs";

const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  // The decoder ignores CRCs, so zeros do.
  return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** A PNG whose rows cycle through the given filter types. */
const encode = (
  width: number,
  height: number,
  colorType: number,
  pixels: Uint8Array,
  filters: number[],
): Buffer => {
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType] ?? 0;
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const filter = filters[y % filters.length] ?? 0;
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const at = (yy: number, ii: number) =>
        yy < 0 || ii < 0 ? 0 : (pixels[yy * stride + ii] ?? 0);
      const v = at(y, i);
      const a = at(y, i - channels);
      const b = at(y - 1, i);
      const c = at(y - 1, i - channels);
      const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter] ?? 0;
      raw[y * (stride + 1) + 1 + i] = (v - predicted) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const noise = (n: number): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) % 256);

describe("decodePng", () => {
  it("undoes every filter type for RGBA", () => {
    const pixels = noise(7 * 5 * 4);
    const img = decodePng(encode(7, 5, 6, pixels, [0, 1, 2, 3, 4]));
    expect(img.width).toBe(7);
    expect(img.height).toBe(5);
    expect([...img.data]).toEqual([...pixels]);
  });

  it("expands RGB and grey to opaque RGBA", () => {
    const rgb = noise(3 * 2 * 3);
    const fromRgb = decodePng(encode(3, 2, 2, rgb, [4, 3]));
    expect([...fromRgb.data.subarray(0, 8)]).toEqual([
      rgb[0],
      rgb[1],
      rgb[2],
      255,
      rgb[3],
      rgb[4],
      rgb[5],
      255,
    ]);

    const grey = Uint8Array.from([10, 200]);
    const fromGrey = decodePng(encode(2, 1, 0, grey, [1]));
    expect([...fromGrey.data]).toEqual([10, 10, 10, 255, 200, 200, 200, 255]);
  });

  it("rejects what it can't read", () => {
    expect(() => decodePng(Buffer.from("not a png at all"))).toThrow(/not a PNG/);
  });
});

describe("pixelStats", () => {
  it("finds no spread in a uniform image and some for one bright pixel", () => {
    const flat = new Uint8Array(100 * 4).fill(20);
    expect(pixelStats({ width: 10, height: 10, data: flat }).stddev).toBeLessThan(0.001);
    flat.set([255, 255, 255, 255], 0);
    expect(pixelStats({ width: 10, height: 10, data: flat }).stddev).toBeGreaterThan(10);
  });
});
