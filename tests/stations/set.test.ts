// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInput, type InputHandle } from "../../src/core/input";
import { createStations, STATION_TIMEOUTS, type StationsHandle } from "../../src/core/stations";
import type { Station, StationSet } from "../../src/core/types";
import { createUi, type UiHandle } from "../../src/core/ui";
import { firePointer, makeRoot, panelFrame, useFakeClock } from "../input/dom";

let root: HTMLElement;
let input: InputHandle;
let ui: UiHandle;
let stations: StationsHandle;
let set: StationSet;
let events: string[];
let appDowns: number;
let nextId = 1;

const el = (id = "a") => root.querySelector<HTMLElement>(`[data-station="${id}"]`)!;
const station = (id = "a") => set.list.find((s) => s.id === id)!;

/** A person's finger: a fresh small pointer id, pressed and lifted on whatever is at the target. */
const touch = (target: Element, y: number, x = 540) => {
  const pointerId = nextId++;
  firePointer(target, "pointerdown", { pointerId, clientX: x, clientY: y });
  firePointer(target, "pointerup", { pointerId, clientX: x, clientY: y });
};

const pressButton = (container: Element) => {
  const button = container.querySelector(".hc-button");
  if (!button) throw new Error("no button");
  const pointerId = nextId++;
  firePointer(button, "pointerdown", { pointerId, clientX: 0, clientY: 0 });
  return () => firePointer(button, "pointerup", { pointerId, clientX: 0, clientY: 0 });
};

/** Idle -> both touches -> Confirm (the first button in the adjust step). */
const calibrateAndConfirm = (id = "a") => {
  touch(el(id), 900);
  vi.advanceTimersByTime(500);
  touch(el(id), 300);
  vi.advanceTimersByTime(500);
  touch(el(id), 1500);
  vi.advanceTimersByTime(500);
  pressButton(el(id))();
};

/** Drags a band handle by `dy` stage px, as a person would. */
const dragHandle = (edge: "top" | "bottom", from: number, dy: number, id = "a") => {
  const handle = el(id).querySelector<HTMLElement>(`.hc-handle[data-edge="${edge}"]`)!;
  const pointerId = nextId++;
  firePointer(handle, "pointerdown", { pointerId, clientX: 540, clientY: from });
  for (let i = 1; i <= 4; i++) {
    firePointer(handle, "pointermove", { pointerId, clientX: 540, clientY: from + (dy * i) / 4 });
  }
  firePointer(handle, "pointerup", { pointerId, clientX: 540, clientY: from + dy });
};

const buttons = (id = "a") => [...el(id).querySelectorAll<HTMLElement>(".hc-button")];

const resetButtonRect = (id: string) => {
  const b = el(id).querySelector<HTMLElement>(".hc-button")!;
  return { x: Number.parseFloat(b.style.left), y: Number.parseFloat(b.style.top) };
};

beforeEach(() => {
  useFakeClock();
  root = makeRoot({ width: 1080, height: 1920 });
  input = createInput(root);
  ui = createUi(root, () => panelFrame());
  stations = createStations({ root, frame: () => panelFrame(), input, ui });
  set = stations.define([{ id: "a", rect: { x: 0, y: 0, width: 1080, height: 1920 } }]);
  events = [];
  for (const name of ["ready", "start", "end"] as const) {
    set.on(name, (s: Station) => events.push(`${name}:${s.id}`));
  }
  appDowns = 0;
  input.on("down", () => appDowns++);
});

afterEach(() => {
  stations.dispose();
  ui.dispose();
  input.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("station set", () => {
  it("runs the whole flow and keeps calibration touches from the app", () => {
    expect(station().state).toBe("idle");
    expect(station().color).toBe(ui.palette.players[0]);

    touch(el(), 900);
    expect(station().state).toBe("calibrating");
    expect(el().dataset.step).toBe("top");
    vi.advanceTimersByTime(500);
    touch(el(), 300);
    expect(el().dataset.step).toBe("bottom");
    vi.advanceTimersByTime(500);
    touch(el(), 1500);
    expect(station().state).toBe("calibrating");
    expect(el().dataset.step).toBe("adjust");
    // The band is not the player's until they confirm it.
    expect(station().band).toBeNull();
    expect(el().querySelectorAll(".hc-handle")).toHaveLength(2);
    expect(buttons()).toHaveLength(2);
    expect(events).toEqual([]);

    vi.advanceTimersByTime(500);
    pressButton(el())();
    expect(events).toEqual(["ready:a"]);
    expect(station().state).toBe("ready");
    expect(station().band).toEqual({ top: 300, bottom: 1500 });
    set.startReady();
    expect(station().state).toBe("playing");
    expect(events).toEqual(["ready:a", "start:a"]);
    expect(appDowns).toBe(0);

    // While playing, touches go to the app; only the reset control is live.
    expect(el().style.pointerEvents).toBe("none");
    touch(root, 800);
    expect(appDowns).toBe(1);
  });

  it("resets on a one-second hold of the reset control", () => {
    calibrateAndConfirm();
    set.startReady();
    const release = pressButton(el());
    vi.advanceTimersByTime(600);
    expect(station().state).toBe("playing");
    vi.advanceTimersByTime(500);
    release();
    expect(station().state).toBe("idle");
    expect(events).toEqual(["ready:a", "start:a", "end:a"]);
  });

  it("does not reset on a short press of the reset control", () => {
    calibrateAndConfirm();
    set.startReady();
    pressButton(el())();
    vi.advanceTimersByTime(2000);
    expect(station().state).toBe("playing");
  });

  it("adjusts the band with its handles, clamped, without the app seeing the drag", () => {
    touch(el(), 900);
    vi.advanceTimersByTime(500);
    touch(el(), 300);
    vi.advanceTimersByTime(500);
    touch(el(), 1500);
    // Grab the top handle a little below its edge: the edge keeps that offset.
    dragHandle("top", 320, -200);
    dragHandle("bottom", 1500, 1000);
    vi.advanceTimersByTime(500);
    pressButton(el())();
    expect(station().band).toEqual({ top: 100, bottom: 1920 });
    expect(appDowns).toBe(0);
  });

  it("keeps the minimum band height while dragging", () => {
    touch(el(), 900);
    vi.advanceTimersByTime(500);
    touch(el(), 300);
    vi.advanceTimersByTime(500);
    touch(el(), 1500);
    dragHandle("bottom", 1500, -1400);
    const box = el().querySelector<HTMLElement>(".hc-anim-reveal")!;
    expect(Number.parseFloat(box.style.height)).toBe(400);
    vi.advanceTimersByTime(500);
    pressButton(el())();
    expect(station().band).toEqual({ top: 300, bottom: 700 });
  });

  it("starts the touches again on Redo", () => {
    touch(el(), 900);
    vi.advanceTimersByTime(500);
    touch(el(), 300);
    vi.advanceTimersByTime(500);
    touch(el(), 1500);
    vi.advanceTimersByTime(500);
    const redo = buttons()[1]!;
    firePointer(redo, "pointerdown", { pointerId: nextId++ });
    expect(station().state).toBe("calibrating");
    expect(el().dataset.step).toBe("top");
    expect(events).toEqual([]);
  });

  it("ignores a Confirm press that arrives with the calibration finger", () => {
    touch(el(), 900);
    vi.advanceTimersByTime(500);
    touch(el(), 300);
    vi.advanceTimersByTime(500);
    touch(el(), 1500);
    pressButton(el())();
    expect(events).toEqual([]);
  });

  it("times out each state", () => {
    touch(el(), 900);
    vi.advanceTimersByTime(STATION_TIMEOUTS.calibrateStep + 10);
    expect(station().state).toBe("idle");

    calibrateAndConfirm();
    set.startReady();
    vi.advanceTimersByTime(STATION_TIMEOUTS.playing - 5000);
    touch(root, 800);
    vi.advanceTimersByTime(STATION_TIMEOUTS.playing - 5000);
    expect(station().state).toBe("playing");
    vi.advanceTimersByTime(5010);
    expect(station().state).toBe("idle");
    expect(events.at(-1)).toBe("end:a");
  });

  it("times out a band nobody confirmed, and dragging keeps it open", () => {
    touch(el(), 900);
    vi.advanceTimersByTime(500);
    touch(el(), 300);
    vi.advanceTimersByTime(500);
    touch(el(), 1500);
    vi.advanceTimersByTime(STATION_TIMEOUTS.confirm - 1000);
    dragHandle("top", 300, 50);
    vi.advanceTimersByTime(STATION_TIMEOUTS.confirm - 1000);
    expect(el().dataset.step).toBe("adjust");
    vi.advanceTimersByTime(1010);
    expect(station().state).toBe("idle");
    expect(events).toEqual([]);
  });

  it("hands a station to a bot and back to a person", () => {
    station().claimForBot();
    expect(events).toEqual(["ready:a"]);
    expect(station().bot).toBe(true);
    set.startReady();
    expect(station().state).toBe("playing");

    // A bot's own touches keep it going without a takeover.
    const id = input.inject.down(500, 900);
    input.inject.up(id);
    expect(station().bot).toBe(true);

    touch(root, 900);
    expect(events).toEqual(["ready:a", "start:a", "end:a"]);
    expect(station().state).toBe("calibrating");
    expect(station().bot).toBe(false);
  });

  it("does not let a bot tap start calibration on an idle station", () => {
    Object.defineProperty(document, "elementFromPoint", {
      value: () => el(),
      configurable: true,
    });
    try {
      const id = input.inject.down(540, 900);
      input.inject.up(id);
      expect(station().state).toBe("idle");
      touch(el(), 900);
      expect(station().state).toBe("calibrating");
    } finally {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
  });

  it("puts the reset control in the corner the spec asks for", () => {
    set.dispose();
    const full = { x: 0, y: 0, width: 1080, height: 1920 };
    const corners = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
    const four = stations.define(corners.map((c) => ({ id: c, rect: full, resetCorner: c })));
    for (const s of four.list) s.claimForBot();
    four.startReady();
    // The bot band is the whole rect here, so the corners are the rect's corners.
    const at = Object.fromEntries(corners.map((c) => [c, resetButtonRect(c)]));
    expect(at["top-left"]!.x).toBeLessThan(200);
    expect(at["top-left"]!.y).toBeLessThan(200);
    expect(at["top-right"]!.x).toBeGreaterThan(800);
    expect(at["top-right"]!.y).toBeLessThan(200);
    expect(at["bottom-left"]!.x).toBeLessThan(200);
    expect(at["bottom-left"]!.y).toBeGreaterThan(1700);
    expect(at["bottom-right"]!.x).toBeGreaterThan(800);
    expect(at["bottom-right"]!.y).toBeGreaterThan(1700);
    four.dispose();
  });

  it("keeps the reset control inside a calibrated band", () => {
    set.dispose();
    const one = stations.define([
      { id: "b", rect: { x: 0, y: 0, width: 1080, height: 1920 }, resetCorner: "bottom-left" },
    ]);
    calibrateAndConfirm("b");
    one.startReady();
    const { y } = resetButtonRect("b");
    expect(y).toBeGreaterThan(300);
    expect(y + 150).toBeLessThanOrEqual(1500);
    expect(y).toBeGreaterThan(1200);
    one.dispose();
  });

  it("honours a station's play timeout", () => {
    set.dispose();
    const two = stations.define([
      { id: "never", rect: { x: 0, y: 0, width: 1080, height: 1920 }, playTimeout: 0 },
      { id: "short", rect: { x: 0, y: 0, width: 1080, height: 1920 }, playTimeout: 5000 },
    ]);
    const state = (id: string) => two.list.find((s) => s.id === id)!.state;
    calibrateAndConfirm("never");
    calibrateAndConfirm("short");
    two.startReady();
    expect([state("never"), state("short")]).toEqual(["playing", "playing"]);
    vi.advanceTimersByTime(5010);
    expect([state("never"), state("short")]).toEqual(["playing", "idle"]);
    vi.advanceTimersByTime(60 * 60_000);
    expect(state("never")).toBe("playing");
    two.dispose();
  });

  it("removes its overlay on dispose", () => {
    set.dispose();
    expect(root.querySelector(".hc-stations")).toBeNull();
    station().claimForBot();
    expect(events).toEqual([]);
  });

  it("colours stations from the palette in order and puts reset on the outer side", () => {
    const pair = stations.define([
      { id: "l", rect: { x: 0, y: 0, width: 400, height: 1920 } },
      { id: "r", rect: { x: 680, y: 0, width: 400, height: 1920 }, color: "#123456" },
    ]);
    expect(pair.list.map((s) => s.color)).toEqual([ui.palette.players[0], "#123456"]);
    for (const s of pair.list) {
      s.claimForBot();
    }
    pair.startReady();
    const left = el("l").querySelector<HTMLElement>(".hc-button")!;
    const right = el("r").querySelector<HTMLElement>(".hc-button")!;
    expect(Number.parseFloat(left.style.left)).toBeLessThan(200);
    expect(Number.parseFloat(right.style.left)).toBeGreaterThan(200);
    pair.dispose();
  });
});
