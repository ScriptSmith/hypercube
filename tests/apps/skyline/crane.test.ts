import { describe, expect, it } from "vitest";
import { BH, LIFT_MAX, MAX_LOOSE, SLING } from "../../../src/apps/skyline/config";
import type { Crane } from "../../../src/apps/skyline/crane";
import { createRng } from "../../../src/core/rng";
import { DT, fetch, rig, settleAt, stepFor, testWorld } from "./helpers";

const slotCentre = (c: Crane, lot: number, slot: number) => {
  const l = c.lots[lot]!;
  const s = l.bp.slots[slot]!;
  return { x: l.left + s.x + 0.5, y: s.r * BH + BH / 2 };
};
/** Hook height that puts a carried block's centre at `y`. */
const hookFor = (y: number) => y + BH / 2 + SLING;
const ground = (c: Crane, lot = 0) => c.lots[lot]!.bp.slots.findIndex((s) => s.r === 0);

describe("skyline crane", () => {
  it("catches a yard block when the hook is lowered onto it", () => {
    const { crane } = rig("catch");
    expect(crane.request(1)).toBe(true);
    stepFor(crane, 4);
    expect(crane.yard.some((b) => b?.kind === 1)).toBe(true);
    const i = crane.yard.findIndex((b) => b);
    // Hovering above it does nothing; lowering onto it catches it.
    settleAt(crane, crane.world.yard[i]!, BH + 1.5);
    expect(crane.carrying).toBeNull();
    crane.setTarget(crane.world.yard[i]!, 0);
    stepFor(crane, 4);
    expect(crane.carrying?.kind).toBe(1);
    expect(crane.yard[i]).toBeNull();
  });

  it("snaps a block let go near a free slot, and drops one let go far from any", () => {
    const { crane } = rig("snap");
    fetch(crane, 0);
    const target = slotCentre(crane, 0, ground(crane));
    settleAt(crane, target.x + 0.4, hookFor(target.y + 0.5));
    expect(crane.release()).toBe("placed");
    stepFor(crane, 1);
    expect(crane.lots[0]!.filled.filter((f) => f !== null)).toEqual([0]);
    expect(crane.counts.placed).toBe(1);
    // High above everything: it drops, lands and goes back to the yard.
    fetch(crane, 2);
    settleAt(crane, crane.world.tMin + 0.2, BH * 6);
    expect(crane.release()).toBe("dropped");
    stepFor(crane, 6);
    expect(crane.counts.dropped).toBe(1);
    expect(crane.loose).toHaveLength(0);
    expect(crane.yard.some((b) => b?.kind === 2)).toBe(true);
  });

  it("lets go by itself when a block is held still in its slot", () => {
    const { crane } = rig("auto");
    fetch(crane, 1);
    const target = slotCentre(crane, 0, ground(crane));
    settleAt(crane, target.x, hookFor(target.y) - 0.05, 12);
    stepFor(crane, 1.5);
    expect(crane.carrying).toBeNull();
    expect(crane.counts.placed).toBe(1);
  });

  it("only fills supported slots, and roofs only on top", () => {
    const { crane } = rig("support", {
      world: testWorld({ lots: [{ x: 4.5, cols: 3 }] }),
    });
    // The lot's first upper slot, with nothing under it: no snap there.
    const lot = crane.lots[0]!;
    const upper = lot.bp.slots.findIndex((s) => s.r === 2);
    fetch(crane, 0);
    const c = slotCentre(crane, 0, upper);
    settleAt(crane, c.x, hookFor(c.y));
    expect(crane.release()).toBe("dropped");
    // A roof over a ground slot of a building taller than one floor does not snap.
    stepFor(crane, 6);
    fetch(crane, 3);
    const g = slotCentre(crane, 0, ground(crane));
    settleAt(crane, g.x, hookFor(g.y) + 0.1);
    stepFor(crane, 2);
    expect(crane.carrying?.kind).toBe(3);
    expect(crane.release()).toBe("dropped");
    stepFor(crane, 6);
    expect(lot.filled.every((f) => f === null)).toBe(true);
  });

  it("keeps a carried block out of buildings and the ground", () => {
    const { crane, pilot } = rig("collide");
    // Let the autopilot put up a few floors first.
    for (let i = 0; i < 200 / DT && crane.counts.placed < 5; i++) {
      if (crane.canRequest()) crane.request(0);
      pilot.update(DT, crane.readout());
      crane.step(DT);
    }
    expect(crane.counts.placed).toBeGreaterThanOrEqual(5);
    // Then take over once it has a block on the hook.
    for (let i = 0; i < 60 / DT && !crane.carrying; i++) {
      pilot.update(DT, crane.readout());
      crane.step(DT);
    }
    expect(crane.carrying).not.toBeNull();
    pilot.reset();
    // Sweep the load low across the whole site: it rides over every building.
    let worst = Number.POSITIVE_INFINITY;
    crane.setTarget(crane.world.tMin, 0);
    stepFor(crane, 4);
    crane.setTarget(crane.world.tMax, 0);
    stepFor(crane, 10, () => {
      const l = crane.load();
      if (!l) return;
      const surf = crane.surfaceAt(l.x - 0.3, l.x + 0.3);
      worst = Math.min(worst, l.y - BH / 2 - surf);
    });
    expect(worst).toBeGreaterThan(-0.12);
  });

  it("finishes buildings, lights them, takes the oldest apart when every lot is full, and reuses its blocks", () => {
    const { crane, pilot } = rig("cycle");
    const seen: string[] = [];
    let t = 0;
    for (let i = 0; i < 900 / DT && !seen.includes("cleared"); i++) {
      t += DT;
      if (crane.canRequest()) crane.request(createRng(`k${i}`).int(3));
      pilot.update(DT, crane.readout());
      crane.step(DT);
      for (const e of crane.events) seen.push(e.type);
      crane.events.length = 0;
    }
    expect(seen.filter((e) => e === "finished").length).toBeGreaterThanOrEqual(crane.lots.length);
    expect(seen).toContain("clearing");
    expect(seen).toContain("cleared");
    // The cleared lot has a fresh outline and the rest still stand.
    expect(crane.lots.filter((l) => l.phase === "build")).toHaveLength(1);
    expect(crane.lots.filter((l) => l.phase === "done")).toHaveLength(crane.lots.length - 1);
    expect(crane.counts.cleared).toBe(1);
    expect(t).toBeLessThan(900);
  });

  it("stays bounded under any amount of abuse", () => {
    const { crane } = rig("abuse", { wind: true, assist: false });
    const rng = createRng("abuse");
    for (let i = 0; i < (20 * 60) / DT; i++) {
      if (rng.next() < 0.02) crane.setTarget(rng.range(-5, 20), rng.range(-2, 12));
      if (rng.next() < 0.01) crane.release();
      if (rng.next() < 0.03) crane.request(rng.int(4));
      if (rng.next() < 0.03) crane.arrive(rng.int(4), -2);
      if (rng.next() < 0.0005) crane.clear();
      crane.step(DT);
      if (i % 600 === 0) {
        expect(crane.loose.length).toBeLessThanOrEqual(MAX_LOOSE);
        expect(crane.riders.length).toBeLessThanOrEqual(LIFT_MAX);
        expect(crane.settles.length).toBeLessThanOrEqual(4);
        expect(crane.events.length).toBeLessThanOrEqual(256);
        const h = crane.hook();
        expect(Number.isFinite(h.x) && Number.isFinite(h.y)).toBe(true);
        expect(crane.trolley.x).toBeGreaterThanOrEqual(crane.world.tMin - 1e-6);
        expect(crane.trolley.x).toBeLessThanOrEqual(crane.world.tMax + 1e-6);
        // Nothing is ever in an unsupported slot.
        for (const lot of crane.lots) {
          lot.bp.slots.forEach((s, j) => {
            if (lot.filled[j] === null) return;
            for (const b of s.below) expect(lot.filled[b]).not.toBeNull();
            if (lot.filled[j] === 3) expect(s.top).toBe(true);
          });
        }
      }
    }
    expect(crane.counts.placed).toBeGreaterThan(0);
  });
});

describe("skyline start", () => {
  it("is never an empty skyline: all lots but one standing and lit, the last under way", () => {
    for (const seed of ["s1", "s2", "s3"]) {
      const { crane } = rig(seed, { prebuilt: true });
      const done = crane.lots.filter((l) => l.phase === "done");
      expect(done).toHaveLength(crane.lots.length - 1);
      for (const l of done) expect(l.filled.every((f) => f !== null)).toBe(true);
      const building = crane.lots.find((l) => l.phase === "build")!;
      const n = building.filled.filter((f) => f !== null).length;
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(building.filled.length);
      for (const lot of crane.lots) {
        lot.bp.slots.forEach((s, j) => {
          if (lot.filled[j] === null) return;
          for (const b of s.below) expect(lot.filled[b]).not.toBeNull();
          if (lot.filled[j] === 3) expect(s.top).toBe(true);
        });
      }
    }
    const one = rig("one", {
      prebuilt: true,
      world: testWorld({ lots: [{ x: 4, cols: 3 }] }),
    }).crane;
    expect(one.lots[0]!.phase).toBe("build");
    expect(one.lots[0]!.filled.some((f) => f !== null)).toBe(true);
    const tall = rig("t", { prebuilt: true, variant: "tall" }).crane;
    expect(tall.tower!.blocks).toHaveLength(2);
  });
});

describe("skyline tallest tower", () => {
  const tallRig = (seed: string) =>
    rig(seed, {
      variant: "tall",
      world: testWorld({ lots: [{ x: 5, cols: 1 }], jibY: 9, height: 9.6 }),
    });

  it("stacks blocks with their offsets, and a lean too far wobbles and tumbles", () => {
    const { crane } = tallRig("lean");
    const t = crane.tower!;
    // Each block a little further right: the top's weight ends up past an edge.
    for (let n = 0; n < 6 && t.phase === "build"; n++) {
      fetch(crane, n % 3);
      const top = t.blocks.length > 0 ? t.blocks[t.blocks.length - 1]!.x : t.x;
      const y = t.blocks.length * BH + BH / 2;
      settleAt(crane, top + 0.42, hookFor(y) + 0.15);
      expect(crane.release()).toBe("placed");
      stepFor(crane, 0.6);
    }
    expect(crane.best).toBeGreaterThanOrEqual(3);
    const seen: string[] = [];
    stepFor(crane, 4, () => {
      for (const e of crane.events) seen.push(e.type);
      crane.events.length = 0;
    });
    expect(seen).toContain("tumble");
    expect(crane.counts.tumbles).toBe(1);
    // Whatever stands now is stable.
    const b = t.blocks;
    for (let i = 0; i < b.length - 1; i++) {
      const above = b.slice(i + 1);
      const com = above.reduce((s, x) => s + x.x, 0) / above.length;
      expect(Math.abs(com - b[i]!.x)).toBeLessThanOrEqual(0.5);
    }
    stepFor(crane, 8);
    expect(crane.loose).toHaveLength(0);
  });

  it("caps at the top, celebrates, then comes down and starts again", () => {
    const { crane, pilot } = tallRig("cap");
    const seen: string[] = [];
    for (let i = 0; i < 1200 / DT && !seen.includes("cleared"); i++) {
      if (crane.canRequest()) crane.request(i % 3);
      pilot.update(DT, crane.readout());
      crane.step(DT);
      for (const e of crane.events) seen.push(e.type);
      crane.events.length = 0;
    }
    expect(seen).toContain("capped");
    expect(seen).toContain("cleared");
    expect(crane.best).toBe(crane.tower!.maxFloors);
    expect(crane.tower!.phase).toBe("build");
  });
});
