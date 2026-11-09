import { describe, expect, it } from "vitest";
import { ANSWERS } from "../../../src/apps/answerball/answers";
import { FACES } from "../../../src/apps/answerball/die";
import { DEEP, poseRotation } from "../../../src/apps/answerball/motion";
import { rotationError } from "../../../src/apps/answerball/rotation";
import { deck } from "../../../src/apps/answerball/show";
import {
  ballAt,
  type BallCount,
  EYE,
  restOutline,
  wallLayout,
} from "../../../src/apps/answerball/walllayout";
import {
  createWallBallModel,
  createWallDeck,
  MAX_ROLL,
  MAX_TILT,
  type WallBallModel,
} from "../../../src/apps/answerball/wallshake";
import { outline } from "../../../src/apps/answerball/wallview";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import { createRng } from "../../../src/core/rng";
import { apply3, DEG, type Vec3 } from "../../../src/core/sphere";

const WALL = { ...VENUE_SIZE.wall, unit: 1 };
const REACH = DEFAULT_REACH.wall;
const DT = 1 / 60;
const REST = poseRotation(Math.atan2(EYE.up, EYE.out), 0);

const model = (seed = "w", pace: "calm" | "lively" = "calm", holding?: number) => {
  let n = 0;
  return createWallBallModel({
    rng: createRng(seed),
    pace,
    prompt: true,
    rest: REST,
    deal: () => n++ % ANSWERS.length,
    holding,
  });
};

const run = (m: WallBallModel, seconds: number, each?: (t: number) => void) => {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    each?.(i * DT);
    m.step(DT);
  }
};

/** Step until the stage is `stage`, at most `limit` s; the seconds it took. */
const until = (m: WallBallModel, stage: string, limit = 30) => {
  let t = 0;
  while (m.stage !== stage && t < limit) {
    m.step(DT);
    t += DT;
  }
  return t;
};

describe("wall layout", () => {
  for (const count of [1, 2, 3] as BallCount[]) {
    it(`fits ${count} ball${count > 1 ? "s" : ""} in a row, in a child's reach and above the crowd`, () => {
      for (const frame of [WALL, { width: 1280, height: 480, unit: 1280 / WALL.width }]) {
        const l = wallLayout(frame, count);
        const u = frame.unit;
        expect(l.balls).toHaveLength(count);
        const top = l.balls[0]!.y - l.outlineRise - l.outline;
        expect(top).toBeGreaterThan(80 * u);
        expect(l.floor).toBeLessThan(frame.height - 150 * u);
        for (let i = 0; i < count; i++) {
          const b = l.balls[i]!;
          expect(b.y).toBeCloseTo(l.floor - l.scale, 6);
          expect(b.x - l.outline).toBeGreaterThan(100 * u);
          expect(b.x + l.outline).toBeLessThan(frame.width - 100 * u);
          if (i > 0) expect(b.x - l.balls[i - 1]!.x - 2 * l.outline).toBeGreaterThan(150 * u);
        }
        // A child reaches the bottom of each ball, an adult up to about its middle.
        const childTop = frame.height * (1 - REACH.child);
        const adultTop = frame.height * (1 - REACH.adult);
        expect(l.floor - childTop).toBeGreaterThan(0.3 * l.scale);
        expect(Math.abs(l.balls[0]!.y - adultTop)).toBeLessThan(0.45 * l.scale);
        // The windows are above people's heads but in the lower two thirds of the wall.
        expect(l.balls[0]!.y).toBeGreaterThan(frame.height * 0.3);
      }
    });
  }

  it("makes three balls as large as they fit side by side", () => {
    const l = wallLayout(WALL, 3);
    expect(2 * l.outline).toBeGreaterThan(0.8 * (WALL.width / 3));
    expect(wallLayout(WALL, 1).scale).toBeGreaterThan(l.scale);
  });

  it("finds the ball under a touch, a little past its edge too, and none between", () => {
    const l = wallLayout(WALL, 3);
    l.balls.forEach((b, i) => {
      const cy = b.y - l.outlineRise;
      expect(ballAt(l, b.x, cy)).toBe(i);
      expect(ballAt(l, b.x, cy + l.outline * 1.05)).toBe(i);
      expect(ballAt(l, b.x + l.outline * 0.7, cy + l.outline * 0.6)).toBe(i);
    });
    expect(ballAt(l, (l.balls[0]!.x + l.balls[1]!.x) / 2, 200)).toBe(-1);
    expect(ballAt(l, 10, 10)).toBe(-1);
  });
});

describe("the ball's outline", () => {
  /** Whether the ray from `eye` through picture point (x, y) meets the unit ball. */
  const hits = (eye: Vec3, x: number, y: number) => {
    const d = [x - eye[0], y - eye[1], -eye[2]];
    const l = Math.hypot(d[0]!, d[1]!, d[2]!);
    const b = -(eye[0] * d[0]! + eye[1] * d[1]! + eye[2] * d[2]!) / l;
    const c = eye[0] ** 2 + eye[1] ** 2 + eye[2] ** 2 - 1;
    return b * b - c >= 0 && b > 0;
  };

  it("is a circle a little larger than the ball when seen straight on", () => {
    const o = outline([0, 0, 3.4]);
    expect(o.x).toBeCloseTo(0, 6);
    expect(o.y).toBeCloseTo(0, 6);
    expect(o.r).toBeCloseTo(1 / Math.sqrt(1 - 1 / 3.4 ** 2), 4);
  });

  for (const eye of [
    [0, EYE.up, EYE.out],
    [0.3, -0.4, 2.2],
    [-0.12, 0.6, 5],
  ] as Vec3[]) {
    it(`holds every point of the ball seen from ${eye.join(", ")}, and not much more`, () => {
      const o = outline(eye);
      let inside = 0;
      let nearEdge = 0;
      for (let y = -1.6; y <= 1.6; y += 0.01) {
        for (let x = -1.6; x <= 1.6; x += 0.01) {
          if (!hits(eye, x, y)) continue;
          inside++;
          const d = Math.hypot(x - o.x, y - o.y);
          expect(d).toBeLessThan(o.r + 0.01);
          if (d > o.r - 0.03) nearEdge++;
        }
      }
      expect(inside).toBeGreaterThan(1000);
      expect(nearEdge).toBeGreaterThan(10);
    });
  }

  it("at rest is centred close to the ball, so a touch finds it", () => {
    const o = restOutline();
    expect(Math.abs(o.x)).toBeLessThan(1e-6);
    expect(Math.abs(o.y)).toBeLessThan(0.1);
    expect(o.r).toBeGreaterThan(1);
    expect(o.r).toBeLessThan(1.1);
  });
});

describe("a ball on the wall", () => {
  it("starts waiting with the prompt showing, or holding its first answer", () => {
    const m = model();
    expect(m.stage).toBe("wait");
    expect(m.showing()).toBeNull();
    run(m, 2);
    expect(m.prompt()).toBeGreaterThan(0.5);
    expect(m.die().depth).toBeCloseTo(DEEP, 1);
    const h = model("w", "calm", 7);
    expect(h.stage).toBe("hold");
    expect(h.showing()).toBe(7);
    expect(h.die().depth).toBeLessThan(0.01);
  });

  it("jolts at a tap, shakes the die, then raises an answer and holds it", () => {
    const m = model();
    run(m, 2);
    m.press(1, 0.3, -0.5, true);
    expect(m.stage).toBe("shake");
    let peak = 0;
    run(m, 0.1, () => (peak = Math.max(peak, m.tilt())));
    m.release(1);
    run(m, 1, () => (peak = Math.max(peak, m.tilt())));
    expect(peak).toBeGreaterThan(3 * DEG);
    expect(peak).toBeLessThan(15 * DEG);
    expect(m.prompt()).toBeLessThan(0.1);
    const rise = until(m, "rise", 5);
    expect(rise).toBeLessThan(2);
    const hold = until(m, "hold", 6);
    expect(hold).toBeGreaterThan(1.5);
    expect(hold).toBeLessThan(4.5);
    expect(m.showing()).toBe(m.answer);
    expect(m.die().depth).toBeLessThan(0.02);
    // The text reads upright on the wall.
    const up = apply3(m.rotation(), apply3(m.die().rot, FACES[m.answer]!.up));
    expect(up[1]).toBeGreaterThan(0.97);
    run(m, 3);
    expect(m.stage).toBe("hold");
    // Then it sinks, and asks again.
    until(m, "sink", 15);
    until(m, "wait", 3);
    run(m, 2);
    expect(m.die().depth).toBeGreaterThan(0.5);
    expect(m.prompt()).toBeGreaterThan(0.5);
  });

  it("turns with a dragging finger, never far, and rocks back to rest when let go", () => {
    const m = model();
    m.press(1, 0, -0.4, true);
    run(m, 1, (t) => m.move(1, Math.min(1.2, t * 3), -0.4));
    // Dragged right: its front turns right, about the upright axis.
    const ahead = apply3(m.rotation(), [0, 0, 1]);
    expect(ahead[0]).toBeGreaterThan(0.25);
    expect(m.tilt()).toBeLessThan(MAX_TILT + MAX_ROLL + 0.05);
    expect(m.offset()[0]).toBeGreaterThan(0.05);
    expect(m.offset()[0]).toBeLessThan(MAX_ROLL + 1e-6);
    m.release(1);
    let crossings = 0;
    let prev = apply3(m.rotation(), [0, 0, 1])[0];
    run(m, 6, () => {
      const x = apply3(m.rotation(), [0, 0, 1])[0];
      if (Math.sign(x - REST[2]) !== Math.sign(prev - REST[2])) crossings++;
      prev = x;
    });
    expect(crossings).toBeGreaterThanOrEqual(2);
    expect(m.tilt()).toBeLessThan(0.5 * DEG);
  });

  it("is shaken harder by a fast drag, and the die arrives on an edge", () => {
    const m = model();
    m.press(1, 0, -0.4, true);
    run(m, 1.5, (t) => m.move(1, 0.45 * Math.sin(t * 2 * Math.PI * 2.2), -0.4));
    m.release(1);
    until(m, "rise", 6);
    expect(m.long).toBe(true);
    const gentle = model();
    gentle.press(1, 0, -0.4, true);
    run(gentle, 1.5, (t) => gentle.move(1, 0.08 * Math.sin(t * 2 * Math.PI), -0.4));
    gentle.release(1);
    until(gentle, "rise", 6);
    expect(gentle.long).toBe(false);
  });

  it("hops at a flick upwards and lands", () => {
    const m = model();
    m.press(1, 0, -0.4, true);
    m.move(1, 0, -0.2, 4);
    let high = 0;
    run(m, 0.6, () => (high = Math.max(high, m.offset()[1])));
    m.release(1);
    expect(high).toBeGreaterThan(0.03);
    expect(high).toBeLessThan(0.12);
    run(m, 2);
    expect(m.offset()[1]).toBe(0);
  });

  it("gives a new answer when shaken while one shows", () => {
    const m = model();
    m.press(1, 0.2, 0, false);
    m.release(1);
    until(m, "hold");
    const first = m.answer;
    run(m, 2);
    m.press(2, -0.3, -0.3, false);
    m.release(2);
    expect(m.stage).toBe("shake");
    expect(m.showing()).toBeNull();
    until(m, "hold");
    expect(m.answer).not.toBe(first);
  });

  it("shakes by itself a few times over, as a hand would, and answers", () => {
    const m = model();
    m.jiggle(1);
    let peak = 0;
    let crossings = 0;
    let prev = 0;
    let first: Vec3 | null = null;
    const rest = apply3(REST, [0, 0, 1]);
    run(m, 2, () => {
      const x = apply3(m.rotation(), [0, 0, 1]);
      const d: Vec3 = [x[0] - rest[0], x[1] - rest[1], x[2] - rest[2]];
      if (!first && Math.hypot(...d) > DEG) first = d;
      if (first) {
        const a = d[0] * first[0] + d[1] * first[1] + d[2] * first[2];
        if (prev !== 0 && Math.sign(a) !== Math.sign(prev)) crossings++;
        prev = a;
      }
      peak = Math.max(peak, m.tilt());
    });
    expect(m.stage).not.toBe("wait");
    expect(peak).toBeGreaterThan(4 * DEG);
    expect(peak).toBeLessThan(14 * DEG);
    expect(crossings).toBeGreaterThanOrEqual(2);
    expect(until(m, "hold", 8)).toBeLessThan(8);
    expect(m.sincePerson).toBe(Infinity);
  });

  it("knows a person's touch from a bot's", () => {
    const m = model();
    m.press(1, 0, 0, false);
    m.release(1);
    run(m, 1);
    expect(m.sincePerson).toBe(Infinity);
    m.press(2, 0, 0, true);
    m.release(2);
    run(m, 1);
    expect(m.sincePerson).toBeCloseTo(1, 1);
  });

  it("sinks an answer on reset and leaves a waiting ball be", () => {
    const m = model("r", "calm", 3);
    m.reset();
    expect(m.stage).toBe("sink");
    until(m, "wait", 3);
    m.reset();
    expect(m.stage).toBe("wait");
    m.press(1, 0.4, 0.2, true);
    m.reset();
    expect(m.fingers).toBe(0);
  });

  it("stays in shape and in bounds through an hour of rough handling", () => {
    const m = model("hour", "lively");
    const rng = createRng("hands");
    let finger = 0;
    let down = 0;
    for (let t = 0; t < 3600; t += DT) {
      if (down > 0) {
        down -= DT;
        m.move(finger, rng.range(-1.5, 1.5), rng.range(-1.5, 1.5), rng.range(-6, 6));
        if (down <= 0) m.release(finger);
      } else if (rng.next() < 0.01) {
        finger++;
        down = rng.range(0, 3);
        m.press(finger, rng.range(-1, 1), rng.range(-1, 1), rng.next() < 0.5);
      } else if (rng.next() < 0.001) m.jiggle(rng.range(0.5, 1.5), rng.next() < 0.3);
      m.step(DT);
      if (Math.round(t / DT) % 60 !== 0) continue;
      const pose = m.die();
      expect(rotationError(m.rotation())).toBeLessThan(1e-9);
      expect(rotationError(pose.rot)).toBeLessThan(1e-6);
      expect(m.tilt()).toBeLessThan(0.75);
      expect(Math.abs(m.offset()[0])).toBeLessThanOrEqual(2 * MAX_ROLL + 1e-9);
      expect(m.offset()[1]).toBeLessThan(0.2);
      expect(pose.depth).toBeGreaterThanOrEqual(-1e-9);
      expect(pose.depth).toBeLessThan(DEEP + 0.2);
      expect(Number.isFinite(pose.pos[0] + pose.pos[1] + pose.pos[2])).toBe(true);
      for (const b of m.bubbles.list) expect(Math.hypot(b.x, b.y)).toBeLessThan(1);
      expect(Math.hypot(...m.slosh())).toBeLessThanOrEqual(0.0501);
    }
    m.release(finger);
    expect(m.fingers).toBe(0);
  });

  it("holds at most ten fingers", () => {
    const m = model();
    for (let i = 0; i < 30; i++) m.press(i, 0, 0, true);
    expect(m.fingers).toBe(10);
    for (let i = 0; i < 30; i++) m.release(i);
    expect(m.fingers).toBe(0);
  });
});

describe("the deck the balls share", () => {
  it("never deals an answer another ball shows, nor one dealt lately", () => {
    const showing: (number | null)[] = [null, null, null];
    const d = createWallDeck(createRng("deck"), 3, deck, () => showing);
    const rng = createRng("turns");
    const seen = new Set<number>();
    const last: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const ball = rng.int(3);
      showing[ball] = null;
      const a = d.deal();
      expect(showing).not.toContain(a);
      expect(last).not.toContain(a);
      last.push(a);
      if (last.length > 5) last.shift();
      showing[ball] = rng.next() < 0.7 ? a : null;
      seen.add(a);
    }
    expect(seen.size).toBe(ANSWERS.length);
  });
});
