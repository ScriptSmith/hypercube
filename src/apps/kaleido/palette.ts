/**
 * Ink colours. Each hour of the day has four related hues around a centre that moves through the
 * day: blues at night, cool sky and sea colours in the morning, gold at midday, amber and coral in
 * the afternoon, violet in the evening. Neighbouring hours differ only a little, so the day's
 * layers read as one gradient. `rainbow` is eight spread hues instead.
 */

export type ColourMode = "time" | "rainbow";
export type Rgb = readonly [number, number, number];

/** Hue centre (degrees) for each local hour, 0 to 23. */
export const HOUR_HUES: readonly number[] = [
  235, 240, 245, 250, 245, 225, 205, 195, 186, 176, 160, 100, 46, 42, 35, 26, 16, 352, 328, 292,
  280, 268, 256, 246,
];
/** Degrees between neighbouring hues of one hour's palette. */
export const HUE_STEP = 10;
/** Lightness of the four members of a palette, so neighbours differ a little. */
const LIGHTS = [0.58, 0.52, 0.64, 0.55];
/** Dark hues (blues, violets) are lifted towards this luminance so they glow on dark water. */
export const TARGET_LUMA = 0.42;
const RAINBOW_HUES = [0, 30, 52, 125, 178, 205, 255, 300];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** HSL (hue in degrees, s and l 0 to 1) to linear-ish RGB, 0 to 1. */
export const hsl = (h: number, s: number, l: number): Rgb => {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hh < 1
      ? [c, x, 0]
      : hh < 2
        ? [x, c, 0]
        : hh < 3
          ? [0, c, x]
          : hh < 4
            ? [0, x, c]
            : hh < 5
              ? [x, 0, c]
              : [c, 0, x];
  return [clamp01(r + m), clamp01(g + m), clamp01(b + m)];
};

/** Hue in degrees (0 to 360) of an RGB colour; grey gives 0. */
export const hueOf = ([r, g, b]: Rgb): number => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 1e-6) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

export const luma = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * A colour of hue `h`, saturation `s` and lightness `l`, made lighter (up to 0.78) if that's
 * what it takes to reach luminance `target`. Bright hues are never darkened.
 */
export const balanced = (h: number, s: number, l: number, target: number): Rgb => {
  if (luma(hsl(h, s, l)) >= target) return hsl(h, s, l);
  let lo = l;
  let hi = 0.78;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (luma(hsl(h, s, mid)) < target) lo = mid;
    else hi = mid;
  }
  return hsl(h, s, hi);
};

const cache = new Map<string, Rgb[]>();

/** The four colours of `hour` (0 to 23, wrapped), or the rainbow's eight. */
export const paletteFor = (hour: number, mode: ColourMode = "time"): readonly Rgb[] => {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const key = mode === "rainbow" ? "rainbow" : String(h);
  let out = cache.get(key);
  if (!out) {
    out =
      mode === "rainbow"
        ? RAINBOW_HUES.map((hue, i) => balanced(hue, 0.9, LIGHTS[i % 4]!, TARGET_LUMA))
        : LIGHTS.map((l, i) =>
            balanced((HOUR_HUES[h] ?? 0) + (i - 1.5) * HUE_STEP, 0.9, l, TARGET_LUMA * (l / 0.58)),
          );
    cache.set(key, out);
  }
  return out;
};

/** 24-bit integer for an RGB colour, for the wire. */
export const packRgb = ([r, g, b]: Rgb): number =>
  (Math.round(clamp01(r) * 255) << 16) |
  (Math.round(clamp01(g) * 255) << 8) |
  Math.round(clamp01(b) * 255);

export const unpackRgb = (n: number): Rgb => [
  ((n >> 16) & 255) / 255,
  ((n >> 8) & 255) / 255,
  (n & 255) / 255,
];

export const cssRgb = ([r, g, b]: Rgb, alpha = 1): string =>
  `rgba(${Math.round(clamp01(r) * 255)},${Math.round(clamp01(g) * 255)},${Math.round(clamp01(b) * 255)},${alpha})`;

/**
 * Hands out colours in turn, so each new touch takes the next colour of the current palette and
 * people side by side pour different ones.
 */
export interface ColourCycle {
  next(hour: number): Rgb;
  /** The palette in use at `hour`. */
  palette(hour: number): readonly Rgb[];
}

export const createColourCycle = (mode: ColourMode, start = 0): ColourCycle => {
  let i = Math.max(0, Math.floor(start));
  return {
    next(hour) {
      const p = paletteFor(hour, mode);
      const c = p[i % p.length]!;
      i = (i + 1) % 840;
      return c;
    },
    palette: (hour) => paletteFor(hour, mode),
  };
};

/** Smallest angle between two hues, in degrees. */
export const hueDistance = (a: number, b: number): number => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
};
