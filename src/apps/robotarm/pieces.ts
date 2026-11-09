/**
 * The pieces on one bench and their simple physics. Our own, and deliberately simple: no rigid
 * bodies. A released piece works out where it will come to rest before it moves (`landing`),
 * then follows that path: it falls straight down onto the highest thing under it; if its centre
 * is not over that thing (or it is a ball, which only rests on flat ground) it tips off the
 * edge, away from it, and falls again. Blocks settle onto a face as they fall.
 *
 * Supports are the bench, the pad, each bin's floor and rim, and the tops of other pieces, with
 * pieces as discs. A falling piece counts as a support at the place it will land, so two pieces
 * dropped in quick succession stack rather than merge.
 */
import {
  BALL,
  type Bench,
  type Bin,
  BLOCK,
  binLocal,
  binWorld,
  clampToBench,
  discOverBin,
} from "./bench";
import {
  CUBE_SYMMETRIES,
  dot,
  type Mat3,
  matFromQuat,
  mul,
  normalize,
  type Quat,
  quatAngle,
  quatFromMat,
  quatNormalize,
  quatToward,
  rotAxis,
  rotY,
  sub,
  transpose,
  v3,
  type Vec3,
} from "./math";
import type { Rng } from "../../core/types";

export type PieceKind = "block" | "ball";
/**
 * rest: on something. held: in the jaws. fall: following its landing path. gone: just sorted,
 * popping away. away: a finished tower sinking into the pad. up: rising off a bank's lift to the
 * screen. wait: hidden until it can arrive.
 */
export type PieceState = "rest" | "held" | "fall" | "gone" | "away" | "up" | "wait";

export const BENCH_ID = -1;
export const PAD_ID = -2;
export const LIFT_ID = -3;
export const binFloorId = (i: number) => -10 - i;
export const binWallId = (i: number) => -20 - i;

type Seg = { kind: "fall"; to: Vec3 } | { kind: "tip"; to: Vec3; axis: Vec3; from: Vec3 };

export interface Piece {
  id: number;
  kind: PieceKind;
  color: number;
  /** Half the block's edge, or the ball's radius. */
  half: number;
  pos: Vec3;
  quat: Quat;
  prevPos: Vec3;
  prevQuat: Quat;
  state: PieceState;
  /** What it rests on, or will rest on when its path ends. */
  support: number;
  /** Seconds in the current state. */
  timer: number;
  /** 0 (invisible) to 1. */
  alpha: number;
  /** Seconds since it last landed, for a small squash. */
  landed: number;
  /** Where it starts after a reset. */
  home: { x: number; z: number; yaw: number };
  path: Seg[];
  seg: number;
  segT: number;
  vy: number;
  settle: Quat;
}

export type TableEvent =
  | { type: "land"; piece: number; at: Vec3; support: number; speed: number }
  | { type: "tip"; piece: number; at: Vec3 }
  | { type: "sorted"; piece: number; bin: number; at: Vec3; color: number }
  | { type: "tower"; at: Vec3 }
  | { type: "spawn"; piece: number; at: Vec3 }
  | { type: "lifted"; piece: number; color: number; kind: PieceKind };

export const GRAVITY = 14;
const TIP_SPEED = 1.7;
const SETTLE_RATE = 8;
/** Pieces as supports: a block's top is a disc this share of its half edge (inscribed). */
const SUPPORT_R = 1;
/** A falling piece's own footprint, a little smaller so neighbours can touch. */
const FALL_R = 0.8;
/** A block rests on another only with its centre this close (share of the half edge). */
const STABLE_R = 1.1;
const GONE_S = 0.55;
/**
 * A piece on a working lift waits this long, then rises up the beam, faster and faster, until it
 * is well out of the frame.
 */
const LIFT_DELAY_S = 0.45;
export const UP_S = 2.4;
/** Speed up the beam: RISE_V0 + RISE_A * t world units per second. */
const RISE_V0 = 0.6;
const RISE_A = 7;

/** Seconds a rising piece takes to climb `d` world units. */
export const riseTime = (d: number): number => {
  const a = RISE_A / 2;
  return d <= 0 ? 0 : (-RISE_V0 + Math.sqrt(RISE_V0 * RISE_V0 + 4 * a * d)) / (2 * a);
};
const RESPAWN_S = 1.6;
const AWAY_S = 1.2;
const CELEBRATE_S = 1.6;
const SPAWN_HEIGHT = 2.1;
const MAX_ITER = 6;

export const halfOf = (kind: PieceKind) => (kind === "block" ? BLOCK / 2 : BALL);

const yawQuat = (yaw: number): Quat => quatFromMat(rotY(yaw));

/** The nearest orientation with a face down, keeping the block's turn about the vertical. */
export const flatten = (q: Quat): Quat => {
  const m = matFromQuat(q);
  const cols: Vec3[] = [v3(m[0], m[3], m[6]), v3(m[1], m[4], m[7]), v3(m[2], m[5], m[8])];
  let k = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(cols[i]!.y) > Math.abs(cols[k]!.y)) k = i;
  const up = v3(0, Math.sign(cols[k]!.y) || 1, 0);
  const next = cols[(k + 1) % 3]!;
  let h = v3(next.x, 0, next.z);
  if (Math.hypot(h.x, h.z) < 1e-6) {
    const other = cols[(k + 2) % 3]!;
    // Rotate the other horizontal axis a quarter turn about up to stand in for `next`.
    h = v3(-other.z * up.y, 0, other.x * up.y);
  }
  h = normalize(h);
  const third = v3(up.y * h.z, 0, -up.y * h.x);
  const out: Vec3[] = [v3(), v3(), v3()];
  out[k] = up;
  out[(k + 1) % 3] = h;
  out[(k + 2) % 3] = third;
  const [a, b, c] = out as [Vec3, Vec3, Vec3];
  return quatNormalize(quatFromMat([a.x, b.x, c.x, a.y, b.y, c.y, a.z, b.z, c.z]));
};

/** A flat block's yaw: the turn of one of its horizontal faces' normals (any of four). */
export const blockYaw = (q: Quat): number => {
  const m = matFromQuat(q);
  const cols: Vec3[] = [v3(m[0], m[3], m[6]), v3(m[1], m[4], m[7]), v3(m[2], m[5], m[8])];
  let best = cols[0]!;
  for (const c of cols) if (Math.abs(c.y) < Math.abs(best.y)) best = c;
  return Math.atan2(-best.z, best.x);
};

/** How far below its centre a piece reaches, at its orientation. */
export const lowestOffset = (p: Pick<Piece, "kind" | "half">, rot: Mat3): number =>
  p.kind === "ball" ? p.half : p.half * (Math.abs(rot[3]) + Math.abs(rot[4]) + Math.abs(rot[5]));

interface Support {
  id: number;
  top: number;
  /** Whether a piece of `kind` centred at (x, z) stays put on it. */
  stable: boolean;
  /** Where the faller goes when it tips off, clear of this support. */
  tip(x: number, z: number, r: number): { x: number; z: number };
}

export interface GrabCandidate {
  piece: Piece;
  /** Along the approach, piece centre relative to the grip point. */
  depth: number;
}

export interface GrabFrame {
  grip: Vec3;
  approach: Vec3;
  close: Vec3;
  side: Vec3;
  tool: Mat3;
}

/** How far off the grip point a piece may be and still be grabbed: generous on purpose. */
export const GRAB = {
  /** Along the closing axis: anywhere between the open fingers. */
  close: 0.3,
  side: 0.26,
  /** Towards the palm (negative) and towards the fingertips. */
  depthMin: -0.3,
  depthMax: 0.2,
  /** A block's face must be within this of square to the jaws. */
  align: (32 * Math.PI) / 180,
} as const;

export interface Table {
  readonly bench: Bench;
  readonly pieces: readonly Piece[];
  readonly events: TableEvent[];
  readonly counts: { sorted: number; towers: number; drops: number; sent: number };
  /** Seconds until a scored tower leaves, or null. */
  readonly celebrating: number | null;
  reset(): void;
  step(dt: number): void;
  /**
   * Height of the highest surface under a disc at (x, z): the bench, bins and the pad, and with
   * `pieces` the tops of pieces too (except those in `skip`).
   */
  floorAt(x: number, z: number, r: number, pieces: boolean, skip?: ReadonlySet<number>): number;
  grabCandidate(f: GrabFrame, gapHalf: number): GrabCandidate | null;
  /** Lift a piece out of the world into the jaws: whatever rested on it falls. */
  take(id: number): void;
  /** Let go of a held piece at its current pose. */
  release(id: number): void;
  /** The top of the tower on the pad, or the pad's top when it is empty. */
  towerTop(): number;
  /** Whether a piece rests (or will) in one of the bins, and which. */
  binOf(p: Piece): Bin | null;
  /** Points new pieces keep clear of when they arrive (the gripper). */
  setAvoid(points: Vec3[]): void;
  /**
   * The bank's lift: whether it works (the screen is there) and which colours the screen
   * still wants. Null on a bench without one.
   */
  readonly lift: { readonly active: boolean; readonly needs: readonly number[] } | null;
  setLift(active: boolean, needs: readonly number[]): void;
}

export const createTable = (bench: Bench, rng: Rng): Table => {
  const events: TableEvent[] = [];
  const counts = { sorted: 0, towers: 0, drops: 0, sent: 0 };
  const lift = bench.lift ? { active: false, needs: [0, 0, 0] } : null;
  const pieces: Piece[] = [];
  let celebrating: number | null = null;
  let nextId = 0;

  const kindsFor = (): PieceKind[] => {
    if (bench.variant === "stack") return Array.from({ length: bench.pieces }, () => "block");
    const out: PieceKind[] = ["block", "block", "block", "ball", "ball"];
    return out.slice(0, bench.pieces);
  };

  const colorFor = (i: number) =>
    bench.variant === "tidy" && bench.bins.length
      ? i < bench.bins.length
        ? bench.bins[i]!.color
        : bench.bins[rng.int(bench.bins.length)]!.color
      : i % 3;

  const makePiece = (kind: PieceKind, color: number, x: number, z: number, yaw: number): Piece => {
    const half = halfOf(kind);
    const q =
      kind === "block"
        ? yawQuat(yaw)
        : quatFromMat(mul(rotY(yaw), rotAxis(v3(1, 0, 0), yaw * 0.7)));
    const pos = v3(x, half, z);
    return {
      id: nextId++,
      kind,
      color,
      half,
      pos,
      quat: q,
      prevPos: { ...pos },
      prevQuat: { ...q },
      state: "rest",
      support: BENCH_ID,
      timer: 0,
      alpha: 1,
      landed: 10,
      home: { x, z, yaw },
      path: [],
      seg: 0,
      segT: 0,
      vy: 0,
      settle: q,
    };
  };

  /** The first deal: where each piece starts, and starts again after a reset. */
  const deal = (() => {
    const kinds = kindsFor();
    const slots = bench.slots.map((s) => ({ s, k: rng.next() })).sort((a, b) => a.k - b.k);
    const colors = kinds.map((_, i) => colorFor(i));
    for (let i = colors.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [colors[i], colors[j]] = [colors[j]!, colors[i]!];
    }
    return kinds.map((kind, i) => {
      const slot = slots[i]?.s ?? bench.slots[i % bench.slots.length]!;
      return {
        kind,
        color: colors[i] ?? 0,
        x: slot.x,
        z: slot.z,
        yaw: rng.range(-Math.PI, Math.PI),
      };
    });
  })();

  const layOut = () => {
    pieces.length = 0;
    nextId = 0;
    for (const d of deal) pieces.push(makePiece(d.kind, d.color, d.x, d.z, d.yaw));
  };

  // ---- Supports -------------------------------------------------------------------------------

  /** Pieces that act as supports: resting ones where they are, falling ones where they'll land. */
  const supportSpot = (p: Piece): Vec3 | null => {
    if (p.state === "rest") return p.pos;
    if (p.state === "fall") {
      const last = p.path[p.path.length - 1];
      return last ? last.to : p.pos;
    }
    return null;
  };

  const binSupports = (b: Bin, x: number, z: number, r: number, out: Support[]) => {
    if (!discOverBin(b, x, z, r)) return;
    const { u, v } = binLocal(b, x, z);
    const inner = b.half - b.wall;
    const inside = Math.abs(u) <= inner && Math.abs(v) <= inner;
    const fullyInside = Math.abs(u) <= inner - r && Math.abs(v) <= inner - r;
    const withinOuter = Math.abs(u) <= b.half && Math.abs(v) <= b.half;
    if (!fullyInside) {
      out.push({
        id: binWallId(b.index),
        top: b.rim,
        stable: false,
        tip(px, pz, pr) {
          const l = binLocal(b, px, pz);
          // Landing on the rim with its centre over the bin: it drops in. Otherwise it falls out.
          if (Math.abs(l.u) <= b.half && Math.abs(l.v) <= b.half) {
            const lim = Math.max(0, inner - pr - 0.01);
            return binWorld(
              b,
              Math.max(-lim, Math.min(lim, l.u)),
              Math.max(-lim, Math.min(lim, l.v)),
            );
          }
          const out2 = b.half + pr + 0.02;
          return Math.abs(l.u) >= Math.abs(l.v)
            ? binWorld(b, Math.sign(l.u) * out2, l.v)
            : binWorld(b, l.u, Math.sign(l.v) * out2);
        },
      });
    }
    if (inside || (withinOuter && !fullyInside)) {
      out.push({
        id: binFloorId(b.index),
        top: b.floor,
        stable: inside,
        tip: (px, pz) => ({ x: px, z: pz }),
      });
    }
  };

  const supportsUnder = (
    x: number,
    z: number,
    r: number,
    kind: PieceKind,
    self: number,
    pieceTops: boolean,
    skip?: ReadonlySet<number>,
  ): Support[] => {
    const out: Support[] = [
      { id: BENCH_ID, top: 0, stable: true, tip: (px, pz) => ({ x: px, z: pz }) },
    ];
    const pad = bench.pad;
    if (pad && Math.hypot(x - pad.x, z - pad.z) < pad.r + r) {
      const stable = Math.hypot(x - pad.x, z - pad.z) <= pad.r;
      out.push({
        id: PAD_ID,
        top: pad.top,
        stable,
        tip(px, pz, pr) {
          const dx = px - pad.x;
          const dz = pz - pad.z;
          const d = Math.hypot(dx, dz) || 1;
          const k = (pad.r + pr + 0.02) / d;
          return { x: pad.x + dx * k, z: pad.z + dz * k };
        },
      });
    }
    const lf = bench.lift;
    if (lf && lift?.active && Math.hypot(x - lf.x, z - lf.z) < lf.r + r) {
      out.push({
        id: LIFT_ID,
        top: lf.top,
        stable: Math.hypot(x - lf.x, z - lf.z) <= lf.r,
        tip: (px, pz) => ({ x: px, z: pz }),
      });
    }
    for (const b of bench.bins) binSupports(b, x, z, r, out);
    if (pieceTops) {
      for (const p of pieces) {
        if (p.id === self || skip?.has(p.id)) continue;
        const at = supportSpot(p);
        if (!at) continue;
        const sr = p.kind === "block" ? p.half * SUPPORT_R : p.half * 0.7;
        const dx = x - at.x;
        const dz = z - at.z;
        const d = Math.hypot(dx, dz);
        if (d >= sr + r) continue;
        const stable = kind === "block" && p.kind === "block" && d < p.half * STABLE_R;
        out.push({
          id: p.id,
          top: at.y + p.half,
          stable,
          tip(px, pz, pr) {
            let ex = px - at.x;
            let ez = pz - at.z;
            let e = Math.hypot(ex, ez);
            if (e < 1e-4) {
              // Dead centre on a ball: roll off away from the arm.
              ex = at.x;
              ez = at.z;
              e = Math.hypot(ex, ez) || 1;
            }
            const k = (sr + pr + 0.02) / e;
            return { x: at.x + ex * k, z: at.z + ez * k };
          },
        });
      }
    }
    return out;
  };

  // Called thousands of times a second by the arm's clamp, so it allocates nothing.
  const floorAt: Table["floorAt"] = (x, z, r, withPieces, skip) => {
    let top = 0;
    const pad = bench.pad;
    if (pad && pad.top > top && Math.hypot(x - pad.x, z - pad.z) < pad.r + r) top = pad.top;
    const lf = bench.lift;
    if (lf && lift?.active && lf.top > top && Math.hypot(x - lf.x, z - lf.z) < lf.r + r)
      top = lf.top;
    for (const b of bench.bins) {
      if (b.rim <= top) continue;
      const dx = x - b.x;
      const dz = z - b.z;
      const c = Math.cos(b.yaw);
      const s = Math.sin(b.yaw);
      const u = Math.abs(dx * c - dz * s);
      const v = Math.abs(dx * s + dz * c);
      const du = Math.max(0, u - b.half);
      const dv = Math.max(0, v - b.half);
      if (du * du + dv * dv >= r * r) continue;
      const inner = b.half - b.wall - r;
      top = Math.max(top, u <= inner && v <= inner ? b.floor : b.rim);
    }
    if (withPieces) {
      for (const p of pieces) {
        if (skip?.has(p.id)) continue;
        let at: Vec3;
        if (p.state === "rest") at = p.pos;
        else if (p.state === "fall") at = p.path[p.path.length - 1]?.to ?? p.pos;
        else continue;
        const pt = at.y + p.half;
        if (pt <= top) continue;
        const sr = p.kind === "block" ? p.half * SUPPORT_R : p.half * 0.7;
        if (Math.hypot(x - at.x, z - at.z) < sr + r) top = pt;
      }
    }
    return top;
  };

  /** The landing path from `from` for piece `p`, and what it ends on. */
  const landing = (p: Piece, from: Vec3): { path: Seg[]; support: number } => {
    const path: Seg[] = [];
    const r = p.half * FALL_R;
    let { x, z } = clampToBench(from.x, from.z, p.half);
    let y = from.y;
    if (Math.abs(x - from.x) > 1e-6 || Math.abs(z - from.z) > 1e-6) {
      const dir = normalize(v3(x - from.x, 0, z - from.z));
      path.push({ kind: "tip", from: { ...from }, to: v3(x, y, z), axis: v3(dir.z, 0, -dir.x) });
    }
    let bottom = y - p.half;
    for (let i = 0; i < MAX_ITER; i++) {
      const all = supportsUnder(x, z, r, p.kind, p.id, true).filter((s) => s.top <= bottom + 1e-3);
      let best = all[0]!;
      for (const s of all) {
        if (s.top > best.top + 1e-6 || (Math.abs(s.top - best.top) <= 1e-6 && s.stable)) best = s;
      }
      const restY = best.top + p.half;
      const prevTip = path[path.length - 1];
      if (prevTip?.kind === "tip" && prevTip.to.y < restY) prevTip.to.y = restY;
      path.push({ kind: "fall", to: v3(x, restY, z) });
      const ballOk =
        p.kind === "block" ||
        best.id === BENCH_ID ||
        best.id === PAD_ID ||
        best.id === LIFT_ID ||
        best.id <= -10;
      if (best.stable && ballOk) return { path, support: best.id };
      const next = best.tip(x, z, r);
      const c = clampToBench(next.x, next.z, p.half);
      const dir = normalize(v3(c.x - x, 0, c.z - z));
      const drop = Math.min(p.half * 0.6, best.top);
      path.push({
        kind: "tip",
        from: v3(x, restY, z),
        to: v3(c.x, restY - drop, c.z),
        axis: v3(dir.z, 0, -dir.x),
      });
      x = c.x;
      z = c.z;
      y = restY;
      bottom = best.top - 1e-3;
    }
    // Boxed in: settle on the bench where it is, which is always possible.
    path.push({ kind: "fall", to: v3(x, p.half, z) });
    return { path, support: BENCH_ID };
  };

  const startFall = (p: Piece, from: Vec3) => {
    const { path, support } = landing(p, from);
    p.state = "fall";
    p.path = path;
    p.seg = 0;
    p.segT = 0;
    p.vy = 0;
    p.support = support;
    p.settle = p.kind === "block" ? flatten(p.quat) : p.quat;
  };

  /** Pieces resting on, or about to land on, `id` fall again from where they are. */
  const unsupport = (id: number) => {
    const queue = [id];
    const seen = new Set<number>();
    while (queue.length) {
      const sid = queue.shift()!;
      if (seen.has(sid)) continue;
      seen.add(sid);
      for (const p of pieces) {
        if ((p.state === "rest" || p.state === "fall") && p.support === sid) {
          startFall(p, p.pos);
          queue.push(p.id);
        }
      }
    }
  };

  const binOf = (p: Piece): Bin | null => {
    const at = supportSpot(p) ?? p.pos;
    for (const b of bench.bins) {
      const { u, v } = binLocal(b, at.x, at.z);
      const inner = b.half - b.wall;
      if (Math.abs(u) <= inner && Math.abs(v) <= inner && at.y < b.rim + 3 * p.half) return b;
    }
    return null;
  };

  /** The pieces in the tower on the pad, bottom up through what each rests on. */
  const towerPieces = (): Piece[] => {
    if (!bench.pad) return [];
    const ids = new Set<number>([PAD_ID]);
    const out: Piece[] = [];
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of pieces) {
        if (p.state !== "rest" || ids.has(p.id) || !ids.has(p.support)) continue;
        ids.add(p.id);
        out.push(p);
        grew = true;
      }
    }
    return out;
  };

  const towerTop = () => {
    const pad = bench.pad;
    if (!pad) return 0;
    let top = pad.top;
    for (const p of towerPieces()) top = Math.max(top, p.pos.y + p.half);
    return top;
  };

  // ---- Arrivals ------------------------------------------------------------------------------

  const slotFree = (x: number, z: number, avoid: readonly Vec3[]) => {
    for (const p of pieces) {
      if (p.state === "wait" || p.state === "gone" || p.state === "away" || p.state === "up") {
        continue;
      }
      const at = p.state === "held" ? p.pos : (supportSpot(p) ?? p.pos);
      if (Math.hypot(at.x - x, at.z - z) < 0.55) return false;
    }
    for (const a of avoid) if (Math.hypot(a.x - x, a.z - z) < 0.75) return false;
    return true;
  };

  let avoidPoints: Vec3[] = [];

  /** Bring a waiting piece in from above at a free slot. False when the bench is too full. */
  const arrive = (p: Piece, prefer?: { x: number; z: number }): boolean => {
    let slot = prefer && slotFree(prefer.x, prefer.z, avoidPoints) ? prefer : null;
    if (!slot) {
      const free = bench.slots.filter((s) => slotFree(s.x, s.z, avoidPoints));
      if (!free.length) return false;
      slot = rng.pick(free);
    }
    if (bench.variant === "tidy") {
      p.kind = rng.next() < 0.6 ? "block" : "ball";
      p.half = halfOf(p.kind);
      p.color = bench.bins.length ? rng.pick(bench.bins).color : p.color;
    }
    const yaw = rng.range(-Math.PI, Math.PI);
    p.quat =
      p.kind === "block" ? yawQuat(yaw) : quatFromMat(rotAxis(normalize(v3(1, 0.3, 0.5)), yaw));
    p.pos = v3(slot.x, SPAWN_HEIGHT, slot.z);
    p.prevPos = { ...p.pos };
    p.prevQuat = { ...p.quat };
    p.alpha = 0;
    p.timer = 0;
    startFall(p, p.pos);
    events.push({ type: "spawn", piece: p.id, at: { ...p.pos } });
    return true;
  };

  // ---- Stepping ------------------------------------------------------------------------------

  const land = (p: Piece) => {
    const at = { ...p.pos };
    p.state = "rest";
    p.quat = p.settle;
    p.timer = 0;
    const speed = p.vy;
    p.vy = 0;
    p.landed = 0;
    p.path = [];
    events.push({ type: "land", piece: p.id, at, support: p.support, speed });
    const b = binOf(p);
    if (bench.variant === "tidy" && b && b.color === p.color) {
      p.state = "gone";
      counts.sorted++;
      events.push({ type: "sorted", piece: p.id, bin: b.index, at, color: p.color });
      unsupport(p.id);
      return;
    }
    if (bench.pad && bench.hoop && celebrating === null) {
      const top = towerTop();
      if (top >= bench.hoop.y - 0.03) {
        celebrating = CELEBRATE_S;
        counts.towers++;
        events.push({ type: "tower", at: v3(bench.pad.x, top, bench.pad.z) });
      }
    }
  };

  const stepFall = (p: Piece, dt: number) => {
    let left = dt;
    let guard = 0;
    while (left > 1e-6 && guard++ < 8) {
      const seg = p.path[p.seg];
      if (!seg) {
        land(p);
        return;
      }
      if (seg.kind === "fall") {
        p.quat = quatToward(p.quat, p.settle, SETTLE_RATE * left);
        if (p.pos.y <= seg.to.y + 1e-6) {
          p.pos = { ...seg.to };
          p.seg++;
          continue;
        }
        p.vy += GRAVITY * left;
        const ny = p.pos.y - p.vy * left;
        if (ny <= seg.to.y) {
          const used = (left * (p.pos.y - seg.to.y)) / Math.max(1e-9, p.pos.y - ny);
          p.pos = { ...seg.to };
          p.seg++;
          left -= Math.min(left, used);
          if (!p.path[p.seg]) {
            land(p);
            return;
          }
          continue;
        }
        p.pos = v3(seg.to.x, ny, seg.to.z);
        left = 0;
      } else {
        const dist = Math.hypot(seg.to.x - seg.from.x, seg.to.z - seg.from.z);
        const dur = Math.max(0.12, dist / TIP_SPEED);
        const t0 = p.segT;
        const used = Math.min(left, dur - t0);
        p.segT = t0 + used;
        left -= used;
        const f = p.segT / dur;
        const ease = f * f * (3 - 2 * f);
        p.pos = v3(
          seg.from.x + (seg.to.x - seg.from.x) * ease,
          seg.from.y + (seg.to.y - seg.from.y) * f * f,
          seg.from.z + (seg.to.z - seg.from.z) * ease,
        );
        const share = used / dur;
        const turn = p.kind === "block" ? (Math.PI / 2) * share : (dist * share) / p.half;
        if (turn > 0) {
          const r = rotAxis(seg.axis, turn);
          p.quat = quatNormalize(quatFromMat(mul(r, matFromQuat(p.quat))));
          p.settle =
            p.kind === "block" ? quatNormalize(quatFromMat(mul(r, matFromQuat(p.settle)))) : p.quat;
        }
        if (p.segT >= dur - 1e-9) {
          if (p.kind === "block") p.settle = flatten(p.settle);
          p.seg++;
          p.segT = 0;
          p.vy = 0.6;
          events.push({ type: "tip", piece: p.id, at: { ...p.pos } });
        }
      }
    }
  };

  const step = (dt: number) => {
    for (const p of pieces) {
      p.prevPos = { ...p.pos };
      p.prevQuat = { ...p.quat };
      p.timer += dt;
      p.landed += dt;
      switch (p.state) {
        case "fall":
          p.alpha = Math.min(1, p.alpha + dt / 0.35);
          stepFall(p, dt);
          break;
        case "gone":
          p.alpha = Math.max(0, 1 - p.timer / GONE_S);
          if (p.timer >= RESPAWN_S) {
            p.state = "wait";
            p.timer = 0;
          }
          break;
        case "rest":
          // On a working lift: after a moment it goes up to the screen.
          if (p.support === LIFT_ID && lift?.active && p.timer >= LIFT_DELAY_S) {
            p.state = "up";
            p.timer = 0;
            counts.sent++;
            events.push({ type: "lifted", piece: p.id, color: p.color, kind: p.kind });
            unsupport(p.id);
          }
          break;
        case "up":
          p.pos = v3(p.pos.x, p.pos.y + dt * (RISE_V0 + RISE_A * p.timer), p.pos.z);
          if (p.timer >= UP_S) {
            p.state = "wait";
            p.timer = 0;
          }
          break;
        case "away":
          p.pos = v3(p.pos.x, p.pos.y - dt * 0.9, p.pos.z);
          p.alpha = Math.max(0, 1 - p.timer / AWAY_S);
          if (p.timer >= AWAY_S) {
            p.state = "wait";
            p.timer = 0;
          }
          break;
        case "wait":
          p.alpha = 0;
          if (p.timer >= 0.3) {
            if (!arrive(p, bench.variant === "stack" ? p.home : undefined)) p.timer = 0;
          }
          break;
        default:
          break;
      }
    }
    if (celebrating !== null) {
      celebrating -= dt;
      if (celebrating <= 0) {
        celebrating = null;
        for (const p of towerPieces()) {
          p.state = "away";
          p.timer = 0;
        }
      }
    }
  };

  // ---- Grabbing ------------------------------------------------------------------------------

  const grabCandidate: Table["grabCandidate"] = (f, gapHalf) => {
    let best: GrabCandidate | null = null;
    let bestScore = Infinity;
    const cosAlign = Math.cos(GRAB.align);
    for (const p of pieces) {
      if (p.state !== "rest" && p.state !== "fall") continue;
      if (p.state === "fall" && p.alpha < 0.8) continue;
      if (gapHalf < p.half * 0.92) continue;
      const d = sub(p.pos, f.grip);
      const dc = dot(d, f.close);
      const db = dot(d, f.side);
      const da = dot(d, f.approach);
      if (Math.abs(dc) > GRAB.close || Math.abs(db) > GRAB.side) continue;
      if (da < GRAB.depthMin || da > GRAB.depthMax) continue;
      if (p.kind === "block") {
        const m = matFromQuat(p.quat);
        const a = Math.max(
          Math.abs(m[0] * f.close.x + m[3] * f.close.y + m[6] * f.close.z),
          Math.abs(m[1] * f.close.x + m[4] * f.close.y + m[7] * f.close.z),
          Math.abs(m[2] * f.close.x + m[5] * f.close.y + m[8] * f.close.z),
        );
        if (a < cosAlign) continue;
      }
      const score = Math.abs(dc) + 1.2 * Math.abs(db) + 0.8 * Math.abs(da);
      if (score < bestScore) {
        bestScore = score;
        best = { piece: p, depth: da };
      }
    }
    return best;
  };

  const take = (id: number) => {
    const p = pieces.find((q) => q.id === id);
    if (!p) return;
    p.state = "held";
    p.path = [];
    p.vy = 0;
    p.timer = 0;
    p.alpha = 1;
    unsupport(id);
  };

  const release = (id: number) => {
    const p = pieces.find((q) => q.id === id);
    if (!p || p.state !== "held") return;
    counts.drops++;
    startFall(p, p.pos);
  };

  const reset = () => {
    events.length = 0;
    celebrating = null;
    layOut();
  };

  layOut();

  return {
    bench,
    pieces,
    events,
    counts,
    get celebrating() {
      return celebrating;
    },
    reset,
    step,
    floorAt,
    grabCandidate,
    take,
    release,
    towerTop,
    binOf,
    setAvoid(points) {
      avoidPoints = points;
    },
    lift,
    setLift(active, needs) {
      if (!lift) return;
      lift.needs = [needs[0] ?? 0, needs[1] ?? 0, needs[2] ?? 0];
      if (lift.active === active) return;
      lift.active = active;
      // Pieces sitting on it settle onto the bench when it stops.
      if (!active) unsupport(LIFT_ID);
    },
  };
};

/**
 * The block's orientation squared to the jaws with the least turn from `current`, as a rotation
 * relative to the tool frame. Balls keep their orientation relative to the tool.
 */
export const heldRelative = (p: Pick<Piece, "kind" | "quat">, tool: Mat3): Mat3 => {
  const cur = matFromQuat(p.quat);
  if (p.kind === "ball") return mul(transpose(tool), cur);
  const curQ = p.quat;
  let best = CUBE_SYMMETRIES[0]!;
  let bestA = Infinity;
  for (const s of CUBE_SYMMETRIES) {
    const a = quatAngle(quatFromMat(mul(tool, s)), curQ);
    if (a < bestA) {
      bestA = a;
      best = s;
    }
  }
  return best;
};

export const placeHeld = (
  p: Piece,
  grip: Vec3,
  approach: Vec3,
  depth: number,
  tool: Mat3,
  rel: Mat3,
) => {
  p.pos = v3(grip.x + approach.x * depth, grip.y + approach.y * depth, grip.z + approach.z * depth);
  p.quat = quatNormalize(quatFromMat(mul(tool, rel)));
};
