import { describe, expect, it } from "vitest";
import { FACES } from "../../../src/apps/answerball/die";
import {
  CONTACT_Z,
  createMotion,
  DEEP,
  type DiePose,
  rockAngle,
  turnEase,
} from "../../../src/apps/answerball/motion";
import { angleBetweenRotations, rotationError } from "../../../src/apps/answerball/rotation";
import { createShow, type ShowOptions } from "../../../src/apps/answerball/show";
import { createRng } from "../../../src/core/rng";
import {
  apply3,
  DEG,
  latLonOf,
  type Mat3,
  multiply3,
  sphereInfo,
  type Vec3,
} from "../../../src/core/sphere";

const VIEW = sphereInfo().view;
const CALM: ShowOptions = { windows: 1, pace: "calm", prompt: true, view: VIEW };

const setup = (opts: ShowOptions = CALM, seed = "m") => {
  const show = createShow(createRng(seed), opts);
  return { show, motion: createMotion(show) };
};

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The text's up against the room's up as seen on the window, for window `lane`. */
const upright = (ball: Mat3, win: Mat3, pose: DiePose, face: number) => {
  const toVenue = multiply3(ball, win);
  const up = apply3(toVenue, apply3(pose.rot, FACES[face]!.up));
  const axis: Vec3 = [toVenue[2], toVenue[5], toVenue[8]];
  const on: Vec3 = [-axis[0] * axis[1], 1 - axis[1] * axis[1], -axis[2] * axis[1]];
  const l = Math.hypot(...on);
  return (up[0] * on[0] + up[1] * on[1] + up[2] * on[2]) / l;
};

describe("easing", () => {
  it("turns past the target a little and settles back, without a jolt at either end", () => {
    expect(turnEase(0, 0.05)).toBe(0);
    expect(turnEase(1, 0.05)).toBe(1);
    let peak = 0;
    for (let u = 0; u <= 1; u += 0.001) peak = Math.max(peak, turnEase(u, 0.05));
    expect(peak).toBeCloseTo(1.05, 3);
    const h = 1e-4;
    expect(turnEase(h, 0.05) / h).toBeLessThan(0.01);
    expect(Math.abs(1 - turnEase(1 - h, 0.05)) / h).toBeLessThan(0.01);
  });

  it("rocks a few times, starting and ending still", () => {
    const { show } = setup();
    const c = show.cycle(0, 30);
    const len = 1.2;
    let crossings = 0;
    let prev = 0;
    let most = 0;
    for (let t = 0; t <= len; t += 0.001) {
      const a = rockAngle(c, t, len);
      if (prev !== 0 && Math.sign(a) !== Math.sign(prev) && a !== 0) crossings++;
      prev = a;
      most = Math.max(most, Math.abs(a));
    }
    expect(crossings).toBeGreaterThanOrEqual(2 * c.rocks - 2);
    expect(most).toBeLessThanOrEqual(c.amplitude);
    expect(most).toBeGreaterThan(c.amplitude * 0.4);
    expect(Math.abs(rockAngle(c, 0.001, len))).toBeLessThan(0.002);
    expect(Math.abs(rockAngle(c, len - 0.001, len))).toBeLessThan(0.002);
  });
});

describe("the ball's motion", () => {
  it("stays a proper rotation over a week, wherever the window points", () => {
    for (const windows of [1, 3, 6] as const) {
      const { motion } = setup({ ...CALM, windows });
      for (let t = 0; t < 7 * 24 * 3600; t += 3617.3) {
        expect(rotationError(motion.ball(t))).toBeLessThan(1e-9);
      }
    }
  });

  it("moves smoothly: no jumps from one frame to the next over an hour", () => {
    const { motion } = setup();
    let prev = motion.ball(0);
    let fastest = 0;
    for (let i = 1; i < 3600 * 60; i++) {
      const m = motion.ball(i / 60);
      fastest = Math.max(fastest, angleBetweenRotations(prev, m));
      prev = m;
    }
    // Under half a turn a second at most, even mid-shake.
    expect(fastest * 60).toBeLessThan(Math.PI);
  });

  it("points the window where the plan says once each turn is done", () => {
    const { show, motion } = setup();
    let t = 0;
    for (let i = 0; i < 60; i++) {
      const c = show.cycle(0, t);
      const done = c.start + c.stages[1]!.start + 0.01;
      const aim = latLonOf(motion.aim(0, motion.ball(done)));
      if (c.down) expect(aim.lat / DEG).toBeCloseTo(-90, 3);
      else {
        expect(aim.lat).toBeCloseTo(c.to.pitch, 6);
        expect(Math.cos(aim.lon - c.to.yaw)).toBeCloseTo(1, 9);
      }
      // Mid-turn the window overshoots its target by a few degrees at most.
      const turn = c.stages[0]!;
      let over = 0;
      for (let u = 0.74; u <= 1; u += 0.01) {
        const at = latLonOf(
          motion.aim(0, motion.ball(c.start + turn.start + u * (turn.end - turn.start))),
        );
        const target = latLonOf(motion.aim(0, motion.ball(done)));
        const d = Math.acos(
          Math.min(
            1,
            Math.sin(at.lat) * Math.sin(target.lat) +
              Math.cos(at.lat) * Math.cos(target.lat) * Math.cos(at.lon - target.lon),
          ),
        );
        over = Math.max(over, d);
      }
      expect(over).toBeLessThan(5 * DEG);
      t = c.start + c.duration + 0.01;
    }
  });

  it("turns three windows slowly round the upright, below the equator", () => {
    const { motion } = setup({ ...CALM, windows: 3 });
    const a = latLonOf(motion.aim(0, motion.ball(1000)));
    const b = latLonOf(motion.aim(0, motion.ball(1060)));
    expect(a.lat / DEG).toBeGreaterThan(-31);
    expect(a.lat / DEG).toBeLessThan(-17);
    const turned = Math.abs(Math.atan2(Math.sin(b.lon - a.lon), Math.cos(b.lon - a.lon)));
    expect(turned / DEG).toBeGreaterThan(60);
    expect(turned / DEG).toBeLessThan(120);
  });
});

describe("six windows", () => {
  it("turns them slowly round the upright, alternately above and below the equator", () => {
    const { motion } = setup({ ...CALM, windows: 6 });
    const aims = [0, 1, 2, 3, 4, 5].map((i) => latLonOf(motion.aim(i, motion.ball(1000))));
    aims.forEach((a, i) => {
      if (i % 2 === 0) expect(a.lat / DEG).toBeLessThan(-20);
      else expect(a.lat / DEG).toBeGreaterThan(10);
      const next = aims[(i + 1) % 6]!;
      const gap = Math.atan2(Math.sin(next.lon - a.lon), Math.cos(next.lon - a.lon));
      expect(gap / DEG).toBeCloseTo(60, -1);
    });
  });

  it("rocks the ball only while a row shakes, not for the window underneath", () => {
    const { show, motion } = setup({ ...CALM, windows: 6, under: true });
    let still = 0;
    for (let t = 0; t < 600; t += 0.37) {
      const shaking = [0, 1].some((lane) => {
        const c = show.cycle(lane, t);
        return show.stageAt(c, t - c.start).id === "shake";
      });
      if (shaking) continue;
      still++;
      const yaw = ((t % 240) / 240) * 2 * Math.PI;
      const m = motion.ball(t);
      expect(m[0]).toBeCloseTo(Math.cos(yaw), 9);
      expect(m[4]).toBeCloseTo(1, 9);
    }
    expect(still).toBeGreaterThan(1000);
  });

  it("turns the answer underneath slowly, for people standing all round below", () => {
    const { show, motion } = setup({ ...CALM, windows: 6, under: true });
    expect(motion.windows.length).toBe(7);
    let t = 0;
    for (let i = 0; i < 12; i++) {
      const c = show.cycle(6, t);
      expect(c.down).toBe(true);
      const h = c.stages[4]!;
      const a = c.start + h.start + 1;
      const b = c.start + h.end - 0.1;
      if (a > 0) {
        expect(latLonOf(motion.aim(6, motion.ball(a))).lat / DEG).toBeLessThan(-86);
        expect(motion.die(6, a).depth).toBeLessThan(0.01);
        // Once every 26 to 34 s in the window, give or take the ball's own slow turn.
        const rate = Math.abs(motion.die(6, b).angle - motion.die(6, a).angle) / (b - a);
        expect(rate).toBeGreaterThan((2 * Math.PI) / 36);
        expect(rate).toBeLessThan((2 * Math.PI) / 24);
      }
      // It holds with the high row, between the low row's answers.
      const high = show.cycle(1, a);
      expect(show.stageAt(high, a - high.start).id).toBe("hold");
      const low = show.cycle(0, a);
      expect(show.stageAt(low, a - low.start).id).not.toBe("hold");
      t = c.start + c.duration + 0.01;
    }
  });

  it("holds every window's answer upright for the people it faces", () => {
    const { show, motion } = setup({ ...CALM, windows: 6, under: true });
    for (let lane = 0; lane < 6; lane++) {
      let t = 0;
      for (let i = 0; i < 12; i++) {
        const c = show.cycle(lane, t);
        const h = c.stages[4]!;
        for (const at of [c.start + h.start + 1.2, c.start + h.end - 0.1]) {
          if (at < 0) continue;
          expect(
            upright(motion.ball(at), motion.windows[lane]!, motion.die(lane, at), c.answer),
          ).toBeGreaterThan(0.97);
        }
        t = c.start + c.duration + 0.01;
      }
    }
  });
});

describe("the die", () => {
  it("rests against the glass for the answer, and waits deep in the dark otherwise", () => {
    const { show, motion } = setup();
    let t = 0;
    for (let i = 0; i < 80; i++) {
      const c = show.cycle(0, t);
      const at = (id: string, share: number) => {
        const s = c.stages.find((x) => x.id === id)!;
        return c.start + s.start + share * (s.end - s.start);
      };
      const hold = motion.die(0, at("hold", 0.5));
      expect(hold.depth).toBeLessThan(0.01);
      expect(hold.pos[2] + 0.4).toBeGreaterThan(CONTACT_Z - 0.5);
      const prompt = motion.die(0, at("prompt", 0.5));
      expect(prompt.depth).toBeGreaterThan(DEEP - 0.01);
      expect(motion.die(0, at("rise", 0.05)).depth).toBeGreaterThan(0.12);
      t = c.start + c.duration + 0.01;
    }
  });

  it("moves without jumps through every stage, for twenty minutes", () => {
    // Stepped ten times finer than a frame, so a jump stands out from a quick movement.
    const { motion } = setup();
    const dt = 1 / 600;
    let prev = motion.die(0, 0);
    let worstMove = 0;
    let worstTurn = 0;
    for (let i = 1; i < 1200 * 600; i++) {
      const p = motion.die(0, i * dt);
      worstMove = Math.max(worstMove, dist(prev.pos, p.pos));
      worstTurn = Math.max(worstTurn, angleBetweenRotations(prev.rot, p.rot));
      prev = p;
    }
    // At most about 3 ball radii and 12 radians a second.
    expect(worstMove / dt).toBeLessThan(3);
    expect(worstTurn / dt).toBeLessThan(12);
  }, 30_000);

  it("holds its answer upright for people at the side, and turns it slowly over people below", () => {
    const { show, motion } = setup();
    let t = 0;
    let sides = 0;
    let downs = 0;
    for (let i = 0; i < 90; i++) {
      const c = show.cycle(0, t);
      const h = c.stages[4]!;
      const a = c.start + h.start + 1;
      const b = c.start + h.end - 0.1;
      const pa = motion.die(0, a);
      const pb = motion.die(0, b);
      if (c.down) {
        downs++;
        const turned = Math.abs(pb.angle - pa.angle);
        expect(turned / (b - a)).toBeGreaterThan((2 * Math.PI) / 36);
        expect(turned / (b - a)).toBeLessThan((2 * Math.PI) / 24);
      } else {
        sides++;
        for (const at of [a, (a + b) / 2, b]) {
          expect(
            upright(motion.ball(at), motion.windows[0]!, motion.die(0, at), c.answer),
          ).toBeGreaterThan(0.98);
        }
      }
      t = c.start + c.duration + 0.01;
    }
    expect(sides).toBeGreaterThan(40);
    expect(downs).toBeGreaterThan(15);
  });

  it("shows the prompt before the shake, only when asked for", () => {
    const { show, motion } = setup();
    const c = show.cycle(0, 40);
    const p = c.stages[1]!;
    expect(motion.prompt(0, c.start + (p.start + p.end) / 2)).toBeCloseTo(1, 3);
    expect(motion.prompt(0, c.start + c.stages[4]!.start + 1)).toBe(0);
    const quiet = setup({ ...CALM, prompt: false });
    for (let t = 0; t < 300; t += 0.25) expect(quiet.motion.prompt(0, t)).toBe(0);
  });

  it("sloshes the liquid only round a shake, and only a little", () => {
    const { show, motion } = setup();
    let t = 0;
    for (let i = 0; i < 20; i++) {
      const c = show.cycle(0, t);
      const ball = motion.ball(c.start + c.stages[4]!.start + 2);
      expect(motion.slosh(0, c.start + c.stages[4]!.start + 2, ball)).toEqual([0, 0]);
      let most = 0;
      const s = c.stages[2]!;
      for (let k = 0; k <= 40; k++) {
        const at = c.start + s.start + (k / 40) * (s.end - s.start);
        most = Math.max(most, Math.hypot(...motion.slosh(0, at, motion.ball(at))));
      }
      expect(most).toBeGreaterThan(0.002);
      expect(most).toBeLessThan(0.04);
      t = c.start + c.duration + 0.01;
    }
  });
});
