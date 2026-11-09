/**
 * Messages between a bank's touch frames and its screen. Everything that arrives is checked field
 * by field and dropped whole if anything is out of range, because any page on the public site can
 * join a room it guesses.
 *
 * - `sky`: the screen to every frame, four times a second: the space's size, a snapshot of its
 *   heaviest bodies and whether sizes are true (frames climb their throws in it), the time
 *   factor, the scene and the throw speed scale. It is also the screen's beacon.
 * - `go`: a frame to the screen at the moment of release: a body or black hole leaving a pad or
 *   launcher, with its place, velocity, step and the snapshot it climbed in.
 * - `aim`: a frame to the screen while a slingshot is drawn, at most 15 times a second, so the
 *   screen carries the ribbon on above the bezel. `off` ends it.
 * - `ctl`: a frame to the screen: time slower or faster, the next scene, or sizes switched.
 */
import { PICKS, type Pick } from "./bodies";
import type { Snapshot } from "./strip";

export const TOPIC = { sky: "gv:sky", go: "gv:go", aim: "gv:aim", ctl: "gv:ctl" } as const;

export const MAX_PADS = 8;
export const MAX_SNAP = 16;
/** Bank px. Larger than any bank (16 pairs is 34560) and its sky. */
const MAX_COORD = 400_000;
const MAX_SPEED = 40_000;
const MAX_GM = 1e15;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v: unknown, lo: number, hi: number): v is number =>
  num(v, lo, hi) && Number.isInteger(v);

/** Positions and speeds travel in sixteenths, which survive any encoding exactly. */
export const q16 = (v: number): number => Math.round(v * 16) / 16;

export const pickIndex = (p: Pick | "hole") => (p === "hole" ? 0 : PICKS.indexOf(p));

export interface SkyMsg {
  /** The space's width and height in bank px. */
  w: number;
  h: number;
  /** Snapshot: the clock step it was taken, and bodies as x, y, pull, radius. */
  k: number;
  b: [number, number, number, number][];
  /** Time factor index, scene index, throw speed scale in hundredths. */
  f: number;
  sc: number;
  vs: number;
  /** 1 while sizes are true: part of the snapshot, so climbs agree. */
  z: number;
}

export const encodeSky = (m: SkyMsg): SkyMsg => ({
  w: q16(m.w),
  h: q16(m.h),
  k: Math.max(0, Math.round(m.k)),
  b: m.b
    .slice(0, MAX_SNAP)
    .map(
      ([x, y, gm, r]) =>
        [q16(x), q16(y), Math.round(gm), q16(r)] as [number, number, number, number],
    )
    .filter(([, , gm, r]) => gm >= 1 && r >= 0),
  f: Math.max(0, Math.min(4, Math.round(m.f))),
  sc: Math.max(0, Math.min(4, Math.round(m.sc))),
  vs: Math.max(20, Math.min(300, Math.round(m.vs))),
  z: m.z ? 1 : 0,
});

export const decodeSky = (d: unknown): SkyMsg | null => {
  if (!isObj(d)) return null;
  const { w, h, k, b, f, sc, vs, z } = d;
  if (!num(w, 100, MAX_COORD) || !num(h, 100, MAX_COORD)) return null;
  if (!int(k, 0, Number.MAX_SAFE_INTEGER) || !int(f, 0, 4) || !int(sc, 0, 4)) return null;
  if (!int(vs, 20, 300) || !int(z, 0, 1)) return null;
  if (!Array.isArray(b) || b.length > MAX_SNAP) return null;
  const bodies: [number, number, number, number][] = [];
  for (const e of b) {
    if (!Array.isArray(e) || e.length !== 4) return null;
    const [x, y, gm, r] = e as unknown[];
    if (!num(x, -MAX_COORD, MAX_COORD) || !num(y, -MAX_COORD, MAX_COORD)) return null;
    if (!num(gm, 1, MAX_GM) || !num(r, 0, 1e5)) return null;
    bodies.push([x, y, gm, r]);
  }
  return { w, h, k, b: bodies, f, sc, vs, z };
};

export const snapshotOf = (m: SkyMsg): Snapshot => ({ k: m.k, b: m.b, z: m.z });

export interface GoMsg {
  /** 0 a body from a slingshot, 1 a black hole from a launcher. */
  k: number;
  /** Pad or launcher on the frame, its colour, and the body picked (pads only). */
  p: number;
  c: number;
  b: number;
  /** Bank px and px/s, in sixteenths. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The clock step it left at, and the snapshot it climbs in. */
  s: number;
  sn: number;
  /** 1 when a person let it go. */
  h: number;
}

export const encodeGo = (m: GoMsg): GoMsg => ({
  k: m.k === 1 ? 1 : 0,
  p: Math.max(0, Math.min(MAX_PADS - 1, Math.round(m.p))),
  c: Math.max(0, Math.min(7, Math.round(m.c))),
  b: Math.max(0, Math.min(3, Math.round(m.b))),
  x: q16(m.x),
  y: q16(m.y),
  vx: q16(m.vx),
  vy: q16(m.vy),
  s: Math.round(m.s),
  sn: Math.round(m.sn),
  h: m.h ? 1 : 0,
});

export const decodeGo = (d: unknown): GoMsg | null => {
  if (!isObj(d)) return null;
  const { k, p, c, b, x, y, vx, vy, s, sn, h } = d;
  if (!int(k, 0, 1) || !int(p, 0, MAX_PADS - 1) || !int(c, 0, 7) || !int(b, 0, 3)) return null;
  if (!int(h, 0, 1)) return null;
  if (!num(x, -MAX_COORD, MAX_COORD) || !num(y, 0, 10_000)) return null;
  if (!num(vx, -MAX_SPEED, MAX_SPEED) || !num(vy, -MAX_SPEED, MAX_SPEED)) return null;
  if (!int(s, 0, Number.MAX_SAFE_INTEGER) || !int(sn, 0, Number.MAX_SAFE_INTEGER)) return null;
  return { k, p, c, b, x, y, vx, vy, s, sn, h };
};

export interface AimMsg {
  p: number;
  c: number;
  b: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  sn: number;
  /** 1 to end this pad's ribbon. */
  off: number;
}

export const encodeAim = (m: AimMsg): AimMsg => ({
  p: Math.max(0, Math.min(MAX_PADS - 1, Math.round(m.p))),
  c: Math.max(0, Math.min(7, Math.round(m.c))),
  b: Math.max(0, Math.min(3, Math.round(m.b))),
  x: q16(m.x),
  y: q16(m.y),
  vx: q16(m.vx),
  vy: q16(m.vy),
  sn: Math.max(0, Math.round(m.sn)),
  off: m.off ? 1 : 0,
});

export const decodeAim = (d: unknown): AimMsg | null => {
  if (!isObj(d)) return null;
  const { p, c, b, x, y, vx, vy, sn, off } = d;
  if (!int(p, 0, MAX_PADS - 1) || !int(c, 0, 7) || !int(b, 0, 3) || !int(off, 0, 1)) return null;
  if (!num(x, -MAX_COORD, MAX_COORD) || !num(y, 0, 10_000)) return null;
  if (!num(vx, -MAX_SPEED, MAX_SPEED) || !num(vy, -MAX_SPEED, MAX_SPEED)) return null;
  if (!int(sn, 0, Number.MAX_SAFE_INTEGER)) return null;
  return { p, c, b, x, y, vx, vy, sn, off };
};

export interface CtlMsg {
  /** -1 slower, 1 faster, 0 neither. */
  t: number;
  /** 1 for the next scene. */
  sc: number;
  /** 1 to switch between drawn and true sizes. */
  z: number;
  /** 1 when a person pressed it. */
  h: number;
}

export const encodeCtl = (m: CtlMsg): CtlMsg => ({
  t: m.t < 0 ? -1 : m.t > 0 ? 1 : 0,
  sc: m.sc ? 1 : 0,
  z: m.z ? 1 : 0,
  h: m.h ? 1 : 0,
});

export const decodeCtl = (d: unknown): CtlMsg | null => {
  if (!isObj(d)) return null;
  const { t, sc, z, h } = d;
  if (!int(t, -1, 1) || !int(sc, 0, 1) || !int(z, 0, 1) || !int(h, 0, 1)) return null;
  return { t, sc, z, h };
};
