import { describe, expect, it } from "vitest";
import { BLOCK } from "../../../src/apps/robotarm/bench";
import type { Cell } from "../../../src/apps/robotarm/cell";
import { DEG } from "../../../src/apps/robotarm/config";
import { topDown } from "../../../src/apps/robotarm/ik";
import {
  fingertips,
  forward,
  GRIP,
  HOME,
  JOINTS,
  SPEED_SCALE,
} from "../../../src/apps/robotarm/kinematics";
import { matFromQuat, v3 } from "../../../src/apps/robotarm/math";
import { blockYaw, GRAB, type Piece } from "../../../src/apps/robotarm/pieces";
import { cellOf, DT } from "./helpers";

const run = (cell: Cell, seconds: number, each?: () => void) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    cell.step(DT);
    each?.();
  }
};

/** Turn every joint's target to `q` and wait for the arm to get there. */
const goTo = (cell: Cell, q: readonly number[], seconds = 6) => {
  q.forEach((v, i) => cell.setTarget(i, v));
  run(cell, seconds);
};

/** A resting piece of the bench by kind. */
const pieceOf = (cell: Cell, kind: "block" | "ball"): Piece =>
  cell.table.pieces.find((p) => p.kind === kind && p.state === "rest")!;

const lowestArmPoint = (cell: Cell) => {
  const p = cell.pose;
  const [a, b] = fingertips(p, cell.grip.gap);
  return Math.min(a.y, b.y, p.wrist.y, p.elbow.y) - GRIP.fingerHalfC;
};

describe("robotarm servos", () => {
  it("follow a dial smoothly, within each joint's speed, and stop on target", () => {
    const cell = cellOf();
    cell.turn(0, 90 * DEG);
    let prev = cell.q[0];
    let prevV = 0;
    let maxV = 0;
    let maxA = 0;
    run(cell, 5, () => {
      const v = (cell.q[0] - prev) / DT;
      maxV = Math.max(maxV, Math.abs(v));
      maxA = Math.max(maxA, Math.abs(v - prevV) / DT);
      prev = cell.q[0];
      prevV = v;
    });
    expect(cell.q[0]).toBeCloseTo(90 * DEG, 6);
    expect(maxV).toBeLessThanOrEqual(JOINTS[0]!.rate * 1.0001);
    // Bounded acceleration: no jumps from rest to full speed.
    expect(maxA).toBeLessThanOrEqual(JOINTS[0]!.rate * 4.5 * 1.05);
  });

  it("lag behind a fast spin and catch up", () => {
    const cell = cellOf();
    cell.turn(5, 150 * DEG);
    run(cell, 0.3);
    expect(cell.q[5]).toBeLessThan(cell.target[5] - 60 * DEG);
    run(cell, 3);
    expect(cell.q[5]).toBeCloseTo(cell.target[5], 4);
  });

  it("run slower at the slow speed", () => {
    const normal = cellOf("tidy", "s", { speed: "normal" });
    const slow = cellOf("tidy", "s", { speed: "slow" });
    for (const c of [normal, slow]) {
      c.turn(0, 120 * DEG);
      run(c, 1);
    }
    expect(slow.q[0]).toBeLessThan(normal.q[0] * 0.75);
    expect(SPEED_SCALE.slow).toBeLessThan(1);
  });

  it("stop each dial at its joint's limits", () => {
    const cell = cellOf();
    for (const j of JOINTS) {
      cell.turn(j.index, 10);
      expect(cell.target[j.index]).toBeCloseTo(j.max, 9);
      cell.turn(j.index, -20);
      expect(cell.target[j.index]).toBeCloseTo(j.min, 9);
      cell.setTarget(j.index, j.home);
    }
    expect(cell.events.filter((e) => e.type === "limit").length).toBeGreaterThan(0);
  });
});

describe("robotarm clamp", { timeout: 30_000 }, () => {
  it("stops the arm at the bench and pulls the dial back to where it stopped", () => {
    const cell = cellOf("stack");
    cell.turn(1, 90 * DEG);
    let lowest = Infinity;
    run(cell, 6, () => {
      lowest = Math.min(lowest, lowestArmPoint(cell));
    });
    expect(lowest).toBeGreaterThan(-0.01);
    expect(cell.target[1]).toBeCloseTo(cell.q[1], 6);
    expect(cell.q[1]).toBeLessThan(HOME[1] + 90 * DEG - 0.05);
    expect(cell.clearance()).toBeGreaterThan(-0.01);
    expect(cell.events.some((e) => e.type === "blocked" && e.joint === 1)).toBe(true);
  });

  it("keeps the arm out of the bench whatever the dials do", () => {
    const cell = cellOf("tidy", "wild");
    let lowest = Infinity;
    for (let k = 0; k < 40; k++) {
      for (const j of JOINTS) cell.turn(j.index, Math.sin(k * 1.7 + j.index * 2.3) * 1.4);
      run(cell, 0.8, () => {
        lowest = Math.min(lowest, lowestArmPoint(cell));
      });
    }
    expect(lowest).toBeGreaterThan(-0.02);
  });

  it("lets a stopped joint back out the way it came", () => {
    const cell = cellOf("stack");
    cell.turn(1, 90 * DEG);
    run(cell, 6);
    const stuck = cell.q[1];
    cell.turn(1, -30 * DEG);
    run(cell, 2);
    expect(cell.q[1]).toBeLessThan(stuck - 25 * DEG);
  });

  it("keeps the gripper out of the base column", () => {
    const cell = cellOf("stack");
    // Lean back over the base with the elbow folded: the gripper comes down towards the turret.
    goTo(cell, [0, -20 * DEG, 140 * DEG, 0, 60 * DEG, 0], 8);
    const p = cell.pose;
    for (const t of fingertips(p, cell.grip.gap)) {
      if (t.y < 1.28) expect(Math.hypot(t.x, t.z)).toBeGreaterThan(0.5);
    }
    expect(cell.clearance()).toBeGreaterThan(-0.02);
  });
});

describe("robotarm grabbing", { timeout: 30_000 }, () => {
  const over = (cell: Cell, p: Piece, twistOffset = 0, offset = v3()) => {
    const yaw = p.kind === "block" ? blockYaw(p.quat) : null;
    const q = topDown(
      v3(p.pos.x + offset.x, p.pos.y + 0.02 + offset.y, p.pos.z + offset.z),
      yaw,
      0,
    )!;
    expect(q).not.toBeNull();
    q[5] += twistOffset;
    // Come down from above so the clamp sees the same path a visitor's would.
    const above = topDown(v3(p.pos.x + offset.x, p.pos.y + 0.7, p.pos.z + offset.z), null, q[5])!;
    goTo(cell, above, 8);
    goTo(cell, q, 6);
  };

  it("grabs a block between the open jaws and squares it to them", () => {
    const cell = cellOf("tidy", "g1");
    const block = pieceOf(cell, "block");
    over(cell, block, 12 * DEG);
    cell.pressGrip();
    expect(cell.grip.held).toBe(block.id);
    run(cell, 0.5);
    expect(block.state).toBe("held");
    expect(cell.grip.gap).toBeCloseTo(BLOCK / 2 + 0.004, 3);
    // Every block axis lines up with a tool axis.
    const m = matFromQuat(block.quat);
    const t = cell.pose.tool;
    for (let i = 0; i < 3; i++) {
      const axis = v3(m[i]!, m[3 + i]!, m[6 + i]!);
      const best = Math.max(
        ...[0, 1, 2].map((k) => Math.abs(axis.x * t[k]! + axis.y * t[3 + k]! + axis.z * t[6 + k]!)),
      );
      expect(best).toBeCloseTo(1, 6);
    }
    // It travels with the jaws.
    cell.turn(1, -25 * DEG);
    run(cell, 2);
    const g = cell.pose.grip;
    expect(Math.hypot(block.pos.x - g.x, block.pos.z - g.z)).toBeLessThan(0.15);
    expect(block.pos.y).toBeGreaterThan(0.6);
  });

  it("is forgiving about where the jaws are, within its tolerances", () => {
    const off = [v3(0.12, 0, 0), v3(0, 0, -0.12), v3(0.08, 0.1, 0.08)];
    for (const o of off) {
      const cell = cellOf("tidy", "g2");
      const ball = pieceOf(cell, "ball");
      over(cell, ball, 0, o);
      cell.pressGrip();
      expect(cell.grip.held, `offset ${JSON.stringify(o)}`).toBe(ball.id);
    }
    expect(GRAB.close).toBeGreaterThanOrEqual(0.25);
  });

  it("misses a piece that is not between the jaws", () => {
    const cell = cellOf("tidy", "g3");
    const ball = pieceOf(cell, "ball");
    over(cell, ball, 0, v3(0, 0.62, 0));
    cell.pressGrip();
    expect(cell.grip.held).toBeNull();
    expect(cell.grip.closed).toBe(true);
    run(cell, 0.5);
    expect(cell.grip.gap).toBeCloseTo(GRIP.closedHalf, 6);
  });

  it("needs the jaws square to a block's sides, but takes a ball at any twist", () => {
    const cell = cellOf("tidy", "g4");
    const block = pieceOf(cell, "block");
    over(cell, block, 45 * DEG);
    cell.pressGrip();
    expect(cell.grip.held).toBeNull();
    const cell2 = cellOf("tidy", "g4");
    const ball = pieceOf(cell2, "ball");
    over(cell2, ball, 45 * DEG);
    cell2.pressGrip();
    expect(cell2.grip.held).toBe(ball.id);
  });

  it("lets go: the piece falls straight down and lands flat on the bench", () => {
    const cell = cellOf("tidy", "g5");
    const block = pieceOf(cell, "block");
    over(cell, block, 10 * DEG);
    cell.pressGrip();
    // Lift, swing the base a little and tilt the wrist, then let go in mid air.
    cell.turn(1, -20 * DEG);
    run(cell, 1.5);
    cell.turn(0, 15 * DEG);
    cell.turn(4, 20 * DEG);
    run(cell, 1.5);
    const at = { ...block.pos };
    expect(at.y).toBeGreaterThan(0.5);
    cell.pressGrip();
    expect(cell.grip.held).toBeNull();
    run(cell, 2);
    expect(block.state).toBe("rest");
    expect(block.pos.x).toBeCloseTo(at.x, 6);
    expect(block.pos.z).toBeCloseTo(at.z, 6);
    expect(block.pos.y).toBeCloseTo(BLOCK / 2, 6);
    const m = matFromQuat(block.quat);
    expect(Math.max(Math.abs(m[3]), Math.abs(m[4]), Math.abs(m[5]))).toBeCloseTo(1, 6);
    expect(cell.events.some((e) => e.type === "land" && e.piece === block.id)).toBe(true);
  });

  it("keeps a held block out of the bench", () => {
    const cell = cellOf("tidy", "g6");
    const block = pieceOf(cell, "block");
    over(cell, block, 0);
    cell.pressGrip();
    cell.turn(1, 40 * DEG);
    let lowest = Infinity;
    run(cell, 4, () => {
      lowest = Math.min(lowest, block.pos.y - BLOCK / 2);
    });
    expect(lowest).toBeGreaterThan(-0.03);
  });

  it("goes home at once with home(), letting go of what it holds", () => {
    const cell = cellOf("tidy", "g7");
    const ball = pieceOf(cell, "ball");
    over(cell, ball);
    cell.pressGrip();
    cell.turn(1, -20 * DEG);
    run(cell, 1);
    cell.home();
    expect([...cell.q]).toEqual([...HOME]);
    expect(cell.grip.held).toBeNull();
    run(cell, 2);
    expect(ball.state).toBe("rest");
    expect(forward(cell.q).grip.y).toBeGreaterThan(1);
  });
});
