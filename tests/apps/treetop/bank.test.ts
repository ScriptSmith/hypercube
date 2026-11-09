import { describe, expect, it } from "vitest";
import { createGame, type Game } from "../../../src/apps/treetop/game";
import { createHost, type Host } from "../../../src/apps/treetop/host";
import { LOBBY_MS } from "../../../src/apps/treetop/lobby";
import { createPilot, type Pilot, SKILLS } from "../../../src/apps/treetop/pilot";
import { laneId } from "../../../src/apps/treetop/wire";
import { createRng } from "../../../src/core/rng";
import { config, createBus } from "./helpers";

const HZ = 120;
const T0 = 1_792_000_000_000;

interface Person {
  game: Game;
  slot: number;
  pilot: Pilot;
  tapping: boolean;
}

/**
 * A bank on the in-memory bus, stepped on one fake clock: an optional screen (the host) and a
 * row of single-lane panels. People are pilots that tap through `game.tap`, like a finger.
 */
const createBank = (
  panels: number,
  screen: boolean,
  over: Record<string, string | number> = {},
) => {
  const bus = createBus();
  const cfg = config({ race: 30, ...over });
  let now = T0;
  const clock = () => now;
  const hosts: Host[] = [];
  const addScreen = () => {
    const host = createHost({
      net: bus.join("screen", "screen", 0),
      now: clock,
      local: clock,
      cfg,
    });
    hosts.push(host);
    return host;
  };
  if (screen) addScreen();
  const games = Array.from({ length: panels }, (_, pos) => {
    const net = bus.join(`p${pos}`, "station", pos);
    const game: Game = createGame({
      net,
      now: clock,
      local: clock,
      cfg,
      solo: false,
      pos,
      count: panels,
      rng: (label) => createRng(`flap-test:${label ?? "seed"}`),
      useGhost: () => false,
      endStation: (slot) => game.leave(slot),
    });
    game.setLanes([{ slot: 0, adult: false }]);
    return game;
  });
  const gone = new Set<Game>();
  const people: Person[] = [];
  const step = () => {
    now += 1000 / HZ;
    for (const h of hosts) h.tick();
    for (const g of games) if (!gone.has(g)) g.update(1 / HZ);
    for (const p of people) {
      const l = p.game.lanes[p.slot];
      const course = p.game.course;
      if (!p.tapping || !l?.joined || !course || l.flight.mode !== "flying") continue;
      if (p.pilot.step(l.flight, course, l.body, 1 / HZ)) p.game.tap(p.slot);
    }
  };
  const bank = {
    bus,
    cfg,
    games,
    hosts,
    get now() {
      return now;
    },
    addScreen,
    run(ms: number) {
      const end = now + ms;
      while (now < end) step();
    },
    /** Run until `cond` holds, failing after `ms`. */
    until(cond: () => boolean, ms = 120_000) {
      const end = now + ms;
      while (!cond()) {
        if (now >= end) throw new Error(`timed out after ${ms} ms`);
        step();
      }
    },
    person(pos: number, tapping = true): Person {
      const game = games[pos]!;
      game.join(0, false);
      const p = {
        game,
        slot: 0,
        pilot: createPilot(createRng(`person-${pos}`), SKILLS.steady),
        tapping,
      };
      people.push(p);
      return p;
    },
    bot(pos: number) {
      games[pos]!.join(0, true);
    },
    remove(frame: string, game?: Game) {
      bus.leave(frame);
      if (game) gone.add(game);
      if (frame === "screen") hosts.length = 0;
    },
  };
  return bank;
};

const heatOf = (bank: ReturnType<typeof createBank>) => bank.hosts[0]?.heats.heat ?? null;
const lane = (pos: number) => laneId(pos, 0);

describe("flap bank races", { timeout: 60_000 }, () => {
  it("stays in attract with bots on every lane until someone joins, then the bots leave", () => {
    const bank = createBank(2, true);
    bank.until(() => bank.games.every((g) => g.phase === "racing"));
    bank.run(1000);
    for (const g of bank.games) {
      expect(g.plan.play).toBe("attract");
      expect(g.lanes[0]).toMatchObject({ ctrl: "attract", joined: false });
      expect(g.lanes[0]!.flight.mode).not.toBe("waiting");
      expect(g.shows(g.lanes[0]!)).toBe(true);
    }
    bank.person(0);
    bank.run(1000 / HZ);
    // The frame that was touched drops its bots at once...
    expect(bank.games[0]!.plan.play).toBe("bank");
    expect(bank.games[0]!.lanes[0]!.flight.mode).toBe("waiting");
    // ...and the rest as soon as the lobby opens.
    bank.run(300);
    expect(heatOf(bank)).toMatchObject({ phase: "lobby", lanes: [lane(0)] });
    const idle = bank.games[1]!;
    expect(idle.plan.play).toBe("bank");
    expect(idle.shows(idle.lanes[0]!)).toBe(false);
    expect(idle.lanes[0]!.flight.mode).toBe("waiting");
    expect(bank.hosts[0]!.plan.play).toBe("bank");
  });

  it("races only the lanes that joined and places only them", () => {
    const bank = createBank(4, true);
    bank.run(500);
    bank.bot(1);
    bank.run(200);
    bank.bot(3);
    bank.until(() => heatOf(bank)?.phase === "racing");
    expect(heatOf(bank)!.lanes).toEqual([lane(1), lane(3)]);
    bank.run(2000);
    for (const pos of [0, 2]) {
      const g = bank.games[pos]!;
      expect(g.shows(g.lanes[0]!)).toBe(false);
      expect(g.lanes[0]!.flight.mode).toBe("waiting");
    }
    for (const pos of [1, 3]) {
      const l = bank.games[pos]!.lanes[0]!;
      expect(l.racer).toBe(true);
      expect(l.flight.mode).not.toBe("waiting");
    }
    const screen = bank.hosts[0]!;
    expect([...screen.board.live()].map((l) => l.id).sort((a, b) => a - b)).toEqual([
      lane(1),
      lane(3),
    ]);
    bank.until(() => heatOf(bank)?.phase === "lobby");
    expect([...screen.board.places!.keys()].sort((a, b) => a - b)).toEqual([lane(1), lane(3)]);
    for (const g of bank.games) expect(g.board.places).toEqual(screen.board.places);
  });

  it("ends a race early once every racer is out, keeps players for the next race, and lets go of those who stop", () => {
    const bank = createBank(2, true, { crash: "out" });
    const a = bank.person(0);
    const b = bank.person(1);
    bank.until(() => heatOf(bank)?.phase === "racing");
    const first = heatOf(bank)!;
    // A couple of seconds of tapping, then they stop and fall.
    bank.run(2500);
    a.tapping = false;
    b.tapping = false;
    bank.until(() => heatOf(bank)?.phase === "lobby", 20_000);
    expect(bank.now).toBeLessThan(first.until - 15_000);
    expect(heatOf(bank)!.lanes).toEqual([lane(0), lane(1)]);
    expect(bank.hosts[0]!.board.places?.size).toBe(2);
    // They touched the last race, so they are still in: the next one follows by itself.
    bank.until(() => heatOf(bank)?.phase === "racing", LOBBY_MS + 6000);
    expect(heatOf(bank)!.k).toBeGreaterThan(first.k);
    expect(heatOf(bank)!.lanes).toEqual([lane(0), lane(1)]);
    // Nobody touches this one: it ends as soon as both are out, and they have gone.
    bank.until(() => heatOf(bank)?.phase === "lobby", 20_000);
    bank.run(200);
    expect(bank.games.map((g) => g.lanes[0]!.joined)).toEqual([false, false]);
    bank.until(() => heatOf(bank)?.phase === "attract", LOBBY_MS + 1000);
    bank.run(500);
    expect(bank.games.map((g) => g.plan.play)).toEqual(["attract", "attract"]);
  });

  it("ends a tumble race once every racer has finished", () => {
    const bank = createBank(2, true, { crash: "tumble" });
    bank.bot(0);
    bank.bot(1);
    bank.until(() => heatOf(bank)?.phase === "racing");
    const race = heatOf(bank)!;
    bank.until(() => heatOf(bank)?.phase === "lobby", 40_000);
    expect(bank.now).toBeLessThan(race.until);
    for (const g of bank.games) expect(g.lanes[0]!.flight.fin).not.toBe(null);
  });

  it("lets a mid-race joiner practise unranked, then race the next one", () => {
    const bank = createBank(2, true);
    bank.bot(0);
    bank.until(() => heatOf(bank)?.phase === "racing");
    bank.run(4000);
    const p = bank.person(1);
    bank.run(1000);
    const late = bank.games[1]!.lanes[0]!;
    expect(late).toMatchObject({ practice: true, racer: false, joined: true });
    expect(late.flight.mode).not.toBe("waiting");
    const screen = bank.hosts[0]!;
    expect(screen.board.lanes.has(lane(1))).toBe(false);
    expect(heatOf(bank)!.lanes).toEqual([lane(0)]);
    bank.until(() => heatOf(bank)?.phase === "lobby", 40_000);
    expect([...screen.board.places!.keys()]).toEqual([lane(0)]);
    bank.run(200);
    expect(late).toMatchObject({ practice: false, joined: true });
    expect(late.flight.mode).toBe("waiting");
    expect(heatOf(bank)!.lanes).toEqual([lane(0), lane(1)]);
    bank.until(() => heatOf(bank)?.phase === "racing", LOBBY_MS + 6000);
    expect(heatOf(bank)!.lanes).toEqual([lane(0), lane(1)]);
    bank.run(500);
    expect(late.racer).toBe(true);
    expect(p.game.board.k).toBe(heatOf(bank)!.k);
  });

  it("keeps racing when the leading panel goes, and the next leader opens the lobby", () => {
    const bank = createBank(3, false);
    for (const pos of [0, 1, 2]) bank.bot(pos);
    const heat = () => bank.games[1]!.heats!.heat;
    bank.until(() => heat()?.phase === "racing");
    expect(bank.games[0]!.heats!.leading).toBe(true);
    const race = heat()!;
    bank.run(5000);
    bank.remove("p0", bank.games[0]);
    bank.run(1000);
    expect(bank.games[1]!.heats!.leading).toBe(true);
    expect(heat()).toMatchObject({ k: race.k, phase: "racing", until: race.until });
    for (const pos of [1, 2]) expect(bank.games[pos]!.lanes[0]!.racer).toBe(true);
    // Panel 0's racer has gone, so the race ends once the other two are done.
    bank.until(() => heat()?.phase === "lobby", 40_000);
    expect(bank.now).toBeLessThan(race.until);
    expect([...bank.games[2]!.board.places!.keys()].sort((a, b) => a - b)).toEqual([
      lane(1),
      lane(2),
    ]);
    bank.until(() => heat()?.phase === "racing", LOBBY_MS + 6000);
    expect(heat()!.k).toBeGreaterThan(race.k);
    expect(bank.games[2]!.heats!.heat).toEqual(heat());
  });

  it("keeps racing when the screen goes mid-race", () => {
    const bank = createBank(2, true);
    bank.bot(0);
    bank.bot(1);
    bank.until(() => heatOf(bank)?.phase === "racing");
    const race = heatOf(bank)!;
    bank.run(3000);
    bank.remove("screen");
    bank.run(1500);
    const p0 = bank.games[0]!;
    expect(p0.heats!.leading).toBe(true);
    expect(p0.heats!.heat).toMatchObject({ k: race.k, phase: "racing" });
    expect(bank.games.every((g) => g.lanes[0]!.racer)).toBe(true);
    bank.until(() => p0.heats!.heat?.phase === "lobby", 40_000);
    expect(bank.games[1]!.board.places?.size).toBe(2);
  });

  it("picks up a race in flight when a screen arrives mid-race", () => {
    const bank = createBank(2, false);
    bank.bot(0);
    bank.bot(1);
    const heat = () => bank.games[1]!.heats!.heat;
    bank.until(() => heat()?.phase === "racing");
    const race = heat()!;
    bank.run(4000);
    const screen = bank.addScreen();
    bank.run(2500);
    expect(screen.heats.leading).toBe(true);
    expect(screen.heats.heat).toMatchObject({ k: race.k, phase: "racing", until: race.until });
    expect(screen.heats.heat!.lanes).toEqual([lane(0), lane(1)]);
    expect(heat()).toMatchObject({ k: race.k, phase: "racing" });
    expect(
      bank.games.every((g) => g.lanes[0]!.racer && g.lanes[0]!.flight.mode !== "waiting"),
    ).toBe(true);
    bank.until(() => screen.heats.heat?.phase === "lobby", 40_000);
    expect(screen.board.places?.size).toBe(2);
  });

  it("races alone with rivals once a panel has no peers left", () => {
    const bank = createBank(2, false);
    bank.bot(0);
    bank.bot(1);
    bank.until(() => bank.games[0]!.heats!.heat?.phase === "racing");
    bank.run(2000);
    bank.remove("p1", bank.games[1]);
    bank.run(500);
    // The race in flight is finished first.
    const p0 = bank.games[0]!;
    expect(p0.plan.play).toBe("bank");
    expect(p0.rivals).toHaveLength(0);
    bank.until(() => p0.plan.play === "lone", 40_000);
    expect(p0.rivals).toHaveLength(2);
    expect(p0.lanes[0]!.joined).toBe(true);
  });
});
