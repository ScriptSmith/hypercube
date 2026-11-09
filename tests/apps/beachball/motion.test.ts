import { describe, expect, it } from "vitest";
import { regionOf } from "../../../src/apps/beachball/geometry";
import {
  createMotion,
  MAX_TURNS,
  type Motion,
  TOSS_GAP,
  TOSS_SPEED,
  tossFactor,
} from "../../../src/apps/beachball/motion";
import { createRng } from "../../../src/core/rng";
import { DEG, direction, type Mat3, type Vec3 } from "../../../src/core/sphere";

const TAU = Math.PI * 2;
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Largest difference between m times its transpose and the identity, and the determinant. */
const orthoError = (m: Mat3) => {
  let worst = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += m[i * 3 + k]! * m[j * 3 + k]!;
      worst = Math.max(worst, Math.abs(s - (i === j ? 1 : 0)));
    }
  }
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  return { worst, det };
};

const toBall = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

const run = (m: Motion, seconds: number, hz: number, each?: (m: Motion) => void) => {
  const n = Math.round(seconds * hz);
  for (let i = 0; i < n; i++) {
    m.step(1 / hz);
    each?.(m);
  }
};

describe("beach ball motion", () => {
  // Four steps a second keeps the test quick; drift depends on the number of steps, and a
  // week at this rate is still 2.4 million of them.
  it("stays a proper rotation over a week of show", { timeout: 30_000 }, () => {
    const m = createMotion(createRng("week"), { pace: "lively", toss: true });
    let worst = 0;
    for (let hour = 0; hour < 24 * 7; hour++) {
      run(m, 3600, 4);
      const e = orthoError(m.rotation);
      worst = Math.max(worst, e.worst);
      expect(e.det).toBeCloseTo(1, 9);
    }
    expect(worst).toBeLessThan(1e-9);
    expect(m.time).toBeCloseTo(7 * 24 * 3600, 3);
  });

  it("is the same show for the same seed", () => {
    const a = createMotion(createRng("same"), { pace: "lazy", toss: true });
    const b = createMotion(createRng("same"), { pace: "lazy", toss: true });
    const c = createMotion(createRng("other"), { pace: "lazy", toss: true });
    run(a, 300, 60);
    run(b, 300, 60);
    run(c, 300, 60);
    expect(a.rotation).toEqual(b.rotation);
    expect(a.tossCount).toBe(b.tossCount);
    expect(a.rotation).not.toEqual(c.rotation);
  });

  it("never tosses twice within the shortest gap, nor waits longer than the longest", () => {
    for (const seed of ["s1", "s2", "s3"]) {
      const m = createMotion(createRng(seed), { pace: "lazy", toss: true });
      const starts: number[] = [];
      let count = 0;
      run(m, 6 * 3600, 20, (mm) => {
        if (mm.tossCount !== count) {
          count = mm.tossCount;
          starts.push(mm.time);
        }
      });
      expect(starts.length).toBeGreaterThan((6 * 3600) / TOSS_GAP[1] - 1);
      for (let i = 1; i < starts.length; i++) {
        const gap = starts[i]! - starts[i - 1]!;
        expect(gap).toBeGreaterThanOrEqual(TOSS_GAP[0]);
        expect(gap).toBeLessThanOrEqual(TOSS_GAP[1] + 0.1);
      }
    }
  });

  it("keeps a toss asked for by admin out of the schedule's way", () => {
    const m = createMotion(createRng("admin"), { pace: "lazy", toss: true });
    run(m, 5, 60);
    m.toss();
    expect(m.tossCount).toBe(1);
    expect(m.nextToss - m.time).toBeGreaterThanOrEqual(TOSS_GAP[0]);
  });

  it("never tosses with tosses off", () => {
    const m = createMotion(createRng("calm"), { pace: "lazy", toss: false });
    run(m, 3 * 3600, 20);
    expect(m.tossCount).toBe(0);
    expect(m.nextToss).toBe(Infinity);
  });

  it("spins a toss up smoothly, then lets drag take it back to the lazy spin", () => {
    for (const seed of ["t1", "t2", "t3", "t4"]) {
      const m = createMotion(createRng(seed), { pace: "lazy", toss: false });
      run(m, 10, 60);
      m.toss();
      const k = m.tosses[0]!;
      expect(k.speed / TAU).toBeGreaterThanOrEqual(TOSS_SPEED[0]);
      expect(k.speed / TAU).toBeLessThanOrEqual(TOSS_SPEED[1]);
      let prev = m.omega;
      let biggestJump = 0;
      let peak = 0;
      run(m, 30, 60, (mm) => {
        biggestJump = Math.max(biggestJump, len(sub(mm.omega, prev)));
        prev = mm.omega;
        const extra = len(sub(mm.omega, mm.lazyOmega()));
        peak = Math.max(peak, extra);
        const since = mm.time - k.start;
        if (since > 20) expect(extra).toBeLessThan(0.08 * k.speed);
      });
      // Close to the full kick at its peak, and no step changes the spin by more than the
      // ramp allows: a smooth spin-up, never a jump.
      expect(peak).toBeGreaterThan(0.8 * Math.min(k.speed, MAX_TURNS * TAU - 0.5));
      expect(biggestJump).toBeLessThan((1.6 * k.speed) / (k.ramp * 60) + 0.02);
      expect(len(sub(m.omega, m.lazyOmega()))).toBeLessThan(0.02 * k.speed);
    }
  });

  it("builds a toss over its ramp and decays it exponentially", () => {
    const k = { start: 10, axis: [0, 1, 0] as Vec3, speed: 5, ramp: 0.4, tau: 4 };
    expect(tossFactor(k, 9)).toBe(0);
    expect(tossFactor(k, 10.2)).toBeCloseTo(0.5, 5);
    expect(tossFactor(k, 10.4)).toBeCloseTo(1, 5);
    expect(tossFactor(k, 14.4)).toBeCloseTo(Math.exp(-1), 5);
    expect(tossFactor(k, 22.4)).toBeCloseTo(Math.exp(-3), 5);
  });

  it("never turns fast enough for the white gores to flash more than three times a second", () => {
    const m = createMotion(createRng("fast"), { pace: "lively", toss: true });
    let fastest = 0;
    run(m, 2 * 3600, 30, (mm) => {
      fastest = Math.max(fastest, len(mm.omega));
      if (mm.time % 37 < 1 / 30) mm.toss();
    });
    expect(fastest / TAU).toBeLessThanOrEqual(MAX_TURNS + 1e-9);
    // Three white gores pass a point per turn.
    expect(3 * MAX_TURNS).toBeLessThan(3);
  });

  it("turns lazily between tosses", () => {
    const m = createMotion(createRng("lazy"), { pace: "lazy", toss: false });
    let slowest = Infinity;
    let fastest = 0;
    run(m, 3600, 20, (mm) => {
      const turnsPerMinute = (len(mm.omega) / TAU) * 60;
      slowest = Math.min(slowest, turnsPerMinute);
      fastest = Math.max(fastest, turnsPerMinute);
    });
    expect(slowest).toBeGreaterThan(1);
    expect(fastest).toBeLessThan(5);
  });

  it("shows each cap to the people underneath and lies on its side, in turn", () => {
    for (const seed of ["p1", "p2", "p3"]) {
      const m = createMotion(createRng(seed), { pace: "lazy", toss: true });
      let valveDown = 0;
      let otherDown = 0;
      let side = 0;
      let n = 0;
      run(m, 3600, 10, (mm) => {
        const tilt = mm.tilt() / DEG;
        if (tilt < 35) valveDown++;
        else if (tilt > 145) otherDown++;
        else if (tilt > 50 && tilt < 130) side++;
        n++;
      });
      expect(valveDown / n).toBeGreaterThan(0.1);
      expect(otherDown / n).toBeGreaterThan(0.1);
      expect(side / n).toBeGreaterThan(0.1);
    }
  });

  it("brings every gore past every side people see within a minute", () => {
    const points: Vec3[] = [];
    for (const lat of [0, -30, -60]) {
      for (let k = 0; k < 8; k++) points.push(direction(lat * DEG, (k * 45 - 180) * DEG));
    }
    for (const seed of ["g1", "g2"]) {
      const m = createMotion(createRng(seed), { pace: "lazy", toss: false });
      for (let minute = 0; minute < 30; minute++) {
        const seen = points.map(() => new Set<number>());
        run(m, 60, 10, (mm) => {
          points.forEach((p, i) => {
            const r = regionOf(toBall(mm.rotation, p));
            if (r.kind === "gore") seen[i]!.add(r.index);
          });
        });
        for (const s of seen) expect(s.size).toBe(6);
      }
    }
  });
});
