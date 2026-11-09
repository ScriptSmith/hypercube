import { describe, expect, it } from "vitest";
import { BALL_R, MAX_IN_PLAY, TABLE_W } from "../../../src/apps/pinball/config";
import {
  CLAM_S,
  PUFF,
  REEF_POINTS,
  RIDE_MIN,
  type ReefToys,
} from "../../../src/apps/pinball/themes/reef";
import { DT, emptyTable, type Rig } from "./helpers";

const reef = (mirror = false) => {
  const r = emptyTable({ variant: "reef", mirror });
  return { r, toys: r.table.toys as ReefToys };
};

/** Run until the clam is wide open (it starts shut). */
const untilOpen = (r: Rig, toys: ReefToys) => {
  for (let i = 0; i < 20 * 120 && toys.clamPhase !== "open"; i++) r.step(DT);
  expect(toys.clamPhase).toBe("open");
};

/** A slow ball dropped into the open clam's middle. */
const intoClam = (r: Rig, toys: ReefToys) => {
  const c = toys.middle.clam;
  return r.table.place(c.x - c.side * 20, c.y + 10, 0, 0);
};

/** Let the clam spit its ball out and get over it (it takes nothing for a moment after). */
const afterSpit = (r: Rig) => r.step(CLAM_S.hold + 1.3);

/** Run until the ramp has no rider. */
const untilOff = (r: Rig, toys: ReefToys) => {
  for (let i = 0; i < 6 * 120 && toys.ride.riders.length > 0; i++) r.step(DT);
  expect(toys.ride.riders).toHaveLength(0);
};

/** A ball sent up the ramp's mouth at `speed` along its axis, from just below its gate. */
const upRamp = (r: Rig, toys: ReefToys, speed: number, back = 40) => {
  const { mouth, dir } = toys.middle.ramp;
  return r.table.place(
    mouth.x - dir.x * back,
    mouth.y - dir.y * back,
    dir.x * speed,
    dir.y * speed,
  );
};

describe("pinball reef theme", () => {
  it("puffs a pufferfish up when it is hit, still kicking, and lets it go down again", () => {
    const { r, toys } = reef();
    const c = toys.middle.puffers[0]!;
    expect(c.r).toBe(PUFF.r0);
    const score = r.table.score;
    const b = r.table.place(c.x, c.y - c.r - BALL_R - 80, 0, 900);
    let biggest = c.r;
    r.step(0.4, () => (biggest = Math.max(biggest, c.r)));
    expect(r.table.score - score).toBeGreaterThanOrEqual(REEF_POINTS.puffer);
    expect(r.table.flashAge("puffer", 0)).toBeLessThan(0.5);
    expect(biggest).toBeCloseTo(PUFF.r1, 0);
    // Kicked away, not swallowed: the ball is outside the swollen fish.
    expect(Math.hypot(b.x - c.x, b.y - c.y)).toBeGreaterThan(c.r + BALL_R - 2);
    r.table.world.balls.length = 0;
    r.step(PUFF.hold + PUFF.shrink + 0.3);
    expect(c.r).toBe(PUFF.r0);
    expect(toys.puffers[0]!.k).toBe(0);
  });

  it("starts with the clam shut and solid, and opens it by itself", () => {
    const { r, toys } = reef();
    expect(toys.clamPhase).toBe("shut");
    expect(toys.middle.clam.shell.on).toBe(true);
    untilOpen(r, toys);
    expect(toys.lid(r.table.world.t)).toBe(1);
    expect(toys.middle.clam.shell.on).toBe(false);
    // And shuts again after a while.
    r.step(CLAM_S.open + CLAM_S.closing + 0.2);
    expect(toys.clamPhase).toBe("shut");
    expect(toys.middle.clam.shell.on).toBe(true);
  });

  it("catches a ball in the open clam, snaps shut, lights a pearl and spits it at the left flipper", () => {
    for (const mirror of [false, true]) {
      const { r, toys } = reef(mirror);
      untilOpen(r, toys);
      const score = r.table.score;
      const b = intoClam(r, toys);
      r.step(DT * 2);
      expect(toys.clam.ball).toBe(b);
      expect(toys.pearls).toBe(1);
      expect(r.table.score - score).toBe(REEF_POINTS.clam);
      expect(toys.clamPhase).toBe("holding");
      r.step(0.4);
      // Shut over it: out of sight, and the shell is solid for others.
      expect(toys.lid(r.table.world.t)).toBe(0);
      expect(r.table.toys.held()[0]!.scale).toBe(0);
      expect(toys.middle.clam.shell.on).toBe(true);
      r.step(CLAM_S.hold - 0.3);
      expect(toys.clam.ball).toBeNull();
      const left = r.table.world.flippers.find((f) => f.name === "left")!;
      const c = toys.middle.clam;
      expect(Math.sign(b.vx)).toBe(Math.sign(left.px - c.x));
      expect(b.vy).toBeGreaterThan(0);
      expect(mirror ? c.x < TABLE_W / 2 : c.x > TABLE_W / 2).toBe(true);
      expect(toys.clamPhase).toBe("open");
    }
  });

  it("is a hard shell while shut: a ball bounces off it and isn't caught", () => {
    const { r, toys } = reef();
    const c = toys.middle.clam;
    expect(toys.clamPhase).toBe("shut");
    const score = r.table.score;
    const b = r.table.place(c.x - 140, c.y, 1400, 0);
    let closest = Infinity;
    r.step(0.3, () => (closest = Math.min(closest, Math.hypot(b.x - c.x, b.y - c.y))));
    expect(toys.clam.ball).toBeNull();
    expect(closest).toBeGreaterThan(c.shell.r + BALL_R - 4);
    expect(r.table.score - score).toBeGreaterThanOrEqual(REEF_POINTS.shell);
  });

  it("doesn't shut its shell on a ball lying in it", () => {
    const { r, toys } = reef();
    untilOpen(r, toys);
    const c = toys.middle.clam;
    // Too fast to catch, but lying over the shell when it shuts: held there for the test.
    const b = r.table.place(c.x - 60, c.y + 40, 0, 0);
    r.step(CLAM_S.open + CLAM_S.closing + 0.2, () => {
      if (toys.clam.ball) return;
      b.x = b.px = c.x - 60;
      b.y = b.py = c.y + 40;
      b.vx = b.vy = 0;
    });
    expect(toys.clam.ball).toBeNull();
    expect(c.shell.on).toBe(false);
    r.table.world.balls.length = 0;
    r.step(DT * 2);
    expect(c.shell.on).toBe(true);
  });

  it("pays a jackpot on the third pearl and sends the pearls out as two more balls", () => {
    const { r, toys } = reef();
    for (let i = 0; i < 3; i++) {
      untilOpen(r, toys);
      intoClam(r, toys);
      r.step(DT * 2);
      expect(toys.pearls).toBe(i + 1);
      // Let it spit the ball out, then drop it so the next one is the only one.
      if (i < 2) {
        afterSpit(r);
        r.table.world.balls.length = 0;
      } else r.step(CLAM_S.hold + 0.1);
    }
    expect(toys.pearls).toBe(0);
    expect(toys.jackpotAt).toBeGreaterThan(0);
    expect(r.table.shake.amount).toBeGreaterThan(0);
    // Counted as they appear: the jackpot's own ball can drain meanwhile (nobody flips).
    const known = new Set(r.table.world.balls.map((b) => b.id));
    const pearls = new Set<number>();
    r.step(CLAM_S.pearl * 2 + 0.1, () => {
      for (const b of r.table.world.balls) if (!known.has(b.id)) pearls.add(b.id);
    });
    expect(pearls.size).toBe(2);
    expect(r.table.inPlay()).toBeLessThanOrEqual(MAX_IN_PLAY);
  });

  it("never sends out more balls than the table can hold", () => {
    const { r, toys } = reef();
    for (let i = 0; i < 3; i++) {
      untilOpen(r, toys);
      intoClam(r, toys);
      r.step(DT * 2);
      if (i === 2) {
        // Fill the table up while the third ball is held.
        while (r.table.inPlay() < MAX_IN_PLAY)
          r.table.place(200 + r.table.inPlay() * 60, 900, 0, 0);
      }
      if (i < 2) {
        afterSpit(r);
        r.table.world.balls.length = 0;
      } else r.step(CLAM_S.hold + 0.1);
    }
    r.step(1);
    expect(r.table.inPlay()).toBeLessThanOrEqual(MAX_IN_PLAY);
  });

  it("takes a fast ball up the turtle ramp and drops it into the left inlane", () => {
    for (const mirror of [false, true]) {
      const { r, toys } = reef(mirror);
      const score = r.table.score;
      const b = upRamp(r, toys, 1100);
      r.step(0.1);
      expect(toys.ride.riders.map((x) => x.ball)).toContain(b);
      expect(r.table.flashAge("ramp", 0)).toBeLessThan(0.2);
      r.step(0.6);
      const h = r.table.toys.held().find((x) => x.ball === b)!;
      expect(h.by).toBe("turtle");
      expect(h.z).toBeGreaterThan(BALL_R + 40);
      untilOff(r, toys);
      expect(toys.rides).toBe(1);
      // Off the end into the inlane on the ramp's side (the first, mirrored with the table).
      const inlane = r.table.layout.rollovers.find((x) => x.tag === "inlane" && x.index === 0)!;
      expect(Math.abs(b.x - inlane.x)).toBeLessThan(40);
      expect(b.vy).toBeGreaterThan(0);
      expect(r.table.score - score).toBeGreaterThanOrEqual(REEF_POINTS.turtle);
    }
  });

  it("lets a slow ball roll back out of the ramp's mouth", () => {
    const { r, toys } = reef();
    const b = upRamp(r, toys, RIDE_MIN * 0.7, 16);
    r.step(1.5);
    expect(toys.ride.riders).toHaveLength(0);
    expect(toys.rides).toBe(0);
    expect(r.table.world.balls).toContain(b);
  });

  it("raises the multiplier on every third ride, and lights a lamp for each", () => {
    const { r, toys } = reef();
    const t = r.table;
    for (let i = 0; i < 3; i++) {
      upRamp(r, toys, 1100);
      r.step(0.2);
      untilOff(r, toys);
      expect(toys.rides).toBe(i + 1);
      t.world.balls.length = 0;
    }
    expect(t.multiplier).toBe(2);
    expect(t.flashAge("turtles", 0)).toBeLessThan(0.1);
  });

  it("pushes balls along the current in its box only, and turns the current round now and then", () => {
    const { r, toys } = reef();
    const box = toys.middle.current.box;
    const inside = r.table.place(box.x0 + 180, box.y0 + 30, 0, 0);
    const outside = r.table.place(560, 1150, 0, 0);
    r.step(0.15);
    expect(inside.vx).toBeGreaterThan(30);
    expect(Math.abs(outside.vx)).toBeLessThan(1);
    r.table.world.balls.length = 0;
    const start = toys.flow.dir.x;
    let turned = false;
    r.step(18, () => {
      if (Math.sign(toys.flow.dir.x) !== Math.sign(start)) turned = true;
    });
    expect(turned).toBe(true);
    expect(toys.turnAt).toBeGreaterThan(0);
  });

  it("starts every game afresh", () => {
    const { r, toys } = reef();
    untilOpen(r, toys);
    intoClam(r, toys);
    upRamp(r, toys, 1100);
    r.step(0.2);
    expect(toys.pearls).toBe(1);
    r.table.start("human");
    expect(toys.pearls).toBe(0);
    expect(toys.rides).toBe(0);
    expect(toys.clamPhase).toBe("shut");
    expect(toys.middle.clam.shell.on).toBe(true);
    expect(r.table.toys.held()).toHaveLength(0);
  });

  it("builds a mirrored table as the mirror image of the other", () => {
    const a = reef(false).toys.middle;
    const b = reef(true).toys.middle;
    expect(b.clam.x).toBeCloseTo(TABLE_W - a.clam.x, 6);
    expect(b.clam.lip.x).toBeCloseTo(TABLE_W - a.clam.lip.x, 6);
    expect(b.clam.aim.vx).toBeCloseTo(-a.clam.aim.vx, 6);
    expect(b.ramp.mouth.x).toBeCloseTo(TABLE_W - a.ramp.mouth.x, 6);
    expect(b.ramp.dir.x).toBeCloseTo(-a.ramp.dir.x, 6);
    expect(b.ramp.path.map((p) => TABLE_W - p.x)).toEqual(
      a.ramp.path.map((p) => expect.closeTo(p.x, 6)),
    );
    expect(b.puffers.map((p) => TABLE_W - p.x)).toEqual(
      a.puffers.map((p) => expect.closeTo(p.x, 6)),
    );
    expect(b.current.box.x0).toBeCloseTo(TABLE_W - a.current.box.x1, 6);
    expect(b.current.dir.x).toBe(-a.current.dir.x);
  });
});
