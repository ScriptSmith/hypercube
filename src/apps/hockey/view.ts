/**
 * Messages between the touch frames of a bank and the screen above them.
 *
 * - `hk:v` view, about 12 times a second from each touch frame: its phase, score, time left,
 *   rally length and every lane's pucks and mallets. Positions are fractions of the frame,
 *   quantised to whole thousandths, so a view is a hundred or so bytes.
 * - `hk:up` (defence): a puck leaving the top of a frame for the screen's deck.
 * - `hk:dn` (defence): a puck dropping off the deck into the frame below.
 * - `hk:dk` (defence): the deck's wave count, twice a second.
 *
 * Everything that arrives is validated: a bad message is dropped, never trusted.
 */
import type { FrameKind } from "../../core/types";
import { apply } from "./layout";
import type { Phase } from "./match";
import { scoreOf, timeLeft } from "./match";
import type { Table } from "./table";

export const TOPIC_VIEW = "hk:v";
export const TOPIC_UP = "hk:up";
export const TOPIC_DOWN = "hk:dn";
export const TOPIC_DECK = "hk:dk";

/** Fractions are sent as whole thousandths. */
const Q = 1000;
const MAX_LANES = 2;
const MAX_PIECES = 16;

const PHASES: readonly Phase[] = ["attract", "countdown", "play", "over"];

export interface LaneView {
  /** Lane surface as [x, y, w, h], fractions of the frame. */
  rect: [number, number, number, number];
  /** Goal mouth centres as [x, y, hue] (frame fractions), one per goal. */
  goals: [number, number, number][];
  /** Puck centres [x, y]. */
  pucks: [number, number][];
  /** Mallets [x, y, hue, person]. */
  mallets: [number, number, number, boolean][];
  /** Puck and mallet radii, fractions of the frame width. */
  puckR: number;
  malletR: number;
}

export interface View {
  pos: number;
  count: number;
  kind: FrameKind;
  phase: Phase;
  /** Set when over: the winning side, or -1. */
  winner: number | null;
  score: [number, number];
  /** Whole seconds of play left. */
  left: number;
  /** Exchanges (hits by alternating sides) since the last goal. */
  rally: number;
  lanes: LaneView[];
}

const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * Q);
const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const ints = (v: unknown, n: number): number[] | null =>
  Array.isArray(v) && v.length <= n && v.every((x) => isInt(x, 0, Q)) ? (v as number[]) : null;

/** The wire form of a view: small arrays of integers. */
export const encodeView = (
  table: Table,
  frame: { width: number; height: number; kind: FrameKind },
  pos: number,
  count: number,
  rally: number,
  now: number,
): unknown => {
  const { width: FW, height: FH } = frame;
  const fx = (x: number) => q(x / FW);
  const fy = (y: number) => q(y / FH);
  const m = table.match;
  return {
    p: pos,
    n: count,
    k: frame.kind,
    ph: PHASES.indexOf(m.phase),
    w: m.winner ?? -2,
    s: scoreOf(m),
    t: Math.ceil(timeLeft(m, now)),
    r: Math.min(999, rally),
    l: table.lanes.slice(0, MAX_LANES).map((lane) => {
      const { toVenue, rect, params } = lane.spec;
      const goals: number[] = [];
      for (const end of [0, 1] as const) {
        for (const mouth of params.mouths[end]) {
          const c = apply(toVenue, end === 0 ? 0 : params.length, (mouth.y0 + mouth.y1) / 2);
          goals.push(
            fx(c.x),
            fy(c.y),
            params.variant === "defence" ? mouth.slot : params.ends[end].side,
          );
        }
      }
      const pucks: number[] = [];
      for (const p of lane.pucks) {
        if (!p.live || pucks.length >= MAX_PIECES * 2) continue;
        const c = apply(toVenue, p.x, p.y);
        pucks.push(fx(c.x), fy(c.y));
      }
      const mallets: number[] = [];
      for (const pl of lane.players.slice(0, MAX_PIECES)) {
        const c = apply(toVenue, pl.mallet.x, pl.mallet.y);
        mallets.push(fx(c.x), fy(c.y), pl.spec.hue, pl.human ? 1 : 0);
      }
      return {
        r: [
          fx(rect.x),
          fy(rect.y),
          fx(rect.x + rect.width) - fx(rect.x),
          fy(rect.y + rect.height) - fy(rect.y),
        ],
        g: goals,
        q: pucks,
        m: mallets,
        pr: q(params.puckR / FW),
        mr: q(params.malletR / FW),
      };
    }),
  };
};

const KINDS: readonly FrameKind[] = ["panel", "pair", "wall", "kiosk", "screen"];

export const decodeView = (v: unknown): View | null => {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isInt(o.p, 0, 63) || !isInt(o.n, 1, 64) || o.p >= o.n) return null;
  if (typeof o.k !== "string" || !(KINDS as readonly string[]).includes(o.k)) return null;
  if (!isInt(o.ph, 0, 3) || !isInt(o.w, -2, 1) || !isInt(o.t, 0, 3600) || !isInt(o.r, 0, 999)) {
    return null;
  }
  const s = o.s;
  if (!Array.isArray(s) || s.length !== 2 || !isInt(s[0], 0, 999) || !isInt(s[1], 0, 999))
    return null;
  if (!Array.isArray(o.l) || o.l.length > MAX_LANES) return null;
  const lanes: LaneView[] = [];
  for (const l of o.l as unknown[]) {
    if (typeof l !== "object" || l === null) return null;
    const lo = l as Record<string, unknown>;
    const r = ints(lo.r, 4);
    const g =
      Array.isArray(lo.g) && lo.g.length <= MAX_PIECES * 3 && lo.g.every((x) => isInt(x, 0, Q))
        ? (lo.g as number[])
        : null;
    const pq = ints(lo.q, MAX_PIECES * 2);
    const m = ints(lo.m, MAX_PIECES * 4);
    if (!r || r.length !== 4 || !g || g.length % 3 || !pq || pq.length % 2 || !m || m.length % 4)
      return null;
    if (!isInt(lo.pr, 0, Q) || !isInt(lo.mr, 0, Q)) return null;
    const f = (x: number) => x / Q;
    lanes.push({
      rect: [f(r[0]!), f(r[1]!), f(r[2]!), f(r[3]!)],
      goals: Array.from({ length: g.length / 3 }, (_, i) => [
        f(g[i * 3]!),
        f(g[i * 3 + 1]!),
        g[i * 3 + 2]!,
      ]),
      pucks: Array.from({ length: pq.length / 2 }, (_, i) => [f(pq[i * 2]!), f(pq[i * 2 + 1]!)]),
      mallets: Array.from({ length: m.length / 4 }, (_, i) => [
        f(m[i * 4]!),
        f(m[i * 4 + 1]!),
        m[i * 4 + 2]!,
        m[i * 4 + 3] === 1,
      ]),
      puckR: f(lo.pr),
      malletR: f(lo.mr),
    });
  }
  return {
    pos: o.p,
    count: o.n,
    kind: o.k as FrameKind,
    phase: PHASES[o.ph]!,
    winner: o.w === -2 ? null : o.w,
    score: [s[0], s[1]],
    left: o.t,
    rally: o.r,
    lanes,
  };
};

/** A defence puck moving between a frame and the deck. `u` is across the frame (0 to 1). */
export interface Handoff {
  pos: number;
  u: number;
  /** Speeds as fractions of the sender's puck speed cap; `vx` is always the speed out. */
  vx: number;
  vy: number;
}

export const encodeHandoff = (h: Handoff): unknown => ({
  p: h.pos,
  u: Math.round(Math.min(1, Math.max(0, h.u)) * Q),
  vx: Math.round(Math.min(2, Math.abs(h.vx)) * Q),
  vy: Math.round(Math.min(2, Math.max(-2, h.vy)) * Q),
});

export const decodeHandoff = (v: unknown): Handoff | null => {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (
    !isInt(o.p, 0, 63) ||
    !isInt(o.u, 0, Q) ||
    !isInt(o.vx, 0, 2 * Q) ||
    !isInt(o.vy, -2 * Q, 2 * Q)
  ) {
    return null;
  }
  return { pos: o.p, u: o.u / Q, vx: o.vx / Q, vy: o.vy / Q };
};
