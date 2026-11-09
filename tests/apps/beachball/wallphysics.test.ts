import { describe, expect, it } from "vitest";
import {
  BUMP,
  type Bounds,
  createWorld,
  FINGER_R,
  MAX_SPEED,
  sweep,
  type World,
} from "../../../src/apps/beachball/wallphysics";
import {
  BALL_RADIUS,
  ballCount,
  MIN_RADIUS,
  pxPerM,
  wallLayout,
} from "../../../src/apps/beachball/walllayout";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import { DEFAULT_VENUE } from "../../../src/core/venue";
import { createRng } from "../../../src/core/rng";
import type { Mat3 } from "../../../src/core/sphere";

const DT = 1 / 120;
const BOUNDS: Bounds = {
  width: DEFAULT_VENUE.wall.widthM,
  height: DEFAULT_VENUE.wall.heightM,
  floor: 0.15,
};
const WALL = VENUE_SIZE.wall;
const R = 0.45;

const world = (n = 1, rest = [3, 6.6, 10], seed = "w") =>
  createWorld(createRng(seed), n, R, BOUNDS, rest);

const run = (w: World, seconds: number, each?: (t: number) => void) => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    each?.(i * DT);
    w.step(DT);
  }
};

const orthoError = (m: Mat3) => {
  let worst = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += m[i * 3 + k]! * m[j * 3 + k]!;
      worst = Math.max(worst, Math.abs(s - (i === j ? 1 : 0)));
    }
  }
  return worst;
};

const inBounds = (w: World) => {
  for (const b of w.balls) {
    expect(b.x - b.r).toBeGreaterThanOrEqual(-1e-6);
    expect(b.x + b.r).toBeLessThanOrEqual(BOUNDS.width + 1e-6);
    expect(b.y - b.r).toBeGreaterThanOrEqual(BOUNDS.floor - 1e-6);
    expect(b.y + b.r).toBeLessThanOrEqual(BOUNDS.height + 1e-6);
  }
};

describe("wall layout", () => {
  it("rests the balls within a child's reach, spread along the sand", () => {
    for (const n of [1, 2, 3]) {
      const l = wallLayout(WALL.width, WALL.height, DEFAULT_REACH.wall, n);
      expect(l.width).toBeCloseTo(DEFAULT_VENUE.wall.widthM, 6);
      expect(l.height).toBeCloseTo(DEFAULT_VENUE.wall.heightM, 6);
      expect(l.radius).toBe(BALL_RADIUS);
      expect(l.floor + 2 * l.radius).toBeLessThan(l.childTop * 0.9);
      expect(l.rest).toHaveLength(n);
      for (const x of l.rest) {
        expect(x - l.radius).toBeGreaterThan(0);
        expect(x + l.radius).toBeLessThan(l.width);
      }
      for (let i = 1; i < n; i++) expect(l.rest[i]! - l.rest[i - 1]!).toBeGreaterThan(3 * l.radius);
      expect(l.shore).toBeGreaterThan(l.floor + 2 * l.radius);
      expect(l.horizon).toBeGreaterThan(l.shore + 0.3);
      expect(l.horizon).toBeLessThan(l.height * 0.75);
    }
  });

  it("shrinks the balls for a lower reach, never below a large target", () => {
    const low = wallLayout(WALL.width, WALL.height, { adult: 0.3, child: 0.17 }, 2);
    expect(low.radius).toBeLessThan(BALL_RADIUS);
    expect(low.radius).toBeGreaterThanOrEqual(MIN_RADIUS);
    expect(low.floor + 2 * low.radius).toBeLessThanOrEqual(low.childTop * 0.9 + 1e-9);
    const none = wallLayout(WALL.width, WALL.height, { adult: 0, child: 0 }, 2);
    expect(none.radius).toBe(MIN_RADIUS);
    // At least 120 venue px across at the smallest.
    expect(2 * MIN_RADIUS * pxPerM()).toBeGreaterThan(120);
  });

  it("reads the ball count option", () => {
    expect(ballCount(undefined)).toBe(2);
    expect(ballCount("3")).toBe(3);
    expect(ballCount(9)).toBe(3);
    expect(ballCount(0)).toBe(1);
    expect(ballCount("x")).toBe(2);
  });
});

describe("finger sweep", () => {
  it("finds where a path first comes within reach", () => {
    expect(sweep(0, 0, 10, 0, 5, 0, 1)).toBeCloseTo(0.4, 6);
    expect(sweep(0, 0, 10, 0, 5, 2, 1)).toBe(-1);
    expect(sweep(4.5, 0, 10, 0, 5, 0, 1)).toBe(0);
    expect(sweep(0, 0, 3, 0, 5, 0, 1)).toBe(-1);
  });
});

describe("beach balls on a wall", () => {
  it("bounce lower each time when dropped and come to rest on the sand", () => {
    const w = world();
    const b = w.balls[0]!;
    b.y = 3;
    b.grounded = false;
    const peaks: number[] = [];
    let rising = false;
    let last = b.y;
    run(w, 12, () => {
      expect(b.y - b.r).toBeGreaterThanOrEqual(BOUNDS.floor - 1e-9);
      if (b.y > last) rising = true;
      else if (rising) {
        peaks.push(last);
        rising = false;
      }
      last = b.y;
    });
    expect(peaks.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]!).toBeLessThan(peaks[i - 1]!);
    expect(b.grounded).toBe(true);
    expect(Math.hypot(b.vx, b.vy)).toBe(0);
    expect(b.y).toBeCloseTo(BOUNDS.floor + R, 6);
  });

  it("takes a big light ball's time to fall", () => {
    const w = world();
    const b = w.balls[0]!;
    b.y = 4.5;
    b.grounded = false;
    let t = 0;
    while (b.y - b.r > BOUNDS.floor + 1e-3 && t < 5) {
      w.step(DT);
      t += DT;
    }
    // About 1 s to drop 4 m: floatier than a stone (0.9 s) but not slow.
    expect(t).toBeGreaterThan(0.95);
    expect(t).toBeLessThan(1.4);
  });

  it("rolls on the sand with its spin matching its speed, then stops", () => {
    const w = world();
    const b = w.balls[0]!;
    w.kick(0, 3, 0);
    b.grounded = true;
    run(w, 0.3);
    expect(b.vx).toBeGreaterThan(1.5);
    expect(b.w[2]).toBeCloseTo(-b.vx / b.r, 0);
    run(w, 4);
    expect(b.vx).toBe(0);
    expect(b.x).toBeGreaterThan(3 + 2);
  });

  it("is batted by a swiping finger at more than the finger's speed, however fast", () => {
    // 3 m/s, then a finger that jumps right past the ball in one step.
    for (const steps of [140, 1]) {
      const w = world();
      const b = w.balls[0]!;
      const y = b.y;
      const from = 1.5;
      const to = b.x + 2;
      w.down(1, from, y);
      for (let i = 1; i <= steps; i++) {
        w.move(1, from + ((to - from) * i) / steps, y);
        w.step(DT);
        if (b.vx > 0.5) break;
      }
      w.up(1);
      const struck = b.vx;
      expect(struck, `in ${steps} steps`).toBeGreaterThan(0.5);
      if (steps > 1) expect(struck).toBeGreaterThan(4);
      // Never passed through: the ball goes the way the finger did.
      run(w, 0.2);
      expect(b.x).toBeGreaterThan(3.2);
      expect(Math.hypot(b.vx, b.vy)).toBeLessThanOrEqual(MAX_SPEED + 1e-9);
    }
  });

  it("is spun by a finger that strikes it off centre", () => {
    const w = world();
    const b = w.balls[0]!;
    const low = b.y - b.r * 0.6;
    w.down(1, 1.5, low);
    for (let i = 1; i <= 40; i++) {
      w.move(1, 1.5 + i * 0.05, low);
      w.step(DT);
    }
    expect(Math.hypot(b.w[0], b.w[1], b.w[2])).toBeGreaterThan(1);
  });

  it("follows a finger that holds it and flies when flicked", () => {
    const w = world();
    const b = w.balls[0]!;
    expect(w.down(1, b.x + 0.2, b.y + 0.1)).toBe("grab");
    expect(b.holder).toBe(1);
    const x0 = b.x + 0.2;
    const y0 = b.y + 0.1;
    for (let i = 1; i <= 60; i++) {
      w.move(1, x0 + i * 0.02, y0 + i * 0.03);
      w.step(DT);
    }
    // The finger moved at 2.4 m/s right and 3.6 m/s up; the ball keeps up.
    expect(Math.hypot(b.x - (x0 + 1.2), b.y - (y0 + 1.8))).toBeLessThan(b.r);
    expect(w.up(1)).toBe("throw");
    expect(b.holder).toBe(null);
    expect(b.vx).toBeGreaterThan(2);
    expect(b.vy).toBeGreaterThan(3);
    const top = { y: b.y };
    run(w, 1.5, () => {
      top.y = Math.max(top.y, b.y);
    });
    expect(top.y).toBeGreaterThan(y0 + 1.8 + 0.3);
  });

  it("pops up from a tap and lands again", () => {
    const w = world();
    const b = w.balls[0]!;
    expect(w.down(1, b.x - 0.1, b.y - 0.1)).toBe("grab");
    w.step(DT);
    expect(w.up(1)).toBe("tap");
    expect(b.vy).toBeCloseTo(BUMP + 0.5 * 1.1 * (0.1 / R), 5);
    let top = b.y;
    run(w, 4, () => {
      top = Math.max(top, b.y);
    });
    expect(top - (BOUNDS.floor + R)).toBeGreaterThan(0.4);
    expect(b.grounded).toBe(true);
  });

  it("pops a ball up from a slow press that never moved, too", () => {
    const w = world();
    const b = w.balls[0]!;
    w.down(1, b.x + 0.05, b.y);
    run(w, 1.5);
    w.move(1, b.x + 0.09, b.y + 0.02);
    expect(w.up(1)).toBe("tap");
    expect(b.vy).toBeGreaterThan(BUMP - 0.1);
  });

  it("throws at the speed it is given, however the steps fall", () => {
    const w = world();
    const b = w.balls[0]!;
    w.down(1, b.x, b.y);
    // One frame's worth of moves arrives at once after a long gap, as on a slow page.
    run(w, 0.1);
    w.move(1, b.x + 0.4, b.y + 0.6, 4, 6);
    run(w, 0.1);
    w.move(1, b.x + 0.8, b.y + 1.2, 4, 6);
    expect(w.up(1)).toBe("throw");
    expect(b.vx).toBeCloseTo(4 * 1.15, 5);
    expect(b.vy).toBeCloseTo(6 * 1.15, 5);
  });

  it("puffs a nearby ball away from a finger that just misses", () => {
    const w = world();
    const b = w.balls[0]!;
    expect(w.down(1, b.x - b.r - 0.25, b.y)).toBe("puff");
    expect(b.vx).toBeGreaterThan(0);
    expect(w.down(2, b.x + 3, b.y)).toBe("none");
  });

  it("lets only one finger hold a ball; another one bats it", () => {
    const w = world();
    const b = w.balls[0]!;
    expect(w.down(1, b.x, b.y)).toBe("grab");
    expect(w.down(2, b.x + 0.1, b.y)).not.toBe("grab");
    expect(b.holder).toBe(1);
    w.cancel(1);
    expect(b.holder).toBe(null);
  });

  it("bounces two balls off each other without overlapping", () => {
    const w = world(2, [5, 8]);
    const [a, b] = w.balls as [(typeof w.balls)[0], (typeof w.balls)[0]];
    a.y = b.y = 2;
    a.grounded = b.grounded = false;
    w.kick(0, 5, 0);
    w.kick(1, -5, 0);
    let met = false;
    run(w, 1, () => {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      expect(d).toBeGreaterThan(a.r + b.r - 0.1);
      if (d < a.r + b.r + 0.05) met = true;
    });
    expect(met).toBe(true);
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
  });

  it("never leaves a ball sitting on another one", () => {
    const w = world(2, [6, 6.05]);
    const [a, b] = w.balls as [(typeof w.balls)[0], (typeof w.balls)[0]];
    b.x = a.x;
    b.y = a.y + 2 * R;
    b.grounded = false;
    run(w, 4);
    expect(a.grounded).toBe(true);
    expect(b.grounded).toBe(true);
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(2 * R - 0.05);
  });

  it("keeps a held ball inside the wall however far the finger goes", () => {
    const w = world();
    const b = w.balls[0]!;
    w.down(1, b.x, b.y);
    for (let i = 0; i < 120; i++) {
      w.move(1, -2 + i * 0.001, -1);
      w.step(DT);
      inBounds(w);
    }
    w.up(1);
    run(w, 3);
    inBounds(w);
  });

  it("stays in bounds, apart and settles after an hour of random throws", () => {
    const rng = createRng("throws");
    const w = world(3);
    let lastKick = 0;
    const seconds = 3600;
    const n = Math.round(seconds / DT);
    let t = 0;
    let fingerId = 10;
    for (let i = 0; i < n; i++) {
      t = i * DT;
      if (t - lastKick > 4 && t < seconds - 30) {
        lastKick = t;
        const k = rng.int(3);
        if (rng.next() < 0.5) {
          w.kick(k, rng.range(-MAX_SPEED, MAX_SPEED), rng.range(-6, MAX_SPEED), [
            rng.range(-20, 20),
            rng.range(-20, 20),
            rng.range(-20, 20),
          ]);
        } else {
          // A fast swipe somewhere across the wall.
          const id = fingerId++;
          const y = rng.range(0.2, 2.2);
          let x = rng.range(0, 13);
          const dir = rng.next() < 0.5 ? -1 : 1;
          w.down(id, x, y);
          for (let s = 0; s < 12; s++) {
            x += dir * 0.12;
            w.move(id, x, y + s * 0.05);
            w.step(DT);
          }
          w.up(id);
        }
      }
      w.step(DT);
      if (i % 600 === 0) inBounds(w);
    }
    inBounds(w);
    for (const b of w.balls) {
      expect(b.grounded).toBe(true);
      expect(Math.hypot(b.vx, b.vy)).toBe(0);
      expect(orthoError(b.rot)).toBeLessThan(1e-9);
    }
    const [a, b, c] = w.balls as [(typeof w.balls)[0], (typeof w.balls)[0], (typeof w.balls)[0]];
    for (const [p, q] of [
      [a, b],
      [b, c],
      [a, c],
    ] as const) {
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(p.r + q.r - 0.02);
    }
  }, 30_000);

  it("spins a thrown ball", () => {
    const w = world();
    const b = w.balls[0]!;
    w.down(1, b.x, b.y);
    w.step(DT);
    w.move(1, b.x + 0.5, b.y + 0.8, 5, 8);
    expect(w.up(1)).toBe("throw");
    expect(Math.hypot(b.w[0], b.w[1], b.w[2])).toBeGreaterThan(2);
  });

  it("reports landings, taps and throws", () => {
    const w = world();
    const b = w.balls[0]!;
    b.y = 3;
    b.grounded = false;
    run(w, 1.2);
    const events = w.drain();
    const land = events.find((e) => e.kind === "land");
    expect(land?.speed).toBeGreaterThan(4);
    expect(w.drain()).toEqual([]);
    run(w, 6);
    w.drain();
    w.down(1, b.x, b.y);
    w.up(1);
    w.down(2, b.x - 2, b.y);
    for (let i = 1; i <= 30; i++) {
      w.move(2, b.x - 2 + i * 0.1, b.y, 6, 0);
      w.step(DT);
    }
    const kinds = w.drain().map((e) => e.kind);
    expect(kinds).toContain("grab");
    expect(kinds).toContain("tap");
    expect(kinds).toContain("bat");
  });

  it("keeps the finger generous for imprecise touch", () => {
    expect(FINGER_R * pxPerM()).toBeGreaterThan(30);
  });
});
