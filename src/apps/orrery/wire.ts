/**
 * Messages within a bank. Everything that arrives is checked field by field and dropped whole if
 * anything is out of range, because any page on the public site can join a room it guesses.
 *
 * - `claim`: a frame's control, to the leader: which knob, its value, whether a finger still
 *   holds it, when the touch began and whether a bot made it.
 * - `state`: the leader to everyone: the mode, the date, the time of day, the tilt, the flat
 *   orbit, the speed, and how long since anyone touched.
 */
import { KNOBS, type KnobId, type Mode, type Shared } from "./keeper";

export const TOPIC = { claim: "or:claim", state: "or:state" } as const;

/** Messages stamped further than this from the receiver's clock are refused. */
export const MAX_SKEW_MS = 10_000;
const MAX_DAY = 1e7;
const MAX_QUIET = 9_999_999;
const MODES: readonly Mode[] = ["tour", "manual", "ease"];

export interface ClaimMsg {
  /** Knob, an index into KNOBS. */
  k: number;
  a: number;
  b: number;
  on: boolean;
  /** Shared clock ms the touch began. */
  s: number;
  /** Shared clock ms sent. */
  t: number;
  bot: boolean;
}

export interface StateMsg {
  /** Mode, an index into MODES. */
  m: number;
  d: number;
  h: number;
  /** Tilt, degrees. */
  i: number;
  f: 0 | 1;
  p: number;
  q: number;
  t: number;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const num = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const round = (v: number, step: number) => Math.round(v / step) * step;

/** Is a knob's value in range? */
export const validValue = (knob: KnobId, a: number, b: number): boolean => {
  switch (knob) {
    case "time":
      return num(a, -MAX_DAY, MAX_DAY) && num(b, 0, 24);
    case "tilt":
      return num(a, 0, 90) && b === 0;
    case "flat":
      return (a === 0 || a === 1) && b === 0;
    case "speed":
      return int(a, 0, 2) && b === 0;
  }
};

export const encodeClaim = (
  knob: KnobId,
  a: number,
  b: number,
  held: boolean,
  since: number,
  clock: number,
  bot: boolean,
): ClaimMsg => ({
  k: KNOBS.indexOf(knob),
  a: knob === "time" ? round(a, 1e-5) : knob === "tilt" ? round(a, 0.01) : Math.round(a),
  b: knob === "time" ? Math.min(24, Math.max(0, round(b, 1e-4))) : 0,
  on: held,
  s: Math.round(Math.min(since, clock)),
  t: Math.round(clock),
  bot,
});

export const decodeClaim = (
  data: unknown,
  clock: number,
): { knob: KnobId; a: number; b: number; held: boolean; since: number; bot: boolean } | null => {
  const d = obj(data);
  if (!d) return null;
  const { k, a, b, on, s, t, bot } = d;
  if (!int(k, 0, KNOBS.length - 1) || typeof on !== "boolean" || typeof bot !== "boolean") {
    return null;
  }
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (!num(s, 0, Number.MAX_SAFE_INTEGER) || !num(t, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (s > t + 1 || Math.abs(t - clock) > MAX_SKEW_MS) return null;
  const knob = KNOBS[k]!;
  if (!validValue(knob, a, b)) return null;
  return { knob, a, b, held: on, since: s, bot };
};

export const encodeState = (s: Shared, clock: number): StateMsg => ({
  m: MODES.indexOf(s.mode),
  d: round(s.sky.day, 1e-5),
  h: Math.min(24, Math.max(0, round(s.sky.hour, 1e-4))),
  i: Math.min(90, Math.max(0, round(s.sky.tilt, 0.01))),
  f: s.sky.flat ? 1 : 0,
  p: Math.min(2, Math.max(0, Math.round(s.sky.speed))),
  q: Math.min(MAX_QUIET, Math.max(0, Math.round(s.quiet))),
  t: Math.round(clock),
});

export const decodeState = (data: unknown, clock: number): (Shared & { t: number }) | null => {
  const d = obj(data);
  if (!d) return null;
  const { m, h, i, f, p, q, t } = d;
  const day = d.d;
  if (!int(m, 0, MODES.length - 1) || !num(day, -MAX_DAY, MAX_DAY) || !num(h, 0, 24)) return null;
  if (!num(i, 0, 90) || (f !== 0 && f !== 1) || !int(p, 0, 2) || !int(q, 0, MAX_QUIET)) return null;
  if (!num(t, 0, Number.MAX_SAFE_INTEGER) || Math.abs(t - clock) > MAX_SKEW_MS) return null;
  return {
    mode: MODES[m]!,
    sky:
      h >= 24
        ? { day: day + 1, hour: 0, tilt: i, flat: f === 1, speed: p }
        : { day, hour: h, tilt: i, flat: f === 1, speed: p },
    quiet: q,
    t,
  };
};
