import { describe, expect, it } from "vitest";
import {
  DROP_MS,
  HORIZON_MS,
  PANEL_FISH,
  TRANSIT_MS,
  TREE_CAP,
} from "../../../src/apps/evolution/config";
import { FLOOR_ROTATION } from "../../../src/apps/evolution/genes";
import { orderTips } from "../../../src/apps/evolution/lineage";
import { createWorld } from "../../../src/apps/evolution/world";
import { createRng } from "../../../src/core/rng";
import { createFleet } from "../../../src/apps/evolution/fleet";
import type { NodeRec } from "../../../src/apps/evolution/lineage";
import { decodePond, encodePond, type PondMsg } from "../../../src/apps/evolution/wire";

const G = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
const T0 = 2_000_000;
const rec = (id: number, parent: number, born: number): NodeRec => ({ id, parent, born, genes: G });

const msg = (
  pos: number,
  t: number,
  fish: NodeRec[],
  dead: { id: number; t: number }[] = [],
  epoch = 7,
): PondMsg =>
  decodePond(
    JSON.parse(
      JSON.stringify(
        encodePond({
          epoch,
          t,
          pos,
          count: 4,
          ponds: 1,
          islands: [{ island: pos, floor: "sand", u0: 0.05, u1: 0.95, fish, dead }],
        }),
      ),
    ),
  )!;

describe("evolution screen fleet", () => {
  it("builds one tree from the frames' ponds, each fish in its island's column", () => {
    const f = createFleet();
    f.accept(msg(0, T0, [rec(1, 0, T0 - 5000), rec(2, 1, T0 - 1000)]), "p0", 0);
    f.accept(msg(1, T0, [rec(100, 0, T0 - 5000)]), "p1", 0);
    f.prune(0, T0, 1000);
    expect(f.lineage.get(1)?.col).toBe(0);
    expect(f.lineage.get(100)?.col).toBe(1);
    expect(f.lineage.get(2)?.order).toBe(1);
    expect(f.columns(1)).toBe(4);
    expect(f.islands().map((s) => s.island)).toEqual([0, 1]);
    expect(f.bands.get(0)?.floors[0]?.floor).toBe("sand");
  });

  it("keeps the same node for a fish from message to message, so its line doesn't jump", () => {
    const f = createFleet();
    const born = T0 - 4321;
    f.accept(msg(0, T0 + 37, [rec(1, 0, T0 - 9000), rec(2, 1, born)]), "p0", 0);
    f.prune(0, T0, 1000);
    const node = f.lineage.get(2)!;
    node.placed = true;
    node.x = 123;
    for (let k = 1; k <= 5; k++) {
      f.accept(msg(0, T0 + 37 + k * 2013, [rec(1, 0, T0 - 9000), rec(2, 1, born)]), "p0", k * 2013);
      expect(f.lineage.get(2)).toBe(node);
    }
    expect(node.x).toBe(123);
    // The same id with another parent is another fish (an id reused after a reload).
    f.accept(msg(0, T0 + 20_000, [rec(1, 0, T0 - 9000), rec(2, 0, T0 + 19_000)]), "p0", 20_000);
    expect(f.lineage.get(2)).not.toBe(node);
  });

  it("ends a caught fish's line when its frame reports the death", () => {
    const f = createFleet();
    f.accept(msg(0, T0, [rec(1, 0, T0 - 5000), rec(2, 0, T0 - 4000)]), "p0", 0);
    f.accept(msg(0, T0 + 2000, [rec(1, 0, T0 - 5000)], [{ id: 2, t: T0 + 1200 }]), "p0", 2000);
    const gone = f.prune(2000, T0 + 2000, 1000);
    expect(gone.map((n) => n.id)).toEqual([2]);
    expect(f.lineage.has(2)).toBe(false);
  });

  it("keeps a migrant alive on its way to the next frame, and ends it if nobody claims it", () => {
    const f = createFleet();
    f.accept(
      msg(0, T0, [rec(1, 0, T0 - 5000), rec(2, 0, T0 - 4000), rec(3, 0, T0 - 3000)]),
      "p0",
      0,
    );
    f.accept(msg(1, T0, [rec(100, 0, T0 - 5000)]), "p1", 0);
    // 2 leaves p0 and turns up in p1; 3 leaves and never arrives.
    f.accept(msg(0, T0 + 2000, [rec(1, 0, T0 - 5000)]), "p0", 2000);
    f.prune(2500, T0 + 2500, 1000);
    expect(f.lineage.get(2)?.died).toBeNull();
    expect(f.lineage.get(3)?.died).toBeNull();
    expect(f.transit).toBe(2);
    f.accept(msg(1, T0 + 3000, [rec(100, 0, T0 - 5000), rec(2, 0, T0 - 4000)]), "p1", 3000);
    const later = 2000 + TRANSIT_MS + 100;
    f.accept(msg(0, T0 + later, [rec(1, 0, T0 - 5000)]), "p0", later);
    f.accept(msg(1, T0 + later, [rec(100, 0, T0 - 5000), rec(2, 0, T0 - 4000)]), "p1", later);
    f.prune(later, T0 + later, 1000);
    expect(f.lineage.get(2)?.died).toBeNull();
    expect(f.lineage.get(2)?.col).toBe(1);
    expect(f.lineage.has(3)).toBe(false);
  });

  it("drops a quiet frame's fish after a few seconds and ends a reloaded frame's old fish", () => {
    const f = createFleet();
    f.accept(msg(0, T0, [rec(1, 0, T0 - 5000)]), "p0", 0);
    f.accept(msg(1, T0, [rec(100, 0, T0 - 5000)]), "p1", 0);
    f.prune(DROP_MS - 100, T0 + DROP_MS, 1000);
    expect(f.frames).toBe(2);
    f.accept(msg(1, T0 + DROP_MS, [rec(100, 0, T0 - 5000)]), "p1", DROP_MS);
    f.prune(DROP_MS + 200, T0 + DROP_MS + 200, 1000);
    expect(f.frames).toBe(1);
    expect(f.lineage.has(1)).toBe(false);
    // p1 reloads: its old fish end, the new ones start.
    f.accept(msg(1, T0 + 9000, [rec(200, 0, T0 + 8000)], [], 99), "p1", 9000);
    f.prune(9000, T0 + 9000, 1000);
    expect(f.lineage.has(100)).toBe(false);
    expect(f.lineage.get(200)?.died).toBeNull();
  });

  it("takes a frame's remembered ancestors without overriding living fish", () => {
    const f = createFleet();
    f.accept(msg(0, T0, [rec(5, 4, T0 - 1000)]), "p0", 0);
    f.history(
      {
        epoch: 7,
        t: T0,
        nodes: [rec(3, 0, T0 - 9000), rec(4, 3, T0 - 5000), rec(5, 4, T0 - 1000)],
      },
      "p0",
    );
    f.prune(0, T0, 1000);
    expect(f.lineage.get(5)?.died).toBeNull();
    expect(f.lineage.get(3)?.kids.map((k) => k.id)).toEqual([4]);
    expect(f.lineage.get(4)?.kids.map((k) => k.id)).toEqual([5]);
  });
});

describe("evolution screen fleet over hours", () => {
  it("keeps the screen's tree within its cap and horizon over three hours of twelve busy ponds", () => {
    let t = 0;
    const clock = () => 50_000_000 + t * 1000;
    const worlds = Array.from({ length: 12 }, (_, pos) =>
      createWorld({
        specs: [
          {
            island: pos,
            box: { x: 0, y: 0, w: 1000, h: 760 },
            target: PANEL_FISH,
            fish: 84,
            floor: FLOOR_ROTATION[pos % 4]!,
          },
        ],
        config: { herons: "many", mutation: "big", ponds: 1, tree: true },
        rng: createRng(`hours:${pos}`),
        stamp: clock,
        cap: TREE_CAP.panel,
      }),
    );
    const dead: { id: number; t: number }[][] = worlds.map(() => []);
    const f = createFleet();
    let most = 0;
    const dt = 0.5;
    for (let step = 1; step <= (3 * 3600) / dt; step++) {
      t += dt;
      worlds.forEach((w, pos) => {
        w.step(dt, false);
        for (const { e } of w.drain()) {
          if (e.kind === "catch" || e.kind === "death")
            dead[pos]!.push({ id: e.fish.id, t: clock() });
        }
      });
      if (step % 4 !== 0) continue;
      const now = t * 1000;
      worlds.forEach((w, pos) => {
        w.prune(clock());
        orderTips(w.lineage);
        const p = w.ponds[0]!;
        const fish = p.fish
          .filter((x) => x.state !== "dying")
          .map((x) => ({ id: x.id, parent: x.parent, born: x.born, genes: x.genes }));
        const m = encodePond({
          epoch: 1,
          t: clock(),
          pos,
          count: 12,
          ponds: 1,
          islands: [
            { island: pos, floor: p.floor, u0: 0.05, u1: 0.95, fish, dead: dead[pos]!.splice(0) },
          ],
        });
        f.accept(decodePond(JSON.parse(JSON.stringify(m)))!, `p${pos}`, now);
      });
      f.prune(now, clock(), TREE_CAP.screen);
      most = Math.max(most, f.lineage.size);
    }
    expect(most).toBeLessThanOrEqual(TREE_CAP.screen);
    let leaves = 0;
    for (const n of f.lineage.nodes()) {
      if (n.died === null) leaves++;
      else expect(n.last).toBeGreaterThan(clock() - HORIZON_MS - 10_000);
    }
    expect(leaves).toBeGreaterThan(180);
    expect(leaves).toBeLessThanOrEqual(12 * (PANEL_FISH + 6));
    expect(f.transit).toBeLessThan(20);
    for (const b of f.bands.values()) expect(b.colors.length).toBeLessThanOrEqual(240);
  }, 120_000);
});
