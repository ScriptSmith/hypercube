import { describe, expect, it } from "vitest";
import { HORIZON_MS, TREE_CAP } from "../../../src/apps/evolution/config";
import {
  ancestorsOf,
  createLineage,
  layoutTree,
  type NodeRec,
  orderTips,
} from "../../../src/apps/evolution/lineage";
import { createWorld } from "../../../src/apps/evolution/world";
import { createRng } from "../../../src/core/rng";

const G = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
const rec = (id: number, parent: number, born: number): NodeRec => ({ id, parent, born, genes: G });

describe("evolution lineage", () => {
  it("keeps only ancestors of living fish", () => {
    const lin = createLineage();
    // 1 founds two families: 2 (with child 4) and 3 (with child 5); 6 is a founder.
    lin.add(rec(1, 0, 0), false);
    lin.add(rec(2, 1, 10), false);
    lin.add(rec(3, 1, 20), false);
    lin.add(rec(4, 2, 30), true);
    lin.add(rec(5, 3, 40), true);
    lin.add(rec(6, 0, 5), true);
    expect(lin.prune(100, HORIZON_MS, 100)).toHaveLength(0);
    expect(lin.size).toBe(6);
    // 5 is caught: 5 and 3 have no living descendants left and go; 1 stays for 4.
    lin.kill(5, 50);
    const gone = lin
      .prune(100, HORIZON_MS, 100)
      .map((n) => n.id)
      .sort();
    expect(gone).toEqual([3, 5]);
    expect([...lin.nodes()].map((n) => n.id).sort()).toEqual([1, 2, 4, 6]);
    // 4 dies too: only the founder 6 is left.
    lin.kill(4, 60);
    lin.prune(100, HORIZON_MS, 100);
    expect([...lin.nodes()].map((n) => n.id)).toEqual([6]);
  });

  it("forgets ancestors whose last young hatched before the horizon", () => {
    const lin = createLineage();
    lin.add(rec(1, 0, 0), false);
    lin.add(rec(2, 1, 1000), true);
    lin.add(rec(3, 1, 2000), true);
    lin.prune(HORIZON_MS / 2, HORIZON_MS, 100);
    expect(lin.has(1)).toBe(true);
    lin.prune(HORIZON_MS + 3000, HORIZON_MS, 100);
    expect(lin.has(1)).toBe(false);
    expect(lin.has(2) && lin.has(3)).toBe(true);
  });

  it("drops the oldest dead ancestors first when over its cap", () => {
    const lin = createLineage();
    // A chain 1 -> 2 -> ... -> 50, only the last alive.
    for (let i = 1; i <= 50; i++) lin.add(rec(i, i - 1, i * 100), i === 50);
    lin.prune(6000, HORIZON_MS, 20);
    expect(lin.size).toBe(20);
    expect(lin.has(50) && lin.has(31)).toBe(true);
    expect(lin.has(30)).toBe(false);
  });

  it("orders tips so each family sits together, and lays out parents between their young", () => {
    const lin = createLineage();
    lin.add(rec(1, 0, 0), false);
    lin.add(rec(2, 0, 0), false);
    // Family of 1: 3, 4, 5. Family of 2: 6, 7. Living parent 8 (child of 2) with child 9.
    for (const [id, p, b] of [
      [3, 1, 10],
      [6, 2, 11],
      [4, 1, 12],
      [7, 2, 13],
      [5, 1, 14],
      [8, 2, 15],
      [9, 8, 20],
    ] as const) {
      lin.add(rec(id, p, b), true);
    }
    lin.prune(100, HORIZON_MS, 100);
    orderTips(lin);
    const order = (id: number) => lin.get(id)!.order;
    const fam1 = [3, 4, 5].map(order).sort((a, b) => a - b);
    const fam2 = [6, 7, 8, 9].map(order).sort((a, b) => a - b);
    expect(fam1[2]! - fam1[0]!).toBe(2);
    expect(fam2[3]! - fam2[0]!).toBe(3);
    for (const n of lin.nodes()) n.col = 0;
    layoutTree(lin, { x0: [0], x1: [700] });
    const xs = [3, 4, 5, 6, 7, 8, 9].map((id) => lin.get(id)!.tx);
    for (const x of xs) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(700);
    }
    const one = lin.get(1)!;
    expect(one.tx).toBeCloseTo((lin.get(3)!.tx + lin.get(4)!.tx + lin.get(5)!.tx) / 3);
    expect(one.leaves).toBe(3);
    expect(lin.get(2)!.leaves).toBe(4);
  });

  it("spreads each column's tips over that column only", () => {
    const lin = createLineage();
    lin.add(rec(1, 0, 0), false);
    for (let i = 0; i < 6; i++) {
      const n = lin.add(rec(10 + i, 1, 10 + i), true);
      n.col = i < 3 ? 0 : 1;
    }
    lin.prune(100, HORIZON_MS, 100);
    orderTips(lin);
    layoutTree(lin, { x0: [0, 1000], x1: [300, 1300] });
    for (let i = 0; i < 6; i++) {
      const x = lin.get(10 + i)!.tx;
      if (i < 3) expect(x).toBeLessThan(300);
      else expect(x).toBeGreaterThan(1000);
    }
    // The shared ancestor sits between the columns.
    expect(lin.get(1)!.tx).toBeGreaterThan(300);
    expect(lin.get(1)!.tx).toBeLessThan(1000);
  });

  it("gives a migrant's nearest ancestors, nearest first", () => {
    const lin = createLineage();
    for (let i = 1; i <= 12; i++) lin.add(rec(i, i - 1, i), i === 12);
    expect(ancestorsOf(lin, 12, 4).map((n) => n.id)).toEqual([11, 10, 9, 8]);
  });

  it("stays bounded over a simulated day of a busy wall", () => {
    let t = 0;
    const world = createWorld({
      specs: [0, 1, 2].map((i) => ({
        island: i,
        box: { x: i * 1100, y: 0, w: 1000, h: 600 },
        target: 40,
        fish: 100,
        floor: "sand" as const,
      })),
      config: { herons: "many", mutation: "big", ponds: 3, tree: true },
      rng: createRng("day"),
      stamp: () => 1_000_000 + t * 1000,
      cap: TREE_CAP.wall,
    });
    let most = 0;
    const dt = 0.5;
    for (let step = 0; step < (24 * 3600) / dt; step++) {
      t += dt;
      world.step(dt, false);
      world.drain();
      if (step % 20 === 0) {
        world.prune(1_000_000 + t * 1000);
        most = Math.max(most, world.lineage.size);
      }
    }
    expect(most).toBeLessThanOrEqual(TREE_CAP.wall);
    const now = 1_000_000 + t * 1000;
    let leaves = 0;
    for (const n of world.lineage.nodes()) {
      if (n.died === null) leaves++;
      else expect(n.last).toBeGreaterThan(now - HORIZON_MS - 30_000);
    }
    expect(leaves).toBeGreaterThan(100);
    expect(leaves).toBeLessThanOrEqual(3 * (40 + 6));
    for (const b of world.bands) {
      expect(b.floors.length).toBeLessThanOrEqual(48);
      expect(b.colors.length).toBeLessThanOrEqual(240);
    }
  }, 60_000);
});
