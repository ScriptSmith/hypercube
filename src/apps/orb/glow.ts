/**
 * The light inside the orb: a few soft glows wandering through the smoke, each drifting from
 * one colour to the next every half minute or so and breathing slowly. Cool glows are deep
 * blue, teal and violet with now and then a gold; warm ones are gold, rose and plum with now
 * and then a teal. Positions are in ball units (centre at the origin, radius 1). Nothing here
 * draws.
 */
export type GlowMode = "cool" | "warm";
export type Rgb = [number, number, number];

export const LIGHTS = 3;
/** Seconds each light holds a colour before drifting to the next. */
export const SEGMENT_S = 32;
/** The last part of a segment spent turning into the next colour. */
const BLEND = 0.45;
/** Chance a segment takes the palette's rare colour. */
export const RARE_CHANCE = 1 / 7;
/** Farthest a light wanders from the centre, ball units. */
export const REACH = 0.62;

const linear = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
};

export const PALETTES: Record<GlowMode, { main: readonly Rgb[]; rare: Rgb }> = {
  cool: {
    main: ["#2343d8", "#0fa3a6", "#7b3fe0", "#3a2fb8", "#2380d8"].map(linear),
    rare: linear("#e3b24e"),
  },
  warm: {
    main: ["#e0a548", "#d8648a", "#a24fc0", "#e89a78", "#c9873c"].map(linear),
    rare: linear("#14a6a2"),
  },
};

export interface Light {
  pos: [number, number, number];
  colour: Rgb;
  /** Multiplies the colour, around 1. */
  power: number;
}

/** A hash of integers to [0, 1). */
export const hash = (a: number, b: number, c: number): number => {
  let h =
    Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/** The colour light `k` holds through segment `j`. */
export const segmentColour = (mode: GlowMode, seed: number, k: number, j: number): Rgb => {
  const p = PALETTES[mode];
  if (hash(seed, k * 7919 + 1, j) < RARE_CHANCE) return p.rare;
  return p.main[Math.floor(hash(seed, k * 7919 + 2, j) * p.main.length)]!;
};

const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/** Each light's own slow path and breathing, from the seed. */
const motionOf = (seed: number, k: number) => {
  const r = (i: number) => hash(seed, k * 31 + 3, i);
  return {
    rate: [0.031 + 0.03 * r(0), 0.023 + 0.025 * r(1), 0.027 + 0.03 * r(2)],
    phase: [r(3) * 6.283, r(4) * 6.283, r(5) * 6.283],
    breath: 8 + 5 * r(6),
    breathPhase: r(7) * 6.283,
    // Lights start their colour segments at different times.
    offset: r(8) * SEGMENT_S,
  };
};

export interface Glow {
  /** The lights at `t`, written into `out` (made if not given). */
  at(t: number, out?: Light[]): Light[];
}

export const createGlow = (mode: GlowMode, seed: number): Glow => {
  const motions = Array.from({ length: LIGHTS }, (_, k) => motionOf(seed, k));
  return {
    at(t, out = []) {
      for (let k = 0; k < LIGHTS; k++) {
        const m = motions[k]!;
        const light = (out[k] ??= { pos: [0, 0, 0], colour: [0, 0, 0], power: 1 });
        const x = Math.sin(t * m.rate[0]! + m.phase[0]!);
        const y = Math.sin(t * m.rate[1]! + m.phase[1]!) * 0.7;
        const z = Math.cos(t * m.rate[2]! + m.phase[2]!);
        const len = Math.max(1, Math.hypot(x, y, z));
        light.pos[0] = (REACH * x) / len;
        light.pos[1] = (REACH * y) / len;
        light.pos[2] = (REACH * z) / len;
        const s = (t + m.offset) / SEGMENT_S;
        const j = Math.floor(s);
        const f = smooth((s - j - (1 - BLEND)) / BLEND);
        const a = segmentColour(mode, seed, k, j);
        const b = segmentColour(mode, seed, k, j + 1);
        for (let i = 0; i < 3; i++) light.colour[i] = a[i]! + (b[i]! - a[i]!) * f;
        light.power = 0.85 + 0.15 * Math.sin((t * 6.283) / m.breath + m.breathPhase);
      }
      out.length = LIGHTS;
      return out;
    },
  };
};
