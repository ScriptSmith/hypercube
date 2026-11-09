// Just enough PNG decoding to measure screenshots: 8-bit grey, grey-alpha, RGB and RGBA,
// not interlaced, which covers what Chromium writes.
import { inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Decode to RGBA, 4 bytes per pixel. */
export const decodePng = (input) => {
  const buf = Buffer.isBuffer(input)
    ? input
    : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (!SIGNATURE.equals(buf.subarray(0, 8))) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  for (let pos = 8; pos + 8 <= buf.length;) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const colorType = data[9];
      channels = CHANNELS[colorType] ?? 0;
      if (depth !== 8 || channels === 0 || data[12] !== 0) {
        throw new Error(`unsupported PNG: depth ${depth}, colour type ${colorType}`);
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error("truncated PNG");
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    for (let i = 0; i < stride; i++) {
      const x = raw[start + 1 + i];
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) v = x + paeth(a, b, c);
      else throw new Error(`bad PNG filter ${filter}`);
      cur[i] = v & 255;
    }
    for (let px = 0; px < width; px++) {
      const o = (y * width + px) * 4;
      const s = px * channels;
      if (channels >= 3) {
        out[o] = cur[s];
        out[o + 1] = cur[s + 1];
        out[o + 2] = cur[s + 2];
      } else {
        out[o] = out[o + 1] = out[o + 2] = cur[s];
      }
      out[o + 3] = channels === 4 ? cur[s + 3] : channels === 2 ? cur[s + 1] : 255;
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data: out };
};

/** Mean and standard deviation of luminance (0 to 255). A blank stage has a spread near 0. */
export const pixelStats = ({ width, height, data }) => {
  const n = width * height;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += l;
    sumSq += l * l;
  }
  const mean = n ? sum / n : 0;
  return { mean, stddev: n ? Math.sqrt(Math.max(0, sumSq / n - mean * mean)) : 0 };
};

/** Below this luminance spread a screenshot counts as blank. One small label is well above it. */
export const BLANK_STDDEV = 1;
