import { describe, expect, it } from "vitest";
import { MAX_IN_PLAY, SAVE_MS, TABLE_H } from "../../../src/apps/pinball/config";
import { botGame, emptyTable, rig } from "./helpers";

/** The upper playfield starts at the upper flippers. */
const UPPER_Y = 770;

describe("pinball table", () => {
  it("serves a ball into the plunger lane and launches it round the arch", () => {
    const r = rig();
    r.table.start("human");
    expect(r.table.waiting()).toBe(true);
    r.step(0.3);
    r.table.pressPlunger();
    r.step(0.5);
    expect(r.table.pull).toBeGreaterThan(0.4);
    r.table.releasePlunger();
    let top = Infinity;
    r.step(1.2, () => {
      const b = r.table.world.balls[0];
      if (b) top = Math.min(top, b.y);
    });
    expect(r.table.waiting()).toBe(false);
    expect(top).toBeLessThan(300);
  });

  it("fires a tap at medium strength", () => {
    const r = rig();
    r.table.start("human");
    r.step(0.3);
    r.table.pressPlunger();
    r.step(0.05);
    r.table.releasePlunger();
    r.step(0.05);
    const b = r.table.world.balls[0]!;
    expect(b.vy).toBeLessThan(-2800);
  });

  it("cradles a ball on a held flipper", () => {
    for (const mirror of [false, true]) {
      const r = emptyTable({ mirror });
      r.table.setFlipper("left", true);
      r.step(0.2);
      const f = r.table.world.flippers.find((x) => x.name === "left")!;
      r.table.place(f.px + 100, 1500, 0, 0);
      r.step(2);
      const b = r.table.world.balls[0]!;
      const at = { x: b.x, y: b.y };
      r.step(2);
      expect(Math.hypot(b.vx, b.vy), `mirror ${mirror}`).toBeLessThan(20);
      expect(Math.hypot(b.x - at.x, b.y - at.y)).toBeLessThan(3);
      // Resting on the flipper near its pivot, above it.
      expect(Math.hypot(b.x - f.px, b.y - f.py)).toBeLessThan(f.len);
      expect(b.y).toBeLessThan(f.py);
    }
  });

  it("sends a flip from the cradle up to the upper playfield", () => {
    let reached = 0;
    let tried = 0;
    for (let delay = 0.3; delay <= 0.5; delay += 0.025) {
      const r = emptyTable();
      r.table.setFlipper("left", true);
      r.step(0.2);
      r.table.place(420, 1500, 0, 0);
      r.step(2);
      r.table.setFlipper("left", false);
      r.step(delay);
      r.table.setFlipper("left", true);
      let top = Infinity;
      r.step(1, () => {
        const b = r.table.world.balls[0];
        if (b) top = Math.min(top, b.y);
      });
      tried++;
      if (top < UPPER_Y) reached++;
    }
    expect(reached / tried).toBeGreaterThan(0.6);
  });

  it("saves a ball that drains early, and charges for one that drains late", () => {
    const r = emptyTable();
    r.table.place(500, 1700, 0, 400);
    r.table.pressPlunger();
    r.table.releasePlunger();
    // No ball in the lane to fire, so no save yet: a drain costs a ball.
    r.step(1);
    expect(r.table.left).toBe(r.cfg.balls - 1);
    // A launch starts the save: a drain straight after comes back free.
    r.step(0.3);
    r.table.pressPlunger();
    r.table.releasePlunger();
    r.step(0.1);
    r.table.world.balls[0]!.x = 500;
    r.table.world.balls[0]!.y = 1800;
    r.table.world.balls[0]!.vy = 600;
    r.step(0.5);
    expect(r.table.left).toBe(r.cfg.balls - 1);
    expect(r.table.waiting()).toBe(true);
    expect(r.table.flashAge("save", 0)).toBeLessThan(1);
    // After the save runs out, the next drain costs.
    r.table.pressPlunger();
    r.table.releasePlunger();
    r.step(SAVE_MS / 1000 + 0.5);
    const b = r.table.world.balls[0]!;
    b.x = 500;
    b.y = 1800;
    b.vy = 600;
    b.vx = 0;
    r.step(0.5);
    expect(r.table.left).toBe(r.cfg.balls - 2);
  });

  it("ends a classic game after its balls, and holds the score", () => {
    const r = rig({ options: { balls: "3" } });
    r.table.start("human");
    let served = 0;
    while (r.table.mode === "play" && served < 10) {
      r.table.world.balls.length = 0;
      r.table.place(500, TABLE_H + 10, 0, 500);
      r.step(0.2);
      served++;
    }
    expect(served).toBe(3);
    expect(r.table.mode).toBe("over");
    expect(r.table.finished()).toBe(false);
    r.step(9);
    expect(r.table.finished()).toBe(true);
  });

  it("plays an unknown or removed variant as classic", () => {
    for (const v of ["gentle", "nope", ""]) {
      const r = rig({ variant: v });
      expect(r.cfg.variant).toBe("classic");
      expect(r.table.layout.posts.every((p) => !p.on)).toBe(true);
    }
  });

  it("sends a deck shot to the screen and serves a new ball at once", () => {
    const r = emptyTable({ deck: true });
    const dl = r.table.layout.deckLane;
    r.table.place(
      dl.mouth.x + dl.dir.x * 30,
      dl.mouth.y + dl.dir.y * 30,
      dl.dir.x * 2200,
      dl.dir.y * 2200,
    );
    r.step(0.3);
    expect(r.ups).toHaveLength(1);
    expect(r.ups[0]!.u).toBeCloseTo(r.table.layout.exitU, 5);
    // The ball climbs off the top in its tube, and a new one waits in the lane: no ball lost.
    expect(r.table.tubes.some((t) => t.kind === "up")).toBe(true);
    expect(r.table.waiting()).toBe(true);
    expect(r.table.left).toBe(r.cfg.balls);
    r.step(0.5);
    expect(r.table.tubes).toHaveLength(0);
  });

  it("goes round the orbit instead when there is no deck", () => {
    for (const sendable of [true, false]) {
      // With no deck, or when the message can't be sent, the ball orbits back into play.
      const r = emptyTable({ deck: !sendable ? true : false, sendable });
      const dl = r.table.layout.deckLane;
      r.table.place(
        dl.mouth.x + dl.dir.x * 30,
        dl.mouth.y + dl.dir.y * 30,
        dl.dir.x * 2200,
        dl.dir.y * 2200,
      );
      r.step(0.3);
      expect(r.table.tubes.some((t) => t.kind === "orbit")).toBe(true);
      expect(r.table.inPlay()).toBe(1);
      r.step(1);
      expect(r.table.tubes).toHaveLength(0);
      expect(r.table.world.balls).toHaveLength(1);
      expect(r.table.stats.orbit).toBe(1);
    }
  });

  it("drops bonus balls from the deck, and a drained bonus ball costs nothing", () => {
    const r = rig({ deck: true });
    r.table.start("human");
    r.step(0.5);
    expect(r.table.addDown({ id: 9, color: 3, t: r.now + 200 }, r.now)).toBe(true);
    expect(r.table.inPlay()).toBe(2);
    r.step(1);
    const bonus = r.table.world.balls.find((b) => b.bonus);
    expect(bonus).toBeDefined();
    expect(bonus!.color).toBe(3);
    bonus!.x = 500;
    bonus!.y = TABLE_H;
    bonus!.vy = 800;
    r.step(0.3);
    expect(r.table.left).toBe(r.cfg.balls);
    expect(r.table.inPlay()).toBe(1);
  });

  it("keeps at most MAX_IN_PLAY balls in play, holding a couple more for later", () => {
    const r = rig({ deck: true });
    r.table.start("human");
    const t = r.now;
    let id = 1;
    while (r.table.inPlay() < MAX_IN_PLAY) {
      expect(r.table.addDown({ id: id++, color: 0, t }, t)).toBe(true);
    }
    expect(id).toBe(MAX_IN_PLAY);
    expect(r.table.addDown({ id: id++, color: 0, t }, t)).toBe(true);
    expect(r.table.addDown({ id: id++, color: 0, t }, t)).toBe(true);
    expect(r.table.inPlay()).toBe(MAX_IN_PLAY);
    expect(r.table.addDown({ id: id++, color: 0, t }, t)).toBe(false);
    r.step(2);
    expect(r.table.inPlay()).toBeLessThanOrEqual(MAX_IN_PLAY);
  });

  it("raises the multiplier when the target bank is complete", () => {
    const r = emptyTable();
    expect(r.table.multiplier).toBe(1);
    // Hit each target squarely from in front.
    const targets = r.table.layout.shapes.filter((s) => s.tag === "target");
    for (const tg of targets) {
      if (tg.kind !== "seg") continue;
      const mx = (tg.ax + tg.bx) / 2;
      const my = (tg.ay + tg.by) / 2;
      const l = Math.hypot(tg.bx - tg.ax, tg.by - tg.ay);
      const nx = -(tg.by - tg.ay) / l;
      const ny = (tg.bx - tg.ax) / l;
      // The front faces down and to the left.
      const s = ny > 0 ? 1 : -1;
      r.table.place(mx + nx * s * 80, my + ny * s * 80, -nx * s * 1500, -ny * s * 1500);
      r.step(0.15);
      r.table.world.balls.length = 0;
    }
    expect(r.table.multiplier).toBe(2);
    expect(r.table.targets.every((x) => !x)).toBe(true);
    expect(r.table.score).toBeGreaterThan(2000);
  });

  it("lets the balls drain after the player leaves, then finishes", () => {
    const r = rig();
    r.table.start("human");
    r.step(0.3);
    r.table.pressPlunger();
    r.table.releasePlunger();
    r.step(0.5);
    r.table.leave();
    expect(r.table.mode).toBe("leaving");
    r.table.setFlipper("left", true);
    expect(r.table.world.flippers.every((f) => !f.held)).toBe(true);
    let t = 0;
    while (!r.table.finished() && t < 20) {
      r.step(0.1);
      t += 0.1;
    }
    expect(r.table.finished()).toBe(true);
    expect(r.table.waiting()).toBe(false);
  });

  it("nudges a ball that has stopped somewhere", () => {
    const r = emptyTable();
    const b = r.table.place(500, 900, 0, 0);
    r.table.world.gravity = 0;
    r.step(5);
    expect(Math.hypot(b.x - 500, b.y - 900)).toBeGreaterThan(5);
  });

  it("plays whole games with a bot, scoring and ending", () => {
    for (const mirror of [false, true]) {
      const r = rig({ mirror });
      r.table.start("bot");
      const secs = botGame(r, mirror ? 9 : 4);
      expect(r.table.mode).toBe("over");
      expect(secs).toBeGreaterThan(20);
      expect(r.table.score).toBeGreaterThan(1000);
    }
  });
});
