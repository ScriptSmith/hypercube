import { describe, expect, it } from "vitest";
import {
  GRAVEL_EDGE,
  gravelHeight,
  sideCentre,
  sideOf,
  surfaceRadius,
  waterLevel,
} from "../../../src/apps/fishbowl/bowl";
import {
  buildCaustics,
  CAUSTIC_FRAMES,
  CAUSTIC_SIZE,
  CAUSTIC_UNIT,
} from "../../../src/apps/fishbowl/caustics";
import { buildFishGeometry, SHAPES } from "../../../src/apps/fishbowl/fishgeo";
import { layoutScenery, obstaclesOf } from "../../../src/apps/fishbowl/scenery";
import { PART } from "../../../src/apps/fishbowl/shaders";
import { castOf, SPECIES, type SpeciesId } from "../../../src/apps/fishbowl/species";
import { createRng } from "../../../src/core/rng";
import { DEG, sphereInfo } from "../../../src/core/sphere";

describe("fishbowl bowl", () => {
  it("puts the surface just above the band people see, whatever the ball", () => {
    for (const [diameter, bottom] of [
      [5, 2.5],
      [3, 1],
      [8, 4],
    ] as const) {
      const s = sphereInfo(undefined, { diameter, bottom });
      const w = waterLevel(s);
      expect(Math.asin(w)).toBeGreaterThan(s.view.top);
      expect(Math.asin(w)).toBeLessThan(s.view.top + 6 * DEG);
      expect(surfaceRadius(w)).toBeGreaterThan(0.3);
    }
    // A ball seen all over still keeps its waterline below the top.
    expect(waterLevel({ view: { top: Math.PI / 2, bottom: -Math.PI / 2 } })).toBeLessThan(0.95);
  });

  it("names three sides a third of a turn apart, the same however far round", () => {
    for (let side = 0; side < 3; side++) expect(sideOf(sideCentre(side))).toBe(side);
    // The seam at ±180° falls between sides 1 and 2.
    expect(sideOf(Math.PI - 0.3)).toBe(1);
    expect(sideOf(-Math.PI + 0.3)).toBe(2);
    expect(sideOf(Math.PI + 0.3)).toBe(2);
    expect(sideOf(5 * Math.PI)).toBe(sideOf(Math.PI));
  });

  it("heaps the gravel a little in the middle", () => {
    expect(gravelHeight(0)).toBeGreaterThan(gravelHeight(GRAVEL_EDGE));
    expect(gravelHeight(GRAVEL_EDGE * 2)).toBe(gravelHeight(GRAVEL_EDGE));
  });
});

describe("fishbowl caustics", () => {
  const data = buildCaustics();
  const at = (f: number, x: number, y: number) =>
    data[f * CAUSTIC_SIZE * CAUSTIC_SIZE + y * CAUSTIC_SIZE + x]!;

  it("averages to plain light, with bright folds and dark gaps", () => {
    expect(data).toHaveLength(CAUSTIC_SIZE * CAUSTIC_SIZE * CAUSTIC_FRAMES);
    for (let f = 0; f < CAUSTIC_FRAMES; f += 7) {
      let sum = 0;
      let bright = 0;
      let dark = 0;
      for (let k = 0; k < CAUSTIC_SIZE * CAUSTIC_SIZE; k++) {
        const v = data[f * CAUSTIC_SIZE * CAUSTIC_SIZE + k]!;
        sum += v;
        if (v > CAUSTIC_UNIT * 2) bright++;
        if (v < CAUSTIC_UNIT * 0.5) dark++;
      }
      // Clipping the brightest lines at the top of a byte loses a little.
      expect(sum / (CAUSTIC_SIZE * CAUSTIC_SIZE) / CAUSTIC_UNIT).toBeGreaterThan(0.85);
      expect(sum / (CAUSTIC_SIZE * CAUSTIC_SIZE) / CAUSTIC_UNIT).toBeLessThan(1.05);
      expect(bright).toBeGreaterThan(100);
      expect(dark).toBeGreaterThan(500);
    }
  });

  it("tiles across its edges and loops in time", () => {
    // Neighbours across an edge differ no more than neighbours inside.
    const step = (a: number, b: number) => Math.abs(a - b);
    let inside = 0;
    let across = 0;
    let loop = 0;
    let frame = 0;
    for (let y = 0; y < CAUSTIC_SIZE; y++) {
      inside += step(at(0, 10, y), at(0, 11, y));
      across += step(at(0, CAUSTIC_SIZE - 1, y), at(0, 0, y));
    }
    for (let k = 0; k < CAUSTIC_SIZE * CAUSTIC_SIZE; k += 7) {
      const x = k % CAUSTIC_SIZE;
      const y = Math.floor(k / CAUSTIC_SIZE);
      frame += step(at(0, x, y), at(1, x, y));
      loop += step(at(CAUSTIC_FRAMES - 1, x, y), at(0, x, y));
    }
    expect(across).toBeLessThan(inside * 1.6);
    expect(loop).toBeLessThan(frame * 1.6);
  });
});

describe("fishbowl fish", () => {
  for (const id of Object.keys(SHAPES) as SpeciesId[]) {
    it(`builds a whole ${id} one length long`, () => {
      const g = buildFishGeometry(id);
      const p = g.getAttribute("position");
      const c = g.getAttribute("aCoord");
      const parts = new Set<number>();
      let minX = Infinity;
      let maxX = -Infinity;
      let maxZ = 0;
      for (let i = 0; i < p.count; i++) {
        expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
        minX = Math.min(minX, p.getX(i));
        maxX = Math.max(maxX, p.getX(i));
        maxZ = Math.max(maxZ, Math.abs(p.getZ(i)));
        parts.add(c.getZ(i));
      }
      expect(maxX).toBeCloseTo(0.5, 1);
      expect(minX).toBeGreaterThan(-0.56);
      expect(minX).toBeLessThan(-0.4);
      // Body, fins, tail, pectorals and eyes all there.
      for (const part of [PART.body, PART.fin, PART.tail, PART.pectoral, PART.eye]) {
        expect(parts.has(part), `${id} part ${part}`).toBe(true);
      }
      // Its widest point, eyes included, fits the clearance the swimming model leaves.
      expect(maxZ * 0.9).toBeLessThan(SPECIES[id].halfWidth * 1.4 + 0.1);
      const tris = g.index!.count / 3;
      expect(tris).toBeGreaterThan(400);
      expect(tris).toBeLessThan(2500);
      g.dispose();
    });
  }

  it("casts a few or many, with a shoal, a catfish and a puffer either way", () => {
    for (const stock of ["few", "many"] as const) {
      const cast = castOf(stock);
      const tetras = cast.filter((s) => s === "tetra").length;
      expect(tetras).toBeGreaterThanOrEqual(6);
      expect(tetras).toBeLessThanOrEqual(10);
      expect(cast.filter((s) => s === "goldfish" || s === "fancy").length).toBeGreaterThanOrEqual(
        2,
      );
      expect(cast).toContain("fancy");
      expect(cast).toContain("cory");
      expect(cast).toContain("puffer");
    }
  });
});

describe("fishbowl scenery", () => {
  it("roots everything on the gravel inside the bowl, spread round", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      const s = layoutScenery(createRng(seed));
      expect(s.plants.length).toBe(5);
      for (const p of s.plants) {
        expect(Math.hypot(p.x, p.z) + 0.05).toBeLessThan(GRAVEL_EDGE);
        // The tallest leaf stays below the surface.
        expect(gravelHeight(Math.hypot(p.x, p.z)) + p.height).toBeLessThan(0.6);
      }
      for (const st of s.stones)
        expect(Math.hypot(st.x, st.z) + st.size[0]).toBeLessThan(GRAVEL_EDGE);
      expect(Math.hypot(s.air.x, s.air.z)).toBeLessThan(GRAVEL_EDGE);
      const angles = s.plants.map((p) => Math.atan2(p.x, p.z)).sort((a, b) => a - b);
      for (let i = 1; i < angles.length; i++)
        expect(angles[i]! - angles[i - 1]!).toBeGreaterThan(0.6);
      expect(obstaclesOf(s).length).toBe(s.plants.length + s.stones.length + 1);
    }
  });
});
