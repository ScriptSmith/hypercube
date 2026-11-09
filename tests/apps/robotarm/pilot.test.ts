import { describe, expect, it } from "vitest";
import { DEG } from "../../../src/apps/robotarm/config";
import { topDown } from "../../../src/apps/robotarm/ik";
import { forward, jawYaw } from "../../../src/apps/robotarm/kinematics";
import { v3, wrapAngle } from "../../../src/apps/robotarm/math";
import { blockYaw } from "../../../src/apps/robotarm/pieces";
import { chooseTarget, createMemory, dropPoint, plan } from "../../../src/apps/robotarm/pilot";
import { cellOf, rig } from "./helpers";

const SEEDS = ["a", "b", "c", "d", "e", "f", "g", "h"];

describe("robotarm autopilot", { timeout: 60_000 }, () => {
  it("tidies pieces into their own bins, through the dials, on every seed", () => {
    for (const seed of SEEDS) {
      const r = rig("tidy", seed);
      r.run(90);
      expect(r.cell.counts.sorted, `seed ${seed}`).toBeGreaterThanOrEqual(6);
      expect(r.driver.stats.failures, `seed ${seed}`).toBeLessThanOrEqual(2);
      // Every grab became a sort, bar the one in hand.
      expect(r.cell.counts.grabs - r.cell.counts.sorted).toBeLessThanOrEqual(1);
    }
  });

  it("stacks towers up to the hoop on every seed", () => {
    for (const seed of SEEDS) {
      const r = rig("stack", seed);
      r.run(90);
      expect(r.cell.counts.towers, `seed ${seed}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("works at the slow speed, and rests at home between pieces when demonstrating", () => {
    const slow = rig("tidy", "slow", { speed: "slow" });
    slow.run(90);
    expect(slow.cell.counts.sorted).toBeGreaterThanOrEqual(3);
    const demo = rig("tidy", "demo", { restAtHome: true });
    let rests = 0;
    let last = "";
    demo.run(90, () => {
      const l = demo.driver.step?.label ?? "";
      if (l === "rest" && last !== "rest") rests++;
      last = l;
    });
    expect(demo.cell.counts.sorted).toBeGreaterThanOrEqual(4);
    expect(rests).toBeGreaterThanOrEqual(demo.cell.counts.sorted - 1);
  });

  it("drives the dials on every frame kind's layout", () => {
    for (const kind of ["pair", "kiosk", "wall"] as const) {
      const r = rig("tidy", `k-${kind}`, { kind });
      r.run(45);
      expect(r.cell.counts.sorted, kind).toBeGreaterThanOrEqual(2);
    }
  });

  it("copes with whatever state a visitor leaves the arm in", () => {
    for (const seed of ["m1", "m2", "m3", "m4"]) {
      const r = rig("tidy", seed);
      const c = r.cell;
      // A visitor stacks one piece on another, leaves the jaws closed on nothing and the arm
      // twisted low over the bench.
      const [a, b] = c.table.pieces.filter((p) => p.kind === "block");
      c.table.take(b!.id);
      b!.pos = v3(a!.pos.x, 1, a!.pos.z);
      c.table.release(b!.id);
      c.pressGrip();
      const q = [70 * DEG, 60 * DEG, 70 * DEG, 50 * DEG, -40 * DEG, 120 * DEG];
      q.forEach((v, i) => c.setTarget(i, v));
      r.run(70);
      expect(c.counts.sorted, `seed ${seed}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("carries a piece a visitor left in the jaws to its bin", () => {
    const r = rig("tidy", "held");
    const c = r.cell;
    const ball = c.table.pieces.find((p) => p.kind === "ball")!;
    const q = topDown(v3(ball.pos.x, ball.pos.y + 0.02, ball.pos.z), null, 0)!;
    q.forEach((v, i) => c.setTarget(i, v));
    for (let i = 0; i < 400; i++) c.step(1 / 60);
    c.pressGrip();
    expect(c.grip.held).toBe(ball.id);
    const p = plan(c, createMemory());
    expect(p.target).toBe(ball.id);
    expect(p.steps.some((s) => s.kind === "grip" && !s.close)).toBe(true);
    r.run(20);
    expect(c.counts.sorted).toBeGreaterThanOrEqual(1);
  });

  it("never fetches a piece already in its own bin, or one with another on top", () => {
    const c = cellOf("tidy", "skip");
    const bin = c.bench.bins[0]!;
    const p = c.table.pieces.find((q) => q.color === bin.color)!;
    c.table.take(p.id);
    // Put it straight into its bin's floor area as if it had stayed there.
    p.pos = v3(bin.x, bin.floor + p.half, bin.z);
    p.state = "rest";
    const mem = createMemory();
    for (let i = 0; i < 6; i++) {
      const t = chooseTarget(c, mem);
      expect(t?.id).not.toBe(p.id);
      if (t) mem.skip.set(t.id, 999);
    }
  });

  it("plans grasps with the tool straight down and the jaws square to the block", () => {
    const c = cellOf("tidy", "plan");
    const p = plan(c, createMemory());
    const grab = p.steps.findIndex((s) => s.kind === "grip" && s.close);
    expect(grab).toBeGreaterThan(0);
    const q = [...c.q];
    for (const s of p.steps.slice(0, grab)) {
      if (s.kind === "move") for (const t of s.targets) q[t.joint] = t.value;
    }
    const pose = forward(q);
    expect(pose.approach.y).toBeCloseTo(-1, 6);
    const target = c.table.pieces.find((x) => x.id === p.target)!;
    // Dial turns under a quarter of a degree are left out of a plan.
    expect(Math.hypot(pose.grip.x - target.pos.x, pose.grip.z - target.pos.z)).toBeLessThan(0.01);
    if (target.kind === "block") {
      const off = wrapAngle((jawYaw(pose) - blockYaw(target.quat)) * 4) / 4;
      expect(Math.abs(off)).toBeLessThan(0.01);
    }
    // The drop point for it is its own bin.
    const drop = dropPoint(c, target)!;
    const bin = c.bench.bins.find((b) => b.color === target.color)!;
    expect(drop.x).toBeCloseTo(bin.x, 9);
    expect(drop.z).toBeCloseTo(bin.z, 9);
  });
});
