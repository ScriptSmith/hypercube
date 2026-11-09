/**
 * Messages within a bank. Everything that arrives is checked field by field and dropped whole if
 * anything is out of range, because any page on the public site can join a room it guesses.
 *
 * - `in`: a touch frame to the leader, one input: a dial turn (dial index and angle, at most 20
 *   a second while a finger turns it), a "first" button, or a shape button. Numbered, so the
 *   leader can say which it has applied.
 * - `state`: the leader to everyone: the shape family, whether the bank is on its slow turn (the
 *   same everywhere from the shared clock) or turned by hand, the orientation as a quaternion
 *   pair, and the last input number it applied from each frame that sent one lately. Up to 15 a
 *   second while it changes, about once a second otherwise.
 * - `cut`: a touch frame to the screen, where its slice is: on change (at most 15 a second) and
 *   every two seconds.
 */
import type { Quat } from "./rot";

export const TOPIC = { input: "fd:in", state: "fd:state", cut: "fd:cut" } as const;

/** Steps per turn for dial angles; one message carries at most one turn. */
export const ANGLE_Q = 16384;
/** Quaternion components in 32767ths. */
export const QUAT_Q = 32767;
/** Lever positions in 4096ths of half its travel. */
export const CUT_Q = 4096;
export const MAX_SEQ = 2 ** 31 - 1;
export const MAX_POS = 63;
export const MAX_ACKS = 16;

export const CUT_FLAG = { held: 1, person: 2, moved: 4 } as const;

export type InputMsg =
  | { s: number; h: number; d: number; a: number }
  | { s: number; h: number; o: number }
  | { s: number; h: number; f: number };

export interface StateMsg {
  /** 0 the slow turn, 1 turned by hand. */
  m: number;
  f: number;
  /** a then b, each in QUAT_Q ths. */
  r: number[];
  /** [pos, seq] of the last input applied from each recent sender. */
  k: [number, number][];
}

export interface CutMsg {
  p: number;
  c: number;
  f: number;
}

const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const clampInt = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : 0)));

export const quantAngle = (a: number): number =>
  clampInt((a / (Math.PI * 2)) * ANGLE_Q, -ANGLE_Q, ANGLE_Q);
export const unquantAngle = (q: number): number => (q / ANGLE_Q) * Math.PI * 2;

export const quantCut = (t: number): number => clampInt(t * CUT_Q, -CUT_Q, CUT_Q);
export const unquantCut = (q: number): number => q / CUT_Q;

export const encodeQuat = (a: Quat, b: Quat): number[] =>
  [...a, ...b].map((x) => clampInt(x * QUAT_Q, -QUAT_Q, QUAT_Q));

/** The pair back as unit quaternions, or null if either is too short to trust. */
export const decodeQuat = (r: readonly number[]): { a: Quat; b: Quat } | null => {
  if (r.length !== 8) return null;
  const a = r.slice(0, 4).map((x) => x / QUAT_Q) as Quat;
  const b = r.slice(4, 8).map((x) => x / QUAT_Q) as Quat;
  const na = Math.hypot(...a);
  const nb = Math.hypot(...b);
  if (na < 0.5 || nb < 0.5) return null;
  return { a: a.map((x) => x / na) as Quat, b: b.map((x) => x / nb) as Quat };
};

export const encodeInput = (m: InputMsg): InputMsg => {
  const s = clampInt(m.s, 0, MAX_SEQ);
  const h = m.h ? 1 : 0;
  if ("d" in m) return { s, h, d: clampInt(m.d, 0, 2), a: clampInt(m.a, -ANGLE_Q, ANGLE_Q) };
  if ("o" in m) return { s, h, o: clampInt(m.o, 0, 3) };
  return { s, h, f: clampInt(m.f, 0, 3) };
};

export const decodeInput = (d: unknown): InputMsg | null => {
  if (!isObject(d)) return null;
  const { s, h } = d;
  if (!int(s, 0, MAX_SEQ) || !int(h, 0, 1)) return null;
  const kinds = ["d", "o", "f"].filter((k) => k in d);
  if (kinds.length !== 1) return null;
  if ("d" in d) {
    if (!int(d.d, 0, 2) || !int(d.a, -ANGLE_Q, ANGLE_Q)) return null;
    return { s, h, d: d.d, a: d.a };
  }
  if ("o" in d) return int(d.o, 0, 3) ? { s, h, o: d.o } : null;
  return int(d.f, 0, 3) ? { s, h, f: d.f } : null;
};

export const encodeState = (m: StateMsg): StateMsg => ({
  m: m.m ? 1 : 0,
  f: clampInt(m.f, 0, 3),
  r: m.r.slice(0, 8).map((x) => clampInt(x, -QUAT_Q, QUAT_Q)),
  k: m.k.slice(0, MAX_ACKS).map(([p, s]) => [clampInt(p, 0, MAX_POS), clampInt(s, 0, MAX_SEQ)]),
});

export const decodeState = (d: unknown): StateMsg | null => {
  if (!isObject(d)) return null;
  const { m, f, r, k } = d;
  if (!int(m, 0, 1) || !int(f, 0, 3)) return null;
  if (!Array.isArray(r) || r.length !== 8 || !r.every((x) => int(x, -QUAT_Q, QUAT_Q))) return null;
  if (!Array.isArray(k) || k.length > MAX_ACKS) return null;
  const acks: [number, number][] = [];
  for (const e of k) {
    if (!Array.isArray(e) || e.length !== 2) return null;
    const [p, s] = e as unknown[];
    if (!int(p, 0, MAX_POS) || !int(s, 0, MAX_SEQ)) return null;
    acks.push([p, s]);
  }
  if (!decodeQuat(r as number[])) return null;
  return { m, f, r: r as number[], k: acks };
};

export const encodeCut = (m: CutMsg): CutMsg => ({
  p: clampInt(m.p, 0, MAX_POS),
  c: clampInt(m.c, -CUT_Q, CUT_Q),
  f: clampInt(m.f, 0, 7),
});

export const decodeCut = (d: unknown): CutMsg | null => {
  if (!isObject(d)) return null;
  const { p, c, f } = d;
  if (!int(p, 0, MAX_POS) || !int(c, -CUT_Q, CUT_Q) || !int(f, 0, 7)) return null;
  return { p, c, f };
};
