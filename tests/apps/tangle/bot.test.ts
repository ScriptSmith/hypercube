import { describe, expect, it } from "vitest";
import { createBrain, probe, room, think } from "../../../src/apps/tangle/bot";
import { HZ } from "../../../src/apps/tangle/config";
import { createRng } from "../../../src/core/rng";
import { down, right, run, up, wallArena } from "./helpers";

const survive = (
  seed: string,
  lines: number,
  variant: "trails" | "snake" = "trails",
  edges: "wrap" | "solid" = "solid",
) => {
  const a = wallArena({ variant, edges, rng: createRng(seed) });
  const rng = createRng(`${seed}:bots`);
  a.start(
    Array.from({ length: lines }, (_, i) => up(((i + 0.5) / lines) * 6400, 1710)),
    1,
  );
  const brains = a.lines.map(() => createBrain());
  const lifetimes = a.lines.map(() => 0);
  for (let t = 0; t < 60 * HZ; t++) {
    a.lines.forEach((l, i) => {
      if (l.alive) l.dir = think(a, l, brains[i]!, rng);
    });
    a.step();
    a.lines.forEach((l, i) => {
      if (l.alive) lifetimes[i] = a.time;
    });
    if (variant === "trails" && a.alive() === 0) break;
  }
  return lifetimes;
};

describe("bots", () => {
  it("see a wall coming", () => {
    const a = wallArena();
    a.start([right(6000, 900)], 1);
    const l = a.lines[0]!;
    expect(probe(a, l, 0, 0, 500)).toBeLessThanOrEqual(400);
    expect(probe(a, l, -1, 160, 500)).toBe(500);
  });

  it("see across a wrapping edge", () => {
    const solid = wallArena();
    solid.start([right(6300, 900)], 1);
    expect(probe(solid, solid.lines[0]!, 0, 0, 500)).toBeLessThanOrEqual(100);
    const a = wallArena({ edges: "wrap" });
    a.start([right(6300, 900)], 1);
    expect(probe(a, a.lines[0]!, 0, 0, 500)).toBe(500);
    // A trail just past the edge: about 100 to the edge and 40 beyond it, less half a trail.
    const b = wallArena({ edges: "wrap" });
    b.start([down(40, 780), right(6300, 900)], 1);
    const [t, l] = b.lines as [(typeof b.lines)[0], (typeof b.lines)[0]];
    l.alive = false;
    run(b, Math.round(0.75 * HZ));
    t.alive = false;
    l.alive = true;
    const seen = probe(b, l, 0, 0, 500);
    expect(seen).toBeGreaterThan(110);
    expect(seen).toBeLessThan(140);
    // Room counts across the edge too: a bot in the corner still has the whole floor.
    expect(room(b, l, 6390, 10)).toBe(room(b, l, 3000, 300));
  });

  it("last a long time alone", () => {
    const lives = ["a", "b", "c", "d", "e", "f"].map((seed) => survive(seed, 1)[0]!);
    for (const life of lives) expect(life).toBeGreaterThan(15);
    lives.sort((x, y) => x - y);
    expect(lives[3]!).toBeGreaterThan(30);
  });

  it("last a long time alone when the edges wrap", () => {
    const lives = ["a", "b", "c", "d", "e", "f"].map(
      (seed) => survive(seed, 1, "trails", "wrap")[0]!,
    );
    lives.sort((x, y) => x - y);
    expect(lives[0]!).toBeGreaterThan(10);
    expect(lives[3]!).toBeGreaterThan(30);
  });

  it("make a round of it in company, but don't play perfectly", () => {
    const all: number[] = [];
    for (const seed of ["a", "b", "c", "d"]) all.push(...survive(seed, 6));
    all.sort((x, y) => x - y);
    const median = all[Math.floor(all.length / 2)]!;
    expect(median).toBeGreaterThan(8);
    // Someone always goes out before the minute is up.
    expect(all[0]!).toBeLessThan(60);
  });

  it("head for food in snake and keep growing", () => {
    const a = wallArena({ variant: "snake", rng: createRng("food") });
    const rng = createRng("food:bots");
    a.start([up(2000, 1710), up(4400, 1710)], 1);
    const brains = a.lines.map(() => createBrain());
    for (let t = 0; t < 40 * HZ; t++) {
      a.lines.forEach((l, i) => {
        if (l.alive) l.dir = think(a, l, brains[i]!, rng);
      });
      a.step();
    }
    const eaten = a.lines.reduce((n, l) => n + l.eaten, 0);
    expect(eaten).toBeGreaterThan(6);
  });
});
