import { describe, expect, it } from "vitest";
import { type Board, type BoardPhase, createBoard } from "../../../src/apps/treetop/board";
import type { Mode } from "../../../src/apps/treetop/flight";
import { type Fly, laneId } from "../../../src/apps/treetop/wire";
import { createBus } from "./helpers";

const K = 1000;
const RACING: BoardPhase = "racing";
const RESULTS: BoardPhase = "results";

const report = (pos: number, lanes: [number, Mode, number | null][], k = K): Fly => ({
  k,
  pos,
  count: 3,
  n: 1,
  t: 0,
  lanes: lanes.map(([d, mode, fin], slot) => ({
    slot,
    d,
    h: 900,
    mode,
    flap: false,
    ctrl: "human",
    adult: false,
    gates: 0,
    fin,
  })),
});

const setup = (withScreen = true) => {
  const bus = createBus();
  let local = 0;
  const flies: string[] = [];
  const make = (frame: string, role: "screen" | "station", pos: number) =>
    createBoard({
      net: bus.join(frame, role, pos),
      local: () => local,
      onFly: (fly, from) => flies.push(`${from}:${fly.pos}`),
    });
  const screen = withScreen ? make("screen", "screen", 0) : null;
  const panels = [0, 1, 2].map((pos) => make(`p${pos}`, "station", pos));
  const all = [screen, ...panels].filter((b): b is Board => b !== null);
  for (const b of all) b.race(K);
  return {
    bus,
    screen,
    panels,
    all,
    flies,
    advance(ms: number, phase: BoardPhase) {
      local += ms;
      for (const b of all) b.tick(phase, true);
    },
  };
};

describe("race board", () => {
  it("sends each panel's lanes to the screen, which leads", () => {
    const { screen, panels, flies } = setup();
    expect(screen!.leader()).toBe(true);
    expect(panels.some((p) => p.leader())).toBe(false);
    panels[1]!.own(report(1, [[500, "flying", null]]));
    expect(flies).toEqual(["p1:1"]);
    expect(screen!.lanes.get(laneId(1, 0))?.d).toBe(500);
  });

  it("shares the pack twice a second so every panel knows the field", () => {
    const { panels, advance } = setup();
    panels.forEach((p, pos) => p.own(report(pos, [[1000 * (pos + 1), "flying", null]])));
    advance(600, RACING);
    for (const p of panels)
      expect(
        p
          .live()
          .map((l) => l.id)
          .sort((a, b) => a - b),
      ).toEqual([0, 4, 8]);
    expect(panels[0]!.place(laneId(0, 0))).toBe(3);
    expect(panels[0]!.place(laneId(2, 0))).toBe(1);
  });

  it("works out placings at the end of the race and everyone gets the same ones", () => {
    const { screen, panels, advance } = setup();
    panels[0]!.own(report(0, [[16_200, "finished", 36_000]]));
    panels[1]!.own(report(1, [[9000, "flying", null]]));
    panels[2]!.own(report(2, [[16_200, "finished", 35_500]]));
    advance(100, RACING);
    expect(screen!.places).toBe(null);
    advance(100, RESULTS);
    for (const b of [screen!, ...panels]) {
      expect(b.ended).toBe(true);
      expect([...b.places!.entries()].sort((a, b) => a[0] - b[0])).toEqual([
        [0, 2],
        [4, 3],
        [8, 1],
      ]);
    }
  });

  it("ends the race early once nobody is flying", () => {
    const { screen, panels, advance } = setup();
    panels[0]!.own(report(0, [[3000, "out", null]]));
    panels[1]!.own(report(1, [[5000, "flying", null]]));
    advance(100, RACING);
    expect(screen!.ended).toBe(false);
    panels[1]!.own(report(1, [[5200, "out", null]]));
    advance(100, RACING);
    expect(screen!.ended).toBe(true);
    expect(panels[0]!.places?.get(laneId(1, 0))).toBe(1);
  });

  it("takes a finish sent once, even before the next report", () => {
    const { screen, panels } = setup();
    panels[2]!.own(report(2, [[16_100, "flying", null]]));
    panels[2]!.finished(laneId(2, 0), 34_900);
    expect(screen!.lanes.get(laneId(2, 0))?.fin).toBe(34_900);
  });

  it("ranks a lane that joins mid-race by distance", () => {
    const { screen, panels, advance } = setup();
    panels[0]!.own(report(0, [[12_000, "flying", null]]));
    panels[1]!.own(report(1, [[11_000, "flying", null]]));
    advance(100, RACING);
    panels[2]!.own(report(2, [[2000, "flying", null]]));
    advance(100, RESULTS);
    expect(screen!.places?.get(laneId(2, 0))).toBe(3);
  });

  it("gives no place to a lane that never left the start line", () => {
    const { screen, panels, advance } = setup();
    panels[0]!.own(report(0, [[0, "waiting", null]]));
    panels[1]!.own(report(1, [[4000, "flying", null]]));
    advance(100, RESULTS);
    expect(screen!.places?.get(laneId(0, 0))).toBeUndefined();
    expect(screen!.places?.get(laneId(1, 0))).toBe(1);
    expect(panels[0]!.place(laneId(0, 0))).toBe(null);
  });

  it("ignores reports for another race", () => {
    const { screen, panels } = setup();
    panels[0]!.own(report(0, [[100, "flying", null]], K - 1));
    expect(screen!.lanes.size).toBe(0);
  });

  it("hands the lead to the lowest panel when the screen goes, and keeps racing", () => {
    const { bus, panels, advance } = setup();
    panels.forEach((p, pos) => p.own(report(pos, [[1000 + pos, "flying", null]])));
    advance(600, RACING);
    bus.leave("screen");
    expect(panels[0]!.leader()).toBe(true);
    panels[1]!.own(report(1, [[16_200, "finished", 30_000]]));
    panels[2]!.own(report(2, [[8000, "flying", null]]));
    panels[0]!.own(report(0, [[9000, "flying", null]]));
    advance(100, RESULTS);
    for (const p of panels) expect(p.places?.get(laneId(1, 0))).toBe(1);
    expect(panels[1]!.places?.get(laneId(0, 0))).toBe(2);
  });

  it("lets a lane nobody hears from fade, then forgets it", () => {
    const { screen, panels, advance } = setup();
    panels[0]!.own(report(0, [[500, "flying", null]]));
    advance(2500, RACING);
    expect(screen!.live()).toEqual([]);
    expect(screen!.lanes.size).toBe(1);
    advance(10_000, RACING);
    expect(screen!.lanes.size).toBe(0);
  });

  it("works with no screen and no peers: a lone frame leads itself", () => {
    const bus = createBus();
    const solo = createBoard({ net: bus.join("only", "station", 0), local: () => 0 });
    solo.race(K);
    expect(solo.leader()).toBe(true);
    solo.own(report(0, [[400, "flying", null]]));
    solo.tick(RESULTS, true);
    expect(solo.places?.get(0)).toBe(1);
    expect(bus.sent.filter((m) => m.topic === "fly")).toEqual([]);
  });
});
