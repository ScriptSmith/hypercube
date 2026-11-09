import { describe, expect, it } from "vitest";
import {
  type GameConfig,
  MATCH_MS,
  RESPAWN_MS,
  type Variant,
} from "../../../src/apps/hockey/config";
import { layoutFor } from "../../../src/apps/hockey/layout";
import { scoreOf } from "../../../src/apps/hockey/match";
import { createTable, type Table, type TableEvent } from "../../../src/apps/hockey/table";
import type { FrameKind } from "../../../src/core/types";
import { layoutInput, testConfig } from "./helpers";
import { createRng } from "../../../src/core/rng";

const DT = 1 / 120;

const config = (over: Partial<GameConfig> = {}): GameConfig => testConfig({ pucks: 2, ...over });

/** Run a bot-only match on the first table of a layout, from the countdown to the end. */
const botMatch = (kind: FrameKind, variant: Variant, seed: string, maxMs = MATCH_MS + 5000) => {
  const layout = layoutFor(layoutInput(kind, { variant }));
  const table = createTable(layout.tables[0]!, config({ variant }), createRng(seed));
  const events: TableEvent[] = [];
  table.on((e) => events.push(e));
  let now = 0;
  table.attract(now);
  table.countdown(now, "m1", now + 1000);
  for (; now < 1000; now += DT * 1000) table.step(DT, now);
  table.play(now);
  for (; now < maxMs && table.match.phase === "play"; now += DT * 1000) table.step(DT, now);
  return { table, events, now };
};

const snapshot = (t: Table) =>
  JSON.stringify(
    t.lanes.map((l) => [
      l.pucks.map((p) => [p.x.toFixed(6), p.y.toFixed(6), p.live]),
      l.players.map((p) => [p.mallet.x.toFixed(6), p.mallet.y.toFixed(6)]),
    ]),
  );

describe("table", () => {
  it("plays a bot match to a result with goals on both sides", () => {
    for (const kind of ["kiosk", "pair", "wall", "panel"] as const) {
      const { table, events, now } = botMatch(kind, "hockey", `match:${kind}`);
      const [a, b] = scoreOf(table.match);
      expect(table.match.phase, kind).toBe("over");
      expect(a + b, kind).toBeGreaterThan(2);
      expect(events.filter((e) => e.type === "goal")).toHaveLength(a + b);
      expect(events.at(-1)).toEqual({ type: "over", winner: table.match.winner });
      if (Math.max(a, b) < 7) expect(now).toBeGreaterThanOrEqual(MATCH_MS);
    }
  });

  it("plays paddles to a result", () => {
    const { table } = botMatch("kiosk", "paddles", "paddles");
    const [a, b] = scoreOf(table.match);
    expect(table.match.phase).toBe("over");
    expect(a + b).toBeGreaterThan(2);
  });

  it("is deterministic for a seed", () => {
    const run = () => {
      const { table } = botMatch("pair", "hockey", "same", 20_000);
      return `${snapshot(table)} ${scoreOf(table.match).join("-")}`;
    };
    expect(run()).toBe(run());
  });

  it("brings a scored puck back on the side that let it in", () => {
    const layout = layoutFor(layoutInput("kiosk"));
    const table = createTable(layout.tables[0]!, config({ pucks: 1 }), createRng("respawn"));
    table.countdown(0, "m", 0);
    table.play(0);
    const lane = table.lanes[0]!;
    const puck = lane.pucks[0]!;
    // Send the puck into side 0's goal (the left end).
    puck.x = 10;
    puck.y = lane.spec.params.width / 2;
    puck.vx = -2000;
    puck.vy = 0;
    let now = 0;
    for (let i = 0; i < 12; i++, now += DT * 1000) table.step(DT, now);
    expect(scoreOf(table.match)).toEqual([0, 1]);
    expect(puck.live).toBe(false);
    for (; now < RESPAWN_MS + 50; now += DT * 1000) table.step(DT, now);
    expect(puck.live).toBe(true);
    expect(puck.x).toBeLessThan(lane.spec.params.length / 2);
  });

  it("serves only its own pucks in versus and brings in arrivals", () => {
    const layout = layoutFor(layoutInput("wall", { versus: true, side: 1 }));
    const table = createTable(layout.tables[0]!, config({ pucks: 3 }), createRng("v"), {
      versus: { side: 1 },
    });
    table.countdown(0, "abc", 0);
    table.play(0);
    const lane = table.lanes[0]!;
    const live = lane.pucks.filter((p) => p.live).map((p) => p.id);
    expect(live.length).toBeGreaterThan(0);
    expect(live.length).toBeLessThan(3);
    const missing = lane.pucks.find((p) => !p.live)!;
    table.arrive(lane, { id: missing.id, y: 300, vx: -900, vy: 0, spin: 0, sent: 0, at: 500 });
    expect(table.owned()).toContain(missing.id);
    let now = 0;
    for (; now < 400; now += DT * 1000) table.step(DT, now);
    expect(missing.live).toBe(false);
    for (; now < 600; now += DT * 1000) table.step(DT, now);
    expect(missing.live).toBe(true);
    expect(missing.vx).toBeLessThan(0);
  });
});
