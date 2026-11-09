/**
 * Messages between a bank's panels and its screen, on the app channel.
 *
 * Panel to screen:
 * - `turn` {k, d, q, b}: station key, steering -1/0/1, sequence number, 1 for a seated bot. Sent
 *   on every change and twice a second as a heartbeat, so a lost message heals itself.
 * - `seat` {k, on, q, b}: a station was seated (ready or playing) or ended.
 * - `aim` {k, g, n, q, b}: `grid` only, in place of `turn`. The latest direction pressed (0 right,
 *   1 down, 2 left, 3 up, -1 before the first press) and how many presses the station has had.
 *   Sent on every press and twice a second; the screen takes a press whenever `n` changes, so
 *   a lost message is made good by the next one.
 *
 * Screen to every frame:
 * - `round` {r, p, s, e, a, k, m}: round number, phase, phase start and end on the shared clock,
 *   attract flag, the runners' station keys (-1 for bot-only starts) and modes (0 person,
 *   1 seated bot, 2 bot). Sent on every phase change and every second.
 * - `alive` {r, l, h, pl}: per runner, 1 while moving, heading in 256ths of a turn, and
 *   placings once the round is over. Four times a second while playing.
 *
 * A station key is `pos * 4 + index`, so it names one station of one frame in the bank.
 */
import { MAX_LINES } from "./config";
import type { Phase } from "./match";

export const TOPIC_TURN = "turn";
export const TOPIC_AIM = "aim";
export const TOPIC_SEAT = "seat";
export const TOPIC_ROUND = "round";
export const TOPIC_ALIVE = "alive";

/** Stations per frame a key leaves room for. */
export const KEYS_PER_FRAME = 4;
export const MAX_KEY = 64 * KEYS_PER_FRAME - 1;
const MAX_SEQ = 2 ** 31;

export const stationKey = (pos: number, index: number): number => pos * KEYS_PER_FRAME + index;

export interface TurnMsg {
  k: number;
  d: -1 | 0 | 1;
  q: number;
  b: boolean;
}

export interface AimMsg {
  k: number;
  g: number;
  n: number;
  q: number;
  b: boolean;
}

export interface SeatMsg {
  k: number;
  on: boolean;
  q: number;
  b: boolean;
}

export interface RoundMsg {
  r: number;
  p: Phase;
  s: number;
  e: number;
  a: boolean;
  k: number[];
  m: number[];
}

export interface AliveMsg {
  r: number;
  l: number[];
  h: number[];
  pl: number[];
}

const PHASES: readonly Phase[] = ["lobby", "countdown", "play", "over"];

const obj = (d: unknown): Record<string, unknown> | null =>
  d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : null;
const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const time = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const ints = (v: unknown, lo: number, hi: number, max = MAX_LINES): number[] | null =>
  Array.isArray(v) && v.length <= max && v.every((x) => int(x, lo, hi)) ? (v as number[]) : null;

export const encodeTurn = (m: TurnMsg) => ({ k: m.k, d: m.d, q: m.q, b: m.b ? 1 : 0 });
export const decodeTurn = (data: unknown): TurnMsg | null => {
  const o = obj(data);
  if (!o || !int(o.k, 0, MAX_KEY) || !int(o.d, -1, 1) || !int(o.q, 0, MAX_SEQ)) return null;
  return { k: o.k, d: o.d as -1 | 0 | 1, q: o.q, b: o.b === 1 };
};

export const encodeAim = (m: AimMsg) => ({ k: m.k, g: m.g, n: m.n, q: m.q, b: m.b ? 1 : 0 });
export const decodeAim = (data: unknown): AimMsg | null => {
  const o = obj(data);
  if (!o || !int(o.k, 0, MAX_KEY) || !int(o.g, -1, 3)) return null;
  if (!int(o.n, 0, MAX_SEQ) || !int(o.q, 0, MAX_SEQ)) return null;
  return { k: o.k, g: o.g, n: o.n, q: o.q, b: o.b === 1 };
};

export const encodeSeat = (m: SeatMsg) => ({ k: m.k, on: m.on ? 1 : 0, q: m.q, b: m.b ? 1 : 0 });
export const decodeSeat = (data: unknown): SeatMsg | null => {
  const o = obj(data);
  if (!o || !int(o.k, 0, MAX_KEY) || !int(o.q, 0, MAX_SEQ)) return null;
  return { k: o.k, on: o.on === 1, q: o.q, b: o.b === 1 };
};

export const encodeRound = (m: RoundMsg) => ({ ...m, a: m.a ? 1 : 0 });
export const decodeRound = (data: unknown): RoundMsg | null => {
  const o = obj(data);
  if (!o || !int(o.r, 0, MAX_SEQ) || !PHASES.includes(o.p as Phase)) return null;
  if (!time(o.s) || !time(o.e)) return null;
  const k = ints(o.k, -1, MAX_KEY);
  const m = ints(o.m, 0, 2);
  if (!k || !m || k.length !== m.length) return null;
  return { r: o.r, p: o.p as Phase, s: o.s, e: o.e, a: o.a === 1, k, m };
};

export const decodeAlive = (data: unknown): AliveMsg | null => {
  const o = obj(data);
  if (!o || !int(o.r, 0, MAX_SEQ)) return null;
  const l = ints(o.l, 0, 1);
  const h = ints(o.h, 0, 255);
  const pl = ints(o.pl, 1, MAX_LINES);
  if (!l || !h || !pl || l.length !== h.length) return null;
  return { r: o.r, l, h, pl };
};

/** A heading in radians as 256ths of a turn, and back. */
export const packHeading = (a: number): number => {
  const t = a / (Math.PI * 2);
  return Math.round((t - Math.floor(t)) * 256) % 256;
};
export const unpackHeading = (v: number): number => (v / 256) * Math.PI * 2;
