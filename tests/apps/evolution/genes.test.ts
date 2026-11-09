import { describe, expect, it } from "vitest";
import { MUTATION_SD } from "../../../src/apps/evolution/config";
import {
  FLOOR_GENES,
  FLOORS,
  G,
  GENE_COUNT,
  labOf,
  lookOf,
  meanGenes,
  mutate,
  packGenes,
  randomGenes,
  rgbOf,
  standout,
  unpackGenes,
} from "../../../src/apps/evolution/genes";
import { createRng } from "../../../src/core/rng";

describe("evolution genes", () => {
  it("gives young genes near their parent's, closer with small changes than big", () => {
    const rng = createRng("genes");
    for (const mode of ["small", "big"] as const) {
      const sd = MUTATION_SD[mode];
      let sum = 0;
      let n = 0;
      let far = 0;
      let lo = 1;
      let hi = 0;
      for (let i = 0; i < 2000; i++) {
        const parent = randomGenes(rng).map((g) => 0.2 + g * 0.6);
        const young = mutate(parent, sd, rng);
        expect(young).toHaveLength(GENE_COUNT);
        for (let k = 0; k < GENE_COUNT; k++) {
          const d = Math.abs(young[k]! - parent[k]!);
          sum += d;
          n++;
          if (d > sd * 6) far++;
          lo = Math.min(lo, young[k]!);
          hi = Math.max(hi, young[k]!);
        }
      }
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
      const mean = sum / n;
      // Most young differ by about the spread; a few (the odd ones) by three times as much.
      expect(mean).toBeGreaterThan(sd * 0.7);
      expect(mean).toBeLessThan(sd * 1.6);
      expect(far / n).toBeLessThan(0.05);
    }
    const small = MUTATION_SD.small;
    const big = MUTATION_SD.big;
    expect(big).toBeGreaterThan(small * 1.5);
  });

  it("keeps genes in range at the edges without piling up there", () => {
    const rng = createRng("edges");
    const parent = [0, 1, 0, 1, 0, 1];
    let atEdge = 0;
    for (let i = 0; i < 500; i++) {
      for (const g of mutate(parent, MUTATION_SD.big, rng)) {
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(1);
        if (g === 0 || g === 1) atEdge++;
      }
    }
    expect(atEdge).toBeLessThan(50);
  });

  it("packs genes into twelve hex digits within a byte's rounding", () => {
    const rng = createRng("pack");
    for (let i = 0; i < 200; i++) {
      const g = randomGenes(rng);
      const s = packGenes(g);
      expect(s).toMatch(/^[0-9a-f]{12}$/);
      const back = unpackGenes(s)!;
      for (let k = 0; k < GENE_COUNT; k++)
        expect(Math.abs(back[k]! - g[k]!)).toBeLessThan(0.5 / 255 + 1e-9);
    }
    expect(unpackGenes("zz")).toBeNull();
    expect(unpackGenes(42)).toBeNull();
    expect(unpackGenes("0123456789ABCDEF")).toBeNull();
  });

  it("measures a floor against itself as perfectly hidden and the floors as clearly different", () => {
    for (const a of FLOORS) {
      expect(standout(FLOOR_GENES[a], FLOOR_GENES[a])).toBe(0);
      for (const b of FLOORS) {
        if (a === b) continue;
        expect(standout(FLOOR_GENES[a], FLOOR_GENES[b])).toBeGreaterThan(0.9);
      }
    }
  });

  it("counts colour, then markings, towards standing out", () => {
    const sand = FLOOR_GENES.sand;
    const darker = [...sand];
    darker[G.light] = sand[G.light]! - 0.2;
    const striped = [...sand];
    striped[G.stripes] = 0.6;
    const scaled = [...sand];
    scaled[G.scale] = sand[G.scale]! + 0.2;
    expect(standout(darker, sand)).toBeGreaterThan(standout(striped, sand));
    expect(standout(striped, sand)).toBeGreaterThan(standout(scaled, sand));
    expect(standout(scaled, sand)).toBeGreaterThan(0);
  });

  it("draws fish in natural colours: no blues or purples, greys when untinted", () => {
    const rng = createRng("colours");
    for (let i = 0; i < 300; i++) {
      const g = randomGenes(rng);
      const [r, gg, b] = rgbOf(labOf(g));
      expect(b).toBeLessThanOrEqual(Math.max(r, gg) + 12);
      const look = lookOf(g);
      expect(look.body).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
      expect(look.mark).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    }
    const grey = rgbOf(labOf([0.5, 0.5, 0, 0, 0, 0]));
    expect(Math.max(...grey) - Math.min(...grey)).toBeLessThan(8);
  });

  it("averages genes, or gives null for none", () => {
    expect(meanGenes([])).toBeNull();
    expect(
      meanGenes([
        [0, 0, 0, 0, 0, 0],
        [1, 1, 1, 1, 1, 1],
      ]),
    ).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  });
});
