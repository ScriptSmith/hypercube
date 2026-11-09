import { bessel, type Mode, onPlate, type PlateShape, sample } from "./modes";

/**
 * Pictures of the plate. A mode's figure is its nodal lines, drawn once with Canvas2D and cached:
 * keys show one each (on the plate's current shape), and a dead drive point shows the ringing
 * figure's lines faintly on the plate. A pixel is lit by its distance from the nearest still line,
 * |w| / |grad w| in pixels, so lines keep one width everywhere.
 *
 * A live picture (`drawMotion`) shows where the plate is still now, from the modes' amplitudes,
 * for the drive point's map; it evaluates the modes from small tables so it can redraw often.
 */

/** Distance (plate units) from (u, v) to the mode's nearest still line, to first order. */
export const lineDistance = (mode: Mode, u: number, v: number): number => {
  const s = sample(mode, u, v);
  return Math.abs(s.w) / Math.max(1e-9, Math.hypot(s.du, s.dv));
};

/**
 * Line coverage, 0 to 1, of a `width` by `height` picture of the plate (a stretched plate is drawn
 * stretched): the alpha of each pixel. `line` is the line's width in pixels.
 */
export const figureMask = (
  mode: Mode,
  width: number,
  height: number,
  line: number,
): Float32Array => {
  const out = new Float32Array(width * height);
  const px = 2 / width;
  const py = 2 / height;
  for (let iy = 0; iy < height; iy++) {
    for (let ix = 0; ix < width; ix++) {
      const u = -1 + (ix + 0.5) * px;
      const v = -1 + (iy + 0.5) * py;
      if (!onPlate(mode.shape, u, v)) continue;
      const s = sample(mode, u, v);
      // Distance in pixels: the slope per pixel is the slope per plate unit times px or py.
      const d = Math.abs(s.w) / Math.max(1e-9, Math.hypot(s.du * px, s.dv * py));
      out[iy * width + ix] = Math.min(1, Math.max(0, (line / 2 + 0.75 - d) / 1.5));
    }
  }
  return out;
};

/** Pictures kept for reuse: a frame's keys at one stretch, and a few more. */
const MAX_CACHE = 16;
const cache = new Map<string, HTMLCanvasElement>();

const rgb = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export interface FigureLook {
  /** Line colour. */
  line: string;
  /** Plate colour, or null for a transparent plate. */
  plate: string | null;
  /** Line width as a share of the picture's size. */
  weight: number;
}

/** A cached canvas `width` by `height` px showing the mode's figure on its plate shape. */
export const figureCanvas = (
  mode: Mode,
  width: number,
  height: number,
  look: FigureLook,
): HTMLCanvasElement => {
  const pw = Math.max(8, Math.round(width));
  const ph = Math.max(8, Math.round(height));
  const form = `${mode.a.toFixed(4)}:${mode.b.toFixed(4)}:${mode.turn.toFixed(3)}`;
  const key = `${mode.shape}:${mode.index}:${form}:${pw}x${ph}:${look.line}:${look.plate}:${look.weight}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  const g = canvas.getContext("2d");
  if (g) {
    const img = g.createImageData(pw, ph);
    const mask = figureMask(mode, pw, ph, Math.max(1.2, look.weight * Math.max(pw, ph)));
    const [lr, lg, lb] = rgb(look.line);
    const plate = look.plate ? rgb(look.plate) : null;
    for (let i = 0; i < pw * ph; i++) {
      const u = -1 + ((i % pw) + 0.5) * (2 / pw);
      const v = -1 + (Math.floor(i / pw) + 0.5) * (2 / ph);
      const on = onPlate(mode.shape, u, v);
      const a = mask[i]!;
      const o = i * 4;
      if (plate && on) {
        img.data[o] = plate[0] + (lr - plate[0]) * a;
        img.data[o + 1] = plate[1] + (lg - plate[1]) * a;
        img.data[o + 2] = plate[2] + (lb - plate[2]) * a;
        img.data[o + 3] = 255;
      } else {
        img.data[o] = lr;
        img.data[o + 1] = lg;
        img.data[o + 2] = lb;
        img.data[o + 3] = on ? Math.round(a * 255) : 0;
      }
    }
    g.putImageData(img, 0, 0);
  }
  cache.set(key, canvas);
  while (cache.size > MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
  return canvas;
};

/** Copy a cached figure into a canvas of its own (an element can only sit in one place). */
export const figureCopy = (
  mode: Mode,
  width: number,
  height: number,
  look: FigureLook,
): HTMLCanvasElement => {
  const src = figureCanvas(mode, width, height, look);
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  c.getContext("2d")?.drawImage(src, 0, 0);
  return c;
};

/** A note's colour: warm for low notes through to violet for high ones. */
export const noteColor = (index: number, count: number): string => {
  const t = count > 1 ? index / (count - 1) : 0;
  const h = 28 + t * 262;
  return hsl(h, 82, 62);
};

const hsl = (h: number, s: number, l: number): string => {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

// ---- Live pictures ------------------------------------------------------------------------

/** Radial samples of J_n(k r), r from 0 to 1, per round mode: the disc's shapes by lookup. */
const RADIAL = 256;
const radial = new Map<string, Float32Array>();

const radialOf = (n: number, k: number): Float32Array => {
  const id = `${n}:${k}`;
  let t = radial.get(id);
  if (!t) {
    t = new Float32Array(RADIAL + 1);
    for (let i = 0; i <= RADIAL; i++) t[i] = bessel(n, (k * i) / RADIAL).j;
    if (radial.size > 64) radial.clear();
    radial.set(id, t);
  }
  return t;
};

/** Scratch tables for `motionField`, reused between calls. */
interface Scratch {
  w: number;
  h: number;
  re: Float32Array;
  im: Float32Array;
  r: Float32Array;
  th: Float32Array;
  cx: Float32Array;
  cy: Float32Array;
}
let scratch: Scratch | null = null;

const scratchFor = (w: number, h: number): Scratch => {
  if (scratch && scratch.w === w && scratch.h === h) return scratch;
  const r = new Float32Array(w * h);
  const th = new Float32Array(w * h);
  for (let iy = 0; iy < h; iy++) {
    for (let ix = 0; ix < w; ix++) {
      const u = -1 + (2 * (ix + 0.5)) / w;
      const v = -1 + (2 * (iy + 0.5)) / h;
      r[iy * w + ix] = Math.hypot(u, v);
      th[iy * w + ix] = Math.atan2(u, -v);
    }
  }
  scratch = {
    w,
    h,
    re: new Float32Array(w * h),
    im: new Float32Array(w * h),
    r,
    th,
    cx: new Float32Array(4 * w),
    cy: new Float32Array(4 * h),
  };
  return scratch;
};

/**
 * The plate's motion (both parts) on a `w` by `h` grid, from the ringing modes. Returns the
 * shared scratch arrays, valid until the next call.
 */
export const motionField = (
  shape: PlateShape,
  modes: readonly Mode[],
  active: readonly number[],
  re: ArrayLike<number>,
  im: ArrayLike<number>,
  w: number,
  h: number,
): { re: Float32Array; im: Float32Array } => {
  const s = scratchFor(w, h);
  s.re.fill(0);
  s.im.fill(0);
  for (const i of active) {
    const m = modes[i];
    const ar = re[i] ?? 0;
    const ai = im[i] ?? 0;
    if (!m || (ar === 0 && ai === 0)) continue;
    if (shape === "square") {
      // Separable: cos(n pi x) and cos(m pi x) along each axis.
      for (let ix = 0; ix < w; ix++) {
        const x = (ix + 0.5) / w;
        s.cx[ix] = Math.cos(m.n * Math.PI * x);
        s.cx[w + ix] = Math.cos(m.m * Math.PI * x);
      }
      for (let iy = 0; iy < h; iy++) {
        const y = (iy + 0.5) / h;
        s.cy[iy] = Math.cos(m.n * Math.PI * y);
        s.cy[h + iy] = Math.cos(m.m * Math.PI * y);
      }
      const A = m.a * m.scale;
      const B = m.b * m.scale;
      for (let iy = 0; iy < h; iy++) {
        const cny = s.cy[iy]!;
        const cmy = s.cy[h + iy]!;
        for (let ix = 0; ix < w; ix++) {
          const v = A * s.cx[ix]! * cmy + B * s.cx[w + ix]! * cny;
          const o = iy * w + ix;
          s.re[o]! += ar * v;
          s.im[o]! += ai * v;
        }
      }
    } else {
      const t = radialOf(m.n, m.k);
      for (let o = 0; o < w * h; o++) {
        const r = s.r[o]!;
        if (r > 1) continue;
        const x = r * RADIAL;
        const i0 = Math.min(RADIAL - 1, Math.floor(x));
        const j = t[i0]! + (t[i0 + 1]! - t[i0]!) * (x - i0);
        const v = j * Math.cos(m.n * (s.th[o]! - m.turn)) * m.scale;
        s.re[o]! += ar * v;
        s.im[o]! += ai * v;
      }
    }
  }
  return { re: s.re, im: s.im };
};

/**
 * Draw where the plate is still now into `img` (its own size): sand-coloured lines where the
 * motion vanishes (a pixel or two wide, from |w| over its slope), and a dimmer wash wherever the
 * motion is small next to the plate's level, so a blurred figure shows as a smudge. Clear
 * elsewhere and off the plate.
 */
export const drawMotion = (
  img: ImageData,
  shape: PlateShape,
  modes: readonly Mode[],
  active: readonly number[],
  re: ArrayLike<number>,
  im: ArrayLike<number>,
  level: number,
  color: string,
): void => {
  const { width: w, height: h, data } = img;
  const f = motionField(shape, modes, active, re, im, w, h);
  const [cr, cg, cb] = rgb(color);
  const wash = 0.1 * Math.max(1e-6, level);
  const s = scratchFor(w, h);
  const size = (o: number) => Math.hypot(f.re[o]!, f.im[o]!);
  for (let iy = 0; iy < h; iy++) {
    for (let ix = 0; ix < w; ix++) {
      const o = iy * w + ix;
      const k = o * 4;
      data[k] = cr;
      data[k + 1] = cg;
      data[k + 2] = cb;
      if (shape === "round" && s.r[o]! > 1) {
        data[k + 3] = 0;
        continue;
      }
      const a = size(o);
      const gx = (size(iy * w + Math.min(w - 1, ix + 1)) - size(iy * w + Math.max(0, ix - 1))) / 2;
      const gy = (size(Math.min(h - 1, iy + 1) * w + ix) - size(Math.max(0, iy - 1) * w + ix)) / 2;
      const d = a / Math.max(1e-9, Math.hypot(gx, gy));
      const line = Math.min(1, Math.max(0, (1.6 - d) / 1.2));
      const soft = 0.45 * Math.max(0, 1 - a / wash);
      data[k + 3] = Math.round(255 * Math.max(line, soft));
    }
  }
};
