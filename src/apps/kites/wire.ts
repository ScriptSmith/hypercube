/**
 * Messages, quantised and checked field by field on arrival (any page on the public site can join
 * a room it guesses, so anything out of range drops the whole message).
 *
 * - `kite` (touch frame to the screen on its side, about 15 a second): every kite the frame
 *   flies, in sky coordinates: x as a fraction across the bank, y in screen heights above the
 *   touch frames' tops. `u` and `u2` are where its line (or a stunt kite's two lines) leave the
 *   frame's top edge, as fractions across the frame. `t` is the shared clock.
 * - `sky` (screen beacon, twice a second): its side, and how far behind the shared clock it draws
 *   kites, so frames draw the bottom of each line at the same moment and the two halves join.
 * - `tangle` (screen to a kite's frame): that kite's line is caught with another, or is free.
 * - `ring` (touch frame to the screen): one of its kites flew through a ring at shared time `t`.
 * - `wind` (leader to the group): today's real wind, for `wind=live`.
 * - `gust` (any frame to the group): an admin gust that starts at shared time `t`.
 */

export const TOPIC = {
  kite: "kt:kite",
  sky: "kt:sky",
  tangle: "kt:tangle",
  ring: "kt:ring",
  wind: "kt:wind",
  gust: "kt:gust",
} as const;

export const FLAG = {
  tangled: 1,
  down: 2,
  sparkle: 4,
  /** Flown by the autopilot: nobody is playing it. */
  auto: 8,
  /** A person (not a bot) touched it lately. */
  human: 16,
  parked: 32,
} as const;

export const SHAPES = ["diamond", "delta", "fish", "bird", "dragon"] as const;
export type Shape = (typeof SHAPES)[number];

export const MAX_POS = 64;
/** Kites one frame may send: two per patch, at most 16 patches. */
export const MAX_KITES = 32;
const T_MAX = 1e13;

export interface WireKite {
  /** Patch * 2, plus 1 for the stunt kite. */
  slot: number;
  u: number;
  u2: number;
  x: number;
  y: number;
  /** Spine angle, radians, 0 up. */
  spin: number;
  /** 0 slack to 1.2 taut. */
  tension: number;
  flags: number;
  /** Palette index. */
  color: number;
  shape: number;
}

export interface KiteMsg {
  t: number;
  pos: number;
  count: number;
  kites: WireKite[];
}

const XQ = 10000;
const UQ = 2000;
const X_MIN = -0.3;
const X_MAX = 1.3;
const Y_MIN = -0.3;
const Y_MAX = 1.5;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const fin = (v: number) => (Number.isFinite(v) ? v : 0);
const q = (v: number, k: number, lo: number, hi: number) => Math.round(clamp(fin(v), lo, hi) * k);
const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const obj = (d: unknown): Record<string, unknown> | null =>
  typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : null;

const wrapAngle = (a: number) => {
  let x = fin(a) % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  else if (x < -Math.PI) x += Math.PI * 2;
  return x;
};

export const encodeKites = (m: KiteMsg): unknown => ({
  t: Math.round(clamp(fin(m.t), 0, T_MAX)),
  p: m.pos,
  n: m.count,
  k: m.kites
    .slice(0, MAX_KITES)
    .map((k) => [
      k.slot,
      q(k.u, UQ, -0.5, 1.5),
      q(k.u2, UQ, -0.5, 1.5),
      q(k.x, XQ, X_MIN, X_MAX),
      q(k.y, XQ, Y_MIN, Y_MAX),
      Math.round(wrapAngle(k.spin) * 1000),
      q(k.tension, 100, 0, 1.2),
      k.flags & 63,
      k.color & 7,
      clamp(k.shape | 0, 0, SHAPES.length - 1),
    ]),
});

const decodeKite = (v: unknown): WireKite | null => {
  if (!Array.isArray(v) || v.length !== 10) return null;
  const [slot, u, u2, x, y, a, tn, f, c, sh] = v as unknown[];
  if (!isInt(slot, 0, MAX_KITES - 1)) return null;
  if (!isInt(u, -0.5 * UQ, 1.5 * UQ) || !isInt(u2, -0.5 * UQ, 1.5 * UQ)) return null;
  if (!isInt(x, X_MIN * XQ, X_MAX * XQ) || !isInt(y, Y_MIN * XQ, Y_MAX * XQ)) return null;
  if (!isInt(a, -3142, 3142) || !isInt(tn, 0, 120) || !isInt(f, 0, 63)) return null;
  if (!isInt(c, 0, 7) || !isInt(sh, 0, SHAPES.length - 1)) return null;
  return {
    slot,
    u: u / UQ,
    u2: u2 / UQ,
    x: x / XQ,
    y: y / XQ,
    spin: a / 1000,
    tension: tn / 100,
    flags: f,
    color: c,
    shape: sh,
  };
};

export const decodeKites = (data: unknown): KiteMsg | null => {
  const o = obj(data);
  if (!o) return null;
  const { t, p, n, k } = o;
  if (!isInt(t, 0, T_MAX) || !isInt(p, 0, MAX_POS - 1) || !isInt(n, 1, MAX_POS) || p >= n) {
    return null;
  }
  if (!Array.isArray(k) || k.length > MAX_KITES) return null;
  const kites: WireKite[] = [];
  const seen = new Set<number>();
  for (const v of k) {
    const kite = decodeKite(v);
    if (!kite || seen.has(kite.slot)) return null;
    seen.add(kite.slot);
    kites.push(kite);
  }
  return { t, pos: p, count: n, kites };
};

export interface SkyMsg {
  side: number;
  /** Ms behind the shared clock that the screen draws kites. */
  delay: number;
}

export const MAX_DELAY = 2000;

export const encodeSky = (m: SkyMsg): unknown => ({
  s: m.side === 1 ? 1 : 0,
  d: Math.round(clamp(fin(m.delay), 0, MAX_DELAY)),
});

export const decodeSky = (data: unknown): SkyMsg | null => {
  const o = obj(data);
  if (!o || !isInt(o.s, 0, 1) || !isInt(o.d, 0, MAX_DELAY)) return null;
  return { side: o.s, delay: o.d };
};

export interface TangleMsg {
  slot: number;
  on: boolean;
  /** Where the lines cross, sky coordinates (as in `kite`). */
  x: number;
  y: number;
}

export const encodeTangle = (m: TangleMsg): unknown => ({
  k: m.slot,
  o: m.on ? 1 : 0,
  x: q(m.x, XQ, X_MIN, X_MAX),
  y: q(m.y, XQ, Y_MIN, Y_MAX),
});

export const decodeTangle = (data: unknown): TangleMsg | null => {
  const o = obj(data);
  if (!o || !isInt(o.k, 0, MAX_KITES - 1) || !isInt(o.o, 0, 1)) return null;
  if (!isInt(o.x, X_MIN * XQ, X_MAX * XQ) || !isInt(o.y, Y_MIN * XQ, Y_MAX * XQ)) return null;
  return { slot: o.k, on: o.o === 1, x: o.x / XQ, y: o.y / XQ };
};

export interface RingMsg {
  ring: number;
  color: number;
  t: number;
}

const RING_MAX = 2 ** 40;

export const encodeRing = (m: RingMsg): unknown => ({
  r: Math.round(clamp(fin(m.ring), 0, RING_MAX)),
  c: m.color & 7,
  t: Math.round(clamp(fin(m.t), 0, T_MAX)),
});

export const decodeRing = (data: unknown): RingMsg | null => {
  const o = obj(data);
  if (!o || !isInt(o.r, 0, RING_MAX) || !isInt(o.c, 0, 7) || !isInt(o.t, 0, T_MAX)) return null;
  return { ring: o.r, color: o.c, t: o.t };
};

export interface WindMsg {
  /** m/s at 10 m. */
  speed: number;
  gusts: number;
  /** Degrees the wind blows from. */
  from: number;
}

export const encodeWind = (m: WindMsg): unknown => ({
  v: Math.round(clamp(fin(m.speed), 0, 60) * 10),
  g: Math.round(clamp(fin(m.gusts), 0, 90) * 10),
  d: Math.round(((fin(m.from) % 360) + 360) % 360),
});

export const decodeWind = (data: unknown): WindMsg | null => {
  const o = obj(data);
  if (!o || !isInt(o.v, 0, 600) || !isInt(o.g, 0, 900) || !isInt(o.d, 0, 360)) return null;
  return { speed: o.v / 10, gusts: o.g / 10, from: o.d };
};

export interface GustMsg {
  t: number;
  dir: number;
}

export const encodeGust = (m: GustMsg): unknown => ({
  t: Math.round(clamp(fin(m.t), 0, T_MAX)),
  d: m.dir < 0 ? -1 : 1,
});

export const decodeGust = (data: unknown): GustMsg | null => {
  const o = obj(data);
  if (!o || !isInt(o.t, 0, T_MAX) || (o.d !== 1 && o.d !== -1)) return null;
  return { t: o.t, dir: o.d };
};
