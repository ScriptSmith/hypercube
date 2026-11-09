/**
 * Messages in a bank. Everything that arrives is checked field by field and dropped whole if
 * anything is out of range, because any page on the public site can join a room it guesses.
 *
 * - `drop`: a touch frame to its screen, as a finished ball starts up the frame's tube: which
 *   board (of how many on the frame), the ball's colour, when it crosses the frame's top edge
 *   (shared clock) and how fast it is rising there. The screen carries it on up its own tube.
 * - `beacon`: the screen to everyone, four times a second: its side, the jar's count, size and
 *   phase, and the level epoch (how many times the jar has emptied).
 * - `level`: the screen to everyone when the jar empties, so boards step up a level.
 */

export const TOPIC = { drop: "tm:drop", beacon: "tm:beacon", level: "tm:level" } as const;

export interface DropMsg {
  /** Board on the frame, and boards on the frame. */
  b: number;
  n: number;
  /** Colour index. */
  c: number;
  /** Shared clock ms when the ball crosses the frame's top edge, and its speed there in mm/s. */
  t: number;
  v: number;
  /** 1 when a person sent it. */
  h: number;
}

export interface BeaconMsg {
  s: number;
  /** Balls in the jar, balls that fill it, and its phase (0 fill, 1 full, 2 open, 3 close). */
  j: number;
  cap: number;
  p: number;
  /** Level epoch. */
  e: number;
}

export interface LevelMsg {
  s: number;
  e: number;
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
const E_MAX = 1e9;

const all = <T>(m: Record<string, number | null>): T | null => {
  for (const v of Object.values(m)) if (v === null) return null;
  return m as T;
};

export const encodeDrop = (m: DropMsg): DropMsg => ({
  b: Math.max(0, Math.min(3, Math.round(m.b))),
  n: Math.max(1, Math.min(4, Math.round(m.n))),
  c: Math.max(0, Math.min(7, Math.round(m.c))),
  t: Math.round(m.t),
  v: Math.max(100, Math.min(20_000, Math.round(m.v))),
  h: m.h ? 1 : 0,
});

export const decodeDrop = (data: unknown): DropMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const m = all<DropMsg>({
    b: int(d.b, 0, 3),
    n: int(d.n, 1, 4),
    c: int(d.c, 0, 7),
    t: num(d.t, 0, T_MAX),
    v: num(d.v, 100, 20_000),
    h: int(d.h, 0, 1),
  });
  return m && m.b < m.n ? m : null;
};

export const encodeBeacon = (m: BeaconMsg): BeaconMsg => ({
  s: m.s === 1 ? 1 : 0,
  j: Math.max(0, Math.min(64, Math.round(m.j))),
  cap: Math.max(1, Math.min(64, Math.round(m.cap))),
  p: Math.max(0, Math.min(3, Math.round(m.p))),
  e: Math.max(0, Math.min(E_MAX, Math.round(m.e))),
});

export const decodeBeacon = (data: unknown): BeaconMsg | null => {
  const d = obj(data);
  if (!d) return null;
  return all<BeaconMsg>({
    s: int(d.s, 0, 1),
    j: int(d.j, 0, 64),
    cap: int(d.cap, 1, 64),
    p: int(d.p, 0, 3),
    e: int(d.e, 0, E_MAX),
  });
};

export const encodeLevel = (m: LevelMsg): LevelMsg => ({
  s: m.s === 1 ? 1 : 0,
  e: Math.max(0, Math.min(E_MAX, Math.round(m.e))),
});

export const decodeLevel = (data: unknown): LevelMsg | null => {
  const d = obj(data);
  if (!d) return null;
  return all<LevelMsg>({ s: int(d.s, 0, 1), e: int(d.e, 0, E_MAX) });
};

export const PHASES = ["fill", "full", "open", "close"] as const;
