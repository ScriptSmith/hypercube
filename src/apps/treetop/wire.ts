/**
 * Messages within a bank. Every value that arrives is checked; a bad message is dropped whole.
 *
 * - `fly`, from each touch frame to the leader, 10 times a second while it has gliders in the race
 *   and twice a second otherwise: each of those lanes with distance and height in whole course
 *   px, a flap bit, mode, controller, gates and finish time; which of the frame's lanes have
 *   joined; and the heat the frame is following, so a new leader can pick up where the last
 *   one stopped. Practice runs are not in it.
 * - `fin`, once per lane per race to the leader: the race ms at the finish line.
 * - `res`, from the leader to everyone at the end of a race: the placings.
 * - `pack`, from the leader to everyone twice a second: distance, mode and finish of every lane,
 *   for pack strips and place badges.
 * - `heat`, from the leader to everyone on every change and once a second: the phase, its times
 *   on the shared clock and the lanes in it (lobby.ts).
 *
 * A lane's id is `pos * MAX_SLOTS + slot`, so it is unique in the bank and says where it sits.
 */
import { MODES, type Mode } from "./flight";
import { type Heat, HEAT_PHASES, type HeatPhase } from "./lobby";

export const TOPIC_FLY = "fly";
export const TOPIC_FIN = "fin";
export const TOPIC_RES = "res";
export const TOPIC_PACK = "pack";
export const TOPIC_HEAT = "heat";

/** Lanes on one touch frame at most: two halves of a pair, each with two pads. */
export const MAX_SLOTS = 4;
export const MAX_POS = 64;
export const MAX_LANES = MAX_POS * MAX_SLOTS;

/** Who flies a lane: a person, a bot kept for testing, or a faded attract bot. */
export const CTRLS = ["human", "bot", "attract"] as const;
export type Ctrl = (typeof CTRLS)[number];

export const laneId = (pos: number, slot: number): number => pos * MAX_SLOTS + slot;
export const lanePos = (id: number): number => Math.floor(id / MAX_SLOTS);
export const laneSlot = (id: number): number => id % MAX_SLOTS;

export interface LaneReport {
  slot: number;
  d: number;
  h: number;
  mode: Mode;
  flap: boolean;
  ctrl: Ctrl;
  /** The adult glider of a `pads` lane pair. */
  adult: boolean;
  gates: number;
  fin: number | null;
}

export interface Fly {
  k: number;
  pos: number;
  count: number;
  /** Lanes on the sending frame. */
  n: number;
  /** Clock ms when the frame took these readings. */
  t: number;
  lanes: LaneReport[];
  /** Bit per slot: the lanes whose stations are playing (people and test bots). */
  joined?: number;
  /** The heat the frame is following. */
  heat?: Heat;
}

export interface Fin {
  k: number;
  lane: number;
  t: number;
}

export interface PackLane {
  lane: number;
  d: number;
  mode: Mode;
  ctrl: Ctrl;
  fin: number | null;
}

export interface Pack {
  k: number;
  /** The leader has ended the race early (nobody is flying). */
  ended: boolean;
  lanes: PackLane[];
}

export interface Res {
  k: number;
  places: [number, number][];
}

const MAX_D = 1_000_000;
const MAX_K = 1e12;
/** Clock times must be plausible: within a few centuries of the epoch. */
const MAX_T = 1e13;

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const finOf = (v: unknown): number | null | undefined =>
  v === -1 ? null : isInt(v, 0, MAX_D) ? v : undefined;
const obj = (data: unknown): Record<string, unknown> | null =>
  typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;

const flagsOf = (mode: Mode, ctrl: Ctrl, flap = false, adult = false) =>
  MODES.indexOf(mode) | (flap ? 8 : 0) | (CTRLS.indexOf(ctrl) << 4) | (adult ? 64 : 0);

const unflag = (f: number) => {
  const mode = MODES[f & 7];
  const ctrl = CTRLS[(f >> 4) & 3];
  return mode && ctrl ? { mode, ctrl, flap: (f & 8) !== 0, adult: (f & 64) !== 0 } : null;
};

export const encodeFly = (m: Fly): unknown => ({
  k: m.k,
  p: m.pos,
  c: m.count,
  n: m.n,
  t: Math.round(m.t),
  L: m.lanes.map((l) => [
    l.slot,
    Math.round(Math.min(MAX_D, Math.max(0, l.d))),
    Math.round(Math.min(4000, Math.max(-2000, l.h))),
    flagsOf(l.mode, l.ctrl, l.flap, l.adult),
    Math.min(1000, l.gates),
    l.fin ?? -1,
  ]),
  ...(m.joined ? { j: m.joined } : {}),
  ...(m.heat ? { v: encodeHeat(m.heat) } : {}),
});

export const decodeFly = (data: unknown): Fly | null => {
  const o = obj(data);
  if (!o) return null;
  const { k, p, c, n, t, L } = o;
  if (!isInt(k, 0, MAX_K) || !isInt(p, 0, MAX_POS - 1) || !isInt(c, 1, MAX_POS)) return null;
  if (!isInt(n, 1, MAX_SLOTS) || typeof t !== "number" || !Number.isFinite(t)) return null;
  if (!Array.isArray(L) || L.length > n) return null;
  const lanes: LaneReport[] = [];
  for (const row of L) {
    if (!Array.isArray(row) || row.length !== 6) return null;
    const [slot, d, h, f, g, fin] = row as unknown[];
    if (!isInt(slot, 0, n - 1) || !isInt(d, 0, MAX_D) || !isInt(h, -2000, 4000)) return null;
    if (!isInt(f, 0, 127) || !isInt(g, 0, 1000)) return null;
    const flags = unflag(f);
    const done = finOf(fin);
    if (!flags || done === undefined) return null;
    lanes.push({ slot, d, h, gates: g, fin: done, ...flags });
  }
  const out: Fly = { k, pos: p, count: c, n, t, lanes };
  if (o.j !== undefined) {
    if (!isInt(o.j, 0, (1 << n) - 1)) return null;
    out.joined = o.j;
  }
  if (o.v !== undefined) {
    const heat = decodeHeat(o.v);
    if (!heat) return null;
    out.heat = heat;
  }
  return out;
};

/** Whether slot `slot` is set in a joined mask. */
export const joinedSlot = (mask: number, slot: number): boolean => (mask & (1 << slot)) !== 0;

export const encodeHeat = (h: Heat): unknown => ({
  k: h.k,
  p: HEAT_PHASES.indexOf(h.phase),
  s: Math.round(h.since),
  e: Math.round(h.until),
  o: Math.round(h.opened),
  L: h.lanes,
});

export const decodeHeat = (data: unknown): Heat | null => {
  const o = obj(data);
  if (!o || !isInt(o.k, 0, MAX_K) || !isInt(o.p, 0, HEAT_PHASES.length - 1)) return null;
  if (!isInt(o.s, 0, MAX_T) || !isInt(o.e, 0, MAX_T) || !isInt(o.o, 0, MAX_T)) return null;
  if (!Array.isArray(o.L) || o.L.length > MAX_LANES) return null;
  if (!o.L.every((l) => isInt(l, 0, MAX_LANES - 1))) return null;
  const phase = HEAT_PHASES[o.p] as HeatPhase;
  return { k: o.k, phase, since: o.s, until: o.e, opened: o.o, lanes: [...(o.L as number[])] };
};

export const encodeFin = (m: Fin): unknown => ({ k: m.k, l: m.lane, t: Math.round(m.t) });

export const decodeFin = (data: unknown): Fin | null => {
  const o = obj(data);
  if (!o || !isInt(o.k, 0, MAX_K) || !isInt(o.l, 0, MAX_LANES - 1) || !isInt(o.t, 0, MAX_D)) {
    return null;
  }
  return { k: o.k, lane: o.l, t: o.t };
};

export const encodePack = (m: Pack): unknown => ({
  k: m.k,
  e: m.ended ? 1 : 0,
  L: m.lanes.map((l) => [
    l.lane,
    Math.round(Math.min(MAX_D, Math.max(0, l.d))),
    flagsOf(l.mode, l.ctrl),
    l.fin ?? -1,
  ]),
});

export const decodePack = (data: unknown): Pack | null => {
  const o = obj(data);
  if (!o || !isInt(o.k, 0, MAX_K) || (o.e !== 0 && o.e !== 1)) return null;
  if (!Array.isArray(o.L) || o.L.length > MAX_LANES) return null;
  const lanes: PackLane[] = [];
  for (const row of o.L) {
    if (!Array.isArray(row) || row.length !== 4) return null;
    const [lane, d, f, fin] = row as unknown[];
    if (!isInt(lane, 0, MAX_LANES - 1) || !isInt(d, 0, MAX_D) || !isInt(f, 0, 127)) return null;
    const flags = unflag(f);
    const done = finOf(fin);
    if (!flags || done === undefined) return null;
    lanes.push({ lane, d, mode: flags.mode, ctrl: flags.ctrl, fin: done });
  }
  return { k: o.k, ended: o.e === 1, lanes };
};

export const encodeRes = (m: Res): unknown => ({ k: m.k, r: m.places });

export const decodeRes = (data: unknown): Res | null => {
  const o = obj(data);
  if (!o || !isInt(o.k, 0, MAX_K) || !Array.isArray(o.r) || o.r.length > MAX_LANES) return null;
  const places: [number, number][] = [];
  for (const row of o.r) {
    if (!Array.isArray(row) || row.length !== 2) return null;
    const [lane, place] = row as unknown[];
    if (!isInt(lane, 0, MAX_LANES - 1) || !isInt(place, 1, MAX_LANES)) return null;
    places.push([lane, place]);
  }
  return { k: o.k, places };
};
