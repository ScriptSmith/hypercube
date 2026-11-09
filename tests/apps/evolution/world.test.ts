import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/core/rng";
import { MIGRANT_CHAIN } from "../../../src/apps/evolution/config";
import { type Migrant, createWorld, type World } from "../../../src/apps/evolution/world";

const make = (
  n: number,
  opts: {
    outside?: (pond: number, edge: -1 | 1) => boolean;
    emigrate?: (pond: number, edge: -1 | 1, m: Migrant) => boolean;
    seed?: string;
  } = {},
) => {
  let t = 0;
  const world = createWorld({
    specs: Array.from({ length: n }, (_, i) => ({
      island: i,
      box: { x: i * 1100, y: 0, w: 1000, h: 700 },
      target: 22,
      fish: 84,
      floor: "sand" as const,
    })),
    config: { herons: "few", mutation: "small", ponds: n, tree: true },
    rng: createRng(opts.seed ?? "world"),
    stamp: () => 5_000_000 + t * 1000,
    cap: 900,
    outside: opts.outside,
    emigrate: opts.emigrate,
  });
  const run = (s: number, dt = 0.1, swim = false) => {
    for (let i = 0; i < Math.round(s / dt); i++) {
      t += dt;
      for (const p of world.ponds) p.touchT = 0;
      world.step(dt, swim);
      world.drain();
    }
  };
  return { world, run, now: () => 5_000_000 + t * 1000 };
};

const homeOf = (w: World, id: number) => w.ponds.findIndex((p) => p.fish.some((f) => f.id === id));

describe("evolution world", () => {
  it("puts every founder in the tree and keeps living fish as its tips", () => {
    const { world, run, now } = make(2);
    expect(world.lineage.size).toBe(44);
    run(120);
    world.prune(now());
    const living = new Set(
      world.ponds.flatMap((p) => p.fish.filter((f) => f.state !== "dying").map((f) => f.id)),
    );
    for (const n of world.lineage.nodes()) {
      if (n.died === null)
        expect(living.has(n.id) || world.ponds.some((p) => p.fish.some((f) => f.id === n.id))).toBe(
          true,
        );
    }
    for (const id of living) expect(world.lineage.get(id)?.died).toBeNull();
  });

  it("passes migrants between neighbouring ponds with their lineage intact", () => {
    const { world, run, now } = make(3, { seed: "mig" });
    run(600);
    expect(world.counts.migrants).toBeGreaterThan(5);
    world.prune(now());
    // Some living fish descend from a fish born in another pond.
    const islandOf = (id: number) => Math.floor(id / (1 << 20));
    let crossed = 0;
    world.ponds.forEach((p, i) => {
      for (const f of p.fish) {
        let n = world.lineage.get(f.id);
        while (n && n.parent > 0) {
          if (islandOf(n.id) !== i) {
            crossed++;
            break;
          }
          n = world.lineage.get(n.parent);
        }
      }
    });
    expect(crossed).toBeGreaterThan(0);
    for (const p of world.ponds) expect(p.fish.length).toBeLessThanOrEqual(22 + 6);
  });

  it("asks its owner to send migrants off its outer edges, and turns them back if nobody takes them", () => {
    const sent: Migrant[] = [];
    let open = true;
    const { world, run } = make(1, {
      seed: "edges",
      outside: () => true,
      emigrate: (_pond, _edge, m) => {
        if (!open) return false;
        sent.push(m);
        return true;
      },
    });
    run(400);
    expect(sent.length).toBeGreaterThan(2);
    const m = sent[0]!;
    expect(m.chain.length).toBeLessThanOrEqual(MIGRANT_CHAIN);
    expect(m.life).toBeGreaterThan(m.age);
    // Gone from this frame's tree as a living fish.
    expect(world.lineage.get(m.fish.id)?.died ?? 0).not.toBeNull();
    open = false;
    const before = world.ponds[0]!.counts.left;
    run(400);
    expect(world.ponds[0]!.counts.left).toBe(before);
    expect(world.ponds[0]!.fish.length).toBeGreaterThanOrEqual(17);
  });

  it("takes in a migrant from another frame with its ancestors", () => {
    const a = make(1, { seed: "a" });
    a.run(200);
    a.world.prune(a.now());
    const f = a.world.ponds[0]!.fish.find((x) => x.parent > 0 && a.world.lineage.get(x.parent))!;
    const chain = [];
    let p = a.world.lineage.get(f.parent);
    while (p && chain.length < 4) {
      chain.push({ id: p.id, parent: p.parent, born: p.born, genes: p.genes });
      p = a.world.lineage.get(p.parent);
    }
    const b = make(2, { seed: "b" });
    const ok = b.world.immigrate(0, -1, {
      fish: { id: f.id, parent: f.parent, born: f.born, genes: f.genes },
      age: f.age,
      life: f.life,
      y: 0.5,
      chain,
    });
    expect(ok).toBe(true);
    expect(homeOf(b.world, f.id)).toBe(0);
    const node = b.world.lineage.get(f.id)!;
    expect(node.died).toBeNull();
    expect(b.world.lineage.get(f.parent)).toBeDefined();
    expect(b.world.lineage.get(f.parent)!.died).not.toBeNull();
    b.world.prune(b.now());
    expect(b.world.lineage.get(f.parent)).toBeDefined();
    // It swims in from the left edge.
    b.run(3, 0.05, true);
    const fish = b.world.ponds[0]!.fish.find((x) => x.id === f.id)!;
    expect(fish.x).toBeGreaterThan(0);
  });

  it("starts fresh on request and sends floors home slowly", () => {
    const { world, run } = make(2, { seed: "fresh" });
    world.setFloor(0, "mud", 500);
    world.setFloor(1, "pebbles", 1500);
    run(60);
    world.homeFloors(5);
    run(3);
    expect(world.ponds[0]!.floor).toBe("sand");
    expect(world.ponds[1]!.floor).toBe("pebbles");
    run(6);
    expect(world.ponds[1]!.floor).toBe("sand");
    const ids = new Set(world.ponds.flatMap((p) => p.fish.map((f) => f.id)));
    world.fresh();
    expect(world.lineage.size).toBe(44);
    for (const p of world.ponds) for (const f of p.fish) expect(ids.has(f.id)).toBe(false);
  });
});
