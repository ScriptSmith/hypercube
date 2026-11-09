import { describe, expect, it } from "vitest";
import { BALL_R, GRAB_REACH, TABLE_H, TABLE_W } from "../../../src/apps/pinball/config";
import { pickBall, touchDown } from "../../../src/apps/pinball/grab";
import manifest from "../../../src/apps/pinball/manifest";
import { padsFor } from "../../../src/apps/pinball/pads";
import type { Ball, Circle, Seg } from "../../../src/apps/pinball/physics";
import { DT, emptyTable, rig, seeded } from "./helpers";

const WALL_R = 7;
/** The grab is off unless the operator turns it on. */
const GRAB = { options: { grab: true } };
const pads = (mirror = false) => padsFor(0, mirror, { left: false, right: false });

/** The ball's centre is somewhere it could get to on its own: inside the shell, clear of posts. */
const inside = (ball: Ball, shapes: readonly { kind: string }[]) => {
  const r = ball.r + WALL_R - 1;
  if (ball.x < 24 + r || ball.x > 1058 - r) return false;
  if (ball.y < 640 && Math.hypot(ball.x - 540, ball.y - 640) > 516 - r) return false;
  for (const s of shapes) {
    if (s.kind !== "circle") continue;
    const c = s as Circle;
    if (Math.hypot(ball.x - c.x, ball.y - c.y) < c.r + ball.r - 1) return false;
  }
  return true;
};

/** Which side of a wall's line a point is on. */
const side = (w: Seg, x: number, y: number) =>
  Math.sign((w.bx - w.ax) * (y - w.ay) - (w.by - w.ay) * (x - w.ax));

const wallAt = (shapes: readonly { kind: string }[], ax: number, ay: number, bx: number) =>
  shapes.find(
    (s) =>
      s.kind === "seg" &&
      Math.abs((s as Seg).ax - ax) < 1 &&
      Math.abs((s as Seg).ay - ay) < 1 &&
      Math.abs((s as Seg).bx - bx) < 1,
  ) as Seg;

describe("pinball ball grab", () => {
  it("picks up the nearest ball within reach, and none further away", () => {
    const r = emptyTable(GRAB);
    const a = r.table.place(400, 900, 0, 0);
    const b = r.table.place(480, 900, 0, 0);
    expect(r.table.grab(1, 430, 900)).toBe(true);
    expect(a.hold).not.toBeNull();
    expect(b.hold).toBeNull();
    expect(r.table.held()).toBe(1);

    const reach = BALL_R + GRAB_REACH;
    const free = (x: number) => pickBall([b], x, 900, GRAB_REACH, () => false);
    expect(free(480 + reach - 1)).toBe(b);
    expect(free(480 + reach + 1)).toBeNull();
    expect(r.table.grab(2, 480 + reach + 2, 900)).toBe(false);
  });

  it("holds one ball per finger, and a second finger can't take a held ball", () => {
    const r = emptyTable(GRAB);
    r.table.world.gravity = 0;
    const a = r.table.place(400, 900, 0, 0);
    const b = r.table.place(560, 900, 0, 0);
    expect(r.table.grab(1, 400, 900)).toBe(true);
    // The same finger again, now near the other ball: it keeps the one it has.
    expect(r.table.grab(1, 560, 900)).toBe(false);
    expect(b.hold).toBeNull();
    // Another finger on the held ball gets nothing.
    expect(r.table.grab(2, 400, 900)).toBe(false);
    // Between the two it takes the free one, though the held one is nearer.
    expect(r.table.grab(2, 470, 900)).toBe(true);
    expect(b.hold).not.toBeNull();
    expect(r.table.held()).toBe(2);
    // Each ball follows its own finger.
    r.table.drag(1, 300, 900);
    r.step(0.3);
    expect(a.x).toBeCloseTo(300, 0);
    expect(b.x).toBeCloseTo(470, 0);
    r.table.drop(1, 0, 0);
    expect(a.hold).toBeNull();
    expect(r.table.held()).toBe(1);
  });

  it("follows the finger with a short catch-up", () => {
    const r = emptyTable(GRAB);
    const b = r.table.place(500, 1000, 0, 0);
    expect(r.table.grab(1, 560, 1000)).toBe(true);
    r.step(DT);
    // It doesn't jump to the finger, but it gets there quickly.
    expect(b.x).toBeGreaterThan(505);
    expect(b.x).toBeLessThan(555);
    r.step(0.15);
    expect(Math.hypot(b.x - 560, b.y - 1000)).toBeLessThan(2);
  });

  it("keeps a held ball inside the table when it's dragged into walls and posts", () => {
    const shapes = rig(GRAB).table.layout.shapes;
    const plungerWall = wallAt(shapes, 976, TABLE_H + 40, 976);
    const guide = wallAt(shapes, 420, 235, 420);
    const sling = shapes.find((s) => s.tag === "sling" && s.index === 0) as Seg;
    const drags: { from: [number, number]; to: [number, number]; wall?: Seg }[] = [
      // Off the left edge, over the arch, past the top corners.
      { from: [500, 900], to: [-200, 900] },
      { from: [555, 340], to: [540, -300] },
      { from: [200, 700], to: [0, 0] },
      { from: [800, 400], to: [TABLE_W, 0] },
      // Into the plunger lane through its wall, and through a top lane guide.
      { from: [900, 1200], to: [1017, 1200], wall: plungerWall },
      { from: [900, 1700], to: [1060, 1750], wall: plungerWall },
      { from: [465, 270], to: [300, 270], wall: guide },
      // Through a pop bumper, and into a slingshot through its face.
      { from: [480, 560], to: [480, 330] },
      { from: [660, 330], to: [660, 560] },
      { from: [300, 1400], to: [190, 1450], wall: sling },
    ];
    for (const d of drags) {
      const r = emptyTable(GRAB);
      const b = r.table.place(d.from[0], d.from[1], 0, 0);
      expect(r.table.grab(1, d.from[0], d.from[1])).toBe(true);
      const start = d.wall ? side(d.wall, b.x, b.y) : 0;
      r.table.drag(1, d.to[0], d.to[1]);
      for (let i = 0; i < 120; i++) {
        r.step(DT);
        const where = `${d.from} to ${d.to} at step ${i}: ${b.x.toFixed(1)}, ${b.y.toFixed(1)}`;
        expect(inside(b, shapes), where).toBe(true);
        if (d.wall) expect(side(d.wall, b.x, b.y), where).toBe(start);
      }
      expect(r.table.world.balls).toContain(b);
    }
  });

  it("keeps a held ball inside the table through a minute of wild dragging", () => {
    const rnd = seeded(31);
    const r = emptyTable(GRAB);
    const shapes = r.table.layout.shapes;
    const b = r.table.place(500, 1000, 0, 0);
    expect(r.table.grab(1, 500, 1000)).toBe(true);
    for (let n = 0; n < 1200; n++) {
      // Anywhere on the panel and a little off it, as a frantic finger might go.
      r.table.drag(1, -100 + rnd() * (TABLE_W + 200), -100 + rnd() * (TABLE_H + 200));
      for (let i = 0; i < 6; i++) {
        r.step(DT);
        expect(inside(b, shapes), `jump ${n}`).toBe(true);
        // The plunger lane's gate only lets balls out.
        if (b.y > 640) expect(b.x, `jump ${n}`).toBeLessThan(976 - BALL_R - WALL_R + 1);
      }
    }
    expect(r.table.world.balls).toContain(b);
    expect(r.table.stats.drains).toBe(0);
  });

  it("can't push another ball through a wall or post", () => {
    const cases: { free: [number, number]; held: [number, number]; to: [number, number] }[] = [
      { free: [100, 1000], held: [300, 1000], to: [-200, 1000] },
      { free: [480, 540], held: [480, 700], to: [480, 300] },
      { free: [900, 1200], held: [800, 1200], to: [1080, 1200] },
    ];
    for (const c of cases) {
      const r = emptyTable(GRAB);
      r.table.world.gravity = 0;
      const shapes = r.table.layout.shapes;
      const free = r.table.place(c.free[0], c.free[1], 0, 0);
      const held = r.table.place(c.held[0], c.held[1], 0, 0);
      expect(r.table.grab(1, c.held[0], c.held[1])).toBe(true);
      r.table.drag(1, c.to[0], c.to[1]);
      for (let i = 0; i < 240; i++) {
        r.step(DT);
        expect(inside(free, shapes), `${c.free} at step ${i}`).toBe(true);
        expect(inside(held, shapes)).toBe(true);
        if (free.y > 640) expect(free.x).toBeLessThan(976 - BALL_R - WALL_R + 1);
      }
    }
  });

  it("throws a ball let go with the finger's speed, capped below the plunger's", () => {
    for (const variant of ["classic"]) {
      // The plunger at full pull.
      const p = rig({ variant, ...GRAB });
      p.table.start("human");
      p.step(0.3);
      p.table.pressPlunger();
      p.step(1.2);
      p.table.releasePlunger();
      p.step(DT);
      const launch = Math.hypot(p.table.world.balls[0]!.vx, p.table.world.balls[0]!.vy);
      expect(launch).toBeGreaterThan(3000);

      const r = emptyTable({ variant, ...GRAB });
      const b = r.table.place(500, 1000, 0, 0);
      r.table.grab(1, 500, 1000);
      r.table.drop(1, 300, -400);
      expect(b.vx).toBeCloseTo(300, 6);
      expect(b.vy).toBeCloseTo(-400, 6);

      r.table.grab(2, b.x, b.y);
      r.table.drop(2, 1e6, -1e6);
      const speed = Math.hypot(b.vx, b.vy);
      expect(speed, variant).toBeLessThan(launch * 0.9);
      expect(speed).toBeGreaterThan(launch * 0.5);
      expect(b.vx).toBeCloseTo(-b.vy, 6);

      r.table.grab(3, b.x, b.y);
      r.table.drop(3, Number.NaN, 5);
      expect([b.vx, b.vy]).toEqual([0, 0]);
    }
  });

  it("doesn't flip or plunge for a touch that picks up a ball", () => {
    const r = emptyTable(GRAB);
    const p = pads();
    const left = r.table.world.flippers.find((f) => f.name === "left")!;
    r.table.place(300, 1500, 0, 0);
    expect(touchDown(r.table, p, 1, 320, 1520, true)).toBe("grab");
    r.step(0.2);
    expect(left.held).toBe(false);
    expect(left.angle).toBeCloseTo(left.rest, 6);
    // Away from the ball, the pad works as before.
    expect(touchDown(r.table, p, 2, 800, 1500, true)).toBe("right");
    // A ball waiting on the plunger is the plunger pad's.
    const w = rig(GRAB);
    w.table.start("human");
    w.step(0.3);
    const ball = w.table.world.balls[0]!;
    expect(touchDown(w.table, p, 3, ball.x, ball.y, true)).toBe("plunger");
    expect(w.table.held()).toBe(0);
  });

  it("works on both tables of a pair", () => {
    for (const h of [0, 1]) {
      const mirror = h === 0;
      const p = padsFor(h * TABLE_W, mirror, { left: h > 0, right: h < 1 });
      const r = emptyTable({ mirror, ...GRAB });
      const b = r.table.place(500, 1200, 0, 0);
      expect(touchDown(r.table, p, 1, h * TABLE_W + 520, 1210, true), `table ${h}`).toBe("grab");
      expect(b.hold).toEqual({ x: 520, y: 1210 });
      // The plunger lane is at the outer edge on both, and its waiting ball isn't for picking up.
      const w = rig({ mirror, ...GRAB });
      w.table.start("human");
      w.step(0.3);
      const ball = w.table.world.balls[0]!;
      expect(touchDown(w.table, p, 2, h * TABLE_W + ball.x, ball.y, true)).toBe("plunger");
    }
  });

  it("is off by default and with grab: false, and for bots and attract play", () => {
    for (const off of [emptyTable(), emptyTable({ options: { grab: false } })]) {
      off.table.place(300, 1500, 0, 0);
      expect(touchDown(off.table, pads(), 1, 300, 1500, true)).toBe("left");
      expect(off.table.held()).toBe(0);
    }
    const option = manifest.options?.find((o) => o.key === "grab");
    expect(option?.default).toBe(false);

    const r = emptyTable(GRAB);
    r.table.place(300, 1500, 0, 0);
    expect(touchDown(r.table, pads(), 1, 300, 1500, false)).toBe("left");
    for (const ctrl of ["bot", "attract"] as const) {
      const t = rig(GRAB);
      t.table.start(ctrl);
      t.table.world.balls.length = 0;
      t.table.place(300, 1500, 0, 0);
      expect(t.table.grab(1, 300, 1500), ctrl).toBe(false);
    }
  });

  it("scores nothing while held and ignores flippers, but scores again once let go", () => {
    const r = emptyTable(GRAB);
    const b = r.table.place(500, 700, 0, 0);
    r.table.grab(1, 500, 700);
    // Over the spinner, into each bumper, down an inlane and its rollover.
    const path: [number, number][] = [
      [500, 900],
      [480, 330],
      [660, 330],
      [570, 700],
      [136, 1300],
      [136, 1520],
    ];
    for (const [x, y] of path) {
      r.table.drag(1, x, y);
      r.step(0.4);
    }
    // Held in the sweep of a flipper that swings.
    const left = r.table.world.flippers.find((f) => f.name === "left")!;
    r.table.drag(1, 420, 1680);
    r.step(0.3);
    r.table.setFlipper("left", true);
    r.step(0.3);
    expect(Math.hypot(b.x - 420, b.y - 1680)).toBeLessThan(2);
    r.table.setFlipper("left", false);
    r.step(0.3);
    expect(left.angle).toBeCloseTo(left.rest, 3);
    expect(r.table.score).toBe(0);
    for (const tag of ["bumper", "spinner", "inlane"]) {
      expect(r.table.flashAge(tag, 0), tag).toBe(Infinity);
    }
    expect(r.table.spinner.speed).toBe(0);
    // Thrown at a bumper, it scores.
    r.table.drag(1, 480, 640);
    r.step(0.4);
    r.table.drop(1, 0, -2500);
    r.step(0.3);
    expect(r.table.score).toBeGreaterThan(0);
  });

  it("can't drain while held, and drains as usual once let go over the drain", () => {
    const r = emptyTable(GRAB);
    const b = r.table.place(500, 1700, 0, 0);
    r.table.grab(1, 500, 1700);
    r.table.drag(1, 500, TABLE_H + 400);
    r.step(3);
    expect(r.table.world.balls).toContain(b);
    expect(b.y).toBeLessThanOrEqual(TABLE_H);
    expect(r.table.stats.drains).toBe(0);
    r.table.drop(1, 0, 600);
    r.step(0.5);
    expect(r.table.world.balls).not.toContain(b);
    expect(r.table.stats.drains).toBe(1);
    expect(r.table.left).toBe(r.cfg.balls - 1);
  });

  it("lets go of held balls when the player leaves or a new game starts", () => {
    const r = emptyTable(GRAB);
    const b = r.table.place(500, 1000, 0, 0);
    r.table.grab(1, 500, 1000);
    r.table.leave();
    expect(r.table.held()).toBe(0);
    expect(b.hold).toBeNull();
    r.step(0.3);
    expect(b.y).toBeGreaterThan(1010);

    const s = emptyTable(GRAB);
    s.table.place(500, 1000, 0, 0);
    s.table.grab(1, 500, 1000);
    s.table.start("human");
    expect(s.table.held()).toBe(0);
    expect(s.table.world.balls.every((x) => x.hold === null)).toBe(true);
    // A finger whose ball has gone lets go of nothing.
    s.table.drop(1, 100, 100);
    s.table.drag(1, 100, 100);
    expect(s.table.held()).toBe(0);
  });
});
