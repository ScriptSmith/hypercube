/**
 * The `ship` message: a touch frame in a bank tells the screen above it where its craft is, about
 * 15 times a second. It carries the pose, engines, phase and ghost, quantised, plus what the screen
 * needs to rebuild the frame's terrain itself: the seed, the terrain's key and the inputs of the
 * frame's layout. The layout inputs go unrounded, so the screen's terrain matches to the bit.
 *
 * Everything that arrives is checked field by field and dropped whole if anything is out of range,
 * because any page on the public site can join a room it guesses.
 */
import type { Variant } from "./config";
import { wrap } from "./craft";
import type { Phase } from "./crew";

export const TOPIC_SHIP = "td:ship";
/** Messages a second from each touch frame. */
export const SHIP_HZ = 15;
/** Positions in a bank. */
export const MAX_POS = 64;

/** Engine bits, as in `ghost.ts`, plus how the screen should draw them. */
export const SHIP_FLAG = {
  left: 1,
  right: 2,
  main: 4,
  turnLeft: 8,
  turnRight: 16,
  /** The helper flies this engine: draw its flame faint. */
  faintLeft: 32,
  faintRight: 64,
  sputter: 128,
} as const;

/** What a screen needs to lay out the touch frame exactly as the frame does. */
export interface ShipGeometry {
  kind: "panel" | "pair";
  /** Panels in the frame. */
  span: number;
  /** Venue size and reach tops, venue px. */
  width: number;
  height: number;
  adult: number;
  child: number;
  variant: Variant;
}

export interface ShipGhost {
  x: number;
  y: number;
  a: number;
  flags: number;
  /** 0 to 1. */
  alpha: number;
}

export interface Ship {
  /** Sender's ms when it took the reading (any steady clock). */
  t: number;
  pos: number;
  count: number;
  /** Seed of the frame's random streams, and the key of its current terrain. */
  seed: number;
  terrain: number;
  geo: ShipGeometry;
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  flags: number;
  phase: Phase;
  /** Seconds since the phase began. */
  phaseT: number;
  /** Stars of the landing, while landed. */
  stars: number;
  /** Flown by the autopilot, nobody playing. */
  attract: boolean;
  run: number;
  wind: number;
  ghost: ShipGhost | null;
}

const PHASES: readonly Phase[] = ["flying", "landed", "bumped"];
const KINDS = ["panel", "pair"] as const;
const VARIANTS: readonly Variant[] = ["duo", "crew"];

/** Positions and speeds stay inside these, venue px and px/s. */
const POS_MAX = 20_000;
const SPEED_MAX = 5000;
const WIND_MAX = 2000;
const SIZE_MAX = 20_000;
const SEED_MAX = 0xffffffff;
const RUN_MAX = 1e9;
const T_MAX = 1e13;
/** Phase time is sent in tenths of a second, at most 10 minutes. */
const PT_MAX = 6000;
const MRAD = 1000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const q = (v: number, max: number) => Math.round(clamp(Number.isFinite(v) ? v : 0, -max, max));

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const obj = (d: unknown): Record<string, unknown> | null =>
  typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : null;

const angle = (a: number) => Math.round(wrap(Number.isFinite(a) ? a : 0) * MRAD);

export const encodeShip = (s: Ship): unknown => {
  const g = s.geo;
  const out: Record<string, unknown> = {
    t: Math.round(clamp(s.t, 0, T_MAX)),
    p: s.pos,
    n: s.count,
    k: s.seed >>> 0,
    tr: Math.round(clamp(s.terrain, 0, RUN_MAX)),
    g: [
      KINDS.indexOf(g.kind),
      g.span,
      g.width,
      g.height,
      g.adult,
      g.child,
      VARIANTS.indexOf(g.variant),
    ],
    s: [
      q(s.x, POS_MAX),
      q(s.y, POS_MAX),
      angle(s.a),
      q(s.vx, SPEED_MAX),
      q(s.vy, SPEED_MAX),
      s.flags & 255,
      PHASES.indexOf(s.phase),
      Math.round(clamp(s.phaseT * 10, 0, PT_MAX)),
      clamp(Math.round(s.stars), 0, 3),
      s.attract ? 1 : 0,
      Math.round(clamp(s.run, 0, RUN_MAX)),
      q(s.wind, WIND_MAX),
    ],
  };
  const h = s.ghost;
  if (h && h.alpha > 0) {
    out.h = [
      q(h.x, POS_MAX),
      q(h.y, POS_MAX),
      angle(h.a),
      h.flags & 31,
      Math.round(clamp(h.alpha, 0, 1) * 100),
    ];
  }
  return out;
};

const decodeGeo = (v: unknown): ShipGeometry | null => {
  if (!Array.isArray(v) || v.length !== 7) return null;
  const [k, span, w, h, adult, child, variant] = v as unknown[];
  if (!isInt(k, 0, KINDS.length - 1) || !isInt(span, 1, 16)) return null;
  if (!isNum(w, 100, SIZE_MAX) || !isNum(h, 100, SIZE_MAX)) return null;
  if (!isNum(adult, 0, h) || !isNum(child, 0, h) || !isInt(variant, 0, VARIANTS.length - 1)) {
    return null;
  }
  const kind = KINDS[k]!;
  if ((kind === "panel") !== (span === 1)) return null;
  return { kind, span, width: w, height: h, adult, child, variant: VARIANTS[variant]! };
};

const decodeGhost = (v: unknown): ShipGhost | null | undefined => {
  if (v === undefined) return null;
  if (!Array.isArray(v) || v.length !== 5) return undefined;
  const [x, y, a, f, al] = v as unknown[];
  if (!isInt(x, -POS_MAX, POS_MAX) || !isInt(y, -POS_MAX, POS_MAX)) return undefined;
  if (!isInt(a, -3142, 3142) || !isInt(f, 0, 31) || !isInt(al, 1, 100)) return undefined;
  return { x, y, a: a / MRAD, flags: f, alpha: al / 100 };
};

export const decodeShip = (data: unknown): Ship | null => {
  const o = obj(data);
  if (!o) return null;
  const { t, p, n, k, tr } = o;
  if (!isInt(t, 0, T_MAX) || !isInt(p, 0, MAX_POS - 1) || !isInt(n, 1, MAX_POS)) return null;
  if (p >= n || !isInt(k, 0, SEED_MAX) || !isInt(tr, 0, RUN_MAX)) return null;
  const geo = decodeGeo(o.g);
  if (!geo) return null;
  const s = o.s;
  if (!Array.isArray(s) || s.length !== 12) return null;
  const [x, y, a, vx, vy, f, ph, pt, st, m, r, w] = s as unknown[];
  if (!isInt(x, -POS_MAX, POS_MAX) || !isInt(y, -POS_MAX, POS_MAX)) return null;
  if (!isInt(a, -3142, 3142) || !isInt(vx, -SPEED_MAX, SPEED_MAX)) return null;
  if (!isInt(vy, -SPEED_MAX, SPEED_MAX) || !isInt(f, 0, 255)) return null;
  if (!isInt(ph, 0, PHASES.length - 1) || !isInt(pt, 0, PT_MAX) || !isInt(st, 0, 3)) return null;
  if (!isInt(m, 0, 1) || !isInt(r, 0, RUN_MAX) || !isInt(w, -WIND_MAX, WIND_MAX)) return null;
  const ghost = decodeGhost(o.h);
  if (ghost === undefined) return null;
  return {
    t,
    pos: p,
    count: n,
    seed: k,
    terrain: tr,
    geo,
    x,
    y,
    a: a / MRAD,
    vx,
    vy,
    flags: f,
    phase: PHASES[ph]!,
    phaseT: pt / 10,
    stars: st,
    attract: m === 1,
    run: r,
    wind: w,
    ghost,
  };
};
