import { describe, expect, it } from "vitest";
import { benchFor, BLOCK } from "../../../src/apps/robotarm/bench";
import { DEG } from "../../../src/apps/robotarm/config";
import { topDown, twistFor } from "../../../src/apps/robotarm/ik";
import {
  ARM,
  clampJoint,
  fingertips,
  forward,
  GRIP,
  HOME,
  JOINTS,
  jawYaw,
  withinLimits,
} from "../../../src/apps/robotarm/kinematics";
import { v3, type Vec3, wrapAngle } from "../../../src/apps/robotarm/math";

const near = (a: Vec3, b: Vec3, eps = 1e-9) => {
  expect(a.x).toBeCloseTo(b.x, -Math.log10(eps));
  expect(a.y).toBeCloseTo(b.y, -Math.log10(eps));
  expect(a.z).toBeCloseTo(b.z, -Math.log10(eps));
};

const { d1, a2, d4, d6 } = ARM;

describe("robotarm forward kinematics", () => {
  it("points straight up at zero", () => {
    const p = forward([0, 0, 0, 0, 0, 0]);
    near(p.shoulder, v3(0, d1, 0));
    near(p.elbow, v3(0, d1 + a2, 0));
    near(p.wrist, v3(0, d1 + a2 + d4, 0));
    near(p.grip, v3(0, d1 + a2 + d4 + d6, 0));
    near(p.approach, v3(0, 1, 0));
    near(p.close, v3(1, 0, 0));
  });

  it("leans forward towards the front of the bench with the shoulder", () => {
    const p = forward([0, 90 * DEG, 0, 0, 0, 0]);
    near(p.elbow, v3(0, d1, a2));
    near(p.grip, v3(0, d1, a2 + d4 + d6));
  });

  it("bends the forearm forward at the elbow", () => {
    const p = forward([0, 0, 90 * DEG, 0, 0, 0]);
    near(p.elbow, v3(0, d1 + a2, 0));
    near(p.wrist, v3(0, d1 + a2, d4));
  });

  it("turns the whole arm about the vertical with the base", () => {
    const p = forward([90 * DEG, 90 * DEG, 0, 0, 0, 0]);
    near(p.grip, v3(a2 + d4 + d6, d1, 0));
    const back = forward([180 * DEG, 90 * DEG, 0, 0, 0, 0]);
    near(back.grip, v3(0, d1, -(a2 + d4 + d6)));
  });

  it("points the tool down when shoulder, elbow and wrist bend add to a half turn", () => {
    const p = forward([0, 30 * DEG, 80 * DEG, 0, 70 * DEG, 0]);
    near(p.approach, v3(0, -1, 0));
    expect(p.grip.y).toBeCloseTo(p.wrist.y - d6, 9);
  });

  it("rolls the wrist bend out of the arm's plane with the forearm roll", () => {
    // Forearm horizontal and forward; rolling a quarter turn makes the bend swing sideways.
    const flat = forward([0, 90 * DEG, 0, 0, 90 * DEG, 0]);
    const rolled = forward([0, 90 * DEG, 0, 90 * DEG, 90 * DEG, 0]);
    expect(Math.abs(flat.approach.x)).toBeLessThan(1e-9);
    expect(Math.abs(rolled.approach.x)).toBeCloseTo(1, 9);
    near(flat.wrist, rolled.wrist);
  });

  it("twists the jaws about the tool axis without moving the grip point", () => {
    const a = forward([0, 40 * DEG, 90 * DEG, 0, 50 * DEG, 0]);
    const b = forward([0, 40 * DEG, 90 * DEG, 0, 50 * DEG, 30 * DEG]);
    near(a.grip, b.grip);
    near(a.approach, b.approach);
    expect(
      Math.acos(a.close.x * b.close.x + a.close.y * b.close.y + a.close.z * b.close.z),
    ).toBeCloseTo(30 * DEG, 9);
    expect(jawYaw(b)).toBeCloseTo(wrapAngle(0 - 30 * DEG), 9);
  });

  it("keeps link lengths whatever the angles", () => {
    for (let k = 0; k < 50; k++) {
      const q = JOINTS.map(
        (j) => j.min + (((k * 37 + j.index * 11) % 100) / 100) * (j.max - j.min),
      );
      const p = forward(q);
      const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      expect(dist(p.shoulder, p.elbow)).toBeCloseTo(a2, 9);
      expect(dist(p.elbow, p.wrist)).toBeCloseTo(d4, 9);
      expect(dist(p.wrist, p.grip)).toBeCloseTo(d6, 9);
      const [t1, t2] = fingertips(p, GRIP.openHalf);
      expect(dist(t1, t2)).toBeCloseTo(2 * (GRIP.openHalf + GRIP.fingerHalfC), 9);
    }
  });

  it("homes above the bench with the tool pointing down", () => {
    const p = forward(HOME);
    expect(p.approach.y).toBeCloseTo(-1, 6);
    expect(p.grip.y).toBeGreaterThan(1);
    expect(p.grip.z).toBeGreaterThan(1);
    expect(withinLimits(HOME)).toBe(true);
  });
});

describe("robotarm joint limits", () => {
  it("clamps each joint to its range", () => {
    for (const j of JOINTS) {
      expect(clampJoint(j.index, j.max + 1)).toBe(j.max);
      expect(clampJoint(j.index, j.min - 1)).toBe(j.min);
      expect(clampJoint(j.index, (j.min + j.max) / 2)).toBe((j.min + j.max) / 2);
      expect(j.min).toBeLessThan(j.home);
      expect(j.max).toBeGreaterThan(j.home);
    }
    expect(withinLimits([0, 0, 0, 0, 0, 0])).toBe(true);
    expect(withinLimits([0, 120 * DEG, 0, 0, 0, 0])).toBe(false);
  });
});

describe("robotarm top-down inverse kinematics", () => {
  it("reaches points across the bench with the tool straight down", () => {
    let reached = 0;
    for (let r = 1.1; r <= 2.85; r += 0.25) {
      for (let a = -150; a <= 150; a += 15) {
        for (const y of [BLOCK / 2, 0.6, 1.2]) {
          const t = v3(r * Math.sin(a * DEG), y, r * Math.cos(a * DEG));
          const q = topDown(t, 0.3);
          expect(q, `r ${r} a ${a} y ${y}`).not.toBeNull();
          const p = forward(q!);
          near(p.grip, t, 1e-7);
          expect(p.approach.y).toBeCloseTo(-1, 9);
          expect(q![3]).toBe(0);
          reached++;
        }
      }
    }
    expect(reached).toBeGreaterThan(300);
  });

  it("closes the jaws across a block's faces", () => {
    for (const yaw of [-2.5, -0.7, 0, 0.4, 1.3, 3]) {
      const t = v3(1.2, BLOCK / 2, 1.6);
      const q = topDown(t, yaw)!;
      const p = forward(q);
      const diff = wrapAngle((jawYaw(p) - yaw) * 4) / 4;
      expect(Math.abs(diff)).toBeLessThan(1e-7);
    }
  });

  it("picks the twist nearest the one asked for", () => {
    const a = twistFor(0, 0.2, 0)!;
    const b = twistFor(0, 0.2, Math.PI / 2)!;
    expect(Math.abs(a)).toBeLessThan(Math.PI / 4 + 1e-9);
    expect(Math.abs(b - Math.PI / 2)).toBeLessThan(Math.PI / 4 + 1e-9);
  });

  it("returns null out of reach", () => {
    expect(topDown(v3(0, 0.2, 3.4), 0)).toBeNull();
    expect(topDown(v3(0, 6, 0.5), 0)).toBeNull();
  });

  it("reaches every slot, bin and the pad from above", () => {
    for (const variant of ["tidy", "stack"] as const) {
      const bench = benchFor(variant);
      for (const s of bench.slots) {
        expect(topDown(v3(s.x, BLOCK / 2, s.z), 0), `${variant} slot`).not.toBeNull();
        expect(topDown(v3(s.x, 1.4, s.z), 0), `${variant} slot above`).not.toBeNull();
      }
      for (const b of bench.bins) {
        expect(topDown(v3(b.x, b.rim + 0.4, b.z), 0)).not.toBeNull();
        expect(topDown(v3(b.x, b.floor + BLOCK / 2, b.z), 0)).not.toBeNull();
      }
      if (bench.pad && bench.hoop) {
        for (let k = 0; k <= bench.tower; k++) {
          const y = bench.pad.top + (k + 0.5) * BLOCK;
          expect(topDown(v3(bench.pad.x, y, bench.pad.z), 0)).not.toBeNull();
        }
      }
    }
  });
});
