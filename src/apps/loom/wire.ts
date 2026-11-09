/**
 * Messages between a bank's frames and whichever frame is in charge (the screen, or a bank
 * frame standing in for it). Everything that arrives is checked field by field and dropped
 * whole if anything is out of range, because any page on the public site can join a room it
 * guesses.
 *
 * - `state`: a touch frame's harmonics, to the frame it follows: amplitude and phase in
 *   512ths, and flags (live, held, a person). Up to 20 times a second while a finger is on a
 *   control, about once a second otherwise.
 * - `beacon`: the frame in charge to everyone, about four times a second: the round, the
 *   target, the mode, the match fill, and every harmonic's value with its flags (live, right).
 *   Frames follow the beacon; one that stops for a few seconds has gone.
 */
import { MAX_H, TAU } from "./config";
import type { Term } from "./series";

export const TOPIC = { state: "lm:state", beacon: "lm:beacon" } as const;

export const Q = 512;
export const MAX_POS = 63;
/** Most harmonics one frame carries (a merged frame of up to four panels). */
export const MAX_PER_FRAME = 4;

/** Flags in a `state` entry. */
export const STATE_FLAG = { live: 1, held: 2, person: 4 } as const;
/** Flags per harmonic in a `beacon`. */
export const BEACON_FLAG = { live: 1, ok: 2 } as const;

export const quantAmp = (a: number): number => Math.max(0, Math.min(Q, Math.round(a * Q)));
export const quantPhase = (p: number): number => {
  const q = Math.round(((((p % TAU) + TAU) % TAU) / TAU) * Q);
  return q >= Q ? 0 : q;
};
export const unquantAmp = (q: number): number => q / Q;
export const unquantPhase = (q: number): number => (q / Q) * TAU;

export interface StateEntry {
  k: number;
  a: number;
  ph: number;
  f: number;
}

export interface StateMsg {
  p: number;
  h: StateEntry[];
}

export interface BeaconMsg {
  /** Side of the bank (0 or 1). */
  s: number;
  /** 1 when a screen sends it. */
  c: number;
  r: number;
  /** Target index, or 255 for none (`free`). */
  g: number;
  /** 0 play, 1 weave, 2 rest. */
  m: number;
  /** Seconds in the mode, hundredths, capped. */
  t: number;
  /** Match fill, percent. */
  f: number;
  /** Bands woven so far, modulo 65536. */
  w: number;
  /** 1 when someone took part in this round (auto harmonics ease faster). */
  p: number;
  /** Per harmonic: amplitude, phase (512ths) and flags (live, right). */
  v: [number, number, number][];
}

const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const encodeState = (m: StateMsg): { p: number; h: number[][] } => ({
  p: Math.max(0, Math.min(MAX_POS, Math.round(m.p))),
  h: m.h
    .slice(0, MAX_PER_FRAME)
    .map((e) => [
      Math.max(1, Math.min(MAX_H, Math.round(e.k))),
      Math.max(0, Math.min(Q, Math.round(e.a))),
      Math.max(0, Math.min(Q - 1, Math.round(e.ph))),
      Math.max(0, Math.min(7, Math.round(e.f))),
    ]),
});

export const decodeState = (d: unknown): StateMsg | null => {
  if (!isObject(d)) return null;
  const { p, h } = d;
  if (!int(p, 0, MAX_POS) || !Array.isArray(h) || h.length < 1 || h.length > MAX_PER_FRAME) {
    return null;
  }
  const out: StateEntry[] = [];
  for (const e of h) {
    if (!Array.isArray(e) || e.length !== 4) return null;
    const [k, a, ph, f] = e as unknown[];
    if (!int(k, 1, MAX_H) || !int(a, 0, Q) || !int(ph, 0, Q - 1) || !int(f, 0, 7)) return null;
    out.push({ k, a, ph, f });
  }
  return { p, h: out };
};

export const encodeBeacon = (m: BeaconMsg): BeaconMsg => ({
  s: m.s === 1 ? 1 : 0,
  c: m.c ? 1 : 0,
  r: Math.max(0, Math.min(65535, Math.round(m.r))),
  g: Math.max(0, Math.min(255, Math.round(m.g))),
  m: Math.max(0, Math.min(2, Math.round(m.m))),
  t: Math.max(0, Math.min(65535, Math.round(m.t))),
  f: Math.max(0, Math.min(100, Math.round(m.f))),
  w: Math.max(0, Math.min(65535, Math.round(m.w))),
  p: m.p ? 1 : 0,
  v: m.v
    .slice(0, MAX_H)
    .map(([a, ph, fl]) => [
      Math.max(0, Math.min(Q, Math.round(a))),
      Math.max(0, Math.min(Q - 1, Math.round(ph))),
      Math.max(0, Math.min(3, Math.round(fl))),
    ]),
});

export const decodeBeacon = (d: unknown): BeaconMsg | null => {
  if (!isObject(d)) return null;
  const { s, c, r, g, m, t, f, w, p, v } = d;
  if (!int(s, 0, 1) || !int(c, 0, 1) || !int(r, 0, 65535) || !int(g, 0, 255)) return null;
  if (!int(m, 0, 2) || !int(t, 0, 65535) || !int(f, 0, 100) || !int(w, 0, 65535)) return null;
  if (!int(p, 0, 1)) return null;
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_H) return null;
  const out: [number, number, number][] = [];
  for (const e of v) {
    if (!Array.isArray(e) || e.length !== 3) return null;
    const [a, ph, fl] = e as unknown[];
    if (!int(a, 0, Q) || !int(ph, 0, Q - 1) || !int(fl, 0, 3)) return null;
    out.push([a, ph, fl]);
  }
  return { s, c, r, g, m, t, f, w, p, v: out };
};

export const termOf = (a: number, ph: number): Term => ({
  amp: unquantAmp(a),
  phase: unquantPhase(ph),
});
