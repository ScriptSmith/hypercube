import { describe, expect, it } from "vitest";
import { BALL, benchFor, BLOCK, binWorld, PIECES } from "../../../src/apps/robotarm/bench";
import { matFromQuat, quatFromMat, rotAxis, rotY, v3 } from "../../../src/apps/robotarm/math";
import {
  BENCH_ID,
  binFloorId,
  createTable,
  flatten,
  PAD_ID,
  type Piece,
  type Table,
} from "../../../src/apps/robotarm/pieces";
import { createRng } from "../../../src/core/rng";
import { DT } from "./helpers";

const tableOf = (variant: "tidy" | "stack" = "tidy", seed = "p") =>
  createTable(benchFor(variant), createRng(seed));

const run = (t: Table, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) t.step(DT);
};

/** Pick a piece up and hold it at a point, as the jaws would. */
const holdAt = (t: Table, p: Piece, x: number, y: number, z: number, yaw = 0) => {
  t.take(p.id);
  p.pos = v3(x, y, z);
  p.quat = quatFromMat(rotY(yaw));
};

const drop = (t: Table, p: Piece, x: number, y: number, z: number, yaw = 0) => {
  holdAt(t, p, x, y, z, yaw);
  t.release(p.id);
  run(t, 2.5);
};

const blocks = (t: Table) => t.pieces.filter((p) => p.kind === "block");
const balls = (t: Table) => t.pieces.filter((p) => p.kind === "ball");

describe("robotarm pieces", () => {
  it("deal a few large pieces, apart, on the bench", () => {
    for (const variant of ["tidy", "stack"] as const) {
      for (const seed of ["a", "b", "c", "d"]) {
        const t = tableOf(variant, seed);
        expect(t.pieces.length).toBe(PIECES);
        expect(t.pieces.length).toBeLessThanOrEqual(6);
        for (const p of t.pieces) {
          expect(p.state).toBe("rest");
          expect(p.pos.y).toBeCloseTo(p.half, 9);
          for (const q of t.pieces) {
            if (q !== p)
              expect(Math.hypot(p.pos.x - q.pos.x, p.pos.z - q.pos.z)).toBeGreaterThan(0.45);
          }
        }
        if (variant === "tidy") {
          // Every bin has something to tidy.
          const colors = new Set(t.pieces.map((p) => p.color));
          expect(colors.size).toBe(3);
        } else {
          expect(t.pieces.every((p) => p.kind === "block")).toBe(true);
        }
      }
    }
  });

  it("go back to where they started on reset", () => {
    const t = tableOf("tidy", "r");
    const start = t.pieces.map((p) => ({ ...p.pos, kind: p.kind, color: p.color }));
    const b = blocks(t)[0]!;
    drop(t, b, 0.2, 1, 1.0);
    t.reset();
    t.pieces.forEach((p, i) => {
      expect(p.pos).toEqual({ x: start[i]!.x, y: start[i]!.y, z: start[i]!.z });
      expect(p.kind).toBe(start[i]!.kind);
      expect(p.color).toBe(start[i]!.color);
    });
  });

  it("land on top of a block when dropped over its centre", () => {
    const t = tableOf("stack", "s");
    const [a, b, c] = blocks(t);
    drop(t, b!, a!.pos.x + 0.05, 1.2, a!.pos.z - 0.04);
    expect(b!.state).toBe("rest");
    expect(b!.support).toBe(a!.id);
    expect(b!.pos.y).toBeCloseTo(3 * (BLOCK / 2), 6);
    drop(t, c!, a!.pos.x, 1.6, a!.pos.z);
    expect(c!.support).toBe(b!.id);
    expect(c!.pos.y).toBeCloseTo(5 * (BLOCK / 2), 6);
  });

  it("tip off onto the bench when dropped mostly over an edge", () => {
    const t = tableOf("stack", "e");
    const [a, b] = blocks(t);
    const x = a!.pos.x + 0.26;
    drop(t, b!, x, 1.2, a!.pos.z);
    expect(b!.state).toBe("rest");
    expect(b!.support).toBe(BENCH_ID);
    expect(b!.pos.y).toBeCloseTo(BLOCK / 2, 6);
    // It slid away from the block below, not through it.
    expect(Math.hypot(b!.pos.x - a!.pos.x, b!.pos.z - a!.pos.z)).toBeGreaterThan(0.3);
    expect(b!.pos.x).toBeGreaterThan(a!.pos.x);
    // And settled flat.
    const m = matFromQuat(b!.quat);
    expect(Math.max(Math.abs(m[3]), Math.abs(m[4]), Math.abs(m[5]))).toBeCloseTo(1, 6);
  });

  it("roll balls off blocks, and blocks off balls", () => {
    const t = tableOf("tidy", "b");
    const [block] = blocks(t);
    const [ball, ball2] = balls(t);
    drop(t, ball!, block!.pos.x, 1.2, block!.pos.z);
    expect(ball!.support).toBe(BENCH_ID);
    expect(ball!.pos.y).toBeCloseTo(BALL, 6);
    const [, other] = blocks(t);
    drop(t, other!, ball2!.pos.x, 1.2, ball2!.pos.z);
    expect(other!.support).not.toBe(ball2!.id);
    expect(other!.pos.y).toBeCloseTo(BLOCK / 2, 6);
  });

  it("fall into a bin dropped over its rim, and a matching piece is sorted and replaced", () => {
    const t = tableOf("tidy", "bin");
    const bin = t.bench.bins[0]!;
    const p = t.pieces.find((q) => q.color === bin.color)!;
    // Over the rim, centre just inside the wall.
    const at = binWorld(bin, bin.half - bin.wall - 0.04, 0);
    holdAt(t, p, at.x, 1, at.z);
    t.release(p.id);
    let sorted = false;
    for (let i = 0; i < 240 && !sorted; i++) {
      t.step(DT);
      sorted = t.events.some((e) => e.type === "sorted");
    }
    expect(sorted).toBe(true);
    expect(t.counts.sorted).toBe(1);
    expect(p.state).toBe("gone");
    run(t, 3);
    // A new piece arrives at a slot on the bench, outside every bin.
    expect(p.state).toBe("rest");
    expect(t.binOf(p)).toBeNull();
    expect(t.events.some((e) => e.type === "spawn")).toBe(true);
  });

  it("stay in a bin of another colour", () => {
    const t = tableOf("tidy", "wrong");
    const bin = t.bench.bins[1]!;
    const p = t.pieces.find((q) => q.color !== bin.color)!;
    drop(t, p, bin.x, 1, bin.z);
    expect(p.state).toBe("rest");
    expect(p.support).toBe(binFloorId(bin.index));
    expect(p.pos.y).toBeCloseTo(bin.floor + p.half, 6);
    expect(t.binOf(p)).toBe(bin);
    expect(t.counts.sorted).toBe(0);
  });

  it("fall when what they rest on is taken away", () => {
    const t = tableOf("stack", "under");
    const [a, b] = blocks(t);
    drop(t, b!, a!.pos.x, 1, a!.pos.z);
    expect(b!.support).toBe(a!.id);
    t.take(a!.id);
    run(t, 2);
    expect(b!.state).toBe("rest");
    expect(b!.support).toBe(BENCH_ID);
    expect(b!.pos.y).toBeCloseTo(BLOCK / 2, 6);
  });

  it("score a tower that reaches the hoop, then send it away and bring the blocks back", () => {
    const t = tableOf("stack", "tower");
    const pad = t.bench.pad!;
    const hoop = t.bench.hoop!;
    const [a, b, c] = blocks(t);
    drop(t, a!, pad.x, 0.8, pad.z);
    expect(a!.support).toBe(PAD_ID);
    drop(t, b!, pad.x, 1.2, pad.z);
    expect(t.counts.towers).toBe(0);
    holdAt(t, c!, pad.x, 1.6, pad.z);
    t.release(c!.id);
    let tower = false;
    for (let i = 0; i < 180 && !tower; i++) {
      t.step(DT);
      tower = t.events.some((e) => e.type === "tower");
    }
    expect(tower).toBe(true);
    expect(t.towerTop()).toBeGreaterThanOrEqual(hoop.y - 0.03);
    expect(t.counts.towers).toBe(1);
    run(t, 2.5);
    expect([a, b, c].every((p) => p!.state === "away" || p!.state === "wait")).toBe(true);
    run(t, 4);
    for (const p of [a, b, c]) {
      expect(p!.state).toBe("rest");
      expect(p!.support).not.toBe(PAD_ID);
    }
    expect(t.towerTop()).toBe(pad.top);
  });

  it("stay on the bench when dropped beyond its edge", () => {
    const t = tableOf("tidy", "edge");
    const [p] = blocks(t);
    drop(t, p!, 0, 1, 3.6);
    expect(p!.state).toBe("rest");
    expect(Math.hypot(p!.pos.x, p!.pos.z)).toBeLessThanOrEqual(3.2 - BLOCK / 2 + 1e-6);
  });

  it("settle a tilted block onto a face, keeping its turn", () => {
    const tilted = quatFromMat(rotAxis(v3(1, 0, 0), 0.5));
    const m = matFromQuat(flatten(tilted));
    expect(Math.abs(m[4])).toBeCloseTo(1, 9);
    const turned = quatFromMat(rotY(0.3));
    const m2 = matFromQuat(flatten(turned));
    expect(Math.atan2(-m2[6], m2[0])).toBeCloseTo(0.3, 9);
  });

  it("arrive clear of the gripper", () => {
    const t = tableOf("tidy", "avoid");
    const bin = t.bench.bins[0]!;
    for (let k = 0; k < 6; k++) {
      const p = t.pieces.find((q) => q.color === bin.color && q.state === "rest");
      if (!p) break;
      const g = v3(t.bench.slots[k]!.x, 1, t.bench.slots[k]!.z);
      t.setAvoid([g]);
      drop(t, p, bin.x, 1, bin.z);
      run(t, 3);
      expect(Math.hypot(p.pos.x - g.x, p.pos.z - g.z)).toBeGreaterThan(0.7);
    }
  });
});
