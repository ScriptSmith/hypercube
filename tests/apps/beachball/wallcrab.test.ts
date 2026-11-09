import { describe, expect, it } from "vitest";
import { isRed, isYellow } from "../../../src/apps/beachball/palettes";
import {
  ANGRY_MAX,
  ANGRY_MIN,
  CRAB,
  createCrab,
  type CrabEvent,
  type Crabs,
  PUSH_OUT,
} from "../../../src/apps/beachball/wallcrab";
import { CRAB_PAINT } from "../../../src/apps/beachball/wallcrabview";
import { pxPerM } from "../../../src/apps/beachball/walllayout";
import { GRAB, type World } from "../../../src/apps/beachball/wallphysics";
import { createRng } from "../../../src/core/rng";
import { beach, DT } from "./beach";

/** The crab on a wall, stepped with the world, its pushes applied as the app does. */
const crabby = (o: Parameters<typeof beach>[0] = {}, x?: number) => {
  const { w, l } = beach(o);
  const crabs = createCrab(createRng("crab"), x ?? l.crab!, l.floor);
  const events: CrabEvent[] = [];
  const apply = (world: World, c: Crabs) => {
    for (const e of c.drain()) {
      events.push(e);
      if (e.ball >= 0) world.kick(e.ball, e.vx, e.vy);
      if (e.prop >= 0) world.kickProp(e.prop, e.vx, e.vy, 0);
    }
  };
  const step = (seconds: number, each?: () => void) => {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      each?.();
      w.step(DT);
      crabs.step(DT, w);
      if (events.length > 4000) events.splice(0, 2000);
      apply(w, crabs);
    }
  };
  return { w, l, crabs, c: crabs.crab, events, step };
};

describe("the crab", () => {
  it("starts on open sand, is a large target and keeps to no red or yellow", () => {
    const { l, c } = crabby();
    for (const x of l.rest) expect(Math.abs(c.x - x)).toBeGreaterThan(l.radius + CRAB.span);
    expect(c.y).toBeCloseTo(l.floor + CRAB.stand, 6);
    expect(c.y + CRAB.hit).toBeLessThan(l.childTop);
    expect(2 * (CRAB.hit + GRAB) * pxPerM()).toBeGreaterThan(240);
    for (const hex of Object.values(CRAB_PAINT)) {
      expect(isRed(hex), hex).toBe(false);
      expect(isYellow(hex), hex).toBe(false);
    }
  });

  it("scuttles about on its own, pausing and turning, and never leaves the wall", () => {
    const { l, c, step } = crabby({ toys: false });
    const modes = new Set<string>();
    let lo = c.x;
    let hi = c.x;
    let turns = 0;
    let dir = c.dir;
    step(600, () => {
      modes.add(c.mode);
      lo = Math.min(lo, c.x);
      hi = Math.max(hi, c.x);
      if (c.dir !== dir) turns++;
      dir = c.dir;
      expect(c.x).toBeGreaterThanOrEqual(CRAB.half - 1e-9);
      expect(c.x).toBeLessThanOrEqual(l.width - CRAB.half + 1e-9);
    });
    expect(modes.has("walk")).toBe(true);
    expect(modes.has("pause")).toBe(true);
    expect(turns).toBeGreaterThan(20);
    expect(hi - lo).toBeGreaterThan(1.5);
  });

  it("braces for a ball rolling at it and pushes it back, staying on its feet", () => {
    const { w, c, crabs, events, step } = crabby({ toys: false, net: false }, 5);
    crabs.place(5, w.bounds.floor);
    const b = w.balls[1]!;
    w.place(1, 6.8);
    w.kick(1, -3, 0.01, [0, 0, 3 / b.r]);
    const seen = new Set<string>();
    step(1.5, () => seen.add(c.mode));
    expect(seen.has("brace")).toBe(true);
    expect(seen.has("push")).toBe(true);
    expect(c.pushes).toBeGreaterThanOrEqual(1);
    const push = events.find((e) => e.kind === "push" && e.ball === 1)!;
    expect(push.vx).toBeGreaterThanOrEqual(PUSH_OUT[0] * 0.99);
    expect(push.vy).toBeGreaterThan(0);
    // The ball goes back the way it came, and the crab is where it was, upright.
    expect(b.x).toBeGreaterThan(5 + CRAB.span);
    expect(Math.abs(c.x - 5)).toBeLessThan(0.05);
    expect(c.y).toBeCloseTo(w.bounds.floor + CRAB.stand, 6);
  });

  it("pushes away a ball dropped on it, up and to the side", () => {
    const { w, c, crabs, events, step } = crabby({ toys: false, net: false }, 5);
    crabs.place(5, w.bounds.floor);
    const b = w.balls[0]!;
    b.x = 5.05;
    b.y = 2;
    b.grounded = false;
    w.kick(0, 0, -1);
    step(1.5);
    expect(events.some((e) => e.kind === "push" && e.ball === 0 && e.vy > 0)).toBe(true);
    expect(Math.abs(b.x - c.x)).toBeGreaterThan(b.r);
  });

  it("snaps at a finger on it, blowing bubbles, then scuttles off away from it", () => {
    const { c, crabs, events, step } = crabby({ toys: false, net: false }, 6);
    const x0 = c.x;
    expect(crabs.distance(c.x, c.y)).toBeLessThan(0);
    crabs.poke(1, c.x - 0.1, c.y + 0.05);
    step(0.8);
    expect(c.mode).toBe("angry");
    expect(c.claws).toBeGreaterThan(0.8);
    expect(c.cross).toBeGreaterThan(0.8);
    expect(events.some((e) => e.kind === "bubble")).toBe(true);
    expect(events.some((e) => e.kind === "snap")).toBe(true);
    // It never moves far: little lunges round where it was poked.
    expect(Math.abs(c.x - x0)).toBeLessThanOrEqual(0.1 + 1e-9);
    crabs.release(1);
    step(ANGRY_MIN);
    expect(c.mode).toBe("flee");
    step(0.5);
    // Off to the right, away from a finger on its left.
    expect(c.x).toBeGreaterThan(x0 + 0.3);
    expect(c.angers).toBe(1);
  });

  it("stops snapping in time even with the finger still on it", () => {
    const { c, crabs, step } = crabby({ toys: false });
    crabs.poke(1, c.x, c.y);
    step(ANGRY_MAX + 0.1);
    expect(c.mode).not.toBe("angry");
  });

  it("shoves resting balls out of its way now and then, through ten minutes with balls about", () => {
    const { c, events, step } = crabby({ toys: false, net: false, balls: 3 });
    let most = 0;
    step(600, () => {
      most = Math.max(most, events.length);
    });
    expect(c.shoves).toBeGreaterThan(0);
    // It pushes now and then, not all the time.
    expect(c.shoves + c.pushes).toBeLessThan(300);
    expect(most).toBeLessThanOrEqual(4000);
  });
});
