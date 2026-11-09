/**
 * Messages in a bank. Everything that arrives is checked field by field and dropped whole if
 * anything is out of range, because any page on the public site can join a room it guesses.
 *
 * - `drop`: the screen to one touch frame, when an item starts its last free fall out of the
 *   screen's drop tube: which inlet, which item, and the fall itself (start time on the shared
 *   clock, height above the frame's top edge, speed, gravity and drag), so the frame draws the
 *   same fall the screen draws and it carries straight on across the bezel.
 * - `beacon`: the screen to everyone, four times a second: its side, the pace, the park's size.
 * - `load`: a touch frame to its screen once a second: items in play, room for more, items
 *   waiting in its funnels, and whether anyone (or a bot) is playing.
 * - `sorted`: a touch frame to its screen for each item that goes in a bin, right or wrong.
 * - `full`: a touch frame to its screen when a full bin starts rising out of its top edge.
 */
import { BIN_KINDS, ITEMS } from "./items";
import { THING_KINDS } from "./park";

export const TOPIC = {
  drop: "rr:drop",
  beacon: "rr:beacon",
  load: "rr:load",
  sorted: "rr:sorted",
  full: "rr:full",
} as const;

export interface DropMsg {
  /** Inlet index within the frame and its place across the frame in thousandths. */
  i: number;
  u: number;
  k: number;
  id: number;
  /** Fall start, shared clock ms; height above the top edge and speeds, frame venue px. */
  t0: number;
  y0: number;
  vy: number;
  g: number;
  tau: number;
  a: number;
  w: number;
}

export interface BeaconMsg {
  s: number;
  /** Pace in thousandths, park size, and 1 while nobody below is playing. */
  p: number;
  n: number;
  q: number;
}

export interface LoadMsg {
  p: number;
  n: number;
  c: number;
  q: number;
  a: number;
}

export interface SortedMsg {
  k: number;
  b: number;
  r: number;
  h: number;
}

export interface FullMsg {
  /** Bin kind and product (index, or -1 for rubbish). */
  b: number;
  m: number;
  /** Centre and width across the frame, thousandths; height in frame venue px. */
  u: number;
  w: number;
  h: number;
  /** When its centre crosses the frame's top edge (shared clock ms), rising this fast (px/s). */
  t: number;
  v: number;
}

const obj = (d: unknown): Record<string, unknown> | null =>
  typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : null;

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;

const int = (v: unknown, min: number, max: number): number | null => {
  const n = num(v, min, max);
  return n !== null && Number.isInteger(n) ? n : null;
};

const T_MAX = 1e14;
const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

const all = <T>(m: Record<string, number | null>): T | null => {
  for (const v of Object.values(m)) if (v === null) return null;
  return m as T;
};

export const encodeDrop = (m: DropMsg): DropMsg => ({
  i: m.i,
  u: Math.round(m.u),
  k: m.k,
  id: m.id,
  t0: Math.round(m.t0),
  y0: r1(m.y0),
  vy: r1(m.vy),
  g: r1(m.g),
  tau: r3(m.tau),
  a: r3(m.a),
  w: r3(m.w),
});

export const decodeDrop = (data: unknown): DropMsg | null => {
  const d = obj(data);
  if (!d) return null;
  return all<DropMsg>({
    i: int(d.i, 0, 7),
    u: int(d.u, 0, 1000),
    k: int(d.k, 0, ITEMS.length - 1),
    id: int(d.id, 0, 0x7fffffff),
    t0: num(d.t0, 0, T_MAX),
    y0: num(d.y0, 0, 40_000),
    vy: num(d.vy, -10_000, 10_000),
    g: num(d.g, 1, 100_000),
    tau: num(d.tau, 0.05, 10),
    a: num(d.a, -10, 10),
    w: num(d.w, -40, 40),
  });
};

export const encodeBeacon = (m: BeaconMsg): BeaconMsg => ({
  s: m.s,
  p: Math.round(m.p),
  n: m.n,
  q: m.q,
});

export const decodeBeacon = (data: unknown): BeaconMsg | null => {
  const d = obj(data);
  if (!d) return null;
  return all<BeaconMsg>({
    s: int(d.s, 0, 1),
    p: int(d.p, 0, 1000),
    n: int(d.n, 0, 64),
    q: int(d.q, 0, 1),
  });
};

export const decodeLoad = (data: unknown): LoadMsg | null => {
  const d = obj(data);
  if (!d) return null;
  return all<LoadMsg>({
    p: int(d.p, 0, 63),
    n: int(d.n, 0, 500),
    c: int(d.c, 1, 500),
    q: int(d.q, 0, 500),
    a: int(d.a, 0, 1),
  });
};

export const decodeSorted = (data: unknown): SortedMsg | null => {
  const d = obj(data);
  if (!d) return null;
  return all<SortedMsg>({
    k: int(d.k, 0, ITEMS.length - 1),
    b: int(d.b, 0, BIN_KINDS.length - 1),
    r: int(d.r, 0, 1),
    h: int(d.h, 0, 1),
  });
};

export const encodeFull = (m: FullMsg): FullMsg => ({
  b: m.b,
  m: m.m,
  u: Math.round(m.u),
  w: Math.round(m.w),
  h: r1(m.h),
  t: Math.round(m.t),
  v: r1(m.v),
});

export const decodeFull = (data: unknown): FullMsg | null => {
  const d = obj(data);
  if (!d) return null;
  return all<FullMsg>({
    b: int(d.b, 0, BIN_KINDS.length - 1),
    m: int(d.m, -1, THING_KINDS.length - 1),
    u: int(d.u, 0, 1000),
    w: int(d.w, 1, 1000),
    h: num(d.h, 10, 5000),
    t: num(d.t, 0, T_MAX),
    v: num(d.v, 10, 20_000),
  });
};
