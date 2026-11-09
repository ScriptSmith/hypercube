import { describe, expect, it } from "vitest";
import {
  BOT_LOBBY_MS,
  COUNTDOWN_MS,
  HZ,
  INTERRUPT_MS,
  LOBBY_EXTRA_MS,
  LOBBY_MAX_MS,
  LOBBY_MS,
  OVER_MS,
  SPEED_FACTOR,
} from "../../../src/apps/tangle/config";
import {
  attractLines,
  createMatch,
  DESERTED_MS,
  joinLobby,
  linesFor,
  type Match,
  openLobby,
  pickBotSlots,
  RECLAIM_MS,
  SETTLE_MS,
  type SeatKind,
  type Slot,
} from "../../../src/apps/tangle/match";
import { arenaParams } from "../../../src/apps/tangle/arena";
import { localSlots } from "../../../src/apps/tangle/slots";
import { createRng } from "../../../src/core/rng";
import { testConfig, wallArena } from "./helpers";

const STEP = 1000 / HZ;

const wallSlots = (n = 8): Slot[] =>
  localSlots(
    Array.from({ length: n }, (_, i) => (i + 0.5) / n),
    6400,
    0,
    6400,
    1800,
    arenaParams(6400, 1800),
  );

interface Rig {
  m: Match;
  seats: Map<number, SeatKind>;
  dirs: Map<number, number>;
  /** Grid presses waiting at each station. */
  presses: Map<number, number[]>;
  phases: string[];
  now: number;
  /** Advance by `ms` in fixed ticks. */
  advance(ms: number): void;
  /** Advance until `done` or `ms`. */
  until(done: () => boolean, ms: number): void;
}

const rig = (cfg = testConfig(), slots = wallSlots()): Rig => {
  const seats = new Map<number, SeatKind>();
  const dirs = new Map<number, number>();
  const presses = new Map<number, number[]>();
  const phases: string[] = [];
  const r: Rig = {
    m: null as never,
    seats,
    dirs,
    presses,
    phases,
    now: 0,
    advance(ms) {
      const end = r.now + ms;
      while (r.now < end) {
        r.now += STEP;
        r.m.tick(r.now);
      }
    },
    until(done, ms) {
      const end = r.now + ms;
      while (r.now < end && !done()) {
        r.now += STEP;
        r.m.tick(r.now);
      }
    },
  };
  r.m = createMatch({
    cfg,
    arena: wallArena({
      variant: cfg.variant,
      gaps: cfg.gaps,
      trail: cfg.trail,
      edges: cfg.edges,
    }),
    slots,
    rng: createRng("match"),
    now: 0,
    host: {
      seat: (k) => seats.get(k) ?? null,
      dir: (k) => dirs.get(k) ?? 0,
      press: (k) => presses.get(k)?.shift() ?? -1,
      changed: () => phases.push(r.m.phase),
    },
  });
  return r;
};

describe("lobby timing", () => {
  it("opens for 6 s, adds 3 s per joiner, and stops at 12 s", () => {
    let l = openLobby(1000);
    expect(l.until).toBe(1000 + LOBBY_MS);
    l = joinLobby(l);
    expect(l.until).toBe(1000 + LOBBY_MS + LOBBY_EXTRA_MS);
    l = joinLobby(l);
    expect(l.until).toBe(1000 + LOBBY_MAX_MS);
    l = joinLobby(l);
    expect(l.until).toBe(1000 + LOBBY_MAX_MS);
    expect(LOBBY_MS).toBe(6000);
    expect(LOBBY_EXTRA_MS).toBe(3000);
    expect(LOBBY_MAX_MS).toBe(12_000);
  });

  it("runs lobby, countdown and play for real players", () => {
    const r = rig();
    // Into the first bot round, then someone joins.
    r.advance(BOT_LOBBY_MS + 100);
    expect(r.m.phase).toBe("play");
    expect(r.m.attract).toBe(true);
    r.seats.set(0, "human");
    r.advance(STEP);
    expect(r.m.phase).toBe("over");
    r.advance(INTERRUPT_MS);
    expect(r.m.phase).toBe("lobby");
    const opened = r.now;
    expect(r.m.until).toBeCloseTo(opened + LOBBY_MS, -2);
    r.advance(1000);
    r.seats.set(3, "human");
    r.advance(STEP);
    expect(r.m.until).toBeCloseTo(opened + LOBBY_MS + LOBBY_EXTRA_MS, -2);
    r.seats.set(5, "human");
    r.advance(STEP);
    r.seats.set(7, "human");
    r.advance(STEP);
    expect(r.m.until).toBeCloseTo(opened + LOBBY_MAX_MS, -2);
    r.until(() => r.m.phase !== "lobby", LOBBY_MAX_MS);
    expect(r.m.phase).toBe("countdown");
    expect(r.now - opened).toBeCloseTo(LOBBY_MAX_MS, -2);
    r.until(() => r.m.phase !== "countdown", COUNTDOWN_MS + 100);
    expect(r.m.phase).toBe("play");
    expect(r.m.attract).toBe(false);
    expect(r.m.runners.filter((x) => x.mode === "human").map((x) => x.key)).toEqual([0, 3, 5, 7]);
    expect(r.phases).toContain("countdown");
  });

  it("goes back to bot rounds when everyone leaves the lobby", () => {
    const r = rig();
    r.seats.set(2, "human");
    r.advance(STEP);
    expect(r.m.phase).toBe("lobby");
    expect(r.m.until).toBeCloseTo(r.now + LOBBY_MS, -2);
    r.seats.clear();
    r.advance(STEP);
    expect(r.m.until).toBeLessThanOrEqual(r.now + BOT_LOBBY_MS);
    r.advance(BOT_LOBBY_MS + 50);
    expect(r.m.phase).toBe("play");
    expect(r.m.attract).toBe(true);
  });

  it("goes straight to the countdown when hurried", () => {
    const r = rig();
    r.seats.set(1, "human");
    r.m.hurry(r.now);
    expect(r.m.phase).toBe("countdown");
    r.advance(COUNTDOWN_MS + STEP);
    expect(r.m.phase).toBe("play");
  });
});

describe("rounds", () => {
  it("fills attract rounds with slow bots", () => {
    const r = rig();
    r.advance(BOT_LOBBY_MS + 100);
    expect(r.m.runners).toHaveLength(attractLines(8, 6400 * 1800));
    expect(attractLines(1)).toBe(3);
    expect(attractLines(1, 4000 * 3600)).toBe(5);
    expect(attractLines(20, 4000 * 3600)).toBe(8);
    expect(r.m.runners.every((x) => x.mode === "bot")).toBe(true);
    expect(r.m.arena.speed()).toBeCloseTo(320 * SPEED_FACTOR.slow);
  });

  it("tops a round up to `fill` lines with bots on free stations", () => {
    expect(linesFor(testConfig({ fill: 4 }), 1, 1, 8)).toBe(4);
    expect(linesFor(testConfig({ fill: 0 }), 1, 1, 8)).toBe(2);
    expect(linesFor(testConfig({ fill: 0, variant: "snake" }), 1, 1, 8)).toBe(1);
    expect(linesFor(testConfig({ fill: 2 }), 5, 5, 8)).toBe(5);
    const r = rig(testConfig({ fill: 3 }));
    r.seats.set(0, "human");
    r.m.hurry(r.now);
    r.advance(COUNTDOWN_MS + STEP);
    expect(r.m.runners).toHaveLength(3);
    expect(r.m.runners.filter((x) => x.mode === "bot")).toHaveLength(2);
    expect(r.m.arena.speed()).toBeCloseTo(320);
  });

  it("spreads bots out and uses bot-only starts last", () => {
    const slots = wallSlots(4);
    const picked = pickBotSlots(slots, new Set([0]), 3);
    // Farthest from the player at station 0 first.
    expect(picked.map((s) => s.key)).toEqual([3, 1, 2]);
    const more = pickBotSlots(slots, new Set([0, 1, 2, 3]), 2);
    expect(more.every((s) => s.virtual)).toBe(true);
  });

  it("hands a player's line to a bot when they leave mid-round", () => {
    const r = rig(testConfig({ fill: 2 }));
    r.seats.set(0, "human");
    r.seats.set(1, "human");
    r.m.hurry(r.now);
    r.advance(COUNTDOWN_MS + STEP);
    expect(r.m.phase).toBe("play");
    // Nobody steers here, so keep both lines out of trouble.
    for (const x of r.m.runners) x.line.ghostUntil = 1e9;
    r.seats.delete(1);
    r.advance(STEP);
    expect(r.m.runners.find((x) => x.key === 1)?.mode).toBe("bot");
    expect(r.m.phase).toBe("play");
    // Back within a few seconds (a hiccup on a bank): the line is theirs again.
    r.advance(1000);
    r.seats.set(1, "human");
    r.advance(STEP);
    expect(r.m.runners.find((x) => x.key === 1)?.mode).toBe("human");
    // Gone for good: the bot keeps it.
    r.seats.delete(1);
    r.advance(RECLAIM_MS + 100);
    r.seats.set(1, "human");
    r.advance(STEP);
    expect(r.m.runners.find((x) => x.key === 1)?.mode).toBe("bot");
    expect(r.m.waiting(1)).toBe(true);
    // Last person gone too: the round ends a moment later.
    r.seats.delete(0);
    r.seats.delete(1);
    r.advance(DESERTED_MS - 200);
    expect(r.m.phase).toBe("play");
    r.advance(400);
    expect(r.m.phase).toBe("over");
    expect(r.m.places).toBeNull();
  });

  it("ends a round when one line is left, ranks it, and opens the next lobby for those still seated", () => {
    const r = rig(testConfig({ fill: 2 }));
    r.seats.set(0, "human");
    r.seats.set(4, "human");
    r.m.hurry(r.now);
    r.advance(COUNTDOWN_MS + STEP);
    // The player at station 0 turns hard into the bottom edge.
    r.dirs.set(0, 1);
    r.dirs.set(4, 0);
    r.until(() => r.m.phase !== "play", 20_000);
    expect(r.m.phase).toBe("over");
    expect(r.m.places).not.toBeNull();
    const winner = r.m.runners[r.m.places!.indexOf(1)]!;
    expect(winner.line.alive).toBe(true);
    expect(r.m.played).toBe(1);
    r.advance(OVER_MS + STEP);
    expect(r.m.phase).toBe("lobby");
    expect(r.m.until).toBeCloseTo(r.now + LOBBY_MS, -3);
    expect(r.m.arena.lines).toHaveLength(0);
  });

  it("settles a round soon after the last person is out", () => {
    const r = rig(testConfig({ fill: 4 }));
    r.seats.set(0, "human");
    r.m.hurry(r.now);
    r.advance(COUNTDOWN_MS + STEP);
    r.dirs.set(0, 1);
    r.until(() => !r.m.runners.find((x) => x.key === 0)!.line.alive, 10_000);
    const out = r.now;
    r.until(() => r.m.phase !== "play", 30_000);
    expect(r.m.phase).toBe("over");
    expect(r.now - out).toBeLessThanOrEqual(SETTLE_MS + STEP * 2);
  });

  it("runs snake rounds to the time limit", () => {
    const r = rig(testConfig({ variant: "snake", roundMs: 30_000, fill: 2 }));
    r.seats.set(0, "human");
    r.m.hurry(r.now);
    r.advance(COUNTDOWN_MS + STEP);
    const start = r.now;
    r.dirs.set(0, 1);
    r.until(() => r.m.phase !== "play", 40_000);
    expect(r.m.phase).toBe("over");
    expect(r.now - start).toBeGreaterThan(29_900);
    expect(r.m.places).toHaveLength(2);
  });

  it("knows who is waiting for the next round", () => {
    const r = rig(testConfig({ fill: 2 }));
    r.seats.set(0, "human");
    r.m.hurry(r.now);
    r.advance(COUNTDOWN_MS + STEP);
    r.seats.set(6, "human");
    r.advance(STEP);
    expect(r.m.waiting(6)).toBe(true);
    expect(r.m.waiting(0)).toBe(false);
    expect(r.m.phase).toBe("play");
  });

  it("goes back to the lobby on reset", () => {
    const r = rig();
    r.advance(BOT_LOBBY_MS + 1000);
    expect(r.m.phase).toBe("play");
    r.m.reset(r.now);
    expect(r.m.phase).toBe("lobby");
    expect(r.m.runners).toHaveLength(0);
    expect(r.m.arena.lines).toHaveLength(0);
  });
});

describe("grid rounds", () => {
  const into = (r: Rig) => {
    r.seats.set(2, "human");
    r.until(() => r.m.phase === "play" && !r.m.attract, 30_000);
    return r.m.runners.find((x) => x.key === 2)!;
  };

  it("turns a person's line with their presses, and drops presses made between rounds", () => {
    const r = rig(testConfig({ variant: "grid", edges: "wrap" }));
    r.advance(BOT_LOBBY_MS + 100);
    r.seats.set(2, "human");
    r.until(() => r.m.phase === "lobby", 2000);
    // Pressed while waiting: forgotten by the time the round starts.
    r.presses.set(2, [0]);
    const me = into(r);
    expect(r.presses.get(2)).toEqual([]);
    expect(me.line.aim).toBe(3);
    r.advance(200);
    expect(me.line.aim).toBe(3);
    r.presses.set(2, [2, 3]);
    r.advance(STEP);
    expect([me.line.next, me.line.queued]).toEqual([2, 3]);
    r.advance(300);
    expect(me.line.aim).toBe(3);
    expect(me.line.alive).toBe(true);
  });

  it("fills a grid round with bots that press their own directions", () => {
    const r = rig(testConfig({ variant: "grid", fill: 4 }));
    const me = into(r);
    expect(me.mode).toBe("human");
    expect(r.m.runners).toHaveLength(4);
    const aims = new Set<number>();
    for (let t = 0; t < 10; t++) {
      r.advance(500);
      for (const x of r.m.runners) if (x.mode === "bot") aims.add(x.line.aim);
    }
    expect(aims.size).toBeGreaterThan(1);
  });
});
