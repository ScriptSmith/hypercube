import { describe, expect, it } from "vitest";
import { BALL_R, MAX_IN_PLAY, SUBSTEPS, TABLE_H, VMAX } from "../../../src/apps/pinball/config";
import {
  createCarrier,
  createDropBank,
  createFlow,
  createKickout,
  createLock,
  createOrbiter,
  createPuffer,
  createRide,
  createShuttle,
  createSpinDisc,
  createToyBox,
  type Device,
  HOLD_LIMIT_S,
  type Lock,
  type Out,
  stomp,
  strikeLevel,
  type ToyBox,
} from "../../../src/apps/pinball/devices";
import { buildTable } from "../../../src/apps/pinball/layout";
import {
  type Ball,
  circle,
  makeBall,
  makeWorld,
  seg,
  stepWorld,
} from "../../../src/apps/pinball/physics";
import { createTable, type Table } from "../../../src/apps/pinball/table";
import type { ToyHost } from "../../../src/apps/pinball/toys";
import { readConfig } from "../../../src/apps/pinball/config";
import { DT, seeded } from "./helpers";

const ball = (x: number, y: number, vx = 0, vy = 0) => {
  const b = makeBall(1, x, y, BALL_R);
  b.vx = vx;
  b.vy = vy;
  return b;
};

/** Run a device alone for `s` seconds from `t0`, collecting what it lets go. */
const run = (d: Device, t0: number, s: number, step = DT) => {
  const out: Out[] = [];
  for (let t = t0; t <= t0 + s + 1e-9; t += step) d.update(t, out);
  return out;
};

describe("pinball table devices", () => {
  it("kickout: catches a slow ball near it, holds it and kicks it out at its aim", () => {
    const k = createKickout({
      name: "saucer",
      x: 500,
      y: 500,
      r: 40,
      maxSpeed: 2000,
      hold: 1.2,
      out: { vx: -300, vy: 600 },
    });
    expect(k.wants(ball(560, 500), 0)).toBe(false);
    expect(k.wants(ball(520, 500, 2500, 0), 0)).toBe(false);
    const b = ball(520, 500, 400, 0);
    expect(k.wants(b, 0)).toBe(true);
    k.take(b, 0);
    expect(k.wants(ball(500, 500), 0.1)).toBe(false);
    expect(run(k, 0, 1.1)).toHaveLength(0);
    // Pulled into the middle and sunk a little while held.
    const held: Parameters<Device["held"]>[0] = [];
    k.held(held);
    expect(held[0]!.x).toBeCloseTo(500, 3);
    expect(held[0]!.z).toBeLessThan(BALL_R);
    const out = run(k, 1.1, 0.2);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ball: b, x: 500, y: 500, vx: -300, vy: 600 });
    // It cools down before it takes another.
    expect(k.wants(ball(500, 500), 1.3)).toBe(false);
    expect(k.wants(ball(500, 500), 2.5)).toBe(true);
  });

  it("kickback: takes nothing until lit, then a ball going down, and goes out after firing", () => {
    const k = createKickout({
      name: "cannon",
      x: 60,
      y: 1450,
      r: 40,
      maxSpeed: 5000,
      hold: 0.3,
      armed: false,
      accept: (b) => b.vy > 0,
      out: { vx: 0, vy: -3000 },
    });
    const down = ball(60, 1450, 0, 800);
    expect(k.wants(down, 0)).toBe(false);
    k.arm();
    expect(k.wants(ball(60, 1450, 0, -800), 0)).toBe(false);
    expect(k.wants(down, 0)).toBe(true);
    k.take(down, 0);
    expect(run(k, 0, 0.4)[0]).toMatchObject({ vy: -3000 });
    expect(k.armed).toBe(false);
    expect(k.wants(ball(60, 1450, 0, 800), 5)).toBe(false);
    k.arm();
    k.reset();
    expect(k.armed).toBe(false);
  });

  it("kickout: never holds longer than the limit, and reset forgets its ball", () => {
    const k = createKickout({
      name: "slow",
      x: 0,
      y: 0,
      r: 40,
      maxSpeed: 1e9,
      hold: 999,
      out: { vx: 0, vy: 0 },
    });
    k.take(ball(0, 0), 0);
    expect(run(k, 0, HOLD_LIMIT_S - 0.1)).toHaveLength(0);
    expect(run(k, HOLD_LIMIT_S - 0.05, 0.2)).toHaveLength(1);
    k.take(ball(0, 0), 100);
    k.reset();
    expect(k.ball).toBeNull();
    expect(run(k, 100, 30)).toHaveLength(0);
  });

  const lockSpec = (o: Partial<Parameters<typeof createLock>[0]> = {}) =>
    createLock({
      name: "lock",
      mouth: { x: 500, y: 500, r: 40 },
      maxSpeed: 3000,
      slots: [0, 1, 2].map((i) => ({ x: 500, y: 450 - i * 40, z: 40 })),
      countdown: 2,
      gap: 0.3,
      timeout: 12,
      cool: 2,
      out: [{ x: 500, y: 540, vx: -500, vy: 500 }],
      ...o,
    });

  it("lock: holds balls until it is full, counts down and lets them all go as a multiball", () => {
    const l = lockSpec();
    const balls = [0, 1, 2].map((i) => ball(500, 500 + i));
    l.take(balls[0]!, 0);
    expect(l.waits?.()).toBe(true);
    l.take(balls[1]!, 1);
    expect(l.phase).toBe("open");
    l.take(balls[2]!, 2);
    expect(l.phase).toBe("countdown");
    expect(l.waits?.()).toBe(false);
    expect(l.wants(ball(500, 500), 2.1)).toBe(false);
    expect(run(l, 2, 1.9)).toHaveLength(0);
    const out = run(l, 4, 1);
    expect(out.map((o) => o.ball)).toEqual(balls);
    expect(out.every((o) => o.why === "multiball")).toBe(true);
    expect(l.phase).toBe("closed");
    expect(l.count).toBe(0);
    expect(l.progress).toBe(0);
    run(l, 5, 2.1);
    expect(l.phase).toBe("open");
  });

  it("lock: lets a lone ball go after its time limit but keeps its count towards the multiball", () => {
    const l = lockSpec();
    const a = ball(500, 500);
    l.take(a, 0);
    expect(run(l, 0, 11.9)).toHaveLength(0);
    const out = run(l, 12, 0.1);
    expect(out).toEqual([expect.objectContaining({ ball: a, why: "lock" })]);
    expect(l.progress).toBe(1);
    run(l, 12.2, 3);
    // Two more: full, so the release tops the one held up with two new balls.
    l.take(ball(500, 500), 20);
    const c = ball(500, 500);
    l.take(c, 21);
    expect(l.phase).toBe("countdown");
    const multi = run(l, 21, 4);
    expect(multi).toHaveLength(3);
    expect(multi.filter((o) => o.ball === null)).toHaveLength(1);
    expect(multi.every((o) => o.why === "multiball")).toBe(true);
  });

  it("lock: flush lets waiting balls go at once, and reset forgets everything", () => {
    const l = lockSpec();
    l.take(ball(500, 500), 0);
    l.flush(1);
    expect(run(l, 1, 0.1)).toHaveLength(1);
    l.take(ball(500, 500), 10);
    l.reset();
    expect([l.count, l.progress, l.phase]).toEqual([0, 0, "open"]);
    expect(run(l, 10, 30)).toHaveLength(0);
  });

  it("lock: never holds a ball past the limit, whatever its settings", () => {
    const l = lockSpec({ timeout: 999, countdown: 3, gap: 0.5 });
    l.take(ball(500, 500), 0);
    l.take(ball(500, 500), HOLD_LIMIT_S - 5);
    const out = run(l, 0, HOLD_LIMIT_S);
    expect(out).toHaveLength(2);
  });

  it("drop bank: targets drop when hit, the last pays, and they rise when clear", () => {
    const targets = [0, 1, 2].map((i) => seg(100 + i * 80, 500, 160 + i * 80, 500, { r: 12 }));
    const bank = createDropBank({ targets, rise: 2, idle: 20 });
    expect(bank.hit(0, 1)).toBe("drop");
    expect(targets[0]!.on).toBe(false);
    expect(bank.hit(0, 1.1)).toBeNull();
    expect(bank.hit(1, 1.2)).toBe("drop");
    expect(bank.hit(2, 1.3)).toBe("done");
    bank.update(2, []);
    expect(bank.up).toEqual([false, false, false]);
    // A ball sitting where the middle one stands keeps it down until it moves.
    const b = ball(210, 500);
    bank.update(3.5, [b]);
    expect(bank.up).toEqual([true, false, true]);
    expect(targets[1]!.on).toBe(false);
    b.x = 600;
    bank.update(3.6, [b]);
    expect(bank.up).toEqual([true, true, true]);
    expect(targets.every((t) => t.on)).toBe(true);
    // A half-done bank rises again after a while without a hit.
    bank.hit(1, 10);
    bank.update(29, []);
    expect(bank.up[1]).toBe(false);
    bank.update(30.1, []);
    expect(bank.up[1]).toBe(true);
    bank.hit(0, 40);
    bank.reset();
    expect(bank.up).toEqual([true, true, true]);
  });

  it("orbiter and shuttle: move bumpers a fraction of a ball each sub-step, along their paths", () => {
    const h = DT / SUBSTEPS;
    const c = circle(0, 0, 22);
    const o = createOrbiter(c, { cx: 500, cy: 600, radius: 140, omega: 1.1 });
    let last = { x: c.x, y: c.y };
    for (let i = 0; i < 4000; i++) {
      o.tick(h);
      expect(Math.hypot(c.x - last.x, c.y - last.y)).toBeLessThan(BALL_R / 10);
      expect(Math.hypot(c.x - 500, c.y - 600)).toBeCloseTo(140, 6);
      last = { x: c.x, y: c.y };
    }
    const s = circle(0, 0, 30);
    const sh = createShuttle(s, { a: { x: 300, y: 400 }, b: { x: 700, y: 400 }, period: 4 });
    expect(s.x).toBeCloseTo(300, 6);
    for (let i = 0; i < 1200; i++) sh.tick(h);
    expect(s.x).toBeCloseTo(700, 3);
    sh.reset();
    expect(s.x).toBeCloseTo(300, 6);
  });

  it("orbiter: a full-speed ball never gets inside a moon going round", () => {
    let met = 0;
    for (let phase = 0; phase < 1; phase += 0.125) {
      for (let deg = 0; deg < 360; deg += 30) {
        const w = makeWorld({
          gravity: 0,
          vmax: VMAX,
          damping: 0,
          bounds: { x0: -5000, y0: -5000, x1: 5000, y1: 5000 },
        });
        const c = circle(0, 0, 22, { kick: 900, e: 0.5 });
        w.shapes.push(c);
        const o = createOrbiter(c, { cx: 0, cy: 0, radius: 140, omega: 1.1, phase: phase * 6 });
        w.tick = (h) => o.tick(h);
        const a = (deg * Math.PI) / 180;
        const b = ball(c.x - Math.cos(a) * 400, c.y - Math.sin(a) * 400);
        b.vx = Math.cos(a) * VMAX;
        b.vy = Math.sin(a) * VMAX;
        w.balls.push(b);
        let touched = false;
        for (let i = 0; i < 30; i++) {
          stepWorld(w, DT, SUBSTEPS);
          const d = Math.hypot(b.x - c.x, b.y - c.y);
          touched ||= d < c.r + BALL_R + 4;
          expect(d).toBeGreaterThan(c.r + BALL_R - 2);
        }
        if (touched) met++;
      }
    }
    expect(met).toBeGreaterThan(40);
  });

  it("puffer: swells on a hit and shrinks back, pushing a ball beside it out, never in", () => {
    const w = makeWorld({
      gravity: 0,
      vmax: VMAX,
      damping: 0,
      bounds: { x0: -5000, y0: -5000, x1: 5000, y1: 5000 },
    });
    const c = circle(500, 500, 40, { kick: 800, e: 0.5 });
    w.shapes.push(c);
    const p = createPuffer(c, { r0: 40, r1: 70, grow: 0.15, hold: 0.6, shrink: 0.8 });
    w.tick = (h) => p.tick(h);
    const b = ball(500 + 40 + BALL_R + 1, 500);
    w.balls.push(b);
    p.puff();
    let biggest = 0;
    for (let i = 0; i < 240; i++) {
      stepWorld(w, DT, SUBSTEPS);
      biggest = Math.max(biggest, c.r);
      expect(Math.hypot(b.x - c.x, b.y - c.y)).toBeGreaterThan(c.r + BALL_R - 1);
    }
    expect(biggest).toBeCloseTo(70, 3);
    expect(c.r).toBeCloseTo(40, 6);
    expect(p.k).toBe(0);
    p.puff();
    for (let i = 0; i < 10; i++) stepWorld(w, DT, SUBSTEPS);
    p.reset();
    expect(c.r).toBe(40);
  });

  it("flow: pushes balls inside its box along its direction, and turns when aimed", () => {
    const f = createFlow({
      box: { x0: 0, y0: 0, x1: 1000, y1: 400 },
      dir: { x: 1, y: 0 },
      accel: 600,
    });
    const inside = ball(500, 200);
    const outside = ball(500, 600);
    for (let i = 0; i < 120 * SUBSTEPS; i++) f.tick([inside, outside], DT / SUBSTEPS);
    expect(inside.vx).toBeCloseTo(600, 0);
    expect(outside.vx).toBe(0);
    f.aim(-1, 0);
    for (let i = 0; i < 10; i++) f.tick([], DT / SUBSTEPS);
    // Turning, not flipped at once.
    expect(f.dir.x).toBeGreaterThan(0.9);
    for (let i = 0; i < 2 * 120 * SUBSTEPS; i++) f.tick([], DT / SUBSTEPS);
    expect(f.dir.x).toBeCloseTo(-1, 3);
    f.reset();
    expect(f.dir.x).toBeCloseTo(1, 6);
  });

  it("spin disc: swings a ball resting on it round with the disc", () => {
    const d = createSpinDisc({ x: 500, y: 500, r: 120, omega: 2, grip: 6 });
    const b = ball(580, 500);
    for (let i = 0; i < 60 * SUBSTEPS; i++) d.tick([b], DT / SUBSTEPS);
    // y down, positive omega turns clockwise on screen: at the disc's right, moving down.
    expect(b.vy).toBeGreaterThan(100);
    const far = ball(800, 500);
    d.tick([far], DT);
    expect(far.vy).toBe(0);
  });

  it("ride: carries a ball along its path with height and lets it go at the end", () => {
    const ride = createRide({
      name: "ramp",
      path: [
        { x: 500, y: 800, z: 80 },
        { x: 500, y: 300, z: 120 },
        { x: 800, y: 300, z: BALL_R },
      ],
      speed: 2000,
      exit: 900,
      max: 1,
    });
    const b = ball(500, 900);
    ride.take(b, 0);
    expect(ride.room?.()).toBe(false);
    const out: Out[] = [];
    let top = 0;
    for (let t = 0; t < 2 && out.length === 0; t += DT) {
      ride.update(t, out);
      const held: Parameters<Device["held"]>[0] = [];
      ride.held(held);
      if (held[0]) top = Math.max(top, held[0].z);
    }
    expect(top).toBeGreaterThan(100);
    expect(out[0]).toMatchObject({ ball: b, x: 800, y: 300 });
    expect(out[0]!.vx).toBeCloseTo(900, 3);
    expect(ride.room?.()).toBe(true);
  });

  it("carrier: places a ball by its own function and lets go when it says, or at the limit", () => {
    const c = createCarrier({
      name: "cup",
      wants: () => true,
      place: (since, now) => ({
        x: 500 + (now - since) * 100,
        y: 500,
        z: 40,
        done: now - since >= 2 ? { vx: 300, vy: -200 } : undefined,
      }),
    });
    expect(c.wants(ball(0, 0), 0)).toBe(true);
    c.take(ball(0, 0), 0);
    expect(c.wants(ball(0, 0), 0)).toBe(false);
    const out = run(c, 0, 2.05);
    expect(out[0]).toMatchObject({ vx: 300, vy: -200 });
    expect(Math.abs(out[0]!.x - 700)).toBeLessThan(2);
    const stuck = createCarrier({
      name: "stuck",
      wants: () => true,
      place: () => ({ x: 0, y: 0, z: 0 }),
    });
    stuck.take(ball(0, 0), 0);
    expect(run(stuck, 0, HOLD_LIMIT_S - 0.1)).toHaveLength(0);
    expect(run(stuck, HOLD_LIMIT_S - 0.05, 0.2)).toHaveLength(1);
  });

  it("stomp hops nearby balls; strikeLevel reads a hit's speed", () => {
    const near = ball(500, 500);
    const far = ball(900, 500);
    expect(stomp([near, far], 520, 520, 200, 1500)).toBe(1);
    expect(near.vy).toBeLessThan(-600);
    expect(far.vy).toBe(0);
    expect(strikeLevel(100, 200, 2200)).toBe(0);
    expect(strikeLevel(1200, 200, 2200)).toBeCloseTo(0.5, 6);
    expect(strikeLevel(5000, 200, 2200)).toBe(1);
  });
});

/** A classic table with a lock as its only toy, low in the open middle. */
const lockTable = () => {
  let lock: Lock | null = null;
  let box: ToyBox | null = null;
  const table = createTable({
    layout: buildTable({ mirror: false }),
    cfg: readConfig("classic", {}),
    color: 0,
    random: seeded(9),
    deck: () => false,
    onUp: () => false,
    toys(host: ToyHost) {
      lock = createLock({
        name: "lock",
        mouth: { x: 540, y: 1000, r: 40 },
        maxSpeed: 3000,
        slots: [0, 1, 2].map((i) => ({ x: 540 + i * 60, y: 1000, z: 40 })),
        countdown: 1,
        gap: 0.2,
        timeout: 12,
        cool: 1,
        out: [{ x: 540, y: 1050, vx: 0, vy: 300 }],
      });
      box = createToyBox(host, { devices: [lock] });
      return box;
    },
  });
  return { table, lock: () => lock!, box: () => box! };
};

const stepT = (t: Table, s: number, now = { t: 1e6 }) => {
  for (let i = 0; i < Math.round(s / DT); i++) {
    t.update(DT, now.t);
    now.t += DT * 1000;
  }
};

/** Drop a ball into the lock's mouth. */
const feed = (t: Table) => t.place(540, 1000, 0, 0);

describe("pinball toys on a table", () => {
  it("serves a new ball when one is locked, and counts locked balls as in play", () => {
    const { table, lock } = lockTable();
    table.start("human");
    table.world.balls.length = 0;
    feed(table);
    stepT(table, DT * 2);
    expect(lock().count).toBe(1);
    expect(table.world.balls).toHaveLength(1);
    expect(table.waiting()).toBe(true);
    expect(table.inPlay()).toBe(2);
  });

  it("a drain while balls are locked costs no ball, serves nothing twice and lets the lock go", () => {
    const { table, lock } = lockTable();
    table.start("human");
    table.world.balls.length = 0;
    feed(table);
    stepT(table, DT * 2);
    const left = table.left;
    // The served ball drains past the ball save.
    stepT(table, 9);
    table.world.balls.length = 0;
    table.place(500, TABLE_H + 10, 0, 500);
    stepT(table, 0.2);
    expect(table.stats.drains).toBe(1);
    expect(table.left).toBe(left);
    expect(table.mode).toBe("play");
    // The lock let its ball go rather than wait with nothing in play; nothing else was served.
    expect(lock().count).toBe(0);
    expect(table.world.balls).toHaveLength(1);
    expect(table.waiting()).toBe(false);
  });

  it("a multiball tops up to the lock's size but never past MAX_IN_PLAY", () => {
    const { table, lock } = lockTable();
    table.start("human");
    table.world.balls.length = 0;
    // A crowded table: free balls far from the lock.
    for (let i = 0; i < MAX_IN_PLAY - 2; i++) table.place(150 + i * 60, 700, 0, 0);
    feed(table);
    stepT(table, DT * 2);
    expect(lock().count).toBe(1);
    // It times out with one held, keeping its count; two more fill it.
    stepT(table, 12.5);
    table.world.balls = table.world.balls.filter((b) => b.y < 900);
    let most = 0;
    for (let i = 0; i < 2; i++) {
      feed(table);
      stepT(table, DT * 2);
      stepT(table, 2);
    }
    for (let i = 0; i < 300; i++) {
      stepT(table, DT);
      most = Math.max(most, table.inPlay());
    }
    expect(lock().phase === "closed" || lock().phase === "open").toBe(true);
    expect(most).toBeLessThanOrEqual(MAX_IN_PLAY);
  });

  it("lets every held ball go when the player leaves, and forgets them on a new game", () => {
    const { table, lock } = lockTable();
    table.start("human");
    table.world.balls.length = 0;
    feed(table);
    stepT(table, DT * 2);
    table.leave();
    stepT(table, DT * 2);
    expect(lock().count).toBe(0);
    feed(table);
    table.start("human");
    expect(lock().count).toBe(0);
    expect(table.toys.held()).toHaveLength(0);
  });

  it("puts a ball on a ride from an event, and takes nothing once the game is over", () => {
    const ride = { d: null as ReturnType<typeof createRide> | null };
    const table = createTable({
      layout: buildTable({ mirror: false }),
      cfg: readConfig("classic", {}),
      color: 0,
      random: seeded(9),
      deck: () => false,
      onUp: () => false,
      toys: (host) => {
        ride.d = createRide({
          name: "ramp",
          path: [{ x: 540, y: 300, z: 90 }],
          speed: 1500,
          exit: 500,
        });
        const box = createToyBox(host, {
          devices: [ride.d],
          event(e) {
            if (e.type === "hit" && e.tag === "bumper") box.put(ride.d!, e.ball);
          },
        });
        return box;
      },
    });
    table.start("human");
    table.world.balls.length = 0;
    const b: Ball = table.place(480, 560, 0, -2000);
    stepT(table, 0.1);
    expect(ride.d!.riders.map((r) => r.ball)).toContain(b);
    expect(table.inPlay()).toBe(1);
    stepT(table, 1);
    expect(table.world.balls).toContain(b);
  });
});
