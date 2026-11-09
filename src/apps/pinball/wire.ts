/**
 * Messages between the tables of a bank and the screen above them. Everything that arrives is
 * checked field by field and dropped whole if anything is out of range, because any page on the
 * public site can join a room it guesses.
 *
 * - `up`: a table to the screen when a ball enters the deck lane.
 * - `down`: the screen to a table when a deck ball falls into a hole for it.
 * - `pts`: the screen to a table about twice a second: what its balls scored on the deck.
 * - `score`: a table to the screen on change, at most twice a second, and every few seconds.
 * - `gift`: the screen to a table when one of its balls pops a gift bubble on the deck.
 * - `hi`: the screen's beacon, so the tables know the deck is there.
 */
import { GIFTS } from "./config";

export const TOPIC = {
  up: "pb:up",
  down: "pb:down",
  pts: "pb:pts",
  score: "pb:score",
  gift: "pb:gift",
  hi: "pb:hi",
} as const;

export interface UpMsg {
  /** Ball id, unique on the sending frame for a long while. */
  i: number;
  /** The frame's position in the bank, which of its tables, and how many tables it has. */
  p: number;
  h: number;
  n: number;
  /** Fraction across the table's top edge where the ball left. */
  u: number;
  /** Velocity entering the lane, table px per second. */
  vx: number;
  vy: number;
  /** Colour index. */
  c: number;
  /** Clock ms when the ball left the playfield. */
  t: number;
}

export interface DownMsg {
  i: number;
  /** Which of the receiving frame's tables. */
  h: number;
  c: number;
  /** Clock ms when the ball reaches the table's top edge. */
  t: number;
}

export interface PtsMsg {
  /** [table index, points] pairs. */
  p: [number, number][];
}

export interface ScoreMsg {
  h: number;
  n: number;
  /** Score, balls left, playing (1) or attract (0), balls in play, colour. */
  s: number;
  b: number;
  g: number;
  q: number;
  c: number;
  /** 1 when the table takes balls from the deck: a game is on, a person's or an attract bot's. */
  a: number;
}

export interface GiftMsg {
  /** Which of the receiving frame's tables, which gift (an index into GIFTS). */
  h: number;
  k: number;
  /** Clock ms when the gift reaches the table's top edge. */
  t: number;
}

const obj = (d: unknown): Record<string, unknown> | null =>
  typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : null;

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;

const int = (v: unknown, min: number, max: number): number | null => {
  const n = num(v, min, max);
  return n !== null && Number.isInteger(n) ? n : null;
};

export const MAX_POS = 63;
export const MAX_TABLES = 8;
const T_MAX = 1e14;
const ID_MAX = 2 ** 31 - 1;
const SCORE_MAX = 1e10;
const V_MAX = 20_000;
const r1 = (v: number) => Math.round(v * 10) / 10;
const r4 = (v: number) => Math.round(v * 10_000) / 10_000;

const allSet = (o: Record<string, number | null>): boolean =>
  Object.values(o).every((v) => v !== null);

export const encodeUp = (m: UpMsg): UpMsg => ({
  ...m,
  u: r4(m.u),
  vx: r1(m.vx),
  vy: r1(m.vy),
  t: Math.round(m.t),
});

export const decodeUp = (data: unknown): UpMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const m = {
    i: int(d.i, 0, ID_MAX),
    p: int(d.p, 0, MAX_POS),
    h: int(d.h, 0, MAX_TABLES - 1),
    n: int(d.n, 1, MAX_TABLES),
    u: num(d.u, 0, 1),
    vx: num(d.vx, -V_MAX, V_MAX),
    vy: num(d.vy, -V_MAX, V_MAX),
    c: int(d.c, 0, 63),
    t: num(d.t, 0, T_MAX),
  };
  if (!allSet(m) || (m.h as number) >= (m.n as number)) return null;
  return m as UpMsg;
};

export const encodeDown = (m: DownMsg): DownMsg => ({ ...m, t: Math.round(m.t) });

export const decodeDown = (data: unknown): DownMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const m = {
    i: int(d.i, 0, ID_MAX),
    h: int(d.h, 0, MAX_TABLES - 1),
    c: int(d.c, 0, 63),
    t: num(d.t, 0, T_MAX),
  };
  return allSet(m) ? (m as DownMsg) : null;
};

export const decodePts = (data: unknown): PtsMsg | null => {
  const d = obj(data);
  if (!d || !Array.isArray(d.p) || d.p.length > MAX_TABLES) return null;
  const out: [number, number][] = [];
  for (const e of d.p) {
    if (!Array.isArray(e) || e.length !== 2) return null;
    const h = int(e[0], 0, MAX_TABLES - 1);
    const n = int(e[1], 1, 1e7);
    if (h === null || n === null) return null;
    out.push([h, n]);
  }
  return { p: out };
};

export const decodeScore = (data: unknown): ScoreMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const m = {
    h: int(d.h, 0, MAX_TABLES - 1),
    n: int(d.n, 1, MAX_TABLES),
    s: int(d.s, 0, SCORE_MAX),
    b: int(d.b, 0, 99),
    g: int(d.g, 0, 1),
    q: int(d.q, 0, 99),
    c: int(d.c, 0, 63),
  };
  if (!allSet(m) || (m.h as number) >= (m.n as number)) return null;
  const a = d.a === undefined ? m.g : int(d.a, 0, 1);
  if (a === null) return null;
  return { ...m, a } as ScoreMsg;
};

export const encodeGift = (m: GiftMsg): GiftMsg => ({ ...m, t: Math.round(m.t) });

export const decodeGift = (data: unknown): GiftMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const m = {
    h: int(d.h, 0, MAX_TABLES - 1),
    k: int(d.k, 0, GIFTS.length - 1),
    t: num(d.t, 0, T_MAX),
  };
  return allSet(m) ? (m as GiftMsg) : null;
};
