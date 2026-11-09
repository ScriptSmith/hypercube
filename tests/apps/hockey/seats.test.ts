// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTDOWN_MS, OVER_MS } from "../../../src/apps/hockey/config";
import { layoutFor } from "../../../src/apps/hockey/layout";
import {
  countdownMs,
  createLobby,
  type Lobby,
  QUIET_MS,
  REFILL_MS,
} from "../../../src/apps/hockey/seats";
import { createTable, type Table } from "../../../src/apps/hockey/table";
import { createInput, type InputHandle } from "../../../src/core/input";
import { createRng } from "../../../src/core/rng";
import { createStations, type StationsHandle } from "../../../src/core/stations";
import type { FrameInfo } from "../../../src/core/types";
import { createUi, type UiHandle } from "../../../src/core/ui";
import { firePointer, makeRoot, useFakeClock } from "../../input/dom";
import { layoutInput, testConfig } from "./helpers";

const kiosk = (): FrameInfo => ({
  kind: "kiosk",
  venueWidth: 1920,
  venueHeight: 1080,
  width: 1920,
  height: 1080,
  unit: 1,
  pixelRatio: 1,
  touch: true,
  reach: { adult: 1, child: 1 },
  reachTop: { adult: 0, child: 0 },
  seams: [],
});

let root: HTMLElement;
let input: InputHandle;
let ui: UiHandle;
let stations: StationsHandle;
let table: Table;
let lobby: Lobby;
let nextId = 1;
let matches = 0;
let fits: (Record<string, { top: number; bottom: number }> | null)[] = [];

const make = (testBots: number, playTimeout?: number, variant: "hockey" | "defence" = "hockey") => {
  const layout = layoutFor(layoutInput("kiosk", { variant }));
  table = createTable(layout.tables[0]!, testConfig({ variant }), createRng("seats"));
  table.attract(performance.now());
  fits = [];
  lobby = createLobby({
    fit: (bands) => fits.push(bands),
    fill: variant !== "defence",
    table,
    stations,
    unit: 1,
    colorOf: (hue) => ["#6fa4fc", "#f0e82a"][hue % 2]!,
    testBots,
    newMatch: (now, botsOnly) => ({ id: `m${++matches}`, startAt: now + countdownMs(botsOnly) }),
    ...(playTimeout === undefined ? {} : { playTimeout }),
  });
};

/** Advance time, stepping the table and ticking the lobby as the app's loop does. */
const run = (ms: number) => {
  const steps = Math.ceil(ms / 50);
  for (let i = 0; i < steps; i++) {
    vi.advanceTimersByTime(50);
    const now = performance.now();
    table.step(0.05, now);
    lobby.tick(now, now);
  }
};

const el = (id: string) => root.querySelector<HTMLElement>(`[data-station="${id}"]`)!;

const tap = (target: Element, x: number, y: number) => {
  const pointerId = nextId++;
  firePointer(target, "pointerdown", { pointerId, clientX: x, clientY: y });
  firePointer(target, "pointerup", { pointerId, clientX: x, clientY: y });
};

/** A person takes the left seat: touch, top, bottom, confirm. */
const join = (id = "t0-l") => {
  tap(el(id), 400, 540);
  run(500);
  tap(el(id), 400, 80);
  run(500);
  tap(el(id), 400, 1000);
  run(600);
  const button = el(id).querySelector(".hc-button")!;
  tap(button, 400, 540);
};

const seat = (i: number) => lobby.seats[i]!.station;

beforeEach(() => {
  useFakeClock();
  root = makeRoot({ width: 1920, height: 1080 });
  input = createInput(root);
  ui = createUi(root, kiosk);
  stations = createStations({ root, frame: kiosk, input, ui });
  matches = 0;
});

afterEach(() => {
  lobby.dispose();
  stations.dispose();
  ui.dispose();
  input.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("hockey seats", () => {
  it("rallies in attract with the station hints showing", () => {
    make(0);
    run(2000);
    expect(table.match.phase).toBe("attract");
    expect(lobby.seats.map((s) => s.station.state)).toEqual(["idle", "idle"]);
    expect(table.lanes[0]!.pucks.some((p) => p.live)).toBe(true);
  });

  it("starts a match for one person, with a bot taking the empty seat", () => {
    make(0);
    run(500);
    join();
    run(100);
    expect(table.match.phase).toBe("countdown");
    expect(seat(0).state).toBe("ready");
    run(COUNTDOWN_MS + 100);
    expect(table.match.phase).toBe("play");
    expect(seat(0).state).toBe("playing");
    expect(seat(0).bot).toBe(false);
    expect(seat(1).bot).toBe(true);
    expect(table.players[0]!.human).toBe(true);
    expect(table.players[1]!.human).toBe(false);
    expect(lobby.humans()).toBe(1);
  });

  it("lets a person take over a bot's seat mid-match", () => {
    make(0);
    run(500);
    join();
    run(COUNTDOWN_MS + 200);
    expect(seat(1).bot).toBe(true);
    // A real touch inside the bot's station.
    const id = nextId++;
    firePointer(root, "pointerdown", { pointerId: id, clientX: 1500, clientY: 540 });
    firePointer(root, "pointerup", { pointerId: id, clientX: 1500, clientY: 540 });
    run(100);
    expect(seat(1).state).toBe("calibrating");
    expect(seat(1).bot).toBe(false);
    // The bot keeps the mallet moving while the newcomer calibrates.
    expect(table.match.phase).toBe("play");
    expect(table.players[1]!.human).toBe(false);
  });

  it("refills a seat a person leaves while someone is still playing", () => {
    make(0);
    run(500);
    join();
    run(COUNTDOWN_MS + 200);
    // Take over the bot seat, then let the left player's seat end.
    seat(1).end();
    run(100);
    expect(seat(1).state).toBe("idle");
    run(REFILL_MS + 200);
    expect(seat(1).bot).toBe(true);
    expect(seat(1).state).toBe("playing");
  });

  it("goes back to attract when nobody is left", () => {
    make(0);
    run(500);
    join();
    run(COUNTDOWN_MS + 200);
    seat(0).end();
    run(200);
    expect(table.match.phase).toBe("attract");
    expect(lobby.seats.map((s) => s.station.state)).toEqual(["idle", "idle"]);
  });

  it("runs bot-only matches for testing and returns to the lobby after each", () => {
    make(2);
    run(200);
    expect(table.match.phase).toBe("countdown");
    run(countdownMs(true) + 200);
    expect(table.match.phase).toBe("play");
    expect(lobby.seats.every((s) => s.station.bot && s.station.state === "playing")).toBe(true);
    table.finish(performance.now(), 0);
    run(OVER_MS + 200);
    expect(table.match.phase).toBe("attract");
    expect(lobby.seats.map((s) => s.station.state)).toEqual(["idle", "idle"]);
  });

  it("without the platform timeout, ends a player only after quiet time with pucks in play", () => {
    make(0, 0);
    run(500);
    join();
    run(COUNTDOWN_MS + 200);
    expect(seat(0).state).toBe("playing");
    // Every puck away (on the other wall, in versus): waiting doesn't count.
    const lane = table.lanes[0]!;
    for (let i = 0; i < (QUIET_MS + 5000) / 1000; i++) {
      for (const p of lane.pucks) p.live = false;
      lane.respawnAt.fill(Infinity);
      run(1000);
    }
    expect(seat(0).state).toBe("playing");
    // Touching keeps the seat however long pucks are here.
    for (let i = 0; i < 4; i++) {
      for (const p of lane.pucks) if (!p.live) p.live = true;
      lobby.seats[0]!.touched = performance.now();
      run(QUIET_MS / 3);
      lobby.seats[0]!.touched = performance.now();
    }
    expect(seat(0).state).toBe("playing");
    // Pucks here and no touch: the player has gone.
    for (const p of lane.pucks) p.live = true;
    run(QUIET_MS + 1000);
    expect(seat(0).state).not.toBe("playing");
    expect(table.match.phase).toBe("attract");
  });

  it("fits the table to the band of the person who joins, and back after the match", () => {
    make(0);
    run(500);
    join();
    run(100);
    const fitted = fits.find((f) => f !== null);
    expect(fitted).toBeDefined();
    const band = Object.values(fitted!)[0]!;
    // The person touched high at 80 and low at 1000 (venue px, unit 1).
    expect(band.top).toBeGreaterThanOrEqual(60);
    expect(band.bottom).toBeLessThanOrEqual(1020);
    seat(0).end();
    run(200);
    expect(fits.at(-1)).toBeNull();
  });

  it("in defence leaves empty seats to their sealed slots instead of bots", () => {
    make(0, undefined, "defence");
    run(500);
    join("d0");
    run(COUNTDOWN_MS + 300);
    expect(table.match.phase).toBe("play");
    expect(seat(0).state).toBe("playing");
    expect(seat(1).state).toBe("idle");
    expect(table.lanes[0]!.spec.params.mouths[0].map((m) => m.open)).toEqual([true, false]);
  });

  it("reset ends every seat and returns to the rally", () => {
    make(2);
    run(countdownMs(true) + 500);
    expect(table.match.phase).toBe("play");
    lobby.reset(performance.now());
    expect(table.match.phase).toBe("attract");
    expect(lobby.seats.map((s) => s.station.state)).toEqual(["idle", "idle"]);
  });
});
