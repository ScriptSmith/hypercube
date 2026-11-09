import { describe, expect, it } from "vitest";
import {
  circleHits,
  generateTerrain,
  heightAt,
  MAX_VERTS,
  PAD_WIDTH,
  padUnder,
  type TerrainInput,
} from "../../../src/apps/touchdown/terrain";
import { createRng } from "../../../src/core/rng";
import { KINDS, layoutOf } from "./helpers";

const inputFor = (kind: (typeof KINDS)[number], variant: "duo" | "crew" = "duo", crew = 0) => {
  const l = layoutOf(kind, variant);
  const c = l.crews[crew]!;
  return {
    input: {
      lane: c.lane,
      ground: l.ground,
      craft: l.craft,
      noLand: c.noLand,
      q: l.drop / 1200,
    } satisfies TerrainInput,
    layout: l,
  };
};

describe("touchdown terrain", () => {
  it("is the same for the same seed and differs for another", () => {
    const { input } = inputFor("pair");
    const a = generateTerrain(createRng("x"), input);
    const b = generateTerrain(createRng("x"), input);
    const c = generateTerrain(createRng("y"), input);
    expect(Array.from(a.ys)).toEqual(Array.from(b.ys));
    expect(a.pads).toEqual(b.pads);
    expect(Array.from(a.ys)).not.toEqual(Array.from(c.ys));
  });

  for (const kind of KINDS) {
    for (const variant of ["duo", "crew"] as const) {
      it(`places flat, separate pads inside the lane on a ${kind} (${variant})`, () => {
        const { input, layout } = inputFor(kind, variant);
        const S = layout.craft;
        for (let s = 0; s < 40; s++) {
          const t = generateTerrain(createRng(`t${s}`), input);
          expect(t.pads.length).toBeGreaterThanOrEqual(2);
          expect(t.xs.length).toBeLessThanOrEqual(MAX_VERTS);
          const sorted = [...t.pads].sort((a, b) => a.x0 - b.x0);
          for (let i = 0; i < sorted.length; i++) {
            const p = sorted[i]!;
            expect(p.x0).toBeGreaterThanOrEqual(input.lane.x0);
            expect(p.x1).toBeLessThanOrEqual(input.lane.x1);
            expect(p.x1 - p.x0).toBeCloseTo(PAD_WIDTH[p.stars]! * S, 2);
            expect(p.y).toBeGreaterThan(layout.ground.top);
            expect(p.y).toBeLessThan(layout.ground.bottom);
            for (const f of [0, 0.25, 0.5, 0.75, 1]) {
              expect(heightAt(t, p.x0 + (p.x1 - p.x0) * f)).toBe(p.y);
            }
            const next = sorted[i + 1];
            if (next) expect(next.x0 - p.x1).toBeGreaterThan(0.5 * S);
            for (const [a, b] of input.noLand) {
              expect(p.x1 <= a || p.x0 >= b).toBe(true);
            }
          }
          // The narrowest pad scores the most stars.
          const byWidth = [...t.pads].sort((a, b) => a.x1 - a.x0 - (b.x1 - b.x0));
          expect(byWidth[0]!.stars).toBe(Math.max(...t.pads.map((p) => p.stars)));
          for (let i = 0; i < t.ys.length; i++) {
            expect(t.ys[i]).toBeGreaterThanOrEqual(layout.ground.top - 1e-3);
            expect(t.ys[i]).toBeLessThanOrEqual(layout.ground.bottom + 1e-3);
          }
          expect(t.spawn.x).toBeGreaterThan(input.lane.x0);
          expect(t.spawn.x).toBeLessThan(input.lane.x1);
        }
      });
    }
  }

  it("has three pads where there is room and two on a panel", () => {
    const pair = generateTerrain(createRng("a"), inputFor("pair").input);
    expect(pair.pads.map((p) => p.stars).sort()).toEqual([1, 2, 3]);
    const panel = generateTerrain(createRng("a"), inputFor("panel").input);
    expect(panel.pads.map((p) => p.stars).sort()).toEqual([1, 3]);
  });

  it("finds the pad under both feet, and only then", () => {
    const t = generateTerrain(createRng("b"), inputFor("pair").input);
    const p = t.pads[0]!;
    expect(padUnder(t, p.x0 + 1, p.x1 - 1)).toBe(p);
    expect(padUnder(t, p.x0 - 1, p.x1 - 1)).toBeNull();
  });

  it("tells when a circle touches the surface", () => {
    const t = generateTerrain(createRng("c"), inputFor("pair").input);
    const p = t.pads[0]!;
    const x = (p.x0 + p.x1) / 2;
    expect(circleHits(t, x, p.y - 50, 49)).toBe(false);
    expect(circleHits(t, x, p.y - 50, 51)).toBe(true);
    expect(circleHits(t, x, p.y + 100, 10)).toBe(true);
  });

  it("keeps each wall lane's ridges level so neighbouring lanes join", () => {
    const l = layoutOf("wall", "duo", 3);
    const terrains = l.crews.map((c, i) =>
      generateTerrain(createRng(`w${i}`), {
        lane: c.lane,
        ground: l.ground,
        craft: l.craft,
        noLand: c.noLand,
        q: 1,
      }),
    );
    for (let i = 1; i < terrains.length; i++) {
      const left = terrains[i - 1]!;
      const right = terrains[i]!;
      expect(left.ys[left.ys.length - 1]).toBeCloseTo(right.ys[0]!, 6);
      expect(left.xs[left.xs.length - 1]).toBeCloseTo(right.xs[0]!, 6);
    }
  });
});
