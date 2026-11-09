/**
 * Messages between a bank's touch frames and its screen. Everything that arrives is checked
 * field by field and dropped whole if anything is out of range, because any page on the
 * public site can join a room it guesses.
 *
 * - `angle`: a touch frame's angle, to the screen: in 4096ths of a turn, with flags (its own
 *   angle rather than the bank's slow turn; a finger down; a person recently) and the bank
 *   size it counts its place in the wave from. 20 times a second while it moves by itself or
 *   under a finger, about once a second otherwise, and at once when the flags change.
 * - `beacon`: the screen to everyone, four times a second, so frames know where to send.
 */
import { TAU } from "./config";

export const TOPIC = { angle: "tr:angle", beacon: "tr:beacon" } as const;

/** Steps per turn. 4096 ends up within a tenth of a degree. */
export const Q = 4096;
export const MAX_POS = 63;
export const MAX_COUNT = 64;

export const FLAG = { own: 1, held: 2, person: 4 } as const;

export interface AngleMsg {
  /** Position in the bank (the screen uses the roster's, not this). */
  p: number;
  /** Angle, 0 to Q (Q is a full turn, 360°). */
  a: number;
  f: number;
  /** Bank size the frame counts its place in the wave from. */
  n: number;
}

export interface BeaconMsg {
  /** Side of the bank (0 or 1). */
  s: number;
}

export const quantAngle = (theta: number): number => {
  if (!Number.isFinite(theta)) return 0;
  if (theta >= TAU) return Q;
  const w = ((theta % TAU) + TAU) % TAU;
  const q = Math.round((w / TAU) * Q);
  return Math.min(Q, q);
};

export const unquantAngle = (q: number): number => (q / Q) * TAU;

const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const clampInt = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo)));

export const encodeAngle = (m: AngleMsg): AngleMsg => ({
  p: clampInt(m.p, 0, MAX_POS),
  a: clampInt(m.a, 0, Q),
  f: clampInt(m.f, 0, 7),
  n: clampInt(m.n, 1, MAX_COUNT),
});

export const decodeAngle = (d: unknown): AngleMsg | null => {
  if (!isObject(d)) return null;
  const { p, a, f, n } = d;
  if (!int(p, 0, MAX_POS) || !int(a, 0, Q) || !int(f, 0, 7) || !int(n, 1, MAX_COUNT)) return null;
  return { p, a, f, n };
};

export const encodeBeacon = (m: BeaconMsg): BeaconMsg => ({ s: m.s === 1 ? 1 : 0 });

export const decodeBeacon = (d: unknown): BeaconMsg | null => {
  if (!isObject(d)) return null;
  return int(d.s, 0, 1) ? { s: d.s } : null;
};
