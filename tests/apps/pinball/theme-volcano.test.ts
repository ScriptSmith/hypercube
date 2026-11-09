import { describe, expect, it } from "vitest";
import { BALL_R, MAX_MULTIPLIER, TABLE_W } from "../../../src/apps/pinball/config";
import type { Shape } from "../../../src/apps/pinball/physics";
import {
  ERUPT,
  STOMP,
  VOLCANO_POINTS,
  type VolcanoToys,
} from "../../../src/apps/pinball/themes/volcano";
import { DT, emptyTable, type Rig } from "./helpers";

const volcano = (mirror = false) => {
  const r = emptyTable({ variant: "volcano", mirror });
  return { r, toys: r.table.toys as VolcanoToys };
};

/** A ball shot up through the ramp's mouth. */
const upRamp = (r: Rig, toys: VolcanoToys, speed = 1700) => {
  const m = toys.middle.ramp.mouth;
  return r.table.place(m.x, m.y + 45, 0, -speed);
};

/** A ball straight into egg `i`'s face from the flipper side at `speed`. */
const atEgg = (r: Rig, toys: VolcanoToys, i: number, speed: number) => {
  const s = toys.middle.eggs[i]!;
  const mx = (s.ax + s.bx) / 2;
  const my = (s.ay + s.by) / 2;
  const nx = -(s.by - s.ay);
  const ny = s.bx - s.ax;
  const l = Math.hypot(nx, ny);
  const k = ny > 0 ? 1 : -1;
  return r.table.place(
    mx + (nx / l) * k * 90,
    my + (ny / l) * k * 90,
    (-nx / l) * k * speed,
    (-ny / l) * k * speed,
  );
};

/** Distance from (x, y) to a shape's surface (negative inside). */
const clearOf = (x: number, y: number, s: Shape) => {
  if (s.kind === "circle") return Math.hypot(x - s.x, y - s.y) - s.r;
  if (s.kind === "seg") {
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const t = Math.max(
      0,
      Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / (dx * dx + dy * dy || 1)),
    );
    return Math.hypot(x - (s.ax + dx * t), y - (s.ay + dy * t)) - s.r;
  }
  if (s.kind === "arc") return Math.abs(Math.hypot(x - s.cx, y - s.cy) - s.rad) - s.r;
  return Infinity;
};

describe("pinball volcano theme", () => {
  it("rides a fast ball up the lava ramp into the crater, and serves another", () => {
    for (const mirror of [false, true]) {
      const { r, toys } = volcano(mirror);
      const score = r.table.score;
      upRamp(r, toys);
      r.step(DT * 6);
      expect(toys.ramp.riders).toHaveLength(1);
      expect(r.table.flashAge("ramp", 0)).toBeLessThan(0.1);
      // Up the ramp, above the playfield.
      r.step(0.3);
      const riding = r.table.toys.held()[0]!;
      expect(riding.by).toBe("ramp");
      expect(riding.z).toBeGreaterThan(BALL_R + 20);
      r.step(0.6);
      expect(toys.ramp.riders).toHaveLength(0);
      expect(toys.lock.count).toBe(1);
      expect(toys.lock.progress).toBe(1);
      expect(r.table.score - score).toBe(VOLCANO_POINTS.ramp + VOLCANO_POINTS.lock);
      expect(r.table.waiting()).toBe(true);
      // It sits in the crater's lava, high on the volcano.
      r.step(0.5);
      const h = r.table.toys.held()[0]!;
      const v = toys.middle.volcano;
      expect(h.by).toBe("crater");
      expect(Math.hypot(h.x - v.x, h.y - v.y)).toBeLessThan(v.rim);
      expect(h.z).toBeGreaterThan(v.lava);
    }
  });

  it("lets a slow ball roll back out of the ramp's mouth", () => {
    const { r, toys } = volcano();
    const m = toys.middle.ramp.mouth;
    const b = r.table.place(m.x, m.y + 12, 0, -380);
    r.step(1.2);
    expect(toys.ramp.riders).toHaveLength(0);
    expect(r.table.flashAge("ramp", 0)).toBe(Infinity);
    expect(r.table.world.balls).toContain(b);
    expect(b.y).toBeGreaterThan(m.y);
  });

  it("erupts on the third ball: a rumbling countdown, a jackpot, and the balls thrown out as a multiball", () => {
    const { r, toys } = volcano();
    for (let i = 0; i < 3; i++) {
      upRamp(r, toys);
      r.step(1.1);
    }
    expect(toys.lock.phase).toBe("countdown");
    const score = r.table.score;
    const shook = r.table.shake.at;
    r.step(1);
    // The countdown rumbles the view.
    expect(r.table.shake.at).toBeGreaterThan(shook);
    let waited = 0;
    while (toys.lock.phase === "countdown" && waited < 3) {
      r.step(DT);
      waited += DT;
    }
    expect(toys.lock.phase).toBe("release");
    expect(toys.lock.full).toBe(true);
    expect(toys.eruptAt).toBeGreaterThan(0);
    expect(r.table.score - score).toBeGreaterThanOrEqual(VOLCANO_POINTS.eruption);
    expect(r.table.shake.amount).toBeGreaterThan(0.5);
    // Each ball flies high out of the crater and comes down at one of the landing spots.
    const last = new Map<number, { x: number; y: number }>();
    let highest = 0;
    r.step(2, () => {
      for (const h of r.table.toys.held()) {
        if (h.by !== "erupt") continue;
        highest = Math.max(highest, h.z);
        last.set(h.ball.id, { x: h.x, y: h.y });
      }
    });
    expect(highest).toBeGreaterThan(toys.middle.volcano.top + ERUPT.high * 0.5);
    expect(last.size).toBe(3);
    for (const p of last.values()) {
      const near = Math.min(...toys.middle.landings.map((l) => Math.hypot(l.x - p.x, l.y - p.y)));
      expect(near).toBeLessThan(40);
    }
    expect(toys.lock.count).toBe(0);
    expect(toys.erupt.carried).toHaveLength(0);
    // The three are back on the playfield, plus the ball waiting on the plunger.
    expect(r.table.world.balls.length).toBeGreaterThanOrEqual(4);
    expect(toys.lock.phase).toBe("closed");
    r.step(3.2);
    expect(toys.lock.phase).toBe("open");
  });

  it("spills a ramp shot over the rim and down onto the upper right flipper while the crater is busy", () => {
    for (const mirror of [false, true]) {
      const { r, toys } = volcano(mirror);
      for (let i = 0; i < 3; i++) {
        upRamp(r, toys);
        r.step(1.1);
      }
      expect(toys.lock.phase).toBe("countdown");
      const score = r.table.score;
      const b = upRamp(r, toys);
      r.step(0.9);
      expect(toys.spill.riders.map((x) => x.ball)).toContain(b);
      expect(r.table.score - score).toBe(VOLCANO_POINTS.ramp + VOLCANO_POINTS.spill);
      let freed: { x: number; y: number; vx: number; vy: number } | null = null;
      r.step(1, () => {
        if (!freed && r.table.world.balls.includes(b))
          freed = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
      });
      expect(freed).not.toBeNull();
      const f = freed!;
      const o = toys.middle.spill.out;
      expect(Math.hypot(f.x - o.x, f.y - o.y)).toBeLessThan(30);
      expect(f.vy).toBeGreaterThan(0);
      // The upper flipper on the volcano's side: upLeft once mirrored.
      const up = r.table.world.flippers.find((x) => x.name === (mirror ? "upLeft" : "upRight"))!;
      expect(Math.abs(f.x - up.px)).toBeLessThan(60);
      expect(mirror ? f.x < TABLE_W / 2 : f.x > TABLE_W / 2).toBe(true);
    }
  });

  it("never ends the game or serves twice when the only free ball drains while one is in the crater", () => {
    const { r, toys } = volcano();
    upRamp(r, toys);
    r.step(1.1);
    expect(toys.lock.count).toBe(1);
    const left = r.table.left;
    r.step(9);
    r.table.world.balls.length = 0;
    r.table.place(500, 1940, 0, 600);
    r.step(0.3);
    expect(r.table.left).toBe(left);
    expect(r.table.mode).toBe("play");
    // The crater let its ball go, and kept its count towards the eruption.
    expect(toys.lock.count).toBe(0);
    expect(toys.lock.progress).toBe(1);
    expect(r.table.waiting()).toBe(false);
    r.step(1);
    expect(r.table.world.balls).toHaveLength(1);
  });

  it("lets a ball off the ramp beside the volcano, never inside it, when the player has left", () => {
    const { r, toys } = volcano();
    const b = upRamp(r, toys);
    r.step(0.2);
    expect(toys.ramp.riders).toHaveLength(1);
    r.table.leave();
    // Where it first comes back into play, before the solver could push it anywhere.
    let first: { x: number; y: number } | null = null;
    r.step(1, () => {
      if (!first && r.table.world.balls.includes(b)) first = { x: b.x, y: b.y };
    });
    expect(first).not.toBeNull();
    const v = toys.middle.volcano;
    const f = first!;
    expect(Math.hypot(f.x - v.x, f.y - v.y)).toBeGreaterThan(v.r + BALL_R - 1);
  });

  it("stomps when its tail is hit: nearby balls hop up the table and the view shakes", () => {
    const { r, toys } = volcano();
    const t = r.table;
    const tail = toys.middle.dino.tail;
    const body = toys.middle.dino.body;
    const score = t.score;
    t.place(tail.x, tail.y + 90, 0, -1500);
    r.step(0.08);
    expect(t.flashAge("tail", 0)).toBeLessThan(0.1);
    const started = toys.stompAt;
    expect(started).toBeGreaterThan(0);
    t.world.balls.length = 0;
    r.step(STOMP.slam - 0.12);
    expect(t.flashAge("stomp", 0)).toBe(Infinity);
    // Balls resting beside the dinosaur, and far from it, as its feet come down.
    const near = t.place(body.x - 120, body.y + 60, 0, 0);
    const far = t.place(body.x, body.y + 900, 0, 0);
    r.step(0.08);
    expect(near.vy).toBeLessThan(-300);
    expect(far.vy).toBeGreaterThan(0);
    expect(t.flashAge("stomp", 0)).toBeLessThan(0.1);
    expect(t.shake.amount).toBeGreaterThan(0.2);
    expect(t.score - score).toBeGreaterThanOrEqual(VOLCANO_POINTS.tail + VOLCANO_POINTS.stomp);
    // Another hit straight away doesn't stomp again until it has cooled.
    t.world.balls.length = 0;
    t.place(tail.x, tail.y + 90, 0, -1500);
    r.step(0.1);
    expect(toys.stompAt).toBe(started);
  });

  it("stomps by itself now and then", () => {
    const { r, toys } = volcano();
    let stomps = 0;
    let last = toys.stompAt;
    r.step(STOMP.every * 3 + STOMP.spread * 2, () => {
      if (toys.stompAt !== last) stomps++;
      last = toys.stompAt;
    });
    expect(stomps).toBeGreaterThanOrEqual(2);
    expect(stomps).toBeLessThanOrEqual(4);
  });

  it("cracks an egg on one hit and hatches it on the next; a hard hit hatches it at once", () => {
    const { r, toys } = volcano();
    const t = r.table;
    let score = t.score;
    atEgg(r, toys, 0, 900);
    r.step(0.15);
    t.world.balls.length = 0;
    expect(toys.cracked[0]).toBe(true);
    expect(toys.eggs.up[0]).toBe(true);
    expect(t.score - score).toBe(VOLCANO_POINTS.crack);
    score = t.score;
    r.step(0.3);
    atEgg(r, toys, 0, 900);
    r.step(0.15);
    t.world.balls.length = 0;
    expect(toys.eggs.up[0]).toBe(false);
    expect(toys.cracked[0]).toBe(false);
    expect(toys.hatchAt[0]).toBeGreaterThan(0);
    expect(t.score - score).toBe(VOLCANO_POINTS.hatch);
    score = t.score;
    atEgg(r, toys, 1, 2600);
    r.step(0.15);
    t.world.balls.length = 0;
    expect(toys.eggs.up[1]).toBe(false);
    expect(toys.cracked[1]).toBe(false);
    expect(t.score - score).toBe(VOLCANO_POINTS.hatch);
  });

  it("all three hatched pays a bonus, raises the multiplier and the parent stomps; then new eggs", () => {
    const { r, toys } = volcano();
    const t = r.table;
    const score = t.score;
    const stomped = toys.stompAt;
    for (let i = 0; i < 3; i++) {
      atEgg(r, toys, i, 2600);
      r.step(0.15);
      t.world.balls.length = 0;
      expect(toys.eggs.up[i]).toBe(false);
    }
    expect(t.score - score).toBeGreaterThanOrEqual(
      3 * VOLCANO_POINTS.hatch + VOLCANO_POINTS.clutch,
    );
    expect(t.multiplier).toBe(2);
    expect(t.flashAge("clutch", 0)).toBeLessThan(0.5);
    expect(toys.stompAt).toBeGreaterThan(stomped);
    r.step(4.2);
    expect(toys.eggs.up).toEqual([true, true, true]);
    expect(t.multiplier).toBeLessThanOrEqual(MAX_MULTIPLIER);
  });

  it("throws and lets balls go only where nothing is in the way, on both hands of table", () => {
    for (const mirror of [false, true]) {
      const { r, toys } = volcano(mirror);
      const m = toys.middle;
      const spots = [...m.landings, ...m.outs, m.spill.out];
      for (const p of spots) {
        for (const s of r.table.layout.shapes) {
          if (!s.on) continue;
          expect(clearOf(p.x, p.y, s), `${s.tag}:${s.index} at ${p.x},${p.y}`).toBeGreaterThan(
            BALL_R + 4,
          );
        }
      }
    }
  });

  it("builds a mirrored table as the mirror image of the other", () => {
    const a = volcano(false).toys.middle;
    const b = volcano(true).toys.middle;
    expect(b.volcano.x).toBeCloseTo(TABLE_W - a.volcano.x, 6);
    expect(b.dino.body.x).toBeCloseTo(TABLE_W - a.dino.body.x, 6);
    expect(b.ramp.mouth.x).toBeCloseTo(TABLE_W - a.ramp.mouth.x, 6);
    expect(b.ramp.path.map((p) => TABLE_W - p.x)).toEqual(a.ramp.path.map((p) => p.x));
    expect(b.landings.map((l) => -l.vx)).toEqual(a.landings.map((l) => l.vx));
    expect(b.spill.out.vx).toBe(-a.spill.out.vx);
    expect(b.dino.side).toBe(-a.dino.side);
    expect(b.ramp.gate.nx).toBeCloseTo(0, 9);
    expect(b.ramp.gate.ny).toBe(-1);
  });
});
