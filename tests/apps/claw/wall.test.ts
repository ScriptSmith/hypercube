import { describe, expect, it } from "vitest";
import { STEP } from "../../../src/apps/claw/machine";
import { createTray, TRAY_FADE_S, TRAY_KEEP_S, TRAY_MAX } from "../../../src/apps/claw/tray";
import { createVisitors } from "../../../src/apps/claw/visitors";
import {
  AWAY_S,
  BOT_YIELD_S,
  createWallArcade,
  WALL_PLAY_S,
  type WallArcade,
} from "../../../src/apps/claw/wallarcade";
import { createWallInput, type TouchLike } from "../../../src/apps/claw/wallinput";
import {
  type Button,
  buttonAt,
  layoutWall,
  type WallLayout,
} from "../../../src/apps/claw/walllayout";
import { createRng } from "../../../src/core/rng";
import { DEFAULT_VENUE, reachFor } from "../../../src/core/venue";

const WALL = { width: DEFAULT_VENUE.wall.width, height: DEFAULT_VENUE.wall.height };
const REACH = reachFor(DEFAULT_VENUE.wall);
/** The admin unlock corner, venue px. */
const CORNER = 220;

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const checkLayout = (l: WallLayout, childBand: boolean) => {
  const issues: string[] = [];
  const say = (ok: boolean, what: string) => {
    if (!ok) issues.push(what);
  };
  say(l.play.width >= 2.9 - 1e-9 && l.play.width <= 5 + 1e-9, `play width ${l.play.width}`);
  for (const c of l.cabinets) {
    const b = c.bounds;
    say(b.x >= 0 && b.x + b.width <= l.width + 1e-6, `cabinet ${c.index} across the wall`);
    say(b.y >= 0 && b.y + b.height <= l.height + 1e-6, `cabinet ${c.index} up the wall`);
    for (const d of l.cabinets) {
      if (d.index > c.index)
        say(!overlaps(c.bounds, d.bounds), `${c.index} and ${d.index} overlap`);
    }
    const body = { x: c.x, y: c.y, width: l.bodyW, height: l.cabinetH };
    const h = c.hatch;
    say(
      h.x >= body.x && h.x + h.width <= body.x + l.bodyW && h.y >= c.y + l.rows.glass[1],
      `hatch ${c.index} inside the base`,
    );
    for (const name of ["left", "right", "drop"] as const) {
      const p = c.buttons[name];
      say(2 * p.r >= 150, `${name} on ${c.index} is ${Math.round(2 * p.r)} px`);
      say(p.x - p.r >= body.x && p.x + p.r <= body.x + l.bodyW, `${name} on ${c.index} inside`);
      say(p.y - p.r >= c.y + l.rows.glass[1], `${name} on ${c.index} under the glass`);
      say(p.y + p.r <= l.height, `${name} on ${c.index} above the floor`);
      say(p.y - p.r >= l.adultTop, `${name} on ${c.index} within adult reach`);
      if (childBand) say(p.y - p.r >= l.childTop, `${name} on ${c.index} within child reach`);
      const box = { x: p.x - p.r, y: p.y - p.r, width: 2 * p.r, height: 2 * p.r };
      say(!overlaps(box, h), `${name} on ${c.index} on the hatch`);
      say(
        !overlaps(box, { x: 0, y: l.height - CORNER, width: CORNER, height: CORNER }),
        `${name} on ${c.index} in the admin corner`,
      );
      say(
        buttonAt(l, p.x, p.y)?.button === name && buttonAt(l, p.x, p.y)?.cabinet === c.index,
        `${name} on ${c.index} found`,
      );
    }
    // Press areas never overlap, so a touch between two buttons presses one at most.
    const names = ["left", "right", "drop"] as const;
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const a = c.buttons[names[i]!];
        const b2 = c.buttons[names[j]!];
        const gap = Math.hypot(a.x - b2.x, a.y - b2.y);
        say(
          gap >= c.hit[names[i]!] + c.hit[names[j]!] - 1e-6,
          `${names[i]}/${names[j]} press areas`,
        );
      }
    }
    say(c.timer.y >= c.y + l.rows.glass[1], `timer ${c.index} under the glass`);
  }
  return issues;
};

describe("claw wall layout", () => {
  it("stands two, three or four cabinets on the wall with controls a child can reach", () => {
    for (const n of [2, 3, 4]) {
      const l = layoutWall(WALL, REACH, n);
      expect(l.cabinets).toHaveLength(n);
      expect(checkLayout(l, true), `${n} cabinets`).toEqual([]);
      // Arrows of at least 160 px, the drop button larger, and big plush behind the glass.
      expect(l.button).toBeGreaterThanOrEqual(160);
      expect(l.k).toBeGreaterThan(350);
      // Room at the right end for the Home control, and the glass above the controls.
      expect(l.margin).toBeGreaterThanOrEqual(170);
    }
    const three = layoutWall(WALL, REACH, 3);
    expect(three.play.width).toBeGreaterThan(3);
    expect(three.cabinets.map((c) => c.chute)).toEqual([1, -1, 1]);
  });

  it("keeps every button reachable for other reaches and wall sizes", () => {
    const sizes = [
      WALL,
      { width: 4000, height: 2160 },
      { width: 8000, height: 2000 },
      { width: 5760, height: 3000 },
    ];
    for (const size of sizes) {
      for (const child of [0.15, 0.2, 0.25, 0.3, 0.4]) {
        for (const adult of [0.35, 0.45, 0.6, 1]) {
          if (adult < child) continue;
          for (const n of [2, 3, 4]) {
            if (size.width / n < 1300) continue;
            const l = layoutWall(size, { adult, child }, n);
            const tag = `${size.width}x${size.height} ${adult}/${child} ${n}`;
            expect(checkLayout(l, child >= 0.2), tag).toEqual([]);
          }
        }
      }
    }
  });

  it("finds buttons from a little off their edges and nothing far away", () => {
    const l = layoutWall(WALL, REACH, 3);
    const c = l.cabinets[1]!;
    const right = c.buttons.right;
    expect(buttonAt(l, right.x, right.y - right.r * 1.1)?.button).toBe("right");
    expect(buttonAt(l, right.x, right.y - right.r * 2)).toBeNull();
    expect(buttonAt(l, c.hatch.x + c.hatch.width / 2, c.hatch.y + c.hatch.height / 2)).toBeNull();
    expect(buttonAt(l, 10, 10)).toBeNull();
  });
});

describe("claw hatch", () => {
  it("shows a few prizes at most, and they fade after a while", () => {
    const tray = createTray(createRng("tray"));
    tray.prefill([{ design: "bear", colour: 0 }], 0);
    expect(tray.resting(0)).toBe(1);
    expect(tray.landed).toBe(0);
    for (let i = 0; i < 20; i++) {
      tray.add({ design: "frog", colour: 1 }, i * 3);
      for (let k = 0; k < 6; k++) tray.step(i * 3 + k * 0.5);
      expect(tray.items.length).toBeLessThanOrEqual(TRAY_MAX + 4);
      expect(tray.resting(i * 3 + 2.5)).toBeLessThanOrEqual(TRAY_MAX);
    }
    expect(tray.landed).toBe(20);
    const last = 60;
    tray.step(last + TRAY_KEEP_S + 1);
    tray.step(last + TRAY_KEEP_S + TRAY_FADE_S + 2);
    expect(tray.items.length).toBe(0);
  });

  it("drops a prize in and settles it", () => {
    const tray = createTray(createRng("tray2"));
    const it = tray.add({ design: "cactus", colour: 0 }, 10);
    expect(tray.pose(it, 10).fall).toBe(0);
    const mid = tray.pose(it, it.arrives + 0.2).fall;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(tray.pose(it, it.arrives + 2).fall).toBe(1);
    expect(tray.pose(it, it.arrives + 2).lift).toBe(0);
    tray.poke(it.x, it.arrives + 2);
    expect(tray.pose(it, it.arrives + 2.2).lift).toBeGreaterThan(0);
  });
});

/** An arcade, a router for touches and a fake injector that goes straight to the router. */
const rig = (seed: string, n = 3) => {
  const layout = layoutWall(WALL, REACH, n);
  const arcade = createWallArcade({ layout, rng: createRng(seed), luck: "fair" });
  const router = createWallInput({ arcade: () => arcade, layout: () => layout, unit: () => 1 });
  let nextId = 1;
  const touch = (x: number, y: number, synthetic: boolean): TouchLike => ({
    id: nextId++,
    x,
    y,
    synthetic,
  });
  const run = (seconds: number, each?: () => void) => {
    const steps = Math.round(seconds / STEP);
    for (let i = 0; i < steps; i++) {
      each?.();
      arcade.step();
    }
  };
  /** A person's finger on a button until `up()`. */
  const press = (cabinet: number, b: Button, synthetic = false) => {
    const p = layout.cabinets[cabinet]!.buttons[b];
    const t = touch(p.x, p.y, synthetic);
    router.down(t);
    return { up: () => router.up(t.id), id: t.id };
  };
  const tap = (cabinet: number, b: Button, synthetic = false) => press(cabinet, b, synthetic).up();
  const runUntil = (pred: () => boolean, limit = 60) => {
    const steps = Math.round(limit / STEP);
    for (let i = 0; i < steps && !pred(); i++) arcade.step();
    return pred();
  };
  const injector = () => {
    const pts = new Map<number, TouchLike>();
    return {
      down(x: number, y: number) {
        const t = touch(x, y, true);
        pts.set(t.id, t);
        router.down(t);
        return t.id;
      },
      move(id: number, x: number, y: number) {
        const t = pts.get(id);
        if (!t) return;
        router.move({ ...t, x, y });
      },
      up(id: number) {
        pts.delete(id);
        router.up(id);
      },
      get live() {
        return pts.size;
      },
    };
  };
  return { layout, arcade, router, run, press, tap, runUntil, injector };
};

const seat = (a: WallArcade, i: number) => a.seats[i]!;

// Each case settles three machines' piles and runs minutes of physics: slow on a busy machine.
describe("claw wall arcade", { timeout: 60_000 }, () => {
  it("plays itself with nobody there", () => {
    const r = rig("alone");
    r.run(120);
    for (const s of r.arcade.seats) {
      expect(s.player).toBe("auto");
      expect(s.machine.round).toBeGreaterThanOrEqual(3);
      expect(s.personRounds).toBe(0);
    }
  });

  it("hands a cabinet to a person between rounds at once", () => {
    const r = rig("idle");
    const s = seat(r.arcade, 0);
    expect(r.runUntil(() => s.machine.phase === "idle" && s.machine.round > 0)).toBe(true);
    const round = s.machine.round;
    r.tap(0, "left");
    expect(s.player).toBe("person");
    r.run(2 * STEP);
    expect(s.machine.phase).toBe("play");
    expect(s.machine.round).toBe(round + 1);
    expect(s.roundPlayer).toBe("person");
    expect(s.machine.timeLeft).toBeGreaterThan(WALL_PLAY_S - 0.1);
    expect(s.personRounds).toBe(1);
  });

  it("takes over while the machine aims, with the full time to aim", () => {
    const r = rig("aim");
    const s = seat(r.arcade, 1);
    expect(r.runUntil(() => s.machine.phase === "play" && s.machine.phaseT > 3)).toBe(true);
    r.tap(1, "right");
    expect(s.player).toBe("person");
    r.run(STEP);
    expect(s.machine.timeLeft).toBeGreaterThan(WALL_PLAY_S - 0.1);
    expect(s.roundPlayer).toBe("person");
  });

  it("moves the claw while an arrow is held, and drops it on the button", () => {
    const r = rig("drive");
    const s = seat(r.arcade, 0);
    r.runUntil(() => s.machine.phase === "idle" && s.machine.round > 0);
    r.tap(0, "drop");
    r.run(0.5);
    expect(s.machine.phase).toBe("play");
    const w = s.machine.world;
    // The claw rests over the chute, at the right on this cabinet: go left.
    const x0 = w.trolleyX();
    const left = r.press(0, "left");
    r.run(1.2);
    left.up();
    r.run(0.4);
    const x1 = w.trolleyX();
    expect(x1).toBeLessThan(x0 - 0.5);
    r.run(0.5);
    expect(Math.abs(w.trolleyX() - x1)).toBeLessThan(0.05);
    const right = r.press(0, "right");
    r.run(0.4);
    right.up();
    r.run(0.4);
    expect(w.trolleyX()).toBeGreaterThan(x1 + 0.1);
    expect(s.machine.phase).toBe("play");
    r.tap(0, "drop");
    r.run(STEP * 2);
    expect(s.machine.phase).toBe("drop");
    // The claw comes back to the chute and the machine waits for its player.
    expect(r.runUntil(() => s.machine.phase === "idle", 30)).toBe(true);
    expect(s.player).toBe("person");
    expect(s.waiting).toBe(true);
  });

  it("drops the claw by itself when time runs out", () => {
    const r = rig("timeout");
    const s = seat(r.arcade, 2);
    r.runUntil(() => s.machine.phase === "idle" && s.machine.round > 0);
    r.tap(2, "left");
    r.run(WALL_PLAY_S - 0.5);
    expect(s.machine.phase).toBe("play");
    r.run(1);
    expect(s.machine.phase).toBe("drop");
  });

  it("queues a press while the claw is busy, and starts that player's round right after", () => {
    const r = rig("queue");
    const s = seat(r.arcade, 0);
    expect(r.runUntil(() => s.machine.phase === "lift")).toBe(true);
    r.tap(0, "drop");
    expect(s.player).toBe("auto");
    expect(s.queued).toBe("person");
    expect(r.runUntil(() => s.machine.phase === "idle", 30)).toBe(true);
    expect(s.player).toBe("person");
    r.run(2 * STEP);
    expect(s.machine.phase).toBe("play");
    expect(s.roundPlayer).toBe("person");
  });

  it("plays itself again once its player has gone, and a press before that plays again", () => {
    const r = rig("away");
    const s = seat(r.arcade, 1);
    r.runUntil(() => s.machine.phase === "idle" && s.machine.round > 0);
    r.tap(1, "drop");
    r.run(1);
    r.tap(1, "drop");
    expect(r.runUntil(() => s.machine.phase === "idle", 30)).toBe(true);
    expect(s.waiting).toBe(true);
    // Back for another go.
    r.run(AWAY_S - 3);
    r.tap(1, "right");
    r.run(2 * STEP);
    expect(s.machine.phase).toBe("play");
    expect(s.player).toBe("person");
    expect(s.personRounds).toBe(2);
    // This time they walk off.
    expect(r.runUntil(() => s.machine.phase === "idle", 40)).toBe(true);
    r.run(AWAY_S + 1);
    expect(s.player).toBe("auto");
    expect(r.runUntil(() => s.machine.phase === "play", 20)).toBe(true);
    expect(s.roundPlayer).toBe("auto");
  });

  it("never lets a bot take a person's cabinet, and keeps bots off it for a while", () => {
    const r = rig("yield");
    const s = seat(r.arcade, 0);
    r.runUntil(() => s.machine.phase === "idle" && s.machine.round > 0);
    r.tap(0, "left");
    expect(s.player).toBe("person");
    r.tap(0, "right", true);
    expect(s.player).toBe("person");
    expect(s.queued).toBeNull();
    // Bot holds don't move the person's claw.
    r.run(0.2);
    const x0 = s.machine.world.trolleyX();
    const bot = r.press(0, "left", true);
    r.run(1);
    bot.up();
    expect(Math.abs(s.machine.world.trolleyX() - x0)).toBeLessThan(0.02);
    // After the person has gone the cabinet plays itself, but bots still wait.
    r.tap(0, "drop");
    r.runUntil(() => s.machine.phase === "idle", 30);
    r.run(AWAY_S + 1);
    expect(s.player).toBe("auto");
    r.tap(0, "left", true);
    expect(s.player).toBe("auto");
    r.run(BOT_YIELD_S);
    r.runUntil(() => s.machine.phase === "idle" || s.machine.phase === "play", 30);
    r.tap(0, "left", true);
    expect(["bot", "auto"]).toContain(s.player);
    if (s.player === "auto") expect(s.queued).toBe("bot");
  });

  it("counts a person's wins only on their own rounds", () => {
    const r = rig("wins");
    const s = seat(r.arcade, 0);
    r.runUntil(() => s.machine.phase === "idle" && s.machine.round > 0);
    r.tap(0, "left");
    r.run(0.5);
    expect(r.arcade.forceWin(0)).toBe(true);
    r.run(3);
    expect(s.personWins).toBe(1);
    expect(s.botWins).toBe(0);
    expect(s.tray.landed).toBe(1);
    r.arcade.reset();
    expect(s.player).toBe("auto");
    r.runUntil(() => s.machine.phase === "play", 30);
    expect(r.arcade.forceWin(0)).toBe(true);
    r.run(3);
    expect(s.personWins).toBe(1);
  });

  it("lets a finger slide between the arrows, and lets go when it slides off", () => {
    const r = rig("slide");
    const s = seat(r.arcade, 2);
    r.runUntil(() => s.machine.phase === "idle" && s.machine.round > 0);
    r.tap(2, "drop");
    r.run(0.3);
    const c = r.layout.cabinets[2]!;
    const left = c.buttons.left;
    const right = c.buttons.right;
    const t: TouchLike = { id: 999, x: left.x, y: left.y, synthetic: false };
    r.router.down(t);
    r.run(0.1);
    expect(s.stick).toBe(-1);
    r.router.move({ ...t, x: right.x, y: right.y });
    r.run(0.1);
    expect(s.stick).toBe(1);
    r.router.move({ ...t, x: right.x, y: right.y - 3 * right.r });
    r.run(0.1);
    expect(s.stick).toBe(0);
  });

  it("runs for a long while with bots pressing buttons and people dropping in", () => {
    const r = rig("long", 3);
    const input = r.injector();
    const visitors = createVisitors({
      input: { inject: input },
      arcade: () => r.arcade,
      unit: () => 1,
      rng: createRng("visitors"),
      count: 2,
    });
    const rng = createRng("people");
    let maxTray = 0;
    let maxBodies = 0;
    let maxTouches = 0;
    let longest = 0;
    const lastRound = r.arcade.seats.map(() => 0);
    const since = r.arcade.seats.map(() => 0);
    const people: { up(): void; until: number }[] = [];
    const minutes = 8;
    r.run(minutes * 60, () => {
      visitors.update();
      const t = r.arcade.time;
      // Now and then someone walks up and presses something.
      if (rng.next() < 1 / (60 * 40)) {
        const b = rng.pick<Button>(["left", "right", "drop"]);
        people.push({ ...r.press(rng.int(3), b), until: t + rng.range(0.1, 2) });
      }
      for (let i = people.length - 1; i >= 0; i--) {
        if (t >= people[i]!.until) {
          people[i]!.up();
          people.splice(i, 1);
        }
      }
      r.arcade.seats.forEach((s, i) => {
        maxTray = Math.max(maxTray, s.tray.items.length);
        maxBodies = Math.max(maxBodies, s.machine.world.world.getBodyCount() - s.machine.stock);
        if (s.machine.round !== lastRound[i]) {
          lastRound[i] = s.machine.round;
          since[i] = t;
        }
        longest = Math.max(longest, t - since[i]!);
      });
      maxTouches = Math.max(maxTouches, input.live);
    });
    visitors.dispose();
    const seats = r.arcade.seats;
    const bot = seats.reduce((n, s) => n + s.botRounds, 0);
    const auto = seats.reduce((n, s) => n + s.machine.round, 0) - bot;
    expect(bot).toBeGreaterThan(8);
    expect(auto).toBeGreaterThan(8);
    expect(seats.reduce((n, s) => n + s.personWins, 0)).toBeLessThanOrEqual(
      seats.reduce((n, s) => n + s.personRounds, 0),
    );
    for (const s of seats) {
      expect(s.machine.lost).toBe(0);
      expect(s.machine.world.prizes.length).toBeLessThanOrEqual(s.machine.stock);
      expect(s.machine.world.prizes.length).toBeGreaterThanOrEqual(s.machine.stock - 3);
    }
    // No round waits for ever, nothing piles up, and bots lift their fingers.
    expect(longest).toBeLessThan(60);
    expect(maxTray).toBeLessThanOrEqual(TRAY_MAX + 4);
    expect(maxBodies).toBeLessThanOrEqual(6);
    expect(maxTouches).toBeLessThanOrEqual(6);
    expect(input.live).toBe(0);
  }, 240_000);
});
