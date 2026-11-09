import { describe, expect, it } from "vitest";
import { BALL_R, MAX_MULTIPLIER, TABLE_W } from "../../../src/apps/pinball/config";
import { SPACE_POINTS, type SpaceToys } from "../../../src/apps/pinball/themes/space";
import { DT, emptyTable, type Rig } from "./helpers";

const space = (mirror = false) => {
  const r = emptyTable({ variant: "space", mirror });
  return { r, toys: r.table.toys as SpaceToys };
};

/** A slow ball rolled into the launch pad's pocket. */
const intoPad = (r: Rig, toys: SpaceToys) => {
  const p = toys.middle.pad;
  return r.table.place(p.x, p.y + 30, 0, -150);
};

describe("pinball space theme", () => {
  it("locks a ball in the rocket, lights a lamp and serves another", () => {
    const { r, toys } = space();
    const score = r.table.score;
    intoPad(r, toys);
    r.step(DT * 3);
    expect(toys.lock.count).toBe(1);
    expect(toys.lock.progress).toBe(1);
    expect(r.table.score - score).toBe(SPACE_POINTS.lock);
    expect(r.table.flashAge("rocket", 0)).toBeLessThan(0.1);
    expect(r.table.waiting()).toBe(true);
    // In the rocket's lowest porthole, above the playfield.
    r.step(0.5);
    const h = r.table.toys.held()[0]!;
    expect(h.by).toBe("rocket");
    expect(h.z).toBeGreaterThan(BALL_R);
    expect(h.y).toBeLessThan(toys.middle.pad.y);
  });

  it("lifts off on the third ball: a countdown, a jackpot, a shake and a three-ball multiball", () => {
    const { r, toys } = space();
    for (let i = 0; i < 3; i++) {
      intoPad(r, toys);
      r.step(0.4);
    }
    expect(toys.lock.phase).toBe("countdown");
    const score = r.table.score;
    r.step(1.5);
    expect(toys.lock.phase).toBe("countdown");
    r.step(0.6);
    expect(toys.lock.phase).toBe("release");
    expect(r.table.score - score).toBeGreaterThanOrEqual(SPACE_POINTS.liftoff);
    expect(r.table.shake.amount).toBeGreaterThan(0);
    expect(toys.liftoffAt).toBeGreaterThan(0);
    r.step(1.2);
    expect(toys.lock.count).toBe(0);
    // The three are back on the playfield, plus the ball waiting on the plunger.
    expect(r.table.world.balls.length).toBeGreaterThanOrEqual(3);
    expect(toys.lock.phase).toBe("closed");
    // A new rocket rises, and the pad takes balls again.
    r.step(2.6);
    expect(toys.lock.phase).toBe("open");
  });

  it("never ends the game or serves twice when the only free ball drains while one is locked", () => {
    const { r, toys } = space();
    intoPad(r, toys);
    r.step(0.3);
    const left = r.table.left;
    // The served ball is lost past the save.
    r.step(9);
    r.table.world.balls.length = 0;
    r.table.place(500, 1940, 0, 600);
    r.step(0.3);
    expect(r.table.left).toBe(left);
    expect(r.table.mode).toBe("play");
    expect(toys.lock.count).toBe(0);
    expect(r.table.waiting()).toBe(false);
    expect(r.table.world.balls).toHaveLength(1);
  });

  it("scores the planet and its moons, which go round it opposite each other", () => {
    const { r, toys } = space();
    const m = toys.middle;
    const p = m.planet;
    const a0 = toys.moonAngle();
    r.step(1);
    expect(toys.moonAngle()).not.toBeCloseTo(a0, 3);
    const [a, b] = m.moons;
    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeCloseTo(m.orbit.radius * 2, 3);
    const score = r.table.score;
    r.table.place(p.x, p.y - p.r - BALL_R - 60, 0, 900);
    r.step(0.2);
    expect(r.table.score - score).toBeGreaterThanOrEqual(SPACE_POINTS.planet);
    expect(r.table.flashAge("planet", 0)).toBeLessThan(0.3);
  });

  it("the black hole swallows a passing ball, spirals it in and spits it at the left flipper", () => {
    for (const mirror of [false, true]) {
      const { r, toys } = space(mirror);
      const h = toys.middle.hole;
      const b = r.table.place(h.x + 30, h.y - 10, -300, 100);
      r.step(DT * 2);
      expect(toys.hole.ball).toBe(b);
      const d0 = Math.hypot(b.x - h.x, b.y - h.y);
      r.step(0.7);
      expect(Math.hypot(b.x - h.x, b.y - h.y)).toBeLessThan(d0 / 4);
      expect(r.table.toys.held()[0]!.scale).toBeLessThan(0.5);
      r.step(0.85);
      expect(toys.hole.ball).toBeNull();
      // Towards the left flipper, whichever way the table is built.
      const left = r.table.world.flippers.find((f) => f.name === "left")!;
      expect(Math.sign(b.vx)).toBe(Math.sign(left.px - h.x));
      expect(b.vy).toBeGreaterThan(0);
      expect(mirror ? h.x < TABLE_W / 2 : h.x > TABLE_W / 2).toBe(true);
    }
  });

  it("drops the asteroids one by one; all down pays, raises the multiplier and they rise again", () => {
    const { r, toys } = space();
    const t = r.table;
    const score = t.score;
    toys.middle.asteroids.forEach((s, i) => {
      // A ball straight into each target's face from the flipper side.
      const mx = (s.ax + s.bx) / 2;
      const my = (s.ay + s.by) / 2;
      const nx = -(s.by - s.ay);
      const ny = s.bx - s.ax;
      const l = Math.hypot(nx, ny);
      const k = ny > 0 ? 1 : -1;
      t.place(
        mx + (nx / l) * k * 90,
        my + (ny / l) * k * 90,
        (-nx / l) * k * 1800,
        (-ny / l) * k * 1800,
      );
      r.step(0.15);
      expect(toys.bank.up[i]).toBe(false);
      t.world.balls.length = 0;
    });
    expect(t.score - score).toBeGreaterThanOrEqual(
      3 * SPACE_POINTS.asteroid + SPACE_POINTS.asteroids,
    );
    expect(t.multiplier).toBe(2);
    r.step(2.2);
    expect(toys.bank.up).toEqual([true, true, true]);
    expect(t.multiplier).toBeLessThanOrEqual(MAX_MULTIPLIER);
  });

  it("builds a mirrored table as the mirror image of the other", () => {
    const a = space(false).toys.middle;
    const b = space(true).toys.middle;
    expect(b.pad.x).toBeCloseTo(TABLE_W - a.pad.x, 6);
    expect(b.hole.x).toBeCloseTo(TABLE_W - a.hole.x, 6);
    expect(b.planet.x).toBeCloseTo(TABLE_W - a.planet.x, 6);
    expect(b.outs.map((o) => -o.vx)).toEqual(a.outs.map((o) => o.vx));
    expect(b.hole.spin).toBe(-a.hole.spin);
  });
});
