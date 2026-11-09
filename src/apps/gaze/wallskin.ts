/**
 * The wall's skin tones: a slow cycle through human skin colours from very light to very dark.
 *
 * Skin colour is measured as CIELAB and classed by its individual typology angle,
 * ITA = atan((L* - 50) / b*), from above 55 degrees (very light) to below -30 (dark). The tones
 * here are our own, spaced evenly in ITA from 66 to -66 degrees, with b* (yellowness) and a*
 * (redness) at typical values for each: both highest in the middle of the range and lower at
 * the ends. Each tone is held for the same time and the cycle visits every tone once, in an
 * order that steps between near neighbours, so no tone is first, home or held longer than the
 * others. It starts at a tone chosen at random.
 */
import type { Rng } from "../../core/types";

export const SKIN = {
  /** Tones, evenly spaced in ITA from `itaHigh` to `itaLow`, degrees. */
  tones: 8,
  itaHigh: 66,
  itaLow: -66,
  /** Seconds each tone is held, and spent blending into the next. */
  hold: 50,
  blend: 25,
};

/** The wall's paint when it isn't skin: a dark slate, linear. */
export const SLATE: [number, number, number] = [0.064, 0.068, 0.08];

export interface Lab {
  l: number;
  a: number;
  b: number;
}

/** A tone at ITA `ita` degrees. */
export const toneAt = (ita: number): Lab => {
  const k = ita / 60;
  const b = 14 + 6 * (1 - k * k);
  const a = 9 + 3 * (1 - k * k);
  return { l: 50 + b * Math.tan((ita * Math.PI) / 180), a, b };
};

export const itaOf = (c: Lab): number => (Math.atan2(c.l - 50, c.b) * 180) / Math.PI;

/** The tones, lightest first. */
export const SKIN_TONES: readonly Lab[] = Array.from({ length: SKIN.tones }, (_, i) =>
  toneAt(SKIN.itaHigh + ((SKIN.itaLow - SKIN.itaHigh) * i) / (SKIN.tones - 1)),
);

/**
 * The order the cycle visits them: every other tone going darker, then the rest coming back,
 * so each step is between near neighbours and each tone comes once.
 */
export const SKIN_ORDER: readonly number[] = (() => {
  const n = SKIN.tones;
  const out: number[] = [];
  for (let i = 0; i < n; i += 2) out.push(i);
  for (let i = n - 1 - (n % 2 === 0 ? 0 : 1); i > 0; i -= 2) out.push(i);
  return out;
})();

const finv = (t: number) => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) ** 2 * (t - 4 / 29));

/** CIELAB (D65) to linear sRGB, clamped to 0 to 1. */
export const labToLinear = (c: Lab): [number, number, number] => {
  const fy = (c.l + 16) / 116;
  const x = 0.95047 * finv(fy + c.a / 500);
  const y = finv(fy);
  const z = 1.08883 * finv(fy - c.b / 200);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return [
    clamp(3.2404542 * x - 1.5371385 * y - 0.4985314 * z),
    clamp(-0.969266 * x + 1.8760108 * y + 0.041556 * z),
    clamp(0.0556434 * x - 0.2040259 * y + 1.0572252 * z),
  ];
};

export interface SkinCycle {
  /** The tone held or being left, and the one coming, as indices into `SKIN_TONES`. */
  readonly from: number;
  readonly to: number;
  /** How far into the blend, 0 to 1. */
  readonly mix: number;
  /** The colour now, linear. */
  readonly colour: readonly [number, number, number];
  readonly lab: Lab;
  step(dt: number): void;
}

export const createSkinCycle = (rng: Rng): SkinCycle => {
  const period = SKIN.hold + SKIN.blend;
  let place = Math.floor(rng.next() * SKIN_ORDER.length);
  let t = rng.range(0, SKIN.hold);
  let mix = 0;
  let lab: Lab = SKIN_TONES[SKIN_ORDER[place]!]!;
  let colour = labToLinear(lab);
  const update = () => {
    const a = SKIN_TONES[SKIN_ORDER[place]!]!;
    const b = SKIN_TONES[SKIN_ORDER[(place + 1) % SKIN_ORDER.length]!]!;
    const x = Math.max(0, (t - SKIN.hold) / SKIN.blend);
    mix = x * x * (3 - 2 * x);
    lab = { l: a.l + (b.l - a.l) * mix, a: a.a + (b.a - a.a) * mix, b: a.b + (b.b - a.b) * mix };
    colour = labToLinear(lab);
  };
  update();
  return {
    get from() {
      return SKIN_ORDER[place]!;
    },
    get to() {
      return SKIN_ORDER[(place + 1) % SKIN_ORDER.length]!;
    },
    get mix() {
      return mix;
    },
    get colour() {
      return colour;
    },
    get lab() {
      return lab;
    },
    step(dt) {
      t += dt;
      while (t >= period) {
        t -= period;
        place = (place + 1) % SKIN_ORDER.length;
      }
      update();
    },
  };
};
