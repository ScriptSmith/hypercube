import { beforeAll, describe, expect, it } from "vitest";
import { type Arcade, createArcade, type Luck, RATES } from "../../../src/apps/claw/arcade";
import { layoutArcade } from "../../../src/apps/claw/layout";
import { HEAP_MAX } from "../../../src/apps/claw/heap";
import { createRng } from "../../../src/core/rng";
import { sphereInfo } from "../../../src/core/sphere";

const MINUTES = 10;
/** The longest each phase may last, s: the machine's own limits and a little. */
const PHASE_MAX: Record<string, number> = {
  // The first wait staggers the machines' starts.
  idle: 21,
  play: 22.1,
  drop: 4.1,
  grab: 1.3,
  lift: 5.1,
  carry: 12.1,
  release: 1.7,
};

interface Run {
  arcade: Arcade;
  rounds: number;
  wins: number;
  longestRound: number;
  longestPhase: Record<string, number>;
  outside: number;
  minStockAfterStart: number;
  maxPrizes: number;
  maxBodies: number;
  maxHeap: number;
}

const run = (luck: Luck, seed: string, count = 4, minutes = MINUTES): Run => {
  const s = sphereInfo();
  const arcade = createArcade({
    layout: layoutArcade(s, count),
    sphere: s,
    rng: createRng(seed),
    luck,
  });
  const longestPhase: Record<string, number> = {};
  let outside = 0;
  let minStockAfterStart = Number.POSITIVE_INFINITY;
  let maxPrizes = 0;
  let maxBodies = 0;
  let maxHeap = 0;
  const steps = Math.round(minutes * 60 * 60);
  for (let i = 0; i < steps; i++) {
    arcade.step();
    for (const m of arcade.machines) {
      longestPhase[m.phase] = Math.max(longestPhase[m.phase] ?? 0, m.phaseT);
      if (i % 15 !== 0) continue;
      const w = m.world;
      for (const p of w.prizes) {
        const pos = p.body.getPosition();
        const inChute = pos.x > w.hole.x0 - 0.1 && pos.x < w.hole.x1 + 0.1;
        if (
          pos.x < -0.05 ||
          pos.x > w.spec.width + 0.05 ||
          pos.y > w.spec.height + w.spec.canopy ||
          (pos.y < -0.1 && !inChute)
        ) {
          outside++;
        }
      }
      maxPrizes = Math.max(maxPrizes, w.prizes.length - m.stock);
      maxBodies = Math.max(maxBodies, w.world.getBodyCount() - m.stock);
      if (arcade.time > 60)
        minStockAfterStart = Math.min(minStockAfterStart, w.prizes.length - m.stock);
    }
    maxHeap = Math.max(maxHeap, arcade.heap.items.length);
  }
  const all = arcade.machines.flatMap((m) => m.rounds);
  return {
    arcade,
    rounds: arcade.machines.reduce((n, m) => n + m.round, 0),
    wins: arcade.wins,
    longestRound: Math.max(...all.map((r) => r.seconds)),
    longestPhase,
    outside,
    minStockAfterStart,
    maxPrizes,
    maxBodies,
    maxHeap,
  };
};

describe("claw arcade", () => {
  let fair: Run;
  let generous: Run;
  beforeAll(() => {
    fair = run("fair", "claw-test");
    generous = run("generous", "claw-test-2");
  }, 240_000);

  it("finishes every round: claws never stick, and something happens all the time", () => {
    for (const r of [fair, generous]) {
      for (const [phase, longest] of Object.entries(r.longestPhase)) {
        expect(longest, phase).toBeLessThanOrEqual(PHASE_MAX[phase]!);
      }
      expect(r.longestRound).toBeLessThan(50);
      // Rounds of 20 to 40 s with a pause between, on every machine.
      for (const m of r.arcade.machines) {
        expect(m.round).toBeGreaterThan((MINUTES * 60) / 45);
        expect(m.round).toBeLessThan((MINUTES * 60) / 15);
      }
    }
  });

  it("wins about as often as the luck option says", () => {
    const fairRate = fair.wins / fair.rounds;
    const generousRate = generous.wins / generous.rounds;
    expect(fairRate).toBeGreaterThan(RATES.fair * 0.5);
    expect(fairRate).toBeLessThan(RATES.fair * 1.8);
    expect(generousRate).toBeGreaterThan(RATES.generous * 0.6);
    expect(generousRate).toBeLessThan(RATES.generous * 1.5);
    expect(generousRate).toBeGreaterThan(fairRate);
    // Usually weak: with fair luck most rounds are not strong ones.
    const records = fair.arcade.machines.flatMap((m) => m.rounds);
    expect(records.filter((r) => r.strong).length / records.length).toBeLessThan(0.6);
  });

  it("keeps prizes inside their cabinet unless they go down the chute", () => {
    for (const r of [fair, generous]) {
      expect(r.outside).toBe(0);
      for (const m of r.arcade.machines) expect(m.lost).toBe(0);
      // Every win is on its way to the heap or on it.
      const heap = r.arcade.heap;
      expect(heap.landed + heap.flights.length).toBe(r.wins);
    }
  });

  it("tops the piles up and keeps every count bounded", () => {
    for (const r of [fair, generous]) {
      expect(r.maxPrizes).toBeLessThanOrEqual(0);
      expect(r.minStockAfterStart).toBeGreaterThanOrEqual(-2);
      // The ground, trolley, hanger, head and two fingers, besides the prizes.
      expect(r.maxBodies).toBeLessThanOrEqual(6);
      expect(r.maxHeap).toBeLessThanOrEqual(HEAP_MAX + 3);
      for (const m of r.arcade.machines) expect(m.rounds.length).toBeLessThanOrEqual(64);
    }
  });

  it("runs the same from the same seed", () => {
    const a = run("fair", "same", 3, 1.5);
    const b = run("fair", "same", 3, 1.5);
    expect(a.rounds).toBe(b.rounds);
    expect(a.wins).toBe(b.wins);
    const pos = (r: Run) =>
      r.arcade.machines.map((m) => m.world.prizes.map((p) => p.body.getPosition().x.toFixed(6)));
    expect(pos(a)).toEqual(pos(b));
  }, 60_000);

  it("forces a win down the chute and out to the heap", () => {
    const s = sphereInfo();
    const arcade = createArcade({
      layout: layoutArcade(s, 4),
      sphere: s,
      rng: createRng("force"),
      luck: "fair",
    });
    const before = arcade.heap.landed;
    expect(arcade.forceWin(1)).toBe(true);
    for (let i = 0; i < 60 * 8; i++) arcade.step();
    expect(arcade.wins).toBeGreaterThanOrEqual(1);
    expect(arcade.heap.landed).toBeGreaterThan(before);
    const d = arcade.door(1);
    expect(d.lat).toBeLessThan(arcade.layout.glassLat);
    expect(d.lat).toBeGreaterThan(arcade.layout.bottom);
  });
});
