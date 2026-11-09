import { describe, expect, it } from "vitest";
import { GRAVEL_TOP, gravelHeight, sideOf, waterLevel } from "../../../src/apps/fishbowl/bowl";
import { HABITS } from "../../../src/apps/fishbowl/habits";
import { layoutScenery } from "../../../src/apps/fishbowl/scenery";
import { createShow, type Fish, MAX_FLAKES, type Show } from "../../../src/apps/fishbowl/show";
import type { Stock } from "../../../src/apps/fishbowl/species";
import { createRng } from "../../../src/core/rng";
import { latLonOf, sphereInfo } from "../../../src/core/sphere";

const sphere = sphereInfo();
const water = waterLevel(sphere);

const make = (seed: string, stock: Stock = "few", feeding = true): Show =>
  createShow(createRng(seed), layoutScenery(createRng(`${seed}:scenery`)), {
    stock,
    feeding,
    water,
    view: sphere.view,
  });

const DT = 1 / 30;

/** Where a fish's body could poke out: its centre, nose and tail tip. */
const tips = (f: Fish) => [
  f.pos,
  f.pos.map((v, i) => v + f.fwd[i]! * f.len * 0.5),
  f.pos.map((v, i) => v - f.fwd[i]! * f.len * 0.5),
];

describe("fishbowl swimming", () => {
  for (const [seed, stock] of [
    ["hour-a", "few"],
    ["hour-b", "many"],
  ] as const) {
    it(`keeps every fish in the water and off the gravel for an hour (${stock})`, () => {
      const show = make(seed, stock);
      const path = show.fish.map(() => 0);
      const last = show.fish.map((f) => [...f.pos]);
      let worstGlass = 0;
      let worstTop = -Infinity;
      let worstBottom = Infinity;
      let stillest = Infinity;
      const steps = Math.round(3600 / DT);
      for (let i = 1; i <= steps; i++) {
        show.step(DT);
        show.fish.forEach((f, k) => {
          path[k]! += Math.hypot(...f.pos.map((v, j) => v - last[k]![j]!));
          last[k] = [...f.pos];
        });
        for (const f of show.fish) {
          for (const p of tips(f)) worstGlass = Math.max(worstGlass, Math.hypot(...p));
          expect(Number.isFinite(f.pos[0] + f.pos[1] + f.pos[2])).toBe(true);
          worstTop = Math.max(worstTop, f.pos[1] - show.water);
          worstBottom = Math.min(
            worstBottom,
            f.pos[1] - gravelHeight(Math.hypot(f.pos[0], f.pos[2])),
          );
        }
        // Every 90 s each fish has swum some way: nothing gets stuck.
        if (i % Math.round(90 / DT) === 0) {
          stillest = Math.min(stillest, ...path);
          path.fill(0);
        }
      }
      expect(worstGlass).toBeLessThanOrEqual(0.975);
      expect(worstTop).toBeLessThan(0);
      expect(worstBottom).toBeGreaterThan(0);
      expect(stillest).toBeGreaterThan(0.5);
      expect(show.flakes.length).toBeLessThanOrEqual(MAX_FLAKES);
    }, 120_000);
  }

  it("keeps the shoal together", () => {
    const show = make("school");
    const tetras = show.fish.filter((f) => f.species === "tetra");
    let together = 0;
    let samples = 0;
    for (let i = 0; i < Math.round(1200 / DT); i++) {
      show.step(DT);
      if (i % 30 !== 0 || show.feeding || tetras.some((f) => f.task)) continue;
      const c = [0, 1, 2].map((j) => tetras.reduce((s, f) => s + f.pos[j]!, 0) / tetras.length);
      const far = Math.max(...tetras.map((f) => Math.hypot(...f.pos.map((v, j) => v - c[j]!))));
      samples++;
      if (far < 0.45) together++;
    }
    expect(samples).toBeGreaterThan(200);
    expect(together / samples).toBeGreaterThan(0.85);
  }, 60_000);

  it("keeps a community bowl in the water, both shoals together, habits going round", () => {
    const show = createShow(createRng("community"), layoutScenery(createRng("community:scenery")), {
      stock: "few",
      variant: "community",
      feeding: true,
      water,
      view: sphere.view,
    });
    const kinds = new Set(show.fish.map((f) => f.species));
    for (const k of ["angel", "gourami", "cory", "harlequin", "tetra"])
      expect(kinds.has(k as never)).toBe(true);
    let worst = 0;
    let together = 0;
    let samples = 0;
    for (let i = 0; i < Math.round(900 / DT); i++) {
      show.step(DT);
      for (const f of show.fish) for (const p of tips(f)) worst = Math.max(worst, Math.hypot(...p));
      if (i % 30 !== 0 || show.feeding) continue;
      for (const sp of ["tetra", "harlequin"] as const) {
        const m = show.fish.filter((f) => f.species === sp && !f.task);
        if (m.length < 4) continue;
        const c = [0, 1, 2].map((j) => m.reduce((s, f) => s + f.pos[j]!, 0) / m.length);
        const far = Math.max(...m.map((f) => Math.hypot(...f.pos.map((v, j) => v - c[j]!))));
        samples++;
        if (far < 0.6) together++;
      }
    }
    expect(worst).toBeLessThanOrEqual(0.975);
    expect(together / samples).toBeGreaterThan(0.75);
    for (const kind of ["kiss", "chase", "dart", "nap", "feed"] as const) {
      expect(show.counts[kind], kind).toBeGreaterThan(0);
    }
    // No goldfish to loop and no puffer to puff.
    expect(show.counts.loop).toBe(0);
    expect(show.counts.puff).toBe(0);
  }, 120_000);

  it("swims near the glass most of the time", () => {
    const show = make("shell");
    let near = 0;
    let n = 0;
    for (let i = 0; i < Math.round(600 / DT); i++) {
      show.step(DT);
      if (i % 15) continue;
      for (const f of show.fish) {
        n++;
        if (Math.hypot(...f.pos) > 0.55) near++;
      }
    }
    expect(near / n).toBeGreaterThan(0.9);
  }, 60_000);
});

describe("fishbowl habits", () => {
  it("keeps something happening, spreads habits round the sides and keeps gaps", () => {
    const show = make("habits");
    const starts: { kind: string; side: number; t: number }[] = [];
    let latest: unknown = null;
    let busy = 0;
    let samples = 0;
    let maxActive = 0;
    let quiet = 0;
    let longestQuiet = 0;
    for (let i = 0; i < Math.round(3600 / DT); i++) {
      show.step(DT);
      const e = show.log.at(-1);
      if (e && e !== latest) {
        latest = e;
        starts.push({ ...e });
      }
      const active = show.habits.filter((h) => h.kind !== "feed").length;
      maxActive = Math.max(maxActive, active);
      quiet = show.habits.length === 0 ? quiet + DT : 0;
      longestQuiet = Math.max(longestQuiet, quiet);
      if (i % 30 === 0) {
        samples++;
        if (show.habits.length > 0) busy++;
      }
    }
    expect(maxActive).toBeLessThanOrEqual(2);
    // Something is under way nearly all the time.
    expect(busy / samples).toBeGreaterThan(0.75);
    // Every habit happens, feeding included, every few minutes.
    for (const k of HABITS) expect(show.counts[k], k).toBeGreaterThan(0);
    expect(show.counts.feed).toBeGreaterThanOrEqual(10);
    expect(show.counts.feed).toBeLessThanOrEqual(20);
    // Each side gets at least a quarter of them.
    const total = show.sideCounts.reduce((a, b) => a + b, 0);
    for (const n of show.sideCounts) expect(n / total).toBeGreaterThan(0.25);
    // No long lull with nothing going on, and a few seconds between one start and the next.
    expect(longestQuiet).toBeLessThan(15);
    const times = starts.map((s) => s.t).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThan(3.9);
    expect(starts.length).toBeGreaterThan(200);
  }, 120_000);

  it("does each habit on demand and lets the fish go afterwards", () => {
    for (const kind of HABITS) {
      const show = make(`demand-${kind}`);
      for (let i = 0; i < 300; i++) show.step(DT);
      expect(show.trigger(kind), kind).toBe(true);
      expect(show.habits.some((h) => h.kind === kind)).toBe(true);
      for (let i = 0; i < Math.round(90 / DT); i++) {
        show.step(DT);
        if (!show.habits.some((h) => h.kind === kind)) break;
      }
      expect(
        show.habits.some((h) => h.kind === kind && h.start < 20),
        kind,
      ).toBe(false);
    }
  }, 60_000);

  it("brings a goldfish's nose to the glass in the band people see, then backs it off", () => {
    const show = make("kiss");
    for (let i = 0; i < 300; i++) show.step(DT);
    expect(show.trigger("kiss", 1)).toBe(true);
    const f = show.habits.find((h) => h.kind === "kiss")!.actors[0]!;
    let closest = 0;
    let held = 0;
    for (let i = 0; i < Math.round(30 / DT) && f.habit; i++) {
      show.step(DT);
      const nose = f.pos.map((v, j) => v + f.fwd[j]! * f.len * 0.5);
      const r = Math.hypot(...nose);
      closest = Math.max(closest, r);
      if (f.task?.kind === "kiss" && f.task.phase === "hold") {
        held += DT;
        const { lat, lon } = latLonOf(nose as [number, number, number]);
        expect(lat).toBeLessThan(sphere.view.top);
        expect(sideOf(lon)).toBe(1);
      }
    }
    expect(closest).toBeGreaterThan(0.94);
    expect(held).toBeGreaterThan(4);
  });

  it("puffs the puffer up round and lets it down slowly", () => {
    const show = make("puff");
    for (let i = 0; i < 300; i++) show.step(DT);
    expect(show.trigger("puff")).toBe(true);
    const p = show.fish.find((f) => f.species === "puffer")!;
    let most = 0;
    let full = 0;
    for (let i = 0; i < Math.round(30 / DT); i++) {
      show.step(DT);
      most = Math.max(most, p.puff);
      if (p.puff > 0.99) full += DT;
    }
    expect(most).toBeGreaterThan(0.99);
    expect(full).toBeGreaterThan(3);
    expect(p.puff).toBe(0);
  });
});

describe("fishbowl feeding", () => {
  it("brings the fish up to the food, lets them eat it all, then scatters them", () => {
    const show = make("feed");
    for (let i = 0; i < 600; i++) show.step(DT);
    expect(show.trigger("feed", 0)).toBe(true);
    const feed = show.habits.find((h) => h.kind === "feed")!;
    const spot = feed.spot!;
    const eaters = show.fish.filter((f) => f.species !== "cory" && f.task?.kind === "feed");
    const spread = () =>
      eaters.reduce((s, f) => s + Math.hypot(...f.pos.map((v, j) => v - spot[j]!)), 0) /
      eaters.length;
    const before = spread();
    let closest = before;
    let most = 0;
    let t = 0;
    while (show.feeding && t < 60) {
      show.step(DT);
      t += DT;
      closest = Math.min(closest, spread());
      most = Math.max(most, show.flakes.length);
    }
    expect(show.feeding).toBe(false);
    expect(t).toBeLessThan(46);
    expect(closest).toBeLessThan(before * 0.75);
    expect(most).toBeGreaterThan(5);
    expect(most).toBeLessThanOrEqual(MAX_FLAKES);
    expect(feed.ate).toBeGreaterThan(8);
    const after = spread();
    for (let i = 0; i < 90; i++) show.step(DT);
    expect(spread()).toBeGreaterThan(after);
    // Uneaten flakes settle and go; none stay for ever.
    for (let i = 0; i < Math.round(120 / DT); i++) show.step(DT);
    expect(show.flakes.length).toBe(0);
  });

  it("never feeds with feeding turned off", () => {
    const show = make("nofeed", "few", false);
    for (let i = 0; i < Math.round(900 / DT); i++) show.step(DT);
    expect(show.counts.feed).toBe(0);
    expect(show.counts.kiss).toBeGreaterThan(0);
  }, 60_000);
});

describe("fishbowl snails", () => {
  it("crawl over the glass inside the band, between the gravel and the surface", () => {
    const show = make("snails", "many");
    expect(show.snails).toHaveLength(2);
    let lo = Infinity;
    let hi = -Infinity;
    const start = show.snails.map((s) => [...s.u]);
    for (let i = 0; i < Math.round(1800 / DT); i++) {
      show.step(DT);
      for (const s of show.snails) {
        const { lat } = latLonOf(s.u);
        lo = Math.min(lo, lat);
        hi = Math.max(hi, lat);
        expect(Math.abs(Math.hypot(...s.u) - 1)).toBeLessThan(1e-6);
      }
    }
    expect(lo).toBeGreaterThan(Math.asin(GRAVEL_TOP));
    expect(hi).toBeLessThan(Math.asin(water));
    show.snails.forEach((s, i) => {
      expect(Math.hypot(...s.u.map((v, j) => v - start[i]![j]!))).toBeGreaterThan(0.1);
    });
  }, 60_000);
});
