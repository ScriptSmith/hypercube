import { describe, expect, it } from "vitest";
import { GENE_COUNT, randomGenes } from "../../../src/apps/evolution/genes";
import type { NodeRec } from "../../../src/apps/evolution/lineage";
import {
  decodeBeacon,
  decodeHist,
  decodeMigrant,
  decodePond,
  encodeBeacon,
  encodeHist,
  encodeMigrant,
  encodePond,
  type PondMsg,
} from "../../../src/apps/evolution/wire";
import { createRng } from "../../../src/core/rng";

const T = 1_761_000_000_000;
const rng = createRng("wire");

const fish = (id: number, parent: number, ageS: number): NodeRec => ({
  id,
  parent,
  born: T - ageS * 1000,
  genes: randomGenes(rng),
});

const pond = (n: number, islands = 1): PondMsg => ({
  epoch: 123456789,
  t: T,
  pos: 3,
  count: 6,
  ponds: islands,
  islands: Array.from({ length: islands }, (_, k) => ({
    island: 3 * islands + k,
    floor: "weed",
    u0: 0.04,
    u1: 0.96,
    fish: Array.from({ length: n }, (_, i) =>
      fish(3_145_728 + i + k * 100, i > 0 ? 3_145_728 + i - 1 : 0, 10 + i * 3.3),
    ),
    dead: [{ id: 3_145_000, t: T - 1500 }],
  })),
});

const round = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("evolution messages", () => {
  it("survive the trip: ids exact, times to a tenth of a second, genes to a byte", () => {
    const m = pond(22);
    const d = decodePond(round(encodePond(m)))!;
    expect(d).not.toBeNull();
    expect(d.pos).toBe(3);
    expect(d.count).toBe(6);
    const a = m.islands[0]!;
    const b = d.islands[0]!;
    expect(b.floor).toBe("weed");
    expect(b.u0).toBeCloseTo(0.04, 3);
    expect(b.fish.map((f) => f.id)).toEqual(a.fish.map((f) => f.id));
    a.fish.forEach((f, i) => {
      const g = b.fish[i]!;
      expect(g.parent).toBe(f.parent);
      expect(Math.abs(g.born - f.born)).toBeLessThanOrEqual(50);
      for (let k = 0; k < GENE_COUNT; k++)
        expect(Math.abs(g.genes[k]! - f.genes[k]!)).toBeLessThan(0.0021);
    });
    expect(b.dead).toEqual([{ id: 3_145_000, t: T - 1500 }]);
  });

  it("stay small: a panel's pond is under 1.5 KB and the biggest allowed well under 16 KB", () => {
    expect(JSON.stringify(encodePond(pond(22))).length).toBeLessThan(1500);
    expect(JSON.stringify(encodePond(pond(96, 2))).length).toBeLessThan(16_000);
    const hist = encodeHist({
      epoch: 1,
      t: T,
      nodes: Array.from({ length: 200 }, (_, i) => fish(i + 1, i, 500 - i)),
    });
    expect(JSON.stringify(hist).length).toBeLessThan(16_000);
  });

  it("refuse anything out of range or malformed", () => {
    const good = round(encodePond(pond(5))) as Record<string, unknown>;
    expect(decodePond(good)).not.toBeNull();
    const bad = (patch: (o: Record<string, unknown>) => void) => {
      const o = round(good);
      patch(o);
      return decodePond(o);
    };
    expect(bad((o) => (o.p = 10))).toBeNull();
    expect(bad((o) => (o.n = 0))).toBeNull();
    expect(bad((o) => (o.k = 9))).toBeNull();
    expect(bad((o) => (o.i = []))).toBeNull();
    const isl = (o: Record<string, unknown>) => (o.i as Record<string, unknown>[])[0]!;
    expect(bad((o) => (isl(o).f = 7))).toBeNull();
    expect(bad((o) => (isl(o).u = [600, 400]))).toBeNull();
    expect(bad((o) => (isl(o).x = [[1, 1, 0, "00112233aabb"]]))).toBeNull();
    expect(bad((o) => (isl(o).x = [[1, 0, -5, "00112233aabb"]]))).toBeNull();
    expect(bad((o) => (isl(o).x = [[1, 0, 5, "nothex"]]))).toBeNull();
    expect(
      bad((o) => (isl(o).x = Array.from({ length: 200 }, (_, i) => [i + 1, 0, 1, "001122334455"]))),
    ).toBeNull();
    expect(bad((o) => (isl(o).d = [[5, "x"]]))).toBeNull();
    expect(decodePond(null)).toBeNull();
    expect(decodePond("pond")).toBeNull();
    expect(decodeHist({ e: 1, t: T, x: [[1, 0, 1]] })).toBeNull();
  });

  it("carry a migrant with its lineage", () => {
    const m = {
      t: T,
      to: 4,
      edge: -1 as const,
      y: 0.31,
      age: 42.3,
      life: 104.5,
      fish: fish(3_100_001, 3_100_000, 42.3),
      chain: [fish(3_100_000, 3_099_000, 80), fish(3_099_000, 0, 150)],
    };
    const d = decodeMigrant(round(encodeMigrant(m)))!;
    expect(d.to).toBe(4);
    expect(d.edge).toBe(-1);
    expect(d.y).toBeCloseTo(0.31, 3);
    expect(d.age).toBeCloseTo(42.3, 1);
    expect(d.life).toBeCloseTo(104.5, 1);
    expect(d.fish.id).toBe(m.fish.id);
    expect(d.chain.map((c) => [c.id, c.parent])).toEqual([
      [3_100_000, 3_099_000],
      [3_099_000, 0],
    ]);
    expect(decodeMigrant({ ...(round(encodeMigrant(m)) as object), g: 0 })).toBeNull();
  });

  it("beacons name their side", () => {
    expect(decodeBeacon(round(encodeBeacon(1)))).toEqual({ side: 1 });
    expect(decodeBeacon({ s: 2 })).toBeNull();
  });
});
