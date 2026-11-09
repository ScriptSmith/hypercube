import { describe, expect, it } from "vitest";
import { layoutFor, type LayoutInput } from "../../../src/apps/hockey/layout";
import { createTable, type Table } from "../../../src/apps/hockey/table";
import { createRng } from "../../../src/core/rng";
import type { FrameKind } from "../../../src/core/types";
import { layoutInput, testConfig } from "./helpers";

const DT = 1 / 120;

/** Whether some player's mallet could touch a puck centred at (x, y). */
const reachable = (t: Table, x: number, y: number) => {
  const lane = t.lanes[0]!;
  const reach = lane.spec.params.malletR + lane.spec.params.puckR;
  return lane.players.some((p) => {
    const z = p.mallet.zone;
    return Math.hypot(Math.max(z.x0 - x, 0, x - z.x1), Math.max(z.y0 - y, 0, y - z.y1)) <= reach;
  });
};

interface Watch {
  /** Ms from the serve until each puck first came within someone's reach. */
  firstReach: number[];
  /** Longest time any puck spent out of everyone's reach while nearly still. */
  stuck: number;
  /** Shortest path (venue px) a served puck travelled in its first second. */
  moved: number;
}

/** Serve (attract or a match) and watch every puck for `ms` of simulated time. */
const watch = (t: Table, phase: "attract" | "play", ms: number): Watch => {
  if (phase === "attract") t.attract(0);
  else {
    t.countdown(0, "m", 0);
    t.play(0);
  }
  const lane = t.lanes[0]!;
  const slow = lane.spec.params.maxPuck * 0.1;
  const first = new Map<number, number>();
  const still = new Map<number, number>();
  const served = lane.pucks.filter((p) => p.live);
  const path = new Map(served.map((p) => [p.id, 0]));
  let stuck = 0;
  for (let now = 0; now < ms; now += DT * 1000) {
    t.step(DT, now);
    if (now < 1000) {
      for (const p of served) path.set(p.id, path.get(p.id)! + Math.hypot(p.x - p.px, p.y - p.py));
    }
    for (const p of lane.pucks) {
      if (!p.live) continue;
      const ok = reachable(t, p.x, p.y);
      if (ok && !first.has(p.id)) first.set(p.id, now);
      const quiet = !ok && Math.hypot(p.vx, p.vy) < slow ? (still.get(p.id) ?? 0) + DT * 1000 : 0;
      still.set(p.id, quiet);
      stuck = Math.max(stuck, quiet);
    }
  }
  return { firstReach: [...first.values()], stuck, moved: Math.min(...path.values()) };
};

const table = (kind: FrameKind, over: Partial<LayoutInput>, seed: string) => {
  const layout = layoutFor(layoutInput(kind, over));
  const cfg = testConfig({ players: over.players ?? 3, wall: over.wall ?? "tables" });
  return createTable(
    layout.tables[0]!,
    cfg,
    createRng(seed),
    over.versus ? { versus: { side: 0 } } : {},
  );
};

describe("pucks stay in play", () => {
  it("on the long wall table, every serve reaches a player within a second", () => {
    for (const players of [1, 2, 3, 4]) {
      for (const phase of ["attract", "play"] as const) {
        for (const seed of ["a", "b", "c"]) {
          const t = table("wall", { wall: "long", players }, seed);
          const w = watch(t, phase, 30_000);
          const served = phase === "attract" ? 1 : 2;
          const label = `${players} a side, ${phase}, seed ${seed}`;
          expect(w.firstReach.length, label).toBe(served);
          for (const ms of w.firstReach) expect(ms, label).toBeLessThan(1200);
          expect(w.stuck, label).toBeLessThan(700);
          // Play visibly starts: no serve creeps out of the middle.
          expect(w.moved, label).toBeGreaterThan(400);
        }
      }
    }
  });

  it("never leaves a puck still where nobody can reach it, on any layout", () => {
    const cases: [FrameKind, Partial<LayoutInput>][] = [
      ["wall", {}],
      ["wall", { childLane: true }],
      ["pair", {}],
      ["pair", { bands: { t0: { top: 1100, bottom: 1850 } } }],
      ["kiosk", {}],
      ["panel", {}],
      ["wall", { versus: true, players: 1 }],
      ["wall", { versus: true, players: 4 }],
    ];
    for (const [kind, over] of cases) {
      for (const phase of ["attract", "play"] as const) {
        const w = watch(table(kind, over, "x"), phase, 20_000);
        const label = `${kind} ${JSON.stringify(over)} ${phase}`;
        for (const ms of w.firstReach) expect(ms, label).toBeLessThan(1200);
        expect(w.stuck, label).toBeLessThan(700);
      }
    }
  });
});
