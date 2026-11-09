/**
 * Messages between frames. Everything that arrives is checked field by field and dropped whole
 * if anything is out of range, because any page on the public site can join a room it guesses.
 *
 * - `launch`: a touch frame to the screen on its side, at release.
 * - `boom`: the screen back to the launching frame when its shell bursts.
 * - `cross`: a shell that will pass the corner, to the other corner screen, sent at once so the
 *   other screen holds it well before it arrives.
 * - `spill`: a burst near the corner edge, to the other corner screen.
 * - `volley`: one corner screen's count of recent launches, to the other.
 * - `sky`: a screen's beacon, so the frames below it and the other corner screen know it's there.
 */
import { COLOR_CHOICES, MAX_SHAPE, type ShapeId, SHAPE } from "./recipe";
import type { Burst, Shell } from "./records";

export const TOPIC = {
  launch: "fw:launch",
  boom: "fw:boom",
  cross: "fw:cross",
  spill: "fw:spill",
  volley: "fw:volley",
  sky: "fw:sky",
} as const;

export interface LaunchMsg {
  /** Pad index within the frame. */
  p: number;
  /** Pads in the frame. */
  n: number;
  /** The frame's position in its bank, and its width and height in venue px. */
  pos: number;
  fw: number;
  fh: number;
  /** Tube mouth: fraction across the frame, and depth in venue px below its top. */
  u: number;
  d: number;
  /** Angle from vertical (radians, + right), launch speed and gravity in sky units. */
  a: number;
  v: number;
  g: number;
  c: number;
  s: number;
  z: number;
  k: number;
  /** Release time, clock ms. */
  t: number;
}

export interface BoomMsg {
  p: number;
  c: number;
  u: number;
}

export interface VolleyMsg {
  s: number;
  c: number;
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

const SEED_MAX = 0xffffffff;
const T_MAX = 1e14;
const BIG = 1e6;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r1 = (v: number) => Math.round(v * 10) / 10;

const visitorShape = (v: unknown): ShapeId | null => {
  const s = int(v, 0, SHAPE.flower);
  return s === null ? null : (s as ShapeId);
};
const anyShape = (v: unknown): ShapeId | null => {
  const s = int(v, 0, MAX_SHAPE);
  return s === null ? null : (s as ShapeId);
};

export const encodeLaunch = (m: LaunchMsg): LaunchMsg => ({
  ...m,
  u: r3(m.u),
  d: r1(m.d),
  a: r3(m.a),
  v: r1(m.v),
  g: r1(m.g),
  z: r3(m.z),
  t: Math.round(m.t),
});

export const decodeLaunch = (data: unknown): LaunchMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const m = {
    p: int(d.p, 0, 15),
    n: int(d.n, 1, 16),
    pos: int(d.pos, 0, 63),
    fw: num(d.fw, 100, 20_000),
    fh: num(d.fh, 100, 20_000),
    u: num(d.u, -0.5, 1.5),
    d: num(d.d, 0, 20_000),
    a: num(d.a, -0.7, 0.7),
    v: num(d.v, 1, BIG),
    g: num(d.g, 0, BIG),
    c: int(d.c, 0, COLOR_CHOICES - 1),
    s: visitorShape(d.s),
    z: num(d.z, 0, 1),
    k: int(d.k, 0, SEED_MAX),
    t: num(d.t, 0, T_MAX),
  };
  for (const v of Object.values(m)) if (v === null) return null;
  if ((m.p as number) >= (m.n as number)) return null;
  return m as LaunchMsg;
};

export const decodeBoom = (data: unknown): BoomMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const p = int(d.p, 0, 15);
  const c = int(d.c, 0, COLOR_CHOICES - 1);
  const u = num(d.u, -0.5, 1.5);
  return p === null || c === null || u === null ? null : { p, c, u };
};

export const decodeVolley = (data: unknown): VolleyMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const s = int(d.s, 0, 1);
  const c = int(d.c, 0, 64);
  const t = num(d.t, 0, T_MAX);
  return s === null || c === null || t === null ? null : { s, c, t };
};

/** A shell as sent across the corner. */
export const encodeShell = (s: Shell): Record<string, number> => ({
  x: r1(s.path.x),
  y: r1(s.path.y),
  vx: r1(s.path.vx),
  vy: r1(s.path.vy),
  g: r1(s.path.g),
  k: r3(s.path.k),
  t0: Math.round(s.t0),
  tb: Math.round(s.tb),
  c: s.color,
  s: s.shape,
  z: r3(s.size),
  sd: s.seed,
  r: r1(s.radius),
  st: r1(s.star),
  b: r3(s.boost),
});

/** Fill `out` from a sent shell; false (and `out` untouched) if it isn't one. */
export const decodeShell = (data: unknown, out: Shell): boolean => {
  const d = obj(data);
  if (!d) return false;
  const v = {
    x: num(d.x, -BIG, BIG),
    y: num(d.y, -BIG, BIG),
    vx: num(d.vx, -BIG, BIG),
    vy: num(d.vy, -BIG, BIG),
    g: num(d.g, 0, BIG),
    k: num(d.k, 0, 50),
    t0: num(d.t0, 0, T_MAX),
    tb: num(d.tb, 0, T_MAX),
    c: int(d.c, 0, COLOR_CHOICES - 1),
    s: anyShape(d.s),
    z: num(d.z, 0, 1),
    sd: int(d.sd, 0, SEED_MAX),
    r: num(d.r, 1, BIG),
    st: num(d.st, 0.5, 1000),
    b: num(d.b, 0.1, 3),
  };
  for (const x of Object.values(v)) if (x === null) return false;
  if ((v.tb as number) < (v.t0 as number) || (v.tb as number) - (v.t0 as number) > 15_000)
    return false;
  out.path.x = v.x as number;
  out.path.y = v.y as number;
  out.path.vx = v.vx as number;
  out.path.vy = v.vy as number;
  out.path.g = v.g as number;
  out.path.k = v.k as number;
  out.t0 = v.t0 as number;
  out.tb = v.tb as number;
  out.color = v.c as number;
  out.shape = v.s as ShapeId;
  out.size = v.z as number;
  out.seed = v.sd as number;
  out.radius = v.r as number;
  out.star = v.st as number;
  out.boost = v.b as number;
  return true;
};

export const encodeBurst = (b: Burst): Record<string, number> => ({
  t0: Math.round(b.t0),
  x: r1(b.x),
  y: r1(b.y),
  vx: r1(b.vx),
  vy: r1(b.vy),
  s: b.shape,
  c: b.color,
  c2: b.color2,
  r: r1(b.radius),
  st: r1(b.star),
  n: b.count,
  sd: b.seed,
  ti: r3(b.tilt),
  l: r3(b.life),
  dr: r3(b.drag),
  gr: r1(b.gravity),
  sp: r1(b.speed),
  li: r3(b.light),
});

export const decodeBurst = (data: unknown, out: Burst): boolean => {
  const d = obj(data);
  if (!d) return false;
  const v = {
    t0: num(d.t0, 0, T_MAX),
    x: num(d.x, -BIG, BIG),
    y: num(d.y, -BIG, BIG),
    vx: num(d.vx, -BIG, BIG),
    vy: num(d.vy, -BIG, BIG),
    s: anyShape(d.s),
    c: int(d.c, 0, COLOR_CHOICES - 1),
    c2: int(d.c2, 0, COLOR_CHOICES - 1),
    r: num(d.r, 1, BIG),
    st: num(d.st, 0.5, 1000),
    n: int(d.n, 1, 6000),
    sd: int(d.sd, 0, SEED_MAX),
    ti: num(d.ti, -10, 10),
    l: num(d.l, 0.1, 4.5),
    dr: num(d.dr, 0, 50),
    gr: num(d.gr, 0, BIG),
    sp: num(d.sp, 0, BIG),
    li: num(d.li, 0, 2),
  };
  for (const x of Object.values(v)) if (x === null) return false;
  out.t0 = v.t0 as number;
  out.x = v.x as number;
  out.y = v.y as number;
  out.vx = v.vx as number;
  out.vy = v.vy as number;
  out.shape = v.s as ShapeId;
  out.color = v.c as number;
  out.color2 = v.c2 as number;
  out.radius = v.r as number;
  out.star = v.st as number;
  out.count = v.n as number;
  out.seed = v.sd as number;
  out.tilt = v.ti as number;
  out.life = v.l as number;
  out.drag = v.dr as number;
  out.gravity = v.gr as number;
  out.speed = v.sp as number;
  out.light = v.li as number;
  out.endAt = Infinity;
  return true;
};
