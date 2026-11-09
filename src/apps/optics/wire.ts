/**
 * Messages between the frames of a bank and the screen above them. Every decoder checks every
 * field and drops the whole message if anything is out of range, because any page on the public
 * site can join a room it guesses.
 *
 * - `beam`: a touch frame to its left or right neighbour, the light leaving through that edge,
 *   when it changes (at most 20 times a second) and every second. Each beam is its height on the
 *   edge as a fraction, its angle, its wavelengths, its brightness and the frames it has crossed.
 * - `sky`: a touch frame to the screen, the light leaving through its top edge, with x as a
 *   fraction across the whole bank, and the round it belongs to. Guide light goes up too, marked,
 *   so the screen can show it faint.
 * - `round`: the leader to everyone, which puzzle the bank is on and which frames have solved it.
 * - `state`: a touch frame to the leader, its round and whether it is solved, lit by real light,
 *   and idle.
 * - `cheer`: the leader (or the screen, for its finale) to everyone: the light got through.
 * - `skip`: to the leader, an admin's request for the next puzzle.
 */
import { MAX_HOPS } from "./config";
import { WHITE } from "./spectrum";

export const TOPIC = {
  beam: "op:beam",
  sky: "op:sky",
  round: "op:round",
  state: "op:state",
  cheer: "op:cheer",
  skip: "op:skip",
} as const;

/** Beams in one message, at most. */
export const MAX_BEAMS = 16;
export const MAX_POS = 63;
const SERIAL_MAX = 2 ** 31 - 1;

export interface EdgeBeam {
  /** Height on the edge: 0 at the top, 1 at the bottom. */
  y: number;
  /** Direction, radians (y down). */
  a: number;
  bits: number;
  level: number;
  hops: number;
}

export interface SkyBeam {
  /** Fraction across the whole bank, which is also across the screen above it. */
  x: number;
  a: number;
  bits: number;
  level: number;
  guide: boolean;
}

export interface RoundMsg {
  serial: number;
  level: number;
  /** Frames (by bit position) that have solved this round, and those lit by real light. */
  solved: number;
  real: number;
}

export interface StateMsg {
  serial: number;
  level: number;
  solved: boolean;
  real: boolean;
  idle: boolean;
}

export interface CheerMsg {
  serial: number;
  finale: boolean;
}

const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

const obj = (d: unknown): Record<string, unknown> | null =>
  typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : null;
const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
const int = (v: unknown, lo: number, hi: number): number | null => {
  const n = num(v, lo, hi);
  return n !== null && Number.isInteger(n) ? n : null;
};

const PI = Math.PI + 0.001;

export const encodeEdge = (beams: readonly EdgeBeam[]): { b: number[][] } => ({
  b: beams.slice(0, MAX_BEAMS).map((e) => [r4(e.y), r4(e.a), e.bits, r3(e.level), e.hops]),
});

export const decodeEdge = (data: unknown): EdgeBeam[] | null => {
  const d = obj(data);
  if (!d || !Array.isArray(d.b) || d.b.length > MAX_BEAMS) return null;
  const out: EdgeBeam[] = [];
  for (const e of d.b) {
    if (!Array.isArray(e) || e.length !== 5) return null;
    const y = num(e[0], 0, 1);
    const a = num(e[1], -PI, PI);
    const bits = int(e[2], 1, WHITE);
    const level = num(e[3], 0, 1);
    const hops = int(e[4], 0, MAX_HOPS);
    if (y === null || a === null || bits === null || level === null || hops === null) return null;
    out.push({ y, a, bits, level, hops });
  }
  return out;
};

export const encodeSky = (pos: number, beams: readonly SkyBeam[], serial = 0) => ({
  p: pos,
  s: serial,
  b: beams.slice(0, MAX_BEAMS).map((e) => [r4(e.x), r4(e.a), e.bits, r3(e.level), e.guide ? 1 : 0]),
});

export const decodeSky = (
  data: unknown,
): { pos: number; serial: number; beams: SkyBeam[] } | null => {
  const d = obj(data);
  if (!d || !Array.isArray(d.b) || d.b.length > MAX_BEAMS) return null;
  const pos = int(d.p, 0, MAX_POS);
  const serial = int(d.s, 0, SERIAL_MAX);
  if (pos === null || serial === null) return null;
  const beams: SkyBeam[] = [];
  for (const e of d.b) {
    if (!Array.isArray(e) || e.length !== 5) return null;
    const x = num(e[0], 0, 1);
    const a = num(e[1], -PI, PI);
    const bits = int(e[2], 1, WHITE);
    const level = num(e[3], 0, 1);
    const g = int(e[4], 0, 1);
    if (x === null || a === null || bits === null || level === null || g === null) return null;
    beams.push({ x, a, bits, level, guide: g === 1 });
  }
  return { pos, serial, beams };
};

export const encodeRound = (m: RoundMsg) => ({ s: m.serial, l: m.level, f: m.solved, r: m.real });

export const decodeRound = (data: unknown): RoundMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const serial = int(d.s, 0, SERIAL_MAX);
  const level = int(d.l, 0, 15);
  const solved = int(d.f, 0, 2 ** (MAX_POS + 1));
  const real = int(d.r, 0, 2 ** (MAX_POS + 1));
  if (serial === null || level === null || solved === null || real === null) return null;
  return { serial, level, solved, real };
};

export const encodeState = (m: StateMsg) => ({
  s: m.serial,
  l: m.level,
  v: m.solved ? 1 : 0,
  r: m.real ? 1 : 0,
  i: m.idle ? 1 : 0,
});

export const decodeState = (data: unknown): StateMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const serial = int(d.s, 0, SERIAL_MAX);
  const level = int(d.l, 0, 15);
  const v = int(d.v, 0, 1);
  const r = int(d.r, 0, 1);
  const i = int(d.i, 0, 1);
  if (serial === null || level === null || v === null || r === null || i === null) return null;
  return { serial, level, solved: v === 1, real: r === 1, idle: i === 1 };
};

export const encodeCheer = (m: CheerMsg) => ({ s: m.serial, f: m.finale ? 1 : 0 });

export const decodeCheer = (data: unknown): CheerMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const serial = int(d.s, 0, SERIAL_MAX);
  const f = int(d.f, 0, 1);
  if (serial === null || f === null) return null;
  return { serial, finale: f === 1 };
};

/**
 * Light received from a neighbour, as a source for this frame: hops count up by one, and light
 * that has crossed too many frames is dropped.
 */
export const hopOn = (beams: readonly EdgeBeam[]): EdgeBeam[] =>
  beams.filter((b) => b.hops < MAX_HOPS).map((b) => ({ ...b, hops: b.hops + 1 }));
