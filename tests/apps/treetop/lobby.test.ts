import { describe, expect, it } from "vitest";
import { COUNTDOWN_MS } from "../../../src/apps/treetop/config";
import {
  attractHeat,
  type Heat,
  type HeatInput,
  heatOrder,
  LOBBY_EXTRA_MS,
  LOBBY_MAX_MS,
  LOBBY_MS,
  stepHeat,
} from "../../../src/apps/treetop/lobby";
import { planFor } from "../../../src/apps/treetop/plan";

const T0 = 1_792_000_000_000;
const RACE_MS = 45_000;

const input = (now: number, joined: number[], done = false): HeatInput => ({
  now,
  joined: new Set(joined),
  done: () => done,
  raceMs: RACE_MS,
  attractK: 77,
});

/** Step `h` every 100 ms from `from` to `to` with the same joined lanes. */
const run = (h: Heat, from: number, to: number, joined: number[], done = false): Heat => {
  for (let t = from; t <= to; t += 100) h = stepHeat(h, input(t, joined, done));
  return h;
};

describe("bank lobby", () => {
  it("stays in attract until someone joins", () => {
    const h = attractHeat(0, T0);
    expect(stepHeat(h, input(T0 + 5000, []))).toBe(h);
    const lobby = stepHeat(h, input(T0 + 5000, [4]));
    expect(lobby).toMatchObject({ phase: "lobby", k: 77, lanes: [4], until: T0 + 5000 + LOBBY_MS });
  });

  it("opens for 6 s, adds 3 s per joiner and never runs past 12 s", () => {
    let h = stepHeat(attractHeat(0, T0), input(T0, [0]));
    expect(h.until - T0).toBe(LOBBY_MS);
    h = stepHeat(h, input(T0 + 1000, [0, 4]));
    expect(h.until - T0).toBe(LOBBY_MS + LOBBY_EXTRA_MS);
    expect(h.lanes).toEqual([0, 4]);
    h = stepHeat(h, input(T0 + 2000, [0, 4, 8]));
    expect(h.until - T0).toBe(LOBBY_MAX_MS);
    h = stepHeat(h, input(T0 + 3000, [0, 4, 8, 12]));
    expect(h.until - T0).toBe(LOBBY_MAX_MS);
    // Leaving and coming back doesn't buy more time.
    h = stepHeat(h, input(T0 + 4000, [0, 8, 12]));
    h = stepHeat(h, input(T0 + 4100, [0, 4, 8, 12]));
    expect(h.until - T0).toBe(LOBBY_MAX_MS);
    expect(stepHeat(h, input(T0 + LOBBY_MAX_MS - 1, [0]))).toBe(h);
  });

  it("counts two lanes joining at once as an opener and a joiner", () => {
    const h = stepHeat(attractHeat(0, T0), input(T0, [0, 4]));
    expect(h.until - T0).toBe(LOBBY_MS + LOBBY_EXTRA_MS);
  });

  it("counts down with a new race number, then races only the lanes joined at the start", () => {
    let h = stepHeat(attractHeat(0, T0), input(T0, [0]));
    h = run(h, T0, T0 + LOBBY_MS, [0, 8]);
    expect(h.phase).toBe("lobby");
    h = run(h, T0 + LOBBY_MS, T0 + LOBBY_MS + LOBBY_EXTRA_MS, [0, 8]);
    expect(h.phase).toBe("countdown");
    expect(h.k).toBe(Math.floor((T0 + LOBBY_MS + LOBBY_EXTRA_MS) / 1000));
    const start = h.until;
    expect(start - h.since).toBe(COUNTDOWN_MS);
    h = run(h, h.since + 100, start - 100, [0, 8, 12]);
    expect(h.lanes).toEqual([0, 8, 12]);
    h = stepHeat(h, input(start, [0, 12]));
    expect(h).toMatchObject({
      phase: "racing",
      since: start,
      until: start + RACE_MS,
      lanes: [0, 12],
    });
    // A later joiner doesn't change who is racing.
    expect(stepHeat(h, input(start + 1000, [0, 4, 12]))).toBe(h);
  });

  it("ends a race early once every racer is done and opens the next lobby at once", () => {
    let h: Heat = {
      k: 5000,
      phase: "racing",
      since: T0,
      until: T0 + RACE_MS,
      opened: T0 - 20_000,
      lanes: [0, 4],
    };
    h = stepHeat(h, input(T0 + 9000, [0, 4], false));
    expect(h.phase).toBe("racing");
    h = stepHeat(h, input(T0 + 9100, [0, 4], true));
    expect(h).toMatchObject({ phase: "lobby", k: 5000, lanes: [0, 4], since: T0 + 9100 });
    expect(h.until - h.since).toBe(LOBBY_MS);
    // Everyone stayed, so the next race follows without anyone touching the lobby.
    h = run(h, T0 + 9200, h.until, [0, 4]);
    expect(h).toMatchObject({ phase: "countdown", lanes: [0, 4] });
    expect(h.k).toBeGreaterThan(5000);
  });

  it("ends a race at its time limit", () => {
    const h: Heat = {
      k: 9,
      phase: "racing",
      since: T0,
      until: T0 + RACE_MS,
      opened: 0,
      lanes: [0],
    };
    expect(stepHeat(h, input(T0 + RACE_MS - 1, [0])).phase).toBe("racing");
    expect(stepHeat(h, input(T0 + RACE_MS, [0])).phase).toBe("lobby");
  });

  it("goes back to attract when a lobby ends with nobody in it", () => {
    const end: Heat = {
      k: 9,
      phase: "racing",
      since: T0,
      until: T0 + RACE_MS,
      opened: 0,
      lanes: [0],
    };
    let h = stepHeat(end, input(T0 + RACE_MS, []));
    expect(h).toMatchObject({ phase: "lobby", lanes: [] });
    // Someone arriving during the results gets a full lobby of their own.
    const late = stepHeat(h, input(h.since + 5000, [4]));
    expect(late.until).toBe(h.since + 5000 + LOBBY_MS);
    h = run(h, h.since, h.until, []);
    expect(h.phase).toBe("attract");
  });

  it("orders views of the same bank so a new leader picks the newest", () => {
    const lobby: Heat = { k: 9, phase: "lobby", since: 0, until: 1, opened: 0, lanes: [] };
    const racing: Heat = { ...lobby, k: 10, phase: "racing" };
    const countdown: Heat = { ...lobby, k: 10, phase: "countdown" };
    expect(heatOrder(racing)).toBeGreaterThan(heatOrder(countdown));
    expect(heatOrder(countdown)).toBeGreaterThan(heatOrder(lobby));
  });
});

describe("frame plans", () => {
  const cfg = { race: 45 };

  it("follows the clock's cadence alone and in attract", () => {
    const base = { now: T0, cfg, solo: false, heat: null, current: null };
    expect(planFor({ ...base, lone: true, joined: true }).play).toBe("lone");
    expect(planFor({ ...base, lone: false, joined: false }).play).toBe("attract");
  });

  it("waits in a lobby of its own when it joins before the leader has opened one", () => {
    const p = planFor({
      now: T0,
      cfg,
      solo: false,
      lone: false,
      heat: attractHeat(0, T0),
      joined: true,
      current: { k: 3, label: "race-3" },
    });
    expect(p).toMatchObject({ play: "bank", phase: "lobby", k: 3, label: "race-3" });
  });

  it("follows the heat: lobby, countdown, racing, then results until the leader says", () => {
    const at = (heat: Heat, now: number) =>
      planFor({ now, cfg, solo: false, lone: false, heat, joined: true, current: null });
    const lobby: Heat = {
      k: 20,
      phase: "lobby",
      since: T0,
      until: T0 + 6000,
      opened: T0,
      lanes: [0],
    };
    expect(at(lobby, T0)).toMatchObject({ phase: "lobby", next: T0 + 6000 + COUNTDOWN_MS });
    const cd: Heat = { ...lobby, k: 21, phase: "countdown", since: T0, until: T0 + 5000 };
    expect(at(cd, T0 + 1000)).toMatchObject({ phase: "countdown", start: T0 + 5000, k: 21 });
    // The clock says racing before the leader's word arrives.
    expect(at(cd, T0 + 5000).phase).toBe("racing");
    const race: Heat = { ...cd, phase: "racing", since: T0 + 5000, until: T0 + 50_000 };
    const p = at(race, T0 + 6000);
    expect(p.phase).toBe("racing");
    expect([...(p.racers ?? [])]).toEqual([0]);
    expect(at(race, T0 + 50_000).phase).toBe("results");
  });
});
