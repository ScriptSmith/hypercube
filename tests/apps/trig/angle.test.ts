import { describe, expect, it } from "vitest";
import {
  type Angle,
  CAPTURE_SPEED,
  COAST_MIN,
  createAngle,
  DETENT,
} from "../../../src/apps/trig/angle";
import { DEG, TAU } from "../../../src/apps/trig/config";
import { nearestSpecial, shortest, SPECIAL, tourAngle, wrap } from "../../../src/apps/trig/maths";

const STEP = 1000 / 60;

const rig = (snap = true, hold = 5000, ease = 2500) => {
  let t = 0;
  const angle = createAngle({ snap, tour: tourAngle, holdMs: hold, easeMs: ease, gotoMs: 350 }, t);
  const run = (ms: number, each?: (a: Angle, t: number) => void) => {
    const end = t + ms;
    while (t < end) {
      t += STEP;
      angle.step(t);
      each?.(angle, t);
    }
  };
  return {
    angle,
    run,
    get t() {
      return t;
    },
    set t(v: number) {
      t = v;
    },
  };
};

/** A finger turning by `total` radians over `ms`, in 60 Hz moves. */
const turn = (r: ReturnType<typeof rig>, total: number, ms: number) => {
  const n = Math.max(1, Math.round(ms / STEP));
  for (let i = 0; i < n; i++) {
    r.t += STEP;
    r.angle.turnBy(total / n, r.t);
    r.angle.step(r.t);
  }
};

const isSpecial = (a: number) => {
  const s = nearestSpecial(a, 1e-6);
  return s !== null;
};

describe("trig angle", () => {
  it("follows the slow turn until a finger takes it", () => {
    const r = rig();
    r.run(1000);
    expect(r.angle.mode).toBe("tour");
    expect(r.angle.theta).toBeCloseTo(wrap(tourAngle(r.t)), 9);
    r.angle.grab(r.t);
    expect(r.angle.mode).toBe("held");
  });

  it("sets an absolute angle, and keeps turning continuously across a full turn", () => {
    const r = rig(false);
    r.angle.setTo(350 * DEG, r.t, true);
    expect(r.angle.theta / DEG).toBeCloseTo(350, 9);
    r.t += 100;
    r.angle.setTo(10 * DEG, r.t, true);
    expect(r.angle.theta / DEG).toBeCloseTo(10, 9);
    // Relative turns past 0 going clockwise come out near 360.
    r.t += 100;
    r.angle.turnBy(-20 * DEG, r.t);
    expect(r.angle.theta / DEG).toBeCloseTo(350, 9);
  });

  it("sticks at a special angle while the finger moves slowly, and passes it when fast", () => {
    const slow = rig();
    slow.angle.setTo(20 * DEG, slow.t, true);
    turn(slow, 9 * DEG, 1000);
    expect(slow.angle.theta / DEG).toBeCloseTo(30, 9);
    turn(slow, 2 * DEG, 500);
    expect(slow.angle.theta / DEG).toBeCloseTo(30, 9);
    turn(slow, 6 * DEG, 600);
    expect(slow.angle.theta / DEG).toBeCloseTo(37, 6);
    // Fast: the detent doesn't catch it.
    const fast = rig();
    fast.angle.setTo(20 * DEG, fast.t, true);
    turn(fast, 10.5 * DEG, 50);
    expect(fast.angle.theta / DEG).toBeCloseTo(30.5, 6);
    // Once the finger stops, it is slow again and the detent catches it.
    fast.run(300);
    expect(fast.angle.theta / DEG).toBeCloseTo(30, 9);
    // Without snap it never sticks.
    const free = rig(false);
    free.angle.setTo(20 * DEG, free.t, true);
    turn(free, 9 * DEG, 1000);
    expect(free.angle.theta / DEG).toBeCloseTo(29, 6);
  });

  it("settles onto a special angle let go near it, slowly", () => {
    const r = rig();
    r.angle.setTo(41 * DEG, r.t, true);
    r.run(200);
    r.angle.release(r.t);
    expect(r.angle.mode).toBe("goto");
    r.run(400);
    expect(r.angle.theta / DEG).toBeCloseTo(45, 9);
    expect(r.angle.mode).toBe("hold");
    expect(41 * DEG).toBeLessThan(45 * DEG - DETENT);
  });

  it("coasts after a flick, slows gently and settles on a special angle ahead", () => {
    const r = rig();
    r.angle.setTo(10 * DEG, r.t, true);
    r.t += 100;
    r.angle.release(r.t, 4);
    expect(r.angle.mode).toBe("coast");
    let prev = r.angle.theta;
    let moved = 0;
    let slower = true;
    let lastSpeed = Math.abs(r.angle.speed);
    r.run(6000, (a) => {
      if (a.mode === "coast") {
        const sp = Math.abs(a.speed);
        if (sp > lastSpeed + 1e-9) slower = false;
        lastSpeed = sp;
      }
      moved += Math.abs(shortest(prev, a.theta));
      prev = a.theta;
    });
    expect(slower).toBe(true);
    // It went a long way (over 90°) and stopped exactly on a special angle.
    expect(moved).toBeGreaterThan(Math.PI / 2);
    expect(r.angle.mode).toBe("hold");
    expect(isSpecial(r.angle.theta)).toBe(true);
  });

  it("coasts and stops wherever it stops without snap; a slow release doesn't coast", () => {
    const r = rig(false);
    r.angle.setTo(0, r.t, true);
    r.angle.release(r.t + 10, -3);
    expect(r.angle.mode).toBe("coast");
    for (let i = 0; i < 600 && r.angle.mode === "coast"; i++) r.run(STEP);
    expect(r.angle.mode).toBe("hold");
    expect(r.angle.theta).toBeGreaterThan(Math.PI);
    const s = rig(false);
    s.angle.setTo(1, s.t, true);
    s.angle.release(s.t, COAST_MIN * 0.5);
    expect(s.angle.mode).toBe("hold");
    expect(CAPTURE_SPEED).toBeLessThan(COAST_MIN);
  });

  it("eases to a tapped angle the short way round", () => {
    const r = rig();
    r.angle.setTo(350 * DEG, r.t, true);
    r.angle.release(r.t);
    r.run(10);
    r.angle.goTo(20 * DEG, r.t);
    let max = 0;
    r.run(500, (a) => {
      const d = Math.abs(shortest(350 * DEG, a.theta));
      max = Math.max(max, d);
    });
    expect(r.angle.theta / DEG).toBeCloseTo(20, 9);
    // It went through 0, never round the long way.
    expect(max).toBeLessThanOrEqual(30 * DEG + 1e-9);
  });

  it("holds after a touch, then eases back onto the slow turn without a jump", () => {
    const r = rig(true, 5000, 2500);
    r.run(2000);
    r.angle.setTo(200 * DEG, r.t, true);
    r.angle.release(r.t);
    r.run(4900);
    expect(r.angle.mode).toBe("hold");
    expect(r.angle.theta / DEG).toBeCloseTo(200, 6);
    let prev = r.angle.theta;
    let jump = 0;
    r.run(3000, (a) => {
      jump = Math.max(jump, Math.abs(shortest(prev, a.theta)));
      prev = a.theta;
    });
    expect(r.angle.mode).toBe("tour");
    expect(r.angle.theta).toBeCloseTo(wrap(tourAngle(r.t)), 6);
    // No step bigger than the slow turn's own speed allows (about 8° a frame at its fastest).
    expect(jump).toBeLessThan(10 * DEG);
  });

  it("joins the slow turn at once or by easing when asked", () => {
    const r = rig();
    r.angle.setTo(1, r.t, true);
    r.angle.release(r.t);
    r.angle.follow(r.t);
    expect(r.angle.mode).toBe("ease");
    r.run(2600);
    expect(r.angle.mode).toBe("tour");
    r.angle.setTo(1, r.t, true);
    r.angle.follow(r.t, true);
    expect(r.angle.mode).toBe("tour");
    expect(r.angle.theta).toBeCloseTo(wrap(tourAngle(r.t)), 9);
  });

  it("reads 360° at a full turn reached anticlockwise and 0° reached clockwise", () => {
    const r = rig();
    r.angle.setTo(355 * DEG, r.t, true);
    r.t += 500;
    r.angle.turnBy(5 * DEG, r.t);
    r.run(200);
    expect(r.angle.theta).toBeCloseTo(TAU, 9);
    const c = rig();
    c.angle.setTo(5 * DEG, c.t, true);
    c.t += 500;
    c.angle.turnBy(-5 * DEG, c.t);
    c.run(200);
    expect(c.angle.theta).toBeCloseTo(0, 9);
    // A scrub to the graph's end is a full turn.
    const s = rig();
    s.angle.setTo(TAU, s.t, false);
    expect(s.angle.theta).toBeCloseTo(TAU, 9);
  });

  it("knows the 17 special angles it settles on", () => {
    expect(SPECIAL.length).toBe(17);
  });
});
