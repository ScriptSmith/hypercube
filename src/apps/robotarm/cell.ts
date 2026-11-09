/**
 * One arm on its bench: the joints' servos, the clamp that keeps the arm out of the bench and
 * itself, the gripper and the piece it holds. Pure apart from the table it owns.
 *
 * Each dial sets its joint's target; the servo follows at a limited speed and acceleration, so
 * the arm moves smoothly and lags a fast spin. Before a joint takes its step the clamp checks
 * the new pose: if any part of the arm (or the held piece) would go into the bench, a bin, a
 * piece, the base column or the upper arm, and further in than it already is, that joint stops
 * and its target is pulled back to where it is. The dial then feels like it hit a stop.
 */
import { type Bench } from "./bench";
import { type Config } from "./config";
import {
  clampJoint,
  forward,
  GRIP,
  HOME,
  JOINT_COUNT,
  JOINTS,
  type Joints,
  type Pose,
  SPEED_SCALE,
  toolPoint,
} from "./kinematics";
import {
  clamp,
  dot,
  lerp3,
  type Mat3,
  matFromQuat,
  type Quat,
  quatFromMat,
  quatNormalize,
  slerp,
  sub,
  v3,
  type Vec3,
} from "./math";
import {
  createTable,
  heldRelative,
  lowestOffset,
  type Piece,
  type Table,
  type TableEvent,
} from "./pieces";
import type { Rng } from "../../core/types";

export type CellEvent =
  | TableEvent
  | { type: "grab"; piece: number }
  | { type: "release"; piece: number }
  | { type: "blocked"; joint: number }
  | { type: "limit"; joint: number };

export type Mode = "demo" | "people";

/** Servo: proportional gain (1/s) and acceleration as a multiple of each joint's top speed. */
const KP = 5;
const ACCEL = 4.5;
/** Seconds for a grabbed piece to square up in the jaws. */
const SNAP_S = 0.16;
/** The base column and the upper arm, as obstacles for the gripper. */
const BASE_R = 0.52;
const BASE_TOP = 1.28;
const UPPER_R = 0.24;
const MAX_EVENTS = 64;

export interface Grip {
  /** The button's state: closed (or closing) or open. */
  closed: boolean;
  /** Half the gap between the fingers now. */
  gap: number;
  prevGap: number;
  held: number | null;
  /** The held piece's orientation in the tool frame, and its offset along the approach. */
  rel: Mat3 | null;
  depth: number;
  /** 0 to 1 while the held piece squares up. */
  snap: number;
  from: { pos: Vec3; quat: Quat } | null;
}

export interface Cell {
  readonly index: number;
  readonly table: Table;
  readonly bench: Bench;
  readonly q: Joints;
  readonly prevQ: Joints;
  readonly target: Joints;
  readonly pose: Pose;
  readonly grip: Grip;
  /** Seconds since each joint was last stopped by the clamp, or by its limit. */
  readonly blocked: number[];
  readonly limited: number[];
  /** How many times each joint has been stopped by the clamp. */
  readonly stops: number[];
  readonly events: CellEvent[];
  readonly counts: { grabs: number; sorted: number; towers: number; drops: number; sent: number };
  mode: Mode;
  /** ms timestamps of the last touch of any kind, and of a person's touch, on this arm. */
  lastTouch: number;
  lastHuman: number;
  /** Turn a joint's target by `delta` radians; returns the change actually made. */
  turn(i: number, delta: number): number;
  setTarget(i: number, value: number): void;
  pressGrip(): void;
  step(dt: number): void;
  reset(): void;
  /** Put the arm back at home at once, letting go of anything held; the pieces stay. */
  home(): void;
  /** The held piece, if any. */
  heldPiece(): Piece | null;
  /** Pieces whose centre is between the open fingers. */
  straddled(): Piece[];
  /** How far the arm is from touching anything; negative inside. */
  clearance(q?: readonly number[]): number;
}

export const createCell = (opts: {
  index: number;
  bench: Bench;
  config: Config;
  rng: Rng;
}): Cell => {
  const { bench, config } = opts;
  const table = createTable(bench, opts.rng.fork("table"));
  const q = [...HOME] as Joints;
  const prevQ = [...HOME] as Joints;
  const target = [...HOME] as Joints;
  const vel = [0, 0, 0, 0, 0, 0];
  const blocked = Array.from({ length: JOINT_COUNT }, () => 99);
  const limited = Array.from({ length: JOINT_COUNT }, () => 99);
  const stops = Array.from({ length: JOINT_COUNT }, () => 0);
  const events: CellEvent[] = [];
  const counts = { grabs: 0, sorted: 0, towers: 0, drops: 0, sent: 0 };
  const speed = SPEED_SCALE[config.speed];
  const grip: Grip = {
    closed: false,
    gap: GRIP.openHalf,
    prevGap: GRIP.openHalf,
    held: null,
    rel: null,
    depth: 0,
    snap: 1,
    from: null,
  };
  let pose = forward(q);

  const push = (e: CellEvent) => {
    if (events.length >= MAX_EVENTS) events.shift();
    events.push(e);
  };

  const heldPiece = () =>
    grip.held === null ? null : (table.pieces.find((p) => p.id === grip.held) ?? null);

  /** Where the held piece sits in the jaws for a pose. */
  const heldTarget = (p: Pose): { pos: Vec3; rot: Mat3 } | null => {
    if (!grip.rel) return null;
    const pos = v3(
      p.grip.x + p.approach.x * grip.depth,
      p.grip.y + p.approach.y * grip.depth,
      p.grip.z + p.approach.z * grip.depth,
    );
    const t = p.tool;
    const r = grip.rel;
    const rot: Mat3 = [
      t[0] * r[0] + t[1] * r[3] + t[2] * r[6],
      t[0] * r[1] + t[1] * r[4] + t[2] * r[7],
      t[0] * r[2] + t[1] * r[5] + t[2] * r[8],
      t[3] * r[0] + t[4] * r[3] + t[5] * r[6],
      t[3] * r[1] + t[4] * r[4] + t[5] * r[7],
      t[3] * r[2] + t[4] * r[5] + t[5] * r[8],
      t[6] * r[0] + t[7] * r[3] + t[8] * r[6],
      t[6] * r[1] + t[7] * r[4] + t[8] * r[7],
      t[6] * r[2] + t[7] * r[5] + t[8] * r[8],
    ];
    return { pos, rot };
  };

  const between = (p: Pose, gap: number): Piece[] => {
    const out: Piece[] = [];
    for (const piece of table.pieces) {
      if (piece.state !== "rest" && piece.state !== "fall") continue;
      if (gap < piece.half * 0.9) continue;
      const d = sub(piece.pos, p.grip);
      if (Math.abs(dot(d, p.close)) > gap + 0.03) continue;
      if (Math.abs(dot(d, p.side)) > 0.3) continue;
      const da = dot(d, p.approach);
      if (da < -0.45 || da > 0.35) continue;
      out.push(piece);
    }
    return out;
  };

  const skipHeld = new Set<number>();
  const skipFingers = new Set<number>();

  /** Signed clearance of a point of radius r above the floor and away from the base and arm. */
  const pointClear = (
    pt: Vec3,
    r: number,
    skip: ReadonlySet<number>,
    p: Pose,
    gripper: boolean,
  ): number => {
    let c = pt.y - r - table.floorAt(pt.x, pt.z, Math.max(r, 0.02), true, skip);
    if (gripper) {
      if (pt.y < BASE_TOP + r) c = Math.min(c, Math.hypot(pt.x, pt.z) - BASE_R - r);
      // Distance to the upper arm, shoulder to elbow.
      const a = p.shoulder;
      const ab = sub(p.elbow, a);
      const t = clamp(dot(sub(pt, a), ab) / dot(ab, ab), 0, 1);
      const near = v3(a.x + ab.x * t, a.y + ab.y * t, a.z + ab.z * t);
      c = Math.min(c, Math.hypot(pt.x - near.x, pt.y - near.y, pt.z - near.z) - UPPER_R - r);
    }
    return c;
  };

  const clearanceOf = (p: Pose, gap: number): number => {
    skipHeld.clear();
    skipFingers.clear();
    if (grip.held !== null) {
      skipHeld.add(grip.held);
      skipFingers.add(grip.held);
    } else {
      for (const s of between(p, gap)) skipFingers.add(s.id);
    }
    let c = pointClear(p.elbow, 0.26, skipHeld, p, false);
    c = Math.min(c, pointClear(lerp3(p.elbow, p.wrist, 0.5), 0.17, skipHeld, p, false));
    c = Math.min(c, pointClear(p.wrist, 0.19, skipHeld, p, true));
    const pt = GRIP.palmAt + GRIP.palmHalf.t;
    c = Math.min(c, pointClear(toolPoint(p, pt), 0.03, skipHeld, p, true));
    for (const sc of [-1, 1]) {
      for (const sb of [-1, 1]) {
        c = Math.min(
          c,
          pointClear(
            toolPoint(p, pt, sc * GRIP.palmHalf.c, sb * GRIP.palmHalf.b),
            0.02,
            skipHeld,
            p,
            true,
          ),
        );
        const fc = sc * (gap + GRIP.fingerHalfC);
        const fb = sb * GRIP.fingerHalfB;
        for (const ft of [GRIP.fingerFrom, GRIP.fingerTo]) {
          c = Math.min(
            c,
            pointClear(toolPoint(p, ft, fc, fb), GRIP.fingerHalfC, skipFingers, p, true),
          );
        }
      }
    }
    const held = heldPiece();
    const ht = held ? heldTarget(p) : null;
    if (held && ht) {
      const bottom = ht.pos.y - lowestOffset(held, ht.rot);
      const floor = table.floorAt(ht.pos.x, ht.pos.z, held.half * 0.9, true, skipHeld);
      c = Math.min(c, bottom - floor);
      if (ht.pos.y < BASE_TOP + held.half) {
        c = Math.min(c, Math.hypot(ht.pos.x, ht.pos.z) - BASE_R - held.half);
      }
    }
    return c;
  };

  const clearance = (qq: readonly number[] = q) => clearanceOf(forward(qq), grip.gap);

  const stepServos = (dt: number) => {
    let current = clearanceOf(pose, grip.gap);
    const trial = [...q] as Joints;
    for (let i = 0; i < JOINT_COUNT; i++) {
      const j = JOINTS[i]!;
      blocked[i] = (blocked[i] ?? 0) + dt;
      limited[i] = (limited[i] ?? 0) + dt;
      const err = target[i]! - q[i]!;
      const vmax = j.rate * speed;
      const amax = vmax * ACCEL;
      const want = clamp(err * KP, -vmax, vmax);
      let v = vel[i]! + clamp(want - vel[i]!, -amax * dt, amax * dt);
      let stepA = v * dt;
      if ((err > 0 && stepA > err) || (err < 0 && stepA < err) || Math.abs(err) < 1e-6) {
        stepA = err;
        v = 0;
      }
      if (stepA === 0) {
        vel[i] = 0;
        continue;
      }
      trial[i] = q[i]! + stepA;
      const next = clearanceOf(forward(trial), grip.gap);
      if (next < 0 && next < current - 1e-7) {
        trial[i] = q[i]!;
        vel[i] = 0;
        if (Math.abs(target[i]! - q[i]!) > 1e-4) {
          target[i] = q[i]!;
          stops[i] = (stops[i] ?? 0) + 1;
          if (blocked[i]! > 0.25) push({ type: "blocked", joint: i });
          blocked[i] = 0;
        }
        continue;
      }
      q[i] = trial[i]!;
      vel[i] = v;
      current = next;
    }
    pose = forward(q);
  };

  const stepGrip = (dt: number) => {
    grip.prevGap = grip.gap;
    const held = heldPiece();
    const goal = grip.closed ? (held ? held.half + 0.004 : GRIP.closedHalf) : GRIP.openHalf;
    const rate = (GRIP.openHalf - GRIP.closedHalf) / GRIP.closeTime;
    const d = goal - grip.gap;
    const stepG = clamp(d, -rate * dt, rate * dt);
    if (stepG > 0) {
      // Opening must not push a finger into anything either.
      const before = clearanceOf(pose, grip.gap);
      const after = clearanceOf(pose, grip.gap + stepG);
      if (after < 0 && after < before - 1e-7) return;
    }
    grip.gap += stepG;
  };

  const stepHeld = (dt: number) => {
    const held = heldPiece();
    if (!held) return;
    const t = heldTarget(pose);
    if (!t) return;
    const tq = quatNormalize(quatFromMat(t.rot));
    if (grip.snap < 1 && grip.from) {
      grip.snap = Math.min(1, grip.snap + dt / SNAP_S);
      const e = grip.snap * grip.snap * (3 - 2 * grip.snap);
      held.pos = lerp3(grip.from.pos, t.pos, e);
      held.quat = slerp(grip.from.quat, tq, e);
    } else {
      held.pos = t.pos;
      held.quat = tq;
    }
  };

  const pressGrip = () => {
    if (grip.closed) {
      grip.closed = false;
      const held = heldPiece();
      if (held) {
        table.release(held.id);
        push({ type: "release", piece: held.id });
        counts.drops++;
      }
      grip.held = null;
      grip.rel = null;
      grip.from = null;
      return;
    }
    grip.closed = true;
    const cand = table.grabCandidate(
      {
        grip: pose.grip,
        approach: pose.approach,
        close: pose.close,
        side: pose.side,
        tool: pose.tool,
      },
      grip.gap,
    );
    if (!cand) return;
    const p = cand.piece;
    grip.from = { pos: { ...p.pos }, quat: { ...p.quat } };
    grip.rel = heldRelative(p, pose.tool);
    grip.depth = clamp(cand.depth, -0.12, 0.08);
    grip.snap = 0;
    grip.held = p.id;
    table.take(p.id);
    counts.grabs++;
    push({ type: "grab", piece: p.id });
  };

  const turn = (i: number, delta: number): number => {
    const before = target[i];
    if (before === undefined || !Number.isFinite(delta)) return 0;
    const want = before + delta;
    const next = clampJoint(i, want);
    if (Math.abs(next - want) > 1e-6) {
      if ((limited[i] ?? 99) > 0.4) push({ type: "limit", joint: i });
      limited[i] = 0;
    }
    target[i] = next;
    return next - before;
  };

  const setTarget = (i: number, value: number) => {
    if (i < 0 || i >= JOINT_COUNT || !Number.isFinite(value)) return;
    target[i] = clampJoint(i, value);
  };

  const step = (dt: number) => {
    for (let i = 0; i < JOINT_COUNT; i++) prevQ[i] = q[i]!;
    stepServos(dt);
    stepGrip(dt);
    table.setAvoid([pose.grip]);
    // The table keeps each piece's previous pose for drawing; the held one moves after that.
    table.step(dt);
    stepHeld(dt);
    for (const e of table.events) {
      if (e.type === "sorted") counts.sorted++;
      if (e.type === "tower") counts.towers++;
      if (e.type === "lifted") counts.sent++;
      push(e);
    }
    table.events.length = 0;
  };

  const home = () => {
    const held = heldPiece();
    if (held) table.release(held.id);
    for (let i = 0; i < JOINT_COUNT; i++) {
      q[i] = HOME[i]!;
      prevQ[i] = HOME[i]!;
      target[i] = HOME[i]!;
      vel[i] = 0;
    }
    grip.closed = false;
    grip.gap = GRIP.openHalf;
    grip.prevGap = GRIP.openHalf;
    grip.held = null;
    grip.rel = null;
    grip.from = null;
    grip.snap = 1;
    pose = forward(q);
  };

  const reset = () => {
    for (let i = 0; i < JOINT_COUNT; i++) {
      q[i] = HOME[i]!;
      prevQ[i] = HOME[i]!;
      target[i] = HOME[i]!;
      vel[i] = 0;
      blocked[i] = 99;
      limited[i] = 99;
    }
    grip.closed = false;
    grip.gap = GRIP.openHalf;
    grip.prevGap = GRIP.openHalf;
    grip.held = null;
    grip.rel = null;
    grip.from = null;
    grip.snap = 1;
    pose = forward(q);
    table.reset();
    events.length = 0;
  };

  return {
    index: opts.index,
    table,
    bench,
    q,
    prevQ,
    target,
    get pose() {
      return pose;
    },
    grip,
    blocked,
    limited,
    stops,
    events,
    counts,
    mode: "demo",
    lastTouch: Number.NEGATIVE_INFINITY,
    lastHuman: Number.NEGATIVE_INFINITY,
    turn,
    setTarget,
    pressGrip,
    step,
    reset,
    home,
    heldPiece,
    straddled: () => (grip.held === null ? between(pose, grip.gap) : []),
    clearance,
  };
};

/** Interpolated joint angles for drawing. */
export const drawnJoints = (c: Cell, alpha: number): Joints => {
  const out = [0, 0, 0, 0, 0, 0] as Joints;
  for (let i = 0; i < JOINT_COUNT; i++) out[i] = c.prevQ[i]! + (c.q[i]! - c.prevQ[i]!) * alpha;
  return out;
};

export const pieceRot = (p: Piece): Mat3 => matFromQuat(p.quat);
