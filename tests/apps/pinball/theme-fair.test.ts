import { describe, expect, it } from "vitest";
import { BALL_R, MAX_MULTIPLIER, TABLE_W } from "../../../src/apps/pinball/config";
import { HOLD_LIMIT_S } from "../../../src/apps/pinball/devices";
import {
  CANNON_AIM,
  CANNON_HOLD,
  FAIR_POINTS,
  type FairToys,
  MARKS,
  RIDES,
  STRIKE,
} from "../../../src/apps/pinball/themes/fair";
import { DT, emptyTable, type Rig } from "./helpers";

const fair = (mirror = false) => {
  const r = emptyTable({ variant: "fair", mirror });
  return { r, toys: r.table.toys as FairToys };
};

/** A slow ball rolled up into the Ferris wheel's station. */
const intoStation = (r: Rig, toys: FairToys) => {
  const s = toys.middle.wheel.station;
  return r.table.place(s.x, s.y + 40, 0, -200);
};

/** Step until `done` says so, or `limit` seconds pass; returns the seconds taken. */
const until = (r: Rig, done: () => boolean, limit = 15) => {
  let t = 0;
  while (!done() && t < limit) {
    r.step(DT);
    t += DT;
  }
  return t;
};

describe("pinball fair theme", () => {
  it("lifts a ball to the wheel, carries it up and over, and throws it into a top lane", () => {
    for (const mirror of [false, true]) {
      const { r, toys } = fair(mirror);
      const t = r.table;
      const m = toys.middle.wheel;
      const b = intoStation(r, toys);
      r.step(DT * 3);
      expect(toys.wheel.riders.map((x) => x.ball)).toEqual([b]);
      expect(t.inPlay()).toBe(1);
      // Up the lift onto the platform, waiting for a gondola.
      r.step(0.45);
      const plat = t.toys.held()[0]!;
      expect(plat.z).toBeCloseTo(m.low, 0);
      // The ride: up the far side of the wheel and over the top, rising towards the viewer.
      let top = 0;
      let highest = Infinity;
      const took = until(r, () => {
        const h = t.toys.held()[0];
        if (h) {
          top = Math.max(top, h.z);
          highest = Math.min(highest, h.y);
        }
        return toys.wheel.riders.length === 0;
      });
      expect(took).toBeLessThan(6);
      expect(top).toBeGreaterThan(m.low + 1.8 * m.R * Math.sin(m.tilt));
      expect(highest).toBeLessThan(m.hub.y - m.R * 0.8);
      // Back in play in the lane nearest the wheel, which lights.
      expect(t.world.balls).toContain(b);
      expect(Math.abs(b.x - m.landing.x)).toBeLessThan(30);
      r.step(0.3);
      expect(t.lanes[2]).toBe(true);
      expect(t.flashAge("ride", 0)).toBeLessThan(0.5);
      expect(mirror ? m.hub.x < TABLE_W / 2 : m.hub.x > TABLE_W / 2).toBe(true);
    }
  });

  it("scores each ride, and the fourth rider after three brings two guests for a multiball", () => {
    const { r, toys } = fair();
    const t = r.table;
    for (let i = 0; i < RIDES; i++) {
      const score = t.score;
      intoStation(r, toys);
      r.step(DT * 3);
      expect(toys.wheel.riders).toHaveLength(1);
      until(r, () => toys.wheel.riders.length === 0);
      expect(t.score - score).toBeGreaterThanOrEqual(FAIR_POINTS.ride);
      t.world.balls.length = 0;
    }
    expect(toys.rides).toBe(RIDES);
    expect(toys.lit).toBe(true);
    const score = t.score;
    intoStation(r, toys);
    r.step(DT * 3);
    expect(toys.lit).toBe(false);
    expect(t.score - score).toBeGreaterThanOrEqual(FAIR_POINTS.bigWheel);
    // The guests show on the platform and ride in the next gondolas, then land as new balls.
    let guests = 0;
    until(r, () => {
      guests = Math.max(guests, toys.wheel.riders.filter((x) => !x.ball).length);
      return toys.wheel.riders.length === 0 && t.world.balls.length >= 3;
    });
    expect(guests).toBe(2);
    expect(t.world.balls).toHaveLength(3);
    expect(toys.rides).toBe(0);
  });

  it("takes one ball at a time onto the platform and lets fast ones pass", () => {
    const { r, toys } = fair();
    const s = toys.middle.wheel.station;
    intoStation(r, toys);
    r.step(DT * 3);
    // While the first waits for its gondola, a second one isn't taken.
    const second = r.table.place(s.x, s.y + 10, 0, -100);
    r.step(DT * 2);
    expect(toys.wheel.riders.map((x) => x.ball)).not.toContain(second);
    const { r: r2, toys: t2 } = fair();
    r2.table.place(s.x, s.y + 20, 0, -3200);
    r2.step(DT);
    expect(t2.wheel.riders).toHaveLength(0);
  });

  it("turns the carousel: the horses go round, a slow ball is swung, and all four make a round", () => {
    for (const mirror of [false, true]) {
      const { r, toys } = fair(mirror);
      const t = r.table;
      const c = toys.middle.carousel;
      const a0 = toys.carouselAngle();
      const p0 = { x: c.horses[0]!.x, y: c.horses[0]!.y };
      r.step(0.5);
      expect(toys.carouselAngle()).not.toBeCloseTo(a0, 2);
      for (const h of c.horses) expect(Math.hypot(h.x - c.x, h.y - c.y)).toBeCloseTo(c.ring, 3);
      expect(Math.hypot(c.horses[0]!.x - p0.x, c.horses[0]!.y - p0.y)).toBeGreaterThan(10);
      // As built it turns anticlockwise on screen; mirrored, clockwise.
      expect(Math.sign(c.omega)).toBe(mirror ? 1 : -1);
      // A ball dropped on the disc beside the column is carried round with it.
      t.world.flippers.forEach((f) => (f.held = false));
      const b = t.place(c.x, c.y + 50, 0, 0);
      r.step(DT * 6);
      expect(Math.sign(b.vx)).toBe(Math.sign(-c.omega));
      t.world.balls.length = 0;
      // Every horse hit once is a round: it pays and raises the multiplier.
      const score = t.score;
      const mult = t.multiplier;
      c.horses.forEach((_, i) => {
        const h = c.horses[i]!;
        t.place(h.x, h.y + h.r + BALL_R + 30, 0, -1600);
        r.step(DT * 4);
        t.world.balls.length = 0;
      });
      expect(toys.horses.every((x) => !x)).toBe(true);
      expect(t.score - score).toBeGreaterThanOrEqual(4 * FAIR_POINTS.horse + FAIR_POINTS.round);
      expect(t.multiplier).toBe(Math.min(MAX_MULTIPLIER, mult + 1));
    }
  });

  it("rings the bells to light the fuse, and all three relight the cannon", () => {
    const { r, toys } = fair();
    const t = r.table;
    toys.cannon.disarm();
    const score = t.score;
    toys.middle.bells.forEach((bl, i) => {
      t.place(bl.x, bl.y + bl.r + BALL_R + 40, 0, -1500);
      r.step(DT * 4);
      t.world.balls.length = 0;
      if (i < 2) {
        expect(toys.bells[i]).toBe(true);
        expect(toys.cannon.armed).toBe(false);
      }
      expect(t.flashAge("bell", i)).toBeLessThan(0.1);
    });
    expect(toys.cannon.armed).toBe(true);
    expect(toys.bells.every((x) => !x)).toBe(true);
    expect(t.score - score).toBeGreaterThanOrEqual(3 * FAIR_POINTS.bell + FAIR_POINTS.bells);
  });

  it("fires a draining ball from the cannon back up the table once, then waits to be lit", () => {
    for (const mirror of [false, true]) {
      const { r, toys } = fair(mirror);
      const t = r.table;
      const c = toys.middle.cannon;
      expect(toys.cannon.armed).toBe(true);
      const left = t.left;
      // Down the outlane towards the drain.
      const b = t.place(c.x, c.y - 120, 0, 900);
      r.step(0.15);
      expect(toys.cannon.ball).toBe(b);
      r.step(CANNON_HOLD * CANNON_AIM);
      expect(toys.firedAt).toBeGreaterThan(0);
      // Halfway, in the air over the outlane well above the playfield.
      r.step((CANNON_HOLD * (1 - CANNON_AIM)) / 2);
      expect(t.toys.held()[0]!.z).toBeGreaterThan(200);
      until(r, () => toys.cannon.ball === null, CANNON_HOLD);
      expect(toys.cannon.ball).toBeNull();
      expect(toys.cannon.armed).toBe(false);
      expect(b.vy).toBeLessThan(0);
      expect(Math.sign(b.x - c.x)).toBe(mirror ? -1 : 1);
      expect(b.y).toBeLessThan(1300);
      t.world.balls.length = 0;
      // Unlit, the next one drains: the game loses a ball.
      t.place(c.x, c.y - 120, 0, 900);
      r.step(1);
      expect(toys.cannon.ball).toBeNull();
      expect(t.left).toBe(left - 1);
    }
  });

  it("sends the high striker's puck up by how hard the pad is hit, and rings the bell at the top", () => {
    const { r, toys } = fair();
    const t = r.table;
    const pad = toys.middle.striker.pad;
    const x = (pad.ax + pad.bx) / 2;
    const strike = (speed: number) => {
      t.place(x, pad.ay + pad.r + BALL_R + 6, 0, -speed);
      r.step(DT * 2);
      t.world.balls.length = 0;
    };
    // Soft: a few marks, no bell.
    let score = t.score;
    strike(900);
    expect(toys.striker.level).toBeGreaterThan(0);
    expect(toys.striker.level).toBeLessThan(0.3);
    expect(t.score - score).toBeLessThan(FAIR_POINTS.striker * 4);
    r.step(1.5);
    expect(toys.striker.rangAt).toBe(-Infinity);
    // Hard: all the way up, and the bell rings when the puck gets there.
    score = t.score;
    const mult = t.multiplier;
    strike(STRIKE.hi + 300);
    expect(toys.striker.level).toBe(1);
    expect(t.score - score).toBeGreaterThanOrEqual(FAIR_POINTS.striker * MARKS);
    expect(toys.striker.rangAt).toBe(-Infinity);
    r.step(toys.striker.rise + 0.05);
    expect(toys.striker.rangAt).toBeGreaterThan(0);
    expect(t.score - score).toBeGreaterThanOrEqual(FAIR_POINTS.striker * MARKS + FAIR_POINTS.ring);
    expect(t.multiplier).toBe(mult + 1);
    // From above, the pad is just a ledge.
    r.step(1.5);
    const at = toys.striker.at;
    t.place(x, pad.ay - pad.r - BALL_R - 6, 0, 1500);
    r.step(DT * 2);
    expect(toys.striker.at).toBe(at);
  });

  it("builds a mirrored table as the mirror image of the other", () => {
    const a = fair(false).toys.middle;
    const b = fair(true).toys.middle;
    expect(b.wheel.hub.x).toBeCloseTo(TABLE_W - a.wheel.hub.x, 6);
    expect(b.wheel.station.x).toBeCloseTo(TABLE_W - a.wheel.station.x, 6);
    expect(b.wheel.landing.x).toBeCloseTo(TABLE_W - a.wheel.landing.x, 6);
    expect(b.carousel.x).toBeCloseTo(TABLE_W - a.carousel.x, 6);
    expect(b.carousel.omega).toBe(-a.carousel.omega);
    expect(b.striker.x).toBeCloseTo(TABLE_W - a.striker.x, 6);
    expect(b.cannon.x).toBeCloseTo(TABLE_W - a.cannon.x, 6);
    expect(b.cannon.landing.vx).toBe(-a.cannon.landing.vx);
    b.bells.forEach((bl, i) => expect(bl.x).toBeCloseTo(TABLE_W - a.bells[i]!.x, 6));
  });

  it("lets everything go on a new game, relights the cannon and never holds past the limit", () => {
    const { r, toys } = fair();
    const t = r.table;
    toys.cannon.disarm();
    intoStation(r, toys);
    r.step(0.6);
    expect(toys.wheel.riders).toHaveLength(1);
    t.start("human");
    expect(toys.wheel.riders).toHaveLength(0);
    expect(toys.cannon.armed).toBe(true);
    expect(toys.rides).toBe(0);
    // A ride, a big wheel and the cannon all end well inside the hold limit.
    t.world.balls.length = 0;
    intoStation(r, toys);
    expect(until(r, () => toys.wheel.riders.length === 0)).toBeLessThan(HOLD_LIMIT_S / 2);
  });
});
