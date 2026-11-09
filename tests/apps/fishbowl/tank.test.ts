import { describe, expect, it } from "vitest";
import { buildCarpet, buildFlora, FLORA } from "../../../src/apps/fishbowl/flora";
import { bakeGroundMap, GROUND_MAP } from "../../../src/apps/fishbowl/groundmaps";
import { FAUNA, tankCast } from "../../../src/apps/fishbowl/species";
import { layoutTank, tankBox, type TankLayout } from "../../../src/apps/fishbowl/tank";
import {
  createTankShow,
  MAX_FOOD,
  STARTLE_REACH,
  TANK_HABITS,
  type TankShow,
} from "../../../src/apps/fishbowl/tankshow";
import { createRng } from "../../../src/core/rng";
import type { SetupInfo } from "../../../src/core/types";
import { defaultEye, displaySurface } from "../../../src/core/view3d";

const setup: SetupInfo = { name: "solo", role: "solo", pos: 0, count: 1, group: "g", side: 0 };
const wall = displaySurface({ kind: "wall" }, setup);
const eye = defaultEye({ kind: "wall" }, setup);

const layoutOf = (seed: string): TankLayout => layoutTank(tankBox(wall, eye), createRng(seed));

const make = (
  seed: string,
  variant = "community",
  stock: "few" | "many" = "few",
  feeding = true,
) => {
  const layout = layoutOf(`${seed}:tank`);
  const show = createTankShow(createRng(seed), {
    cast: tankCast(variant, stock),
    feeding,
    layout,
    eye,
  });
  return { layout, show };
};

const DT = 1 / 30;

const run = (show: TankShow, seconds: number, each?: () => void) => {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    show.step(DT);
    each?.();
  }
};

describe("fishbowl tank layout", () => {
  it("fits the wall: glass at the wall, side panes out of sight, water below the top", () => {
    const box = tankBox(wall, eye);
    expect(box.glass.left).toBeCloseTo(wall.origin[0]);
    expect(box.glass.right).toBeCloseTo(wall.origin[0] + wall.width);
    expect(box.left).toBeLessThan(box.glass.left);
    expect(box.right).toBeGreaterThan(box.glass.right);
    // A line of sight through the wall's edge meets the back glass inside the side panes.
    const reach = ((box.glass.right - eye[0]) * (eye[2] - box.back)) / eye[2] + eye[0];
    expect(reach).toBeLessThan(box.right);
    expect(box.water).toBeLessThan(box.glass.top);
    expect(box.water).toBeGreaterThan(box.glass.top - 0.6);
  });

  for (const seed of ["a", "b", "c", "d"]) {
    it(`places stones, wood and plants on the ground inside the tank (${seed})`, () => {
      const l = layoutOf(seed);
      const { box } = l;
      expect(l.ground(0, -0.1)).toBeGreaterThan(box.floor);
      // The ground rises to the back.
      expect(l.ground(0, box.back + 0.2)).toBeGreaterThan(l.ground(0, -0.2));
      for (const r of l.rocks) {
        expect(r.x).toBeGreaterThan(box.left);
        expect(r.x).toBeLessThan(box.right);
        expect(r.z).toBeLessThan(0);
        expect(r.z).toBeGreaterThan(box.back);
      }
      const kinds = new Set(l.plants.map((p) => p.kind));
      for (const k of [
        "vallis",
        "sword",
        "redstem",
        "greenstem",
        "crypt",
        "fern",
        "anubias",
        "moss",
        "frogbit",
      ]) {
        expect(kinds.has(k as never), k).toBe(true);
      }
      for (const p of l.plants) {
        expect(p.z).toBeLessThan(0);
        expect(p.z).toBeGreaterThan(box.back);
        if (p.kind === "frogbit") expect(p.y).toBeCloseTo(box.water);
        else expect(p.y).toBeGreaterThanOrEqual(l.ground(p.x, p.z) - 1e-9);
      }
      expect(l.lumps.length).toBeGreaterThan(5);
      const [ax, ay, az] = l.airstone;
      expect(ay).toBeGreaterThan(l.ground(ax, az));
      // The same seed lays out the same tank.
      expect(layoutOf(seed).plants.length).toBe(l.plants.length);
    });
  }
});

describe("fishbowl tank swimming", () => {
  for (const [seed, variant, stock, minutes] of [
    ["hour-a", "community", "few", 30],
    ["hour-b", "bowl", "many", 15],
  ] as const) {
    it(`keeps everything in the water and moving for ${minutes} minutes (${variant}, ${stock})`, () => {
      const { layout, show } = make(seed, variant, stock);
      const { box } = layout;
      const path = show.fish.map(() => 0);
      const last = show.fish.map((f) => [...f.pos]);
      let worst = { front: -Infinity, top: -Infinity, below: Infinity };
      let maxFood = 0;
      let shoalSpread = 0;
      let outside = 0;
      let broken = 0;
      const steps = Math.round((minutes * 60) / DT);
      for (let i = 1; i <= steps; i++) {
        show.step(DT);
        maxFood = Math.max(maxFood, show.food.length);
        if (i % 3 === 0) {
          for (const [k, f] of show.fish.entries()) {
            path[k]! += Math.hypot(...f.pos.map((v, j) => v - last[k]![j]!));
            last[k] = [...f.pos];
            if (!Number.isFinite(f.pos[0] + f.pos[1] + f.pos[2])) broken++;
            const nose = f.pos[2] + f.fwd[2] * f.len * 0.5;
            worst = {
              front: Math.max(worst.front, nose),
              top: Math.max(worst.top, f.pos[1] - box.water),
              below: Math.min(worst.below, f.pos[1] - layout.ground(f.pos[0], f.pos[2])),
            };
            if (f.pos[0] < box.left || f.pos[0] > box.right || f.pos[2] < box.back) outside++;
          }
        }
        if (i % Math.round(30 / DT) === 0) {
          // Shoals keep together: most members near the shoal's middle.
          for (const sp of ["tetra", "harlequin"] as const) {
            // Shoals scatter to feed and flash apart when startled; measure them swimming.
            const m = show.fish.filter((f) => f.species === sp);
            if (m.length === 0 || show.feeding || m.some((f) => f.task !== null)) continue;
            const c = [0, 1, 2].map((j) => m.reduce((s, f) => s + f.pos[j]!, 0) / m.length);
            const d = m
              .map((f) => Math.hypot(...f.pos.map((v, j) => v - c[j]!)))
              .sort((a, b) => a - b);
            shoalSpread = Math.max(shoalSpread, d[Math.floor(d.length * 0.75)]! / m[0]!.len);
          }
        }
        if (i % Math.round(120 / DT) === 0) {
          // Every two minutes each fish has swum some way: nothing gets stuck.
          for (const [k, f] of show.fish.entries()) {
            if (f.spec.roles.clinger) continue;
            expect(path[k], `${f.species} ${k}`).toBeGreaterThan(f.len * 2);
            path[k] = 0;
          }
        }
      }
      expect(broken).toBe(0);
      expect(outside).toBe(0);
      // Noses touch the glass at most.
      expect(worst.front).toBeLessThan(0);
      expect(worst.top).toBeLessThan(0);
      expect(worst.below).toBeGreaterThan(0);
      expect(maxFood).toBeLessThanOrEqual(MAX_FOOD);
      expect(shoalSpread).toBeLessThan(9);
      expect(show.counts.feed).toBeGreaterThanOrEqual(minutes / 5);
      for (const kind of TANK_HABITS) {
        const can = variant === "bowl" || (kind !== "loop" && kind !== "puff");
        if (can) expect(show.counts[kind], kind).toBeGreaterThan(0);
      }
      // Habits are spread along the wall.
      const total = show.sideCounts.reduce((a, b) => a + b, 0);
      for (const n of show.sideCounts) expect(n / total).toBeGreaterThan(0.18);
      expect(show.habits.length).toBeLessThan(10);
      expect(show.log.length).toBeLessThanOrEqual(64);
    }, 600_000);
  }

  it("turns smoothly and never sits stuck twitching", () => {
    const { show } = make("smooth");
    const n = show.fish.length;
    const prev = show.fish.map((f) => [...f.fwd]);
    const yaw = show.fish.map(() => 0);
    const since = show.fish.map((f) => [...f.pos]);
    let twitches = 0;
    let turns = 0;
    let stuck = 0;
    const steps = Math.round(600 / DT);
    for (let i = 1; i <= steps; i++) {
      show.step(DT);
      show.fish.forEach((f, k) => {
        const [px, py, pz] = prev[k] as [number, number, number];
        // Signed turn about the fish's own up, radians a second.
        const cx = py * f.fwd[2] - pz * f.fwd[1];
        const cy = pz * f.fwd[0] - px * f.fwd[2];
        const cz = px * f.fwd[1] - py * f.fwd[0];
        const rate = (cx * f.up[0] + cy * f.up[1] + cz * f.up[2]) / DT;
        // A quick turn one way straight after a quick turn the other is a twitch.
        if (
          Math.abs(rate) > 1.2 &&
          Math.abs(yaw[k]!) > 1.2 &&
          Math.sign(rate) !== Math.sign(yaw[k]!)
        )
          twitches++;
        if (Math.abs(rate) > 1.2) turns++;
        yaw[k] = rate;
        prev[k] = [...f.fwd];
      });
      if (i % Math.round(3 / DT) === 0) {
        show.fish.forEach((f, k) => {
          const roaming = f.task === null && f.goal.hover <= 0 && !f.spec.roles.clinger;
          if (roaming && Math.hypot(...f.pos.map((v, j) => v - since[k]![j]!)) < 0.03) stuck++;
          since[k] = [...f.pos];
        });
      }
    }
    expect(twitches / Math.max(1, turns)).toBeLessThan(0.035);
    // Fish free to swim about are almost never found where they were three seconds before.
    expect(stuck / ((n * 600) / 3)).toBeLessThan(0.01);
  }, 120_000);

  it("casts a community or a goldfish bowl, at about real stocking", () => {
    const community = tankCast("community", "few");
    expect(community.fish.filter((s) => s === "tetra").length).toBeGreaterThanOrEqual(10);
    expect(community.fish).toContain("angel");
    expect(community.fish).toContain("pleco");
    expect(community.shrimp).toBeGreaterThan(0);
    expect(community.snails).toBeGreaterThan(0);
    const bowl = tankCast("bowl", "few");
    expect(bowl.fish).toContain("goldfish");
    expect(bowl.fish).toContain("puffer");
    expect(tankCast("community", "many").fish.length).toBeGreaterThan(community.fish.length);
    for (const s of Object.values(FAUNA)) {
      expect(s.cruise[0]).toBeLessThan(s.cruise[1]);
      expect(s.burst).toBeGreaterThan(s.cruise[1]);
      expect(s.zone[0]).toBeLessThanOrEqual(s.zone[1]);
    }
  });
});

describe("fishbowl tank touch", () => {
  it("startles fish near a tap, then brings curious ones to look at the finger", () => {
    const { show } = make("tap");
    run(show, 20);
    const f = show.fish.find((g) => g.species === "angel")!;
    const at = { x: f.pos[0], y: f.pos[1] };
    const near = show.fish.filter(
      (g) => Math.hypot(g.pos[0] - at.x, g.pos[1] - at.y, g.pos[2]) < STARTLE_REACH,
    );
    show.tap(at.x, at.y);
    show.step(DT);
    expect(show.counts.tap).toBe(1);
    expect(near.some((g) => g.fear > 0.1)).toBe(true);
    expect(
      near.filter((g) => g.task?.kind === "dart" || g.task?.kind === "puff").length,
    ).toBeGreaterThan(0);
    // Within a few seconds curious fish come to look, and one gets right up to the glass.
    let peeking = 0;
    let close = false;
    for (let i = 0; i < Math.round(14 / DT); i++) {
      show.step(DT);
      const p = show.fish.filter((g) => g.task?.kind === "peek");
      peeking = Math.max(peeking, p.length);
      close ||= p.some(
        (g) =>
          g.task?.kind === "peek" &&
          g.task.phase === "hold" &&
          Math.hypot(g.pos[0] - at.x, g.pos[1] - at.y) < 1.6 &&
          g.pos[2] + g.fwd[2] * g.len * 0.5 > -0.12,
      );
    }
    expect(peeking).toBeGreaterThan(0);
    expect(close).toBe(true);
    // The tap is forgotten after a while.
    run(show, 15);
    expect(show.taps.length).toBe(0);
  });

  it("brings fish low for a low tap", () => {
    const { layout, show } = make("low");
    run(show, 10);
    const y = layout.ground(0, -0.3) + 0.5;
    show.tap(0, y);
    let lowest = Infinity;
    for (let i = 0; i < Math.round(12 / DT); i++) {
      show.step(DT);
      for (const g of show.fish)
        if (g.task?.kind === "peek") lowest = Math.min(lowest, g.task.at[1]);
    }
    expect(lowest).toBeLessThan(y + 0.6);
  });

  it("sprinkles food from a held finger that the fish eat, and keeps it bounded", () => {
    const { show } = make("feed", "community", "few", false);
    run(show, 10);
    for (let i = 0; i < Math.round(1 / DT); i++) {
      show.sprinkle(1, 1);
      show.step(DT);
    }
    expect(show.counts.hold).toBe(1);
    // One finger's sprinkle is bounded, however long it is held.
    expect(show.food.length).toBeGreaterThan(10);
    expect(show.food.length).toBeLessThanOrEqual(30);
    run(show, 3);
    expect(show.fish.some((f) => f.task?.kind === "feed")).toBe(true);
    // Fish and shrimp clear it up; what lands is gone within a minute.
    run(show, 70);
    expect(show.food.length).toBe(0);
    // Holding everywhere for long never grows the food without bound.
    for (let i = 0; i < Math.round(60 / DT); i++) {
      for (let x = -6; x <= 6; x += 1) show.sprinkle(x, 100 + x);
      if (i % 90 === 0) for (let x = -6; x <= 6; x += 1) show.lift(100 + x);
      show.step(DT);
      expect(show.food.length).toBeLessThanOrEqual(MAX_FOOD);
    }
    expect(show.counts.feed).toBe(0);
  }, 60_000);

  it("calms down on reset: no peeks, no fright, no taps", () => {
    const { show } = make("calm");
    run(show, 5);
    show.tap(0, 2);
    run(show, 3);
    show.calm();
    expect(show.taps.length).toBe(0);
    for (const f of show.fish) {
      expect(f.fear).toBe(0);
      expect(f.task?.kind).not.toBe("peek");
    }
  });
});

describe("fishbowl tank habits", () => {
  for (const kind of TANK_HABITS) {
    it(`does ${kind} on demand and lets the fish go`, () => {
      const variant = kind === "loop" || kind === "puff" ? "bowl" : "community";
      const { show } = make(`habit-${kind}`, variant);
      run(show, 5);
      expect(show.trigger(kind, 1)).toBe(true);
      expect(show.habits.some((h) => h.kind === kind)).toBe(true);
      let seen = false;
      for (let i = 0; i < Math.round(60 / DT); i++) {
        show.step(DT);
        if (kind === "kiss") {
          seen ||= show.fish.some(
            (f) =>
              f.task?.kind === "kiss" &&
              f.task.phase === "hold" &&
              f.pos[2] + f.fwd[2] * f.len * 0.5 > -0.1,
          );
        } else if (kind === "air") {
          seen ||= show.fish.some((f) => f.task?.kind === "air" && f.task.phase === "gulp");
        } else if (kind === "puff") {
          seen ||= show.fish.some((f) => f.puff > 0.99);
        } else if (kind === "feed") {
          seen ||= show.food.length > 10;
        } else {
          seen = true;
        }
      }
      expect(seen).toBe(true);
      run(show, 30);
      expect(show.habits.filter((h) => h.kind === kind && h.start < show.time - 80)).toEqual([]);
    }, 30_000);
  }
});

describe("fishbowl tank plants and ground", () => {
  it("builds every plant inside the tank, ribbons clipped under the surface", () => {
    const l = layoutOf("flora");
    const ctx = { water: l.box.water, ground: l.ground, detail: 1 };
    const { tall, low } = buildFlora(l.plants, ctx, createRng("flora"));
    for (const g of [tall, low]) {
      const p = g.getAttribute("position");
      expect(p.count).toBeGreaterThan(100);
      for (let i = 0; i < p.count; i++) {
        expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
        expect(p.getY(i)).toBeLessThan(l.box.water + 0.02);
        expect(p.getZ(i)).toBeLessThan(0.05);
      }
    }
    const carpet = buildCarpet(l.carpet, ctx, () => false, createRng("carpet"));
    expect(carpet.getAttribute("position").count).toBeGreaterThan(1000);
    for (const f of Object.values(FLORA)) expect(f.flex).toBeGreaterThanOrEqual(0);
  });

  it("bakes the ground's shade round stones, wood and plants", () => {
    const l = layoutOf("maps");
    const g = bakeGroundMap(l);
    expect(g.length).toBe(GROUND_MAP.width * GROUND_MAP.height * 4);
    let dark = 0;
    let open = 0;
    for (let i = 0; i < g.length; i += 4) {
      if (g[i]! < 150) dark++;
      if (g[i]! > 230) open++;
    }
    expect(dark).toBeGreaterThan(50);
    expect(open).toBeGreaterThan(GROUND_MAP.width * GROUND_MAP.height * 0.2);
  });
});
