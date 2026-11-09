// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAY_TIMEOUT_MS } from "../../../src/apps/tangle/config";
import { frameLayout } from "../../../src/apps/tangle/layout";
import { createSeating, type Seating, TEST_RECLAIM_MS } from "../../../src/apps/tangle/seating";
import { createInput, type InputHandle } from "../../../src/core/input";
import { createStations, type StationsHandle } from "../../../src/core/stations";
import type { AppContext } from "../../../src/core/types";
import { createUi, type UiHandle } from "../../../src/core/ui";
import { firePointer, makeRoot, panelFrame, useFakeClock } from "../../input/dom";

let root: HTMLElement;
let input: InputHandle;
let ui: UiHandle;
let stations: StationsHandle;
let seating: Seating;
let midRound = false;
let nextId = 1;

const layout = frameLayout({
  kind: "panel",
  width: 1080,
  height: 1920,
  seams: [],
  reachTop: 0,
  wallStations: 8,
  perFrame: 1,
});
const pads = layout.stations[0]!.pads;
const centre = (i: 0 | 1) => ({
  x: pads[i]!.x + pads[i]!.width / 2,
  y: pads[i]!.y + pads[i]!.height / 2,
});

const aimLayout = frameLayout({
  kind: "panel",
  width: 1080,
  height: 1920,
  seams: [],
  reachTop: 0,
  wallStations: 8,
  perFrame: 1,
  pads: "aim",
});
const aimCentre = (d: number) => {
  const p = aimLayout.stations[0]!.pads[d]!;
  return { x: p.x + p.width / 2, y: p.y + p.height / 2 };
};

const make = (testBots = 0, lay = layout) => {
  const ctx = { frame: panelFrame(), ui, stations, input } as unknown as AppContext;
  seating = createSeating({ ctx, layout: lay, colors: [3], midRound: () => midRound, testBots });
};

const tap = (target: Element, x: number, y: number) => {
  const pointerId = nextId++;
  firePointer(target, "pointerdown", { pointerId, clientX: x, clientY: y });
  firePointer(target, "pointerup", { pointerId, clientX: x, clientY: y });
};
const press = (i: 0 | 1) => {
  const pointerId = nextId++;
  const { x, y } = centre(i);
  firePointer(root, "pointerdown", { pointerId, clientX: x, clientY: y });
  return pointerId;
};
const lift = (pointerId: number) => firePointer(window, "pointerup", { pointerId });
const station = () => root.querySelector<HTMLElement>('[data-station="tangle-0"]')!;

beforeEach(() => {
  useFakeClock();
  midRound = false;
  root = makeRoot({ width: 1080, height: 1920 });
  input = createInput(root);
  ui = createUi(root, () => panelFrame());
  stations = createStations({ root, frame: () => panelFrame(), input, ui });
});

afterEach(() => {
  seating.dispose();
  stations.dispose();
  ui.dispose();
  input.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("seating", () => {
  it("seats a person on their first touch, with no calibration", () => {
    make();
    expect(seating.seat(0)).toBeNull();
    tap(station(), 540, 1500);
    expect(seating.list[0]!.state).toBe("ready");
    expect(seating.seat(0)).toBe("human");
  });

  it("starts someone at once if a round is already under way, so they keep the seat while waiting", () => {
    make();
    midRound = true;
    tap(station(), 540, 1500);
    expect(seating.list[0]!.state).toBe("playing");
    vi.advanceTimersByTime(90_000);
    expect(seating.seat(0)).toBe("human");
    vi.advanceTimersByTime(PLAY_TIMEOUT_MS - 90_000 + 1000);
    expect(seating.seat(0)).toBeNull();
  });

  it("turns with the pads, goes straight with both held, and follows a sliding finger", () => {
    make();
    tap(station(), 540, 1500);
    seating.startReady();
    expect(seating.dir(0)).toBe(0);
    const l = press(0);
    expect(seating.dir(0)).toBe(-1);
    const r = press(1);
    expect(seating.dir(0)).toBe(0);
    lift(l);
    expect(seating.dir(0)).toBe(1);
    // Slide the right-hand finger over to the left pad.
    const { x, y } = centre(0);
    firePointer(window, "pointermove", { pointerId: r, clientX: x, clientY: y });
    expect(seating.dir(0)).toBe(-1);
    expect(seating.pads.held(0, 0)).toBe(true);
    lift(r);
    expect(seating.dir(0)).toBe(0);
  });

  it("ignores the pads until the station is playing", () => {
    make();
    tap(station(), 540, 1500);
    press(1);
    expect(seating.dir(0)).toBe(0);
  });

  it("seats test bots that work the pads with synthetic touches", () => {
    make(1);
    vi.advanceTimersByTime(500);
    seating.tick(performance.now());
    expect(seating.seat(0)).toBe("bot");
    seating.startReady();
    expect(seating.drive(0, 1)).toBe(1);
    expect(seating.drive(0, -1)).toBe(-1);
    expect(seating.drive(0, 0)).toBe(0);
    // A bot leaves; it comes back only after a pause.
    seating.endAll();
    seating.tick(performance.now());
    expect(seating.seat(0)).toBeNull();
    vi.advanceTimersByTime(TEST_RECLAIM_MS + 10);
    seating.tick(performance.now());
    expect(seating.seat(0)).toBe("bot");
  });
});

describe("seating with direction pads", () => {
  const tapPad = (d: number) => {
    const pointerId = nextId++;
    const { x, y } = aimCentre(d);
    firePointer(root, "pointerdown", { pointerId, clientX: x, clientY: y });
    firePointer(window, "pointerup", { pointerId, clientX: x, clientY: y });
  };

  it("queues each press, oldest first, and counts them", () => {
    make(0, aimLayout);
    tap(station(), 540, 1500);
    seating.startReady();
    expect(seating.press(0)).toBe(-1);
    tapPad(3);
    tapPad(2);
    expect(seating.pads.presses(0)).toBe(2);
    expect(seating.pads.last(0)).toBe(2);
    expect(seating.press(0)).toBe(3);
    expect(seating.press(0)).toBe(2);
    expect(seating.press(0)).toBe(-1);
    // Only a couple wait: the oldest makes way.
    tapPad(0);
    tapPad(1);
    tapPad(2);
    expect(seating.pads.presses(0)).toBe(5);
    expect([seating.press(0), seating.press(0), seating.press(0)]).toEqual([1, 2, -1]);
  });

  it("presses the pad a finger slides onto, and lights the pads held", () => {
    make(0, aimLayout);
    tap(station(), 540, 1500);
    seating.startReady();
    const pointerId = nextId++;
    const a = aimCentre(1);
    const b = aimCentre(0);
    firePointer(root, "pointerdown", { pointerId, clientX: a.x, clientY: a.y });
    expect(seating.pads.held(0, 1)).toBe(true);
    firePointer(window, "pointermove", { pointerId, clientX: b.x, clientY: b.y });
    expect(seating.pads.held(0, 0)).toBe(true);
    expect(seating.pads.held(0, 1)).toBe(false);
    lift(pointerId);
    expect([seating.press(0), seating.press(0)]).toEqual([1, 0]);
    // A touch well away from every pad presses nothing.
    tap(root, 190, 1380);
    expect(seating.press(0)).toBe(-1);
  });

  it("ignores the pads until the station is playing", () => {
    make(0, aimLayout);
    tap(station(), 540, 1500);
    tapPad(0);
    expect(seating.press(0)).toBe(-1);
    expect(seating.pads.presses(0)).toBe(0);
  });

  it("lets a seated test bot tap the direction it wants", () => {
    make(1, aimLayout);
    vi.advanceTimersByTime(500);
    seating.tick(performance.now());
    expect(seating.seat(0)).toBe("bot");
    seating.startReady();
    seating.drive(0, 2);
    seating.drive(0, 2);
    seating.drive(0, -1);
    seating.drive(0, 3);
    expect([seating.press(0), seating.press(0), seating.press(0)]).toEqual([2, 3, -1]);
  });
});
