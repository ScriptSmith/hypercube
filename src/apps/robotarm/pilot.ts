/**
 * The autopilot's planner: from the arm and the bench as they are, the next few things to do,
 * as dial moves and grip presses. Pure. The driver (driver.ts) carries a plan out by turning
 * dials like a visitor, and asks for a new plan whenever a plan ends or a step fails, so the
 * autopilot copes with whatever state people leave the arm in.
 *
 * A pick: open the jaws, lift to a travel height, turn the base towards the piece and twist the
 * jaws square to it, come down over it, then down onto it, and close. A place: lift, turn
 * towards the bin (or the tower), come down over it and let go. Every pose has the tool
 * pointing straight down, from ik.ts; moves turn up to four dials together, which keeps the
 * tool upright on the way.
 */
import type { Cell } from "./cell";
import { topDown, twistsFor } from "./ik";
import { HOME, type Joints } from "./kinematics";
import { v3 } from "./math";
import { blockYaw, PAD_ID, type Piece } from "./pieces";

export type Step =
  | { kind: "move"; targets: { joint: number; value: number }[]; label: string }
  | { kind: "grip"; close: boolean; label: string }
  | { kind: "wait"; s: number; label: string };

/** Height of the grip point while the arm swings around. */
const TRAVEL = 1.3;
/** Above a piece or a drop point before the last stretch down. */
const HOVER = 0.55;
/** A bin drop happens this far above the rim. */
const BIN_DROP = 0.12;
/** The safe pose when the arm is too close to the base for the travel pose. */
const SAFE: readonly number[] = HOME;

const move = (
  q: readonly number[],
  joints: readonly number[],
  label: string,
  from?: readonly number[],
): Step => ({
  kind: "move",
  label,
  targets: joints
    .filter((j) => !from || Math.abs((from[j] ?? 0) - (q[j] ?? 0)) > 0.004)
    .map((j) => ({ joint: j, value: q[j]! })),
});

const isMove = (s: Step): boolean => s.kind !== "move" || s.targets.length > 0;

export interface PilotMemory {
  /** Pieces that recently defeated the autopilot, with when (sim seconds) to try again. */
  skip: Map<number, number>;
  time: number;
  /** On a bank, send one piece in this many up the lift (when the screen wants its colour). */
  liftEvery: number;
  liftCount: number;
  /** Where the piece in hand is going, decided once when it was picked. */
  carry: { id: number; lift: boolean } | null;
}

export const createMemory = (liftEvery = 1): PilotMemory => ({
  skip: new Map(),
  time: 0,
  liftEvery: Math.max(1, Math.round(liftEvery)),
  liftCount: 0,
  carry: null,
});

/** Whether the piece in hand goes up the lift: only while it works and the screen wants it. */
export const toLift = (cell: Cell, mem: PilotMemory, p: Piece): boolean => {
  const lift = cell.table.lift;
  if (!lift?.active || !cell.bench.lift) return false;
  if (mem.carry?.id !== p.id) {
    const wanted = (lift.needs[p.color] ?? 0) > 0;
    const turn = wanted && mem.liftCount % mem.liftEvery === 0;
    if (wanted) mem.liftCount++;
    mem.carry = { id: p.id, lift: turn };
  }
  return mem.carry.lift;
};

/** Whether anything rests (or will rest) on a piece. */
const covered = (cell: Cell, p: Piece) =>
  cell.table.pieces.some((o) => (o.state === "rest" || o.state === "fall") && o.support === p.id);

/** Pieces in the tower on the pad. */
const inTower = (cell: Cell, p: Piece): boolean => {
  let id = p.support;
  for (let i = 0; i < 12; i++) {
    if (id === PAD_ID) return true;
    const below = cell.table.pieces.find((o) => o.id === id && o.state === "rest");
    if (!below) return false;
    id = below.support;
  }
  return false;
};

const graspPose = (p: Piece, twist: number, lift: number): Joints | null =>
  topDown(
    v3(p.pos.x, p.pos.y + lift, p.pos.z),
    p.kind === "block" ? blockYaw(p.quat) : null,
    twist,
  );

const BALL_TWISTS = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map(
  (d) => (d * Math.PI) / 180,
);

/**
 * The grasp pose whose open fingers stay clearest of the bins and other pieces on the way
 * down, preferring a small turn of the twist dial.
 */
export const bestGrasp = (cell: Cell, p: Piece, lift: number): Joints | null => {
  const at = v3(p.pos.x, p.pos.y + lift, p.pos.z);
  const first = topDown(at, null, 0);
  if (!first) return null;
  const twists = p.kind === "block" ? twistsFor(first[0], blockYaw(p.quat)) : BALL_TWISTS;
  let best: Joints | null = null;
  let bestScore = -Infinity;
  for (const tw of twists) {
    const q = topDown(at, null, tw);
    if (!q) continue;
    const above = topDown(v3(at.x, at.y + 0.3, at.z), null, tw);
    const c = Math.min(cell.clearance(q), above ? cell.clearance(above) : -1);
    const score = Math.min(c, 0.15) - 0.02 * Math.abs(tw - cell.q[5]);
    if (score > bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return best;
};

/** The piece the autopilot should fetch next, or null. */
export const chooseTarget = (cell: Cell, mem: PilotMemory): Piece | null => {
  const grip = cell.pose.grip;
  let best: Piece | null = null;
  let bestD = Infinity;
  for (const p of cell.table.pieces) {
    if (p.state !== "rest") continue;
    if ((mem.skip.get(p.id) ?? -1) > mem.time) continue;
    if (covered(cell, p)) continue;
    if (cell.bench.variant === "tidy") {
      const bin = cell.table.binOf(p);
      if (bin && bin.color === p.color) continue;
    } else {
      if (p.kind !== "block" || inTower(cell, p)) continue;
    }
    if (!graspPose(p, cell.q[5], 0) || !graspPose(p, cell.q[5], HOVER)) continue;
    const d = Math.hypot(p.pos.x - grip.x, p.pos.z - grip.z);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
};

/** Where to put a held piece: its bin, the tower top, or a free spot on the bench. */
export const dropPoint = (
  cell: Cell,
  p: Piece,
  mem?: PilotMemory,
): { x: number; y: number; z: number; yaw: number | null } | null => {
  const bench = cell.bench;
  if (mem && bench.lift && toLift(cell, mem, p)) {
    const l = bench.lift;
    return { x: l.x, y: l.top + p.half + 0.1, z: l.z, yaw: null };
  }
  if (bench.variant === "tidy") {
    const bin = bench.bins.find((b) => b.color === p.color);
    if (bin) return { x: bin.x, y: bin.rim + p.half + BIN_DROP, z: bin.z, yaw: bin.yaw };
  } else if (bench.pad && p.kind === "block") {
    const top = cell.table.towerTop();
    const topPiece = cell.table.pieces.find(
      (o) => o.state === "rest" && inTower(cell, o) && Math.abs(o.pos.y + o.half - top) < 0.02,
    );
    return {
      x: bench.pad.x,
      y: top + p.half + 0.03,
      z: bench.pad.z,
      yaw: topPiece ? blockYaw(topPiece.quat) : 0,
    };
  }
  // Anything else goes back on a free slot.
  for (const s of bench.slots) {
    const free = cell.table.pieces.every(
      (o) => o.id === p.id || o.state === "wait" || Math.hypot(o.pos.x - s.x, o.pos.z - s.z) > 0.6,
    );
    if (free) return { x: s.x, y: p.half + 0.05, z: s.z, yaw: null };
  }
  return null;
};

/** The travel pose over the grip point's current spot, or the safe pose. */
const travelFrom = (cell: Cell, height: number): Joints => {
  const g = cell.pose.grip;
  let r = Math.hypot(g.x, g.z);
  const yaw = cell.q[0];
  r = Math.min(2.6, Math.max(1.2, r));
  const at = v3(Math.sin(yaw) * r, height, Math.cos(yaw) * r);
  return (
    topDown(at, null, cell.q[5]) ?? ([yaw, SAFE[1]!, SAFE[2]!, 0, SAFE[4]!, cell.q[5]] as Joints)
  );
};

/** Travel height: clear of the bins, the tower and whatever is held. */
const travelHeight = (cell: Cell): number => {
  const held = cell.heldPiece();
  const tower = cell.bench.pad ? cell.table.towerTop() + 0.5 : 0;
  return Math.max(TRAVEL, tower + (held ? 2 * held.half : 0) + 0.3);
};

export interface Plan {
  steps: Step[];
  /** The piece the plan fetches or carries. */
  target: number | null;
}

/**
 * The next steps from the arm's current state. No steps means nothing to do: the caller rests.
 */
export const plan = (cell: Cell, mem: PilotMemory): Plan => {
  const steps: Step[] = [];
  const q = cell.q;
  const held = cell.heldPiece();
  const height = travelHeight(cell);
  const lift = (from: readonly number[]) => {
    if (
      cell.pose.grip.y < height - 0.08 ||
      Math.abs(q[3]) > 0.02 ||
      Math.abs(cell.pose.approach.y + 1) > 0.02
    ) {
      const t = travelFrom(cell, height);
      steps.push(move(t, [1, 2, 3, 4], "lift", from));
      return t;
    }
    return [...from] as Joints;
  };

  if (held) {
    const drop = dropPoint(cell, held, mem);
    if (!drop) return { steps: [{ kind: "grip", close: false, label: "let go" }], target: held.id };
    const at = v3(drop.x, drop.y, drop.z);
    const yaw = held.kind === "block" ? drop.yaw : null;
    // The held block is squared to the jaws, so match the jaws to the drop yaw.
    const place = topDown(at, yaw, q[5]);
    const above =
      place && topDown(v3(drop.x, Math.max(drop.y + HOVER * 0.7, height), drop.z), null, place[5]);
    if (!place || !above) {
      mem.skip.set(held.id, mem.time + 20);
      return { steps: [{ kind: "grip", close: false, label: "let go" }], target: held.id };
    }
    let cur = lift(q);
    steps.push(move(above, [0, 5], "turn", cur));
    cur = [above[0], cur[1]!, cur[2]!, cur[3]!, cur[4]!, above[5]] as Joints;
    steps.push(move(above, [1, 2, 4], "over", cur));
    steps.push(move(place, [1, 2, 4], "lower", above));
    steps.push({ kind: "grip", close: false, label: "let go" });
    steps.push({ kind: "wait", s: 0.35, label: "settle" });
    steps.push(move(above, [1, 2, 4], "back up", place));
    return { steps: steps.filter(isMove), target: held.id };
  }

  const target = chooseTarget(cell, mem);
  if (!target) return { steps: [], target: null };
  const grasp = bestGrasp(cell, target, 0.02);
  const hover =
    grasp &&
    topDown(v3(target.pos.x, Math.max(target.pos.y + HOVER, height), target.pos.z), null, grasp[5]);
  const near =
    grasp && topDown(v3(target.pos.x, target.pos.y + HOVER * 0.6, target.pos.z), null, grasp[5]);
  if (!grasp || !hover || !near) {
    mem.skip.set(target.id, mem.time + 20);
    return { steps: [], target: null };
  }
  if (cell.grip.closed) steps.push({ kind: "grip", close: false, label: "open" });
  let cur = lift(q);
  steps.push(move(hover, [0, 5], "turn", cur));
  cur = [hover[0], cur[1]!, cur[2]!, cur[3]!, cur[4]!, hover[5]] as Joints;
  steps.push(move(hover, [1, 2, 4], "over", cur));
  steps.push(move(near, [1, 2, 4], "down", hover));
  steps.push(move(grasp, [1, 2, 4], "onto", near));
  steps.push({ kind: "grip", close: true, label: "grab" });
  steps.push({ kind: "wait", s: 0.3, label: "hold" });
  steps.push(move(hover, [1, 2, 4], "up", grasp));
  return { steps: steps.filter(isMove), target: target.id };
};

/** Home, for resting. */
export const homeSteps = (cell: Cell): Step[] => {
  const steps: Step[] = [];
  if (cell.grip.closed && !cell.heldPiece())
    steps.push({ kind: "grip", close: false, label: "open" });
  const t = travelFrom(cell, travelHeight(cell));
  steps.push(move(t, [1, 2, 3, 4], "lift", cell.q));
  steps.push(move(HOME, [0, 5], "home turn", t));
  steps.push(move(HOME, [1, 2, 4], "home", [HOME[0], t[1], t[2], t[3], t[4], HOME[5]]));
  return steps.filter(isMove);
};
