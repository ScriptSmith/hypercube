/**
 * Messages between a bank's touch frames and its screen. Everything that arrives is checked
 * field by field and dropped whole if anything is out of range or of the wrong type, because any
 * page on the public site can join a room it guesses.
 *
 * - `eye`: a touch frame's eye state, to the screen, when it changes (at most 10 times a
 *   second) and about once a second otherwise. Numbers are integers: lengths in hundredths of
 *   a millimetre, the light and strength sliders in hundredths.
 * - `beacon`: the screen to everyone, four times a second, so frames know where to send.
 */
import type { ConditionId } from "./captions";
import { type Correction, CONDITION_ORDER, type EyeState, RANGE } from "./model";

export const TOPIC = { eye: "ey:eye", beacon: "ey:beacon" } as const;

export const MAX_POS = 63;
export const CORRECTIONS: readonly Correction[] = [
  "none",
  "glasses",
  "contact",
  "reading",
  "newLens",
  "hardLens",
];
export const FLAG = { person: 1, held: 2 } as const;

export interface EyeMsg {
  /** Position in the bank (the screen uses the roster's, not this). */
  p: number;
  /** Condition, an index into CONDITION_ORDER. */
  c: number;
  /** Axial length, hundredths of a mm. */
  L: number;
  /** Corneal radius, hundredths of a mm. */
  r: number;
  a: number;
  /** Light slider, hundredths. */
  l: number;
  /** 1 looking near, 0 far. */
  n: number;
  /** Correction, an index into CORRECTIONS. */
  x: number;
  /** Strength, hundredths. */
  s: number;
  t: number;
  f: number;
}

export interface BeaconMsg {
  /** Side of the bank (0 or 1). */
  s: number;
}

const LIMITS = {
  p: [0, MAX_POS],
  c: [0, CONDITION_ORDER.length - 1],
  L: [Math.round(RANGE.length[0] * 100), Math.round(RANGE.length[1] * 100)],
  r: [Math.round(RANGE.radius[0] * 100), Math.round(RANGE.radius[1] * 100)],
  a: [RANGE.age[0], RANGE.age[1]],
  l: [0, 100],
  n: [0, 1],
  x: [0, CORRECTIONS.length - 1],
  s: [0, 100],
  t: [0, 1],
  f: [0, 3],
} as const satisfies Record<keyof EyeMsg, readonly [number, number]>;

const KEYS = Object.keys(LIMITS) as (keyof EyeMsg)[];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

const clampInt = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo)));

export const encodeEye = (s: EyeState, pos: number, flags: number): EyeMsg => {
  const m: EyeMsg = {
    p: pos,
    c: Math.max(0, CONDITION_ORDER.indexOf(s.condition)),
    L: s.length * 100,
    r: s.radius * 100,
    a: s.age,
    l: s.light * 100,
    n: s.looking === "near" ? 1 : 0,
    x: Math.max(0, CORRECTIONS.indexOf(s.correction)),
    s: s.strength * 100,
    t: s.toggle,
    f: flags,
  };
  for (const k of KEYS) m[k] = clampInt(m[k], LIMITS[k][0], LIMITS[k][1]);
  return m;
};

export const decodeEye = (d: unknown): EyeMsg | null => {
  if (!isObject(d)) return null;
  const out = {} as EyeMsg;
  for (const k of KEYS) {
    const v = d[k];
    if (!int(v, LIMITS[k][0], LIMITS[k][1])) return null;
    out[k] = v;
  }
  return out;
};

export const stateOf = (m: EyeMsg): EyeState => ({
  condition: CONDITION_ORDER[m.c] as ConditionId,
  length: m.L / 100,
  radius: m.r / 100,
  age: m.a,
  light: m.l / 100,
  looking: m.n === 1 ? "near" : "far",
  correction: CORRECTIONS[m.x] ?? "none",
  strength: m.s / 100,
  toggle: m.t === 1 ? 1 : 0,
});

/** True when two messages carry the same eye (flags and position aside). */
export const sameEye = (a: EyeMsg, b: EyeMsg): boolean =>
  a.c === b.c &&
  a.L === b.L &&
  a.r === b.r &&
  a.a === b.a &&
  a.l === b.l &&
  a.n === b.n &&
  a.x === b.x &&
  a.s === b.s &&
  a.t === b.t;

export const encodeBeacon = (m: BeaconMsg): BeaconMsg => ({ s: m.s === 1 ? 1 : 0 });

export const decodeBeacon = (d: unknown): BeaconMsg | null => {
  if (!isObject(d)) return null;
  return int(d.s, 0, 1) ? { s: d.s } : null;
};
