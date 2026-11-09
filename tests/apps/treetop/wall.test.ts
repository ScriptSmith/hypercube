import { describe, expect, it } from "vitest";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import { type Variant } from "../../../src/apps/treetop/config";
import { createGame, type Game } from "../../../src/apps/treetop/game";
import { createHost } from "../../../src/apps/treetop/host";
import { timerSpot } from "../../../src/apps/treetop/lanes";
import { laneAt, WALL_KEEP, wallLayout } from "../../../src/apps/treetop/layout";
import { createLocalBus } from "../../../src/apps/treetop/localbus";
import { LOBBY_MS } from "../../../src/apps/treetop/lobby";
import { stripOf } from "../../../src/apps/treetop/overview";
import { createPilot, type Pilot, SKILLS } from "../../../src/apps/treetop/pilot";
import { spreadColumns, wallColumns, wallTimer } from "../../../src/apps/treetop/wall";
import { laneId } from "../../../src/apps/treetop/wire";
import { createRng } from "../../../src/core/rng";
import { config } from "./helpers";

const WALL = VENUE_SIZE.wall;
const W = WALL.width;
const H = WALL.height;
const REACH = DEFAULT_REACH.wall;
/** A lane's width with six across the wall. */
const LANE = W / 6;

describe("wall layout", () => {
  it("stands six lanes side by side from the floor to adult reach", () => {
    const L = wallLayout(WALL, "race", 6, REACH);
    expect(L.lanes).toHaveLength(6);
    expect(L.laneTop).toBe(H - Math.round(REACH.adult * H));
    for (const [i, l] of L.lanes.entries()) {
      expect(l.column).toBe(i);
      expect(l.slot).toBe(0);
      expect(l.rect).toEqual({ x: i * LANE, y: L.laneTop, width: LANE, height: H - L.laneTop });
      expect(l.scale).toBeCloseTo(l.rect.height / 1920);
    }
    // Nothing that flaps is above reach, and the race shows up there instead.
    expect(L.band.bottom).toBe(L.laneTop);
    expect(L.packH).toBe(L.band.top);
    expect(L.band.bottom - L.band.top).toBeGreaterThanOrEqual(200);
    expect(L.packH).toBeGreaterThan(900);
  });

  it("keeps a strip either side of each join that doesn't flap, and the outer edges whole", () => {
    const L = wallLayout(WALL, "race", 6, REACH);
    const [first, second] = L.lanes;
    expect(first!.touch.x).toBe(0);
    expect(first!.touch.x + first!.touch.width).toBe(LANE - WALL_KEEP);
    expect(second!.touch.x).toBe(LANE + WALL_KEEP);
    expect(L.lanes.at(-1)!.touch.x + L.lanes.at(-1)!.touch.width).toBe(W);
    const y = H - 100;
    expect(laneAt(L.lanes, LANE - WALL_KEEP / 2, y)).toBe(null);
    expect(laneAt(L.lanes, LANE + WALL_KEEP / 2, y)).toBe(null);
    expect(laneAt(L.lanes, LANE * 1.4, y)?.column).toBe(1);
    expect(laneAt(L.lanes, LANE * 1.4, L.laneTop - 10)).toBe(null);
  });

  it("makes four wider lanes", () => {
    const L = wallLayout(WALL, "race", 4, REACH);
    expect(L.lanes.map((l) => l.rect.width)).toEqual([W / 4, W / 4, W / 4, W / 4]);
  });

  it("puts a child lane inside child reach under an adult lane in pads", () => {
    const L = wallLayout(WALL, "pads", 6, REACH);
    expect(L.lanes).toHaveLength(12);
    for (let col = 0; col < 6; col++) {
      const [child, adult] = L.lanes.filter((l) => l.column === col);
      expect(child).toMatchObject({ slot: 0, pad: "child", adult: false });
      expect(adult).toMatchObject({ slot: 1, pad: "adult", adult: true });
      expect(child!.rect.y + child!.rect.height).toBe(H);
      expect(child!.rect.y).toBeGreaterThanOrEqual(H * (1 - REACH.child) - 1);
      expect(adult!.rect.y).toBe(L.laneTop);
      expect(adult!.rect.y + adult!.rect.height).toBe(child!.rect.y);
    }
  });

  it("follows the operator's reach, within limits", () => {
    const low = wallLayout(WALL, "race", 6, { adult: 0.3, child: 0.2 });
    expect(low.laneTop).toBe(H - Math.round(0.3 * H));
    // A wall within reach to the top still leaves room for the race above.
    const high = wallLayout(WALL, "race", 6, { adult: 1, child: 0.5 });
    expect(high.laneTop).toBe(H - Math.round(0.6 * H));
    expect(high.packH).toBeGreaterThan(0.27 * H);
    // Tiny reach still gives lanes worth playing in.
    const tiny = wallLayout(WALL, "pads", 6, { adult: 0.1, child: 0.02 });
    expect(H - tiny.laneTop).toBe(Math.round(0.3 * H));
    const child = tiny.lanes[0]!;
    expect(child.rect.height).toBeGreaterThanOrEqual(Math.round(0.35 * 0.3 * H) - 1);
  });

  it("reads the lanes option as 4 or 6", () => {
    expect(wallColumns({ lanes: 4 })).toBe(4);
    expect(wallColumns({ lanes: 6 })).toBe(6);
    expect(wallColumns({})).toBe(6);
    expect(wallColumns({ lanes: 5 })).toBe(6);
  });
});

describe("wall lanes", () => {
  /** The platform's idle hint: a pad in the middle of the lane, as stations/view.ts draws it. */
  const hintTop = (h: number) => h / 2 - Math.min(320, h * 0.4) / 2;

  for (const variant of ["race", "pads"] as Variant[]) {
    it(`keeps the timer and its label above the tap hint in ${variant}`, () => {
      for (const reach of [REACH, { adult: 0.3, child: 0.15 }, { adult: 0.6, child: 0.3 }]) {
        for (const lane of wallLayout(WALL, variant, 6, reach).lanes) {
          const t = wallTimer(lane);
          const top = lane.rect.y + hintTop(lane.rect.height);
          expect(t.y + t.r + 17).toBeLessThan(top);
          if (lane.rect.height >= 900) expect(t.labelY + 31).toBeLessThan(top);
          expect(t.y - t.r).toBeGreaterThan(lane.rect.y);
        }
      }
    });
  }

  it("leaves a panel's timer where it was", () => {
    const spec = {
      slot: 0,
      rect: { x: 0, y: 0, width: 1080, height: 1920 },
      touch: { x: 0, y: 0, width: 1080, height: 1920 },
      dim: [],
      scale: 1,
      adult: false,
      pad: null,
      column: 0,
    };
    const t = timerSpot(spec);
    expect(t.x).toBe(540);
    expect(t.y).toBeCloseTo(1920 * 0.24);
    expect(t.r).toBeCloseTo(1080 * 0.11);
    expect(t.labelY).toBeCloseTo(t.y + t.r + 70);
  });

  it("puts the adult lane's strip above the child's", () => {
    const L = wallLayout(WALL, "pads", 6, REACH);
    const view = (i: number) => ({ spec: L.lanes[i]! }) as Parameters<typeof stripOf>[1];
    const child = stripOf(L, view(0), 2);
    const adult = stripOf(L, view(1), 2);
    expect(adult.top).toBe(L.band.top);
    expect(child.top).toBeGreaterThan(adult.mid);
    expect(child.top + child.rowH).toBeCloseTo(L.band.bottom);
    for (const s of [child, adult]) {
      expect(s.x0).toBeGreaterThan(s.numX);
      expect(s.x1).toBeGreaterThan(s.x0 + 400);
    }
  });

  it("spreads test bots along the wall", () => {
    expect(spreadColumns(1, 6)[0]).toBe(3);
    expect(spreadColumns(2, 6).slice(0, 2)).toEqual([1, 4]);
    expect(spreadColumns(3, 6).slice(0, 3)).toEqual([1, 3, 5]);
    expect(spreadColumns(2, 4).slice(0, 2)).toEqual([1, 3]);
    for (const bots of [0, 1, 2, 5, 6, 9]) {
      expect([...spreadColumns(bots, 6)].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });
});

describe("in-frame bus", () => {
  it("makes the screen member the leader and delivers to one member or all the others", () => {
    const bus = createLocalBus("treetop");
    const a = bus.join("a", "station", 0);
    const host = bus.join("host", "screen", 0);
    const b = bus.join("b", "station", 1);
    for (const ch of [a, host, b]) expect(ch.leader()).toBe("host");
    const got: string[] = [];
    for (const [name, ch] of [
      ["a", a],
      ["host", host],
      ["b", b],
    ] as const) {
      ch.on("t", (data, from) => got.push(`${name}<${from}:${String(data)}`));
    }
    a.send("t", 1, "host");
    host.send("t", 2);
    expect(got).toEqual(["host<a:1", "a<host:2", "b<host:2"]);
    bus.dispose();
    a.send("t", 3);
    expect(got).toHaveLength(3);
  });
});

const HZ = 120;
const T0 = 1_792_000_000_000;

/** A wall's races without the drawing: the host and one game per column on the in-frame bus. */
const createWallRace = (columns: number, variant: Variant = "race", over = {}) => {
  const bus = createLocalBus("treetop");
  const cfg = config({ race: 30, ...over }, variant);
  let now = T0;
  const clock = () => now;
  const host = createHost({
    net: bus.join("wall-race", "screen", 0),
    now: clock,
    local: clock,
    cfg,
  });
  const games: Game[] = Array.from({ length: columns }, (_, pos) => {
    const game: Game = createGame({
      net: bus.join(`wall-${pos}`, "station", pos),
      now: clock,
      local: clock,
      cfg,
      solo: false,
      pos,
      count: columns,
      rng: (label) => createRng(`wall-test:${label ?? "seed"}`),
      useGhost: () => false,
      endStation: (slot) => game.leave(slot),
    });
    const lanes = wallLayout(WALL, variant, columns, REACH).lanes.filter((l) => l.column === pos);
    game.setLanes(lanes.map((l) => ({ slot: l.slot, adult: l.adult })));
    return game;
  });
  const people: { game: Game; slot: number; pilot: Pilot; tapping: boolean }[] = [];
  const step = () => {
    now += 1000 / HZ;
    host.tick();
    for (const g of games) g.update(1 / HZ);
    for (const p of people) {
      const l = p.game.lanes.find((x) => x.slot === p.slot);
      const course = p.game.course;
      if (!p.tapping || !l?.joined || !course || l.flight.mode !== "flying") continue;
      if (p.pilot.step(l.flight, course, l.body, 1 / HZ)) p.game.tap(p.slot);
    }
  };
  return {
    host,
    games,
    run(ms: number) {
      const end = now + ms;
      while (now < end) step();
    },
    until(cond: () => boolean, ms = 120_000) {
      const end = now + ms;
      while (!cond()) {
        if (now >= end) throw new Error(`timed out after ${ms} ms`);
        step();
      }
    },
    person(pos: number, slot = 0) {
      const game = games[pos]!;
      game.join(slot, false);
      const p = { game, slot, pilot: createPilot(createRng(`person-${pos}`), SKILLS.steady) };
      people.push({ ...p, tapping: true });
      return people.at(-1)!;
    },
    get now() {
      return now;
    },
  };
};

describe("a wall race", { timeout: 60_000 }, () => {
  it("flies attract bots in every lane until someone touches, then races only those who joined", () => {
    const wall = createWallRace(6);
    wall.until(() => wall.games.every((g) => g.phase === "racing"));
    wall.run(1000);
    for (const g of wall.games) {
      expect(g.plan.play).toBe("attract");
      expect(g.lanes[0]).toMatchObject({ ctrl: "attract" });
      expect(g.lanes[0]!.flight.mode).not.toBe("waiting");
    }
    expect(wall.host.heats.leading).toBe(true);
    wall.person(1);
    wall.run(500);
    wall.person(4);
    wall.until(() => wall.host.heats.heat?.phase === "lobby", 2000);
    // Every column follows the wall's lobby at once, and the bots have gone.
    wall.run(100);
    for (const [pos, g] of wall.games.entries()) {
      expect(g.plan.play).toBe("bank");
      expect(g.shows(g.lanes[0]!)).toBe(pos === 1 || pos === 4);
    }
    wall.until(() => wall.host.heats.heat?.phase === "racing", 20_000);
    expect(wall.host.heats.heat!.lanes).toEqual([laneId(1, 0), laneId(4, 0)]);
    wall.run(3000);
    for (const [pos, g] of wall.games.entries()) {
      const l = g.lanes[0]!;
      if (pos === 1 || pos === 4) {
        expect(l.racer).toBe(true);
        expect(l.flight.mode).not.toBe("waiting");
      } else {
        expect(g.shows(l)).toBe(false);
        expect(l.flight.mode).toBe("waiting");
      }
    }
    // Every column built the same course.
    expect(new Set(wall.games.map((g) => g.course!.hash)).size).toBe(1);
    wall.until(() => wall.host.heats.heat?.phase === "lobby", 40_000);
    const places = wall.host.board.places!;
    expect([...places.keys()].sort((a, b) => a - b)).toEqual([laneId(1, 0), laneId(4, 0)]);
    for (const g of wall.games) expect(g.board.places).toEqual(places);
  });

  it("lets a late joiner practise, then race the next one", () => {
    const wall = createWallRace(4, "race", { crash: "out" });
    wall.person(0);
    wall.until(() => wall.host.heats.heat?.phase === "racing", 20_000);
    const first = wall.host.heats.heat!.k;
    wall.run(1000);
    wall.person(2);
    wall.run(100);
    expect(wall.games[2]!.lanes[0]).toMatchObject({ practice: true, racer: false });
    wall.until(() => {
      const h = wall.host.heats.heat!;
      return h.phase === "racing" && h.k !== first;
    }, 60_000);
    expect(wall.host.heats.heat!.lanes).toEqual([laneId(0, 0), laneId(2, 0)]);
    wall.run(100);
    expect(wall.games[2]!.lanes[0]).toMatchObject({ practice: false, racer: true });
  });

  it("races a child and an adult of one column in pads, and goes back to attract when they leave", () => {
    const wall = createWallRace(6, "pads");
    const child = wall.person(2, 0);
    const adult = wall.person(2, 1);
    wall.until(() => wall.host.heats.heat?.phase === "racing", 20_000);
    expect(wall.host.heats.heat!.lanes).toEqual([laneId(2, 0), laneId(2, 1)]);
    const g = wall.games[2]!;
    expect(g.lanes.map((l) => l.adult)).toEqual([false, true]);
    // They stop tapping, so they give their lanes back, and attract comes back.
    child.tapping = false;
    adult.tapping = false;
    wall.until(() => wall.host.heats.heat?.phase === "attract", 60_000 + LOBBY_MS);
    wall.run(500);
    for (const game of wall.games) expect(game.plan.play).toBe("attract");
  });
});
