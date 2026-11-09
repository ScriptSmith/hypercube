/**
 * Messages on the app channel, quantised and checked field by field on arrival (any page on the
 * public site can join a room it guesses, so anything out of range drops the whole message).
 *
 * Bank:
 * - `tf:cars` (host to every frame, SNAP_HZ): shared clock time of the state, ring length in
 *   decimetres, the drawing delay frames should use, the settings, and per car 5 bytes in
 *   base64: id, position along the ring (16 bits), speed (0.1 m/s), flags.
 * - `tf:brake` (touch frame to host): brake car `c` for `d` more ms (a tap sends 1000, a held
 *   finger 800 every half second, a release whatever is left of the tap's second).
 * - `tf:ctl` (touch frame to host): an adult control, `k` 0 cars (`v` -1 or +1), 1 speed limit,
 *   2 smart cars (`v` the new index).
 * - `tf:beat` (touch frame to host, once a second): how late snapshots arrive here (ms), and
 *   whether a person touched this frame lately.
 *
 * Versus:
 * - `tf:slow` (wall to wall): a slowdown thrown at the other road, landing at shared time `t`
 *   at fraction `f` along it, in round `r`.
 * - `tf:score` (wall to wall, once a second): round `r`, and `n`, the share of this side's car
 *   time spent moving this round in thousandths; `e` once the round is over and `n` is final.
 */
import { LIMITS, MAX_CARS, MAX_ID, SMART_EVERY } from "./model";

export const TOPIC = {
  cars: "tf:cars",
  brake: "tf:brake",
  ctl: "tf:ctl",
  beat: "tf:beat",
  slow: "tf:slow",
  score: "tf:score",
} as const;

export const FLAG = {
  /** Brake lights on. */
  brake: 1,
  smart: 2,
  /** The attract mode's ghost hand is braking it. */
  ghost: 4,
  /** A finger is braking it. */
  touched: 8,
} as const;

export interface WireCar {
  id: number;
  /** Rear bumper, metres along the ring. */
  x: number;
  /** m/s of ring time. */
  v: number;
  flags: number;
}

/**
 * How far behind the shared clock frames draw: `d0` ms until clock ms `t0`, then easing towards
 * `d1`. Every frame works it out from the clock, so they all draw the same moment even while it
 * changes.
 */
export interface DelayPlan {
  d0: number;
  d1: number;
  t0: number;
}

export const DELAY_UP = 250;
export const DELAY_DOWN = 40;

/** The delay a plan gives at clock ms `t`. */
export const delayAt = (p: DelayPlan, t: number): number => {
  if (t <= p.t0) return p.d0;
  const dt = (t - p.t0) / 1000;
  return p.d1 >= p.d0
    ? Math.min(p.d1, p.d0 + DELAY_UP * dt)
    : Math.max(p.d1, p.d0 - DELAY_DOWN * dt);
};

export interface SnapMsg {
  /** Shared clock ms the state belongs to. */
  t: number;
  /** Ring length, metres. */
  length: number;
  /** How far behind the shared clock frames should draw. */
  delay: DelayPlan;
  count: number;
  limit: number;
  smart: number;
  /** 1 while attract mode runs on the host. */
  attract: boolean;
  cars: WireCar[];
}

const T_MAX = 1e13;
const LEN_MAX = 100_000;
const POS_Q = 65536;
const V_MAX = 25.5;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const fin = (v: number) => (Number.isFinite(v) ? v : 0);
const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const obj = (d: unknown): Record<string, unknown> | null =>
  typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : null;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_INDEX[B64.charCodeAt(i)] = i;

/** Base64 without padding, for byte arrays whose length is a multiple of 3 or not. */
export const toBase64 = (bytes: Uint8Array, n = bytes.length): string => {
  let out = "";
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < n ? bytes[i + 1]! : 0;
    const c = i + 2 < n ? bytes[i + 2]! : 0;
    const w = (a << 16) | (b << 8) | c;
    out += B64[(w >> 18) & 63]! + B64[(w >> 12) & 63]!;
    if (i + 1 < n) out += B64[(w >> 6) & 63]!;
    if (i + 2 < n) out += B64[w & 63]!;
  }
  return out;
};

/** Bytes from unpadded base64, or null if any character is foreign. */
export const fromBase64 = (s: string): Uint8Array | null => {
  const n = Math.floor((s.length * 3) / 4);
  if (s.length % 4 === 1) return null;
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    let w = 0;
    let k = 0;
    for (; k < 4 && i + k < s.length; k++) {
      const code = s.charCodeAt(i + k);
      const v = code < 128 ? B64_INDEX[code]! : -1;
      if (v < 0) return null;
      w |= v << (18 - 6 * k);
    }
    if (k >= 2 && o < n) out[o++] = (w >> 16) & 255;
    if (k >= 3 && o < n) out[o++] = (w >> 8) & 255;
    if (k >= 4 && o < n) out[o++] = w & 255;
  }
  return out;
};

const BYTES = 5;
const scratch = new Uint8Array(MAX_CARS * BYTES);

export const encodeSnap = (m: SnapMsg): unknown => {
  const n = Math.min(MAX_CARS, m.cars.length);
  const L = Math.max(1, m.length);
  for (let i = 0; i < n; i++) {
    const c = m.cars[i]!;
    const at = i * BYTES;
    let f = fin(c.x) / L;
    f -= Math.floor(f);
    const p = Math.min(POS_Q - 1, Math.round(f * POS_Q)) % POS_Q;
    scratch[at] = c.id & 255;
    scratch[at + 1] = p >> 8;
    scratch[at + 2] = p & 255;
    scratch[at + 3] = Math.round(clamp(fin(c.v), 0, V_MAX) * 10);
    scratch[at + 4] = c.flags & 15;
  }
  return {
    t: Math.round(clamp(fin(m.t), 0, T_MAX)),
    l: Math.round(clamp(fin(m.length), 1, LEN_MAX) * 10),
    d: [
      Math.round(clamp(fin(m.delay.d0), 0, 5000)),
      Math.round(clamp(fin(m.delay.d1), 0, 5000)),
      Math.round(clamp(fin(m.delay.t0) - fin(m.t), -60_000, 60_000)),
    ],
    s: [m.count, m.limit, m.smart],
    a: m.attract ? 1 : 0,
    c: toBase64(scratch, n * BYTES),
  };
};

export const decodeSnap = (data: unknown): SnapMsg | null => {
  const o = obj(data);
  if (!o || !isInt(o.t, 0, T_MAX) || !isInt(o.l, 10, LEN_MAX * 10)) return null;
  const d = o.d;
  if (!Array.isArray(d) || d.length !== 3 || !isInt(d[0], 0, 5000) || !isInt(d[1], 0, 5000)) {
    return null;
  }
  if (!isInt(d[2], -60_000, 60_000)) return null;
  const s = o.s;
  if (!Array.isArray(s) || s.length !== 3) return null;
  if (!isInt(s[0], 0, MAX_CARS) || !isInt(s[1], 0, LIMITS.length - 1)) return null;
  if (!isInt(s[2], 0, SMART_EVERY.length - 1)) return null;
  if (typeof o.c !== "string" || o.c.length > Math.ceil((MAX_CARS * BYTES * 4) / 3)) return null;
  const bytes = fromBase64(o.c);
  if (!bytes || bytes.length % BYTES !== 0) return null;
  const length = o.l / 10;
  const cars: WireCar[] = [];
  const seen = new Set<number>();
  for (let at = 0; at < bytes.length; at += BYTES) {
    const id = bytes[at]!;
    if (id > MAX_ID || seen.has(id)) return null;
    seen.add(id);
    const p = (bytes[at + 1]! << 8) | bytes[at + 2]!;
    const v = bytes[at + 3]! / 10;
    if (v > V_MAX) return null;
    cars.push({ id, x: (p / POS_Q) * length, v, flags: bytes[at + 4]! & 15 });
  }
  return {
    t: o.t,
    length,
    delay: { d0: d[0], d1: d[1], t0: o.t + d[2] },
    count: s[0],
    limit: s[1],
    smart: s[2],
    attract: o.a === 1,
    cars,
  };
};

export interface BrakeMsg {
  car: number;
  ms: number;
  person: boolean;
}

export const encodeBrake = (m: BrakeMsg): unknown => ({
  c: m.car & 255,
  d: Math.round(clamp(fin(m.ms), 0, 1500)),
  p: m.person ? 1 : 0,
});

export const decodeBrake = (data: unknown): BrakeMsg | null => {
  const o = obj(data);
  if (!o || !isInt(o.c, 0, MAX_ID) || !isInt(o.d, 0, 1500)) return null;
  return { car: o.c, ms: o.d, person: o.p === 1 };
};

export interface CtlMsg {
  /** 0 cars, 1 limit, 2 smart. */
  key: 0 | 1 | 2;
  value: number;
  person: boolean;
}

export const encodeCtl = (m: CtlMsg): unknown => ({ k: m.key, v: m.value, p: m.person ? 1 : 0 });

export const decodeCtl = (data: unknown): CtlMsg | null => {
  const o = obj(data);
  if (!o || !isInt(o.k, 0, 2)) return null;
  const k = o.k as 0 | 1 | 2;
  const ok =
    k === 0
      ? o.v === -1 || o.v === 1
      : isInt(o.v, 0, (k === 1 ? LIMITS.length : SMART_EVERY.length) - 1);
  if (!ok) return null;
  return { key: k, value: o.v as number, person: o.p === 1 };
};

export interface BeatMsg {
  /** How late snapshots arrive, ms. */
  late: number;
  person: boolean;
}

export const encodeBeat = (m: BeatMsg): unknown => ({
  l: Math.round(clamp(fin(m.late), 0, 5000)),
  p: m.person ? 1 : 0,
});

export const decodeBeat = (data: unknown): BeatMsg | null => {
  const o = obj(data);
  if (!o || !isInt(o.l, 0, 5000)) return null;
  return { late: o.l, person: o.p === 1 };
};

export interface SlowMsg {
  round: number;
  /** Shared clock ms when it lands. */
  t: number;
  /** Fraction along the other road, 0 to 1. */
  f: number;
}

export const encodeSlow = (m: SlowMsg): unknown => ({
  r: m.round,
  t: Math.round(clamp(fin(m.t), 0, T_MAX)),
  f: Math.round(clamp(fin(m.f), 0, 1) * 1000),
});

export const decodeSlow = (data: unknown): SlowMsg | null => {
  const o = obj(data);
  if (!o || !isInt(o.r, 0, 2 ** 40) || !isInt(o.t, 0, T_MAX) || !isInt(o.f, 0, 1000)) return null;
  return { round: o.r, t: o.t, f: o.f / 1000 };
};

export interface ScoreMsg {
  round: number;
  /** Thousandths of car time spent moving this round. */
  n: number;
  /** True once the round is over and `n` is final. */
  done: boolean;
}

export const encodeScore = (m: ScoreMsg): unknown => ({
  r: m.round,
  n: Math.round(clamp(fin(m.n), 0, 1000)),
  e: m.done ? 1 : 0,
});

export const decodeScore = (data: unknown): ScoreMsg | null => {
  const o = obj(data);
  if (!o || !isInt(o.r, 0, 2 ** 40) || !isInt(o.n, 0, 1000)) return null;
  return { round: o.r, n: o.n, done: o.e === 1 };
};
