/**
 * Messages in a bank. Everything that arrives is checked field by field and dropped whole if
 * anything is out of range, because any page on the public site can join a room it guesses.
 *
 * - `mh:part`, panel to the screen on its side: one finished part. Its id is the frame plus a
 *   sequence number that only grows (it starts from the wall clock, so a reloaded panel carries
 *   on above its old numbers); the screen keeps each frame's highest id and ignores anything at
 *   or below it.
 * - `mh:build`, screen to its group, about once a second and on change: the build's id, theme,
 *   size, progress, times on the shared clock, phase and every column's order.
 * - `mh:beat`, panel to its screen once a second: which workstations are being worked and how
 *   many slots were used in the last minute.
 */
import { THEME_IDS, type ThemeId } from "./config";
import type { Phase } from "./build";

export const TOPIC = { part: "mh:part", build: "mh:build", beat: "mh:beat" } as const;

export const MAX_POS = 64;
export const MAX_COLUMNS = 64;
/** Workstations on one touch frame. */
export const MAX_STATIONS = 16;
const MAX_KIND = 7;
const T_MAX = 1e14;
const SEQ_MAX = Number.MAX_SAFE_INTEGER;
const PHASES: readonly Phase[] = ["building", "finishing", "alive"];

export interface PartMsg {
  /** Sequence number, unique and rising per frame. */
  i: number;
  /** Sender's position in the bank and the workstation on it. */
  p: number;
  w: number;
  /** 0 the child slot, 1 the adult slot. */
  l: number;
  /** Part kind in the theme of build `b`. */
  k: number;
  b: number;
  /** Station colour index, or -1 for a bot's part. */
  c: number;
  /** Fraction across the sender where the part leaves its top edge, and when (shared clock). */
  u: number;
  t: number;
}

export interface BuildMsg {
  id: number;
  theme: ThemeId;
  total: number;
  /** Slots filled or on their way. */
  made: number;
  start: number;
  end: number;
  phase: Phase;
  /** Kind each column makes, -1 for none. */
  orders: number[];
  trophies: number;
}

export interface BeatMsg {
  p: number;
  /** Workstations on the sender. */
  s: number;
  /** Task slots used in the last minute. */
  a: number;
  /** Bit per workstation: worked lately. */
  g: number;
}

const obj = (d: unknown): Record<string, unknown> | null =>
  typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : null;
const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

export const encodePart = (m: PartMsg): unknown => ({
  i: m.i,
  p: m.p,
  w: m.w,
  l: m.l,
  k: m.k,
  b: m.b,
  c: m.c,
  u: Math.round(Math.min(1, Math.max(0, m.u)) * 1000) / 1000,
  t: Math.round(m.t),
});

export const decodePart = (data: unknown): PartMsg | null => {
  const o = obj(data);
  if (!o) return null;
  const { i, p, w, l, k, b, c, u, t } = o;
  if (!isInt(i, 0, SEQ_MAX) || !isInt(p, 0, MAX_POS - 1) || !isInt(w, 0, MAX_STATIONS - 1)) {
    return null;
  }
  if (!isInt(l, 0, 1) || !isInt(k, 0, MAX_KIND) || !isInt(b, 0, SEQ_MAX) || !isInt(c, -1, 7)) {
    return null;
  }
  if (!isNum(u, 0, 1) || !isNum(t, 0, T_MAX)) return null;
  return { i, p, w, l, k, b, c, u, t };
};

export const encodeBuild = (m: BuildMsg): unknown => ({
  i: m.id,
  th: THEME_IDS.indexOf(m.theme),
  n: m.total,
  f: m.made,
  s: Math.round(m.start),
  e: Math.round(m.end),
  ph: PHASES.indexOf(m.phase),
  o: m.orders.slice(0, MAX_COLUMNS),
  tr: m.trophies,
});

export const decodeBuild = (data: unknown): BuildMsg | null => {
  const o = obj(data);
  if (!o) return null;
  const { i, th, n, f, s, e, ph, tr } = o;
  if (!isInt(i, 0, SEQ_MAX) || !isInt(th, 0, THEME_IDS.length - 1) || !isInt(n, 1, 64)) return null;
  if (!isInt(f, 0, n) || !isInt(s, 0, T_MAX) || !isInt(e, s, T_MAX)) return null;
  if (!isInt(ph, 0, PHASES.length - 1) || !isInt(tr, 0, 99)) return null;
  if (!Array.isArray(o.o) || o.o.length > MAX_COLUMNS) return null;
  const orders: number[] = [];
  for (const v of o.o as unknown[]) {
    if (!isInt(v, -1, MAX_KIND)) return null;
    orders.push(v);
  }
  return {
    id: i,
    theme: THEME_IDS[th]!,
    total: n,
    made: f,
    start: s,
    end: e,
    phase: PHASES[ph]!,
    orders,
    trophies: tr,
  };
};

export const encodeBeat = (m: BeatMsg): unknown => ({ p: m.p, s: m.s, a: m.a, g: m.g });

export const decodeBeat = (data: unknown): BeatMsg | null => {
  const o = obj(data);
  if (!o) return null;
  const { p, s, a, g } = o;
  if (!isInt(p, 0, MAX_POS - 1) || !isInt(s, 1, MAX_STATIONS)) return null;
  if (!isInt(a, 0, MAX_STATIONS * 2) || !isInt(g, 0, 2 ** MAX_STATIONS - 1)) return null;
  return { p, s, a, g };
};

/** Rising part ids for one frame: never below the wall clock, so they climb across reloads. */
export const createSequence = (clock: () => number = Date.now) => {
  let last = 0;
  return () => {
    last = Math.max(last + 1, Math.floor(clock()));
    return last;
  };
};

/**
 * Each frame's highest part id, to drop repeats. One entry per frame, and at most `max` frames
 * (the oldest heard is forgotten first), so it is bounded whatever arrives.
 */
export const createSeen = (max = 128) => {
  const high = new Map<string, number>();
  return {
    /** True the first time a frame's id is seen; false for that id or any lower one again. */
    fresh(frame: string, id: number): boolean {
      const h = high.get(frame);
      if (h !== undefined && id <= h) return false;
      high.delete(frame);
      high.set(frame, id);
      while (high.size > max) {
        const first = high.keys().next().value;
        if (first === undefined) break;
        high.delete(first);
      }
      return true;
    },
    get size() {
      return high.size;
    },
    clear() {
      high.clear();
    },
  };
};
