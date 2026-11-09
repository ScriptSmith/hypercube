import { describe, expect, it } from "vitest";
import { LIFE_MAX_S, LIFE_MIN_S, SNAP } from "../../../src/apps/evolution/config";
import { FLOORS, G, type FloorId } from "../../../src/apps/evolution/genes";
import {
  catchNear,
  floorAt,
  meanStandout,
  resident,
  setFloor,
  stepPond,
} from "../../../src/apps/evolution/pond";
import { sdOf, testPond } from "./helpers";

const SEEDS = ["a", "b", "c", "d", "e", "f"];

describe("evolution pond", () => {
  it("starts with a varied population and keeps its numbers steady", () => {
    const p = testPond({ seed: "steady" });
    expect(p.pond.fish).toHaveLength(22);
    expect(sdOf(p.pond.fish.map((f) => f.genes[G.light]!))).toBeGreaterThan(0.2);
    let low = Infinity;
    let high = 0;
    p.run(600, {
      each() {
        const n = resident(p.pond);
        low = Math.min(low, n);
        high = Math.max(high, n);
      },
    });
    expect(low).toBeGreaterThanOrEqual(17);
    expect(high).toBeLessThanOrEqual(22);
    expect(p.pond.counts.caught).toBeGreaterThan(100);
  }, 30_000);

  it("replaces a caught fish one to two seconds later with the young of a survivor", () => {
    const p = testPond({ seed: "replace", herons: "off" });
    const f = p.pond.fish[3]!;
    const caught = catchNear(p.pond, f.x, f.y, "person");
    expect(caught?.id).toBe(f.id);
    expect(resident(p.pond)).toBe(21);
    p.run(0.9, { dt: 0.05 });
    expect(resident(p.pond)).toBe(21);
    let birth: (typeof p.pond.events)[number] | undefined;
    for (let i = 0; i < 30 && !birth; i++) {
      p.deps.stamp();
      stepPond(p.pond, 0.05, p.deps, { swim: false });
      birth = p.pond.events.find((e) => e.kind === "birth");
      p.pond.events.length = 0;
    }
    expect(birth?.kind).toBe("birth");
    if (birth?.kind !== "birth") return;
    const parent = birth.parent!;
    expect(parent).not.toBeNull();
    expect(parent.id).not.toBe(f.id);
    expect(birth.fish.parent).toBe(parent.id);
    const diff = birth.fish.genes.reduce((s, g, i) => s + Math.abs(g - parent.genes[i]!), 0) / 6;
    expect(diff).toBeLessThan(0.25);
  });

  it("lets fish die of old age between 90 and 120 s, so the pond turns over with nobody playing", () => {
    const p = testPond({ seed: "age", herons: "off" });
    for (const f of p.pond.fish) {
      expect(f.life).toBeGreaterThanOrEqual(LIFE_MIN_S);
      expect(f.life).toBeLessThanOrEqual(LIFE_MAX_S);
    }
    const first = new Set(p.pond.fish.map((f) => f.id));
    p.run(LIFE_MAX_S + 5);
    expect(p.pond.fish.some((f) => first.has(f.id))).toBe(false);
    expect(p.pond.counts.died).toBeGreaterThanOrEqual(22);
    expect(p.pond.counts.caught).toBe(0);
  });

  it("snaps a tap to the nearest fish within reach and refuses when the pond runs low", () => {
    const p = testPond({ seed: "snap", herons: "off" });
    const f = p.pond.fish[0]!;
    // Far from every fish: nothing.
    const others = p.pond.fish.map((x) => Math.hypot(x.x - 5000, x.y - 5000));
    expect(Math.min(...others)).toBeGreaterThan(SNAP);
    expect(catchNear(p.pond, 5000, 5000, "person")).toBeNull();
    expect(catchNear(p.pond, f.x + SNAP * 0.6, f.y, "person")).not.toBeNull();
    let caught = 1;
    for (let i = 0; i < 40; i++) {
      const g = p.pond.fish.find((x) => x.state === "swim");
      if (!g) break;
      if (catchNear(p.pond, g.x, g.y, "person")) caught++;
    }
    expect(caught).toBe(11);
    expect(resident(p.pond)).toBe(11);
    expect(p.pond.events.some((e) => e.kind === "miss")).toBe(true);
  });

  it("sweeps a new floor across the pond from where it was chosen", () => {
    const p = testPond({ seed: "sweep", herons: "off" });
    expect(setFloor(p.pond, "sand", 500)).toBe(false);
    expect(setFloor(p.pond, "mud", 900)).toBe(true);
    expect(floorAt(p.pond, 900)).toBe("mud");
    expect(floorAt(p.pond, 50)).toBe("sand");
    p.run(2.5);
    expect(floorAt(p.pond, 600)).toBe("mud");
    expect(floorAt(p.pond, 50)).toBe("sand");
    p.run(2.6);
    expect(p.pond.sweep).toBeNull();
    expect(floorAt(p.pond, 50)).toBe("mud");
  });

  it("changes the floor by itself every few minutes when nobody touches it", () => {
    const p = testPond({ seed: "attract", herons: "off" });
    const floors = new Set<FloorId>([p.pond.floor]);
    p.run(900, { present: false, each: () => floors.add(p.pond.floor) });
    expect(floors.size).toBeGreaterThanOrEqual(3);
    const q = testPond({ seed: "attract", herons: "off" });
    q.run(900, { present: true });
    expect(q.pond.floor).toBe("sand");
  }, 30_000);

  it("has herons pick the fish that stand out", () => {
    const p = testPond({ seed: "picky", herons: "many" });
    let taken = 0;
    let rank = 0;
    for (let i = 0; i < 3000 && taken < 60; i++) {
      const before = [...p.pond.fish].filter((f) => f.state === "swim");
      stepPond(p.pond, 0.1, p.deps, { swim: false });
      p.pond.touchT = 0;
      for (const e of p.pond.events) {
        if (e.kind !== "catch") continue;
        const sorted = before.map((f) => f.standout).sort((a, b) => b - a);
        rank += sorted.indexOf(e.fish.standout) / Math.max(1, sorted.length - 1);
        taken++;
      }
      p.pond.events.length = 0;
    }
    expect(taken).toBeGreaterThan(30);
    // On average the catch is among the most conspicuous fifth of the pond.
    expect(rank / taken).toBeLessThan(0.2);
  }, 30_000);

  it("hides a hunted pond on every floor within a few minutes", () => {
    for (const floor of FLOORS) {
      let start = 0;
      let at2 = 0;
      let at4 = 0;
      for (const seed of SEEDS) {
        const p = testPond({ seed: `${floor}:${seed}`, floor });
        start += meanStandout(p.pond) / SEEDS.length;
        p.run(120);
        at2 += meanStandout(p.pond) / SEEDS.length;
        p.run(120);
        at4 += meanStandout(p.pond) / SEEDS.length;
      }
      expect(at2, `${floor} after 2 min`).toBeLessThan(start * 0.7);
      expect(at4, `${floor} after 4 min`).toBeLessThan(0.62);
    }
  }, 30_000);

  it("follows a change of floor: clearly less conspicuous within 90 s, a third less by 150 s", () => {
    const pairs: [FloorId, FloorId][] = [
      ["sand", "mud"],
      ["mud", "weed"],
      ["weed", "pebbles"],
      ["pebbles", "sand"],
    ];
    for (const [from, to] of pairs) {
      let jump = 0;
      let at90 = 0;
      let at150 = 0;
      for (const seed of SEEDS) {
        const p = testPond({ seed: `${from}>${to}:${seed}`, floor: from });
        p.run(300);
        setFloor(p.pond, to, 500);
        p.run(6);
        jump += meanStandout(p.pond) / SEEDS.length;
        p.run(84);
        at90 += meanStandout(p.pond) / SEEDS.length;
        p.run(60);
        at150 += meanStandout(p.pond) / SEEDS.length;
      }
      expect(jump, `${from} to ${to}: the hidden fish stand out`).toBeGreaterThan(0.75);
      expect(at90, `${from} to ${to} after 90 s`).toBeLessThan(jump * 0.85);
      expect(at150, `${from} to ${to} after 150 s`).toBeLessThan(jump * 0.75);
    }
  }, 30_000);

  it("only drifts with herons off: the pond stays varied and doesn't hide itself", () => {
    let hunted = 0;
    let drifting = 0;
    for (const seed of SEEDS) {
      const d = testPond({ seed: `drift:${seed}`, herons: "off" });
      const before = meanStandout(d.pond);
      d.run(1200);
      drifting += meanStandout(d.pond) / SEEDS.length;
      // Drift moves the mean around but doesn't push it towards the floor.
      expect(Math.abs(meanStandout(d.pond) - before)).toBeLessThan(0.9);
      const spread = [G.light, G.hue, G.tint].map((g) => sdOf(d.pond.fish.map((f) => f.genes[g]!)));
      expect(Math.max(...spread)).toBeGreaterThan(0.08);
      const h = testPond({ seed: `drift:${seed}`, herons: "few" });
      h.run(1200);
      hunted += meanStandout(h.pond) / SEEDS.length;
    }
    expect(drifting).toBeGreaterThan(0.8);
    expect(hunted).toBeLessThan(drifting * 0.6);
  }, 30_000);

  it("hides faster with big changes in the young after a big change of floor", () => {
    let small = 0;
    let big = 0;
    for (const seed of SEEDS) {
      for (const mutation of ["small", "big"] as const) {
        const p = testPond({ seed: `mut:${seed}`, floor: "sand", mutation });
        p.run(300);
        setFloor(p.pond, "mud", 500);
        p.run(120);
        if (mutation === "small") small += meanStandout(p.pond);
        else big += meanStandout(p.pond);
      }
    }
    expect(big).toBeLessThan(small);
  }, 30_000);
});
