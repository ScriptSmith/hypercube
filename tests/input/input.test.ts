// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInput,
  type InputHandle,
  STALE_TOUCH_MS,
  SYNTHETIC_ID_BASE,
} from "../../src/core/input";
import type { Pointer } from "../../src/core/types";
import { firePointer, makeRoot, useFakeClock } from "./dom";

let input: InputHandle | null = null;

beforeEach(() => {
  useFakeClock();
});

afterEach(() => {
  input?.dispose();
  input = null;
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "elementFromPoint");
  vi.useRealTimers();
});

const record = (inp: InputHandle) => {
  const seen: { phase: string; p: Pointer }[] = [];
  for (const phase of ["down", "move", "up", "cancel"] as const) {
    inp.on(phase, (p) => seen.push({ phase, p: { ...p } }));
  }
  return seen;
};

describe("coordinate mapping", () => {
  it("maps client coordinates into stage px through a CSS scale and offset", () => {
    const root = makeRoot({ width: 1080, height: 1920, left: 100, top: 40, scale: 0.5 });
    input = createInput(root);
    expect(input.toStage(100 + 270, 40 + 480)).toEqual({ x: 540, y: 960 });

    const seen = record(input);
    firePointer(root, "pointerdown", { pointerId: 3, clientX: 100 + 54, clientY: 40 + 96 });
    expect(seen[0]?.p).toMatchObject({ id: 3, x: 108, y: 192, synthetic: false });
  });

  it("round-trips injected touches to the same stage position", () => {
    const root = makeRoot({ width: 1080, height: 1920, left: 7, top: 9, scale: 0.25 });
    input = createInput(root);
    const seen = record(input);
    const id = input.inject.down(300, 1200);
    input.inject.move(id, 320, 1100);
    input.inject.up(id);
    expect(id).toBeGreaterThanOrEqual(SYNTHETIC_ID_BASE);
    expect(seen.map((s) => s.phase)).toEqual(["down", "move", "up"]);
    expect(seen[0]?.p.x).toBeCloseTo(300);
    expect(seen[0]?.p.y).toBeCloseTo(1200);
    expect(seen[2]?.p.x).toBeCloseTo(320);
    expect(seen[2]?.p.synthetic).toBe(true);
    expect(input.pointers.size).toBe(0);
  });
});

describe("pointer tracking", () => {
  it("smooths velocity and lets it fade when the finger stops before lifting", () => {
    const root = makeRoot({ width: 1000, height: 1000 });
    input = createInput(root);
    firePointer(root, "pointerdown", { pointerId: 1, clientX: 0, clientY: 500 });
    for (let i = 1; i <= 20; i++) {
      vi.advanceTimersByTime(16);
      firePointer(root, "pointermove", { pointerId: 1, clientX: i * 16, clientY: 500 });
    }
    const p = input.pointers.get(1);
    expect(p?.vx).toBeGreaterThan(900);
    expect(p?.vx).toBeLessThan(1001);
    expect(Math.abs(p?.vy ?? 1)).toBeLessThan(1e-6);

    const seen = record(input);
    vi.advanceTimersByTime(300);
    firePointer(root, "pointerup", { pointerId: 1, clientX: 320, clientY: 500 });
    expect(seen[0]?.phase).toBe("up");
    expect(Math.abs(seen[0]?.p.vx ?? 1000)).toBeLessThan(10);
  });

  it("reports pointercancel and forgets the pointer", () => {
    const root = makeRoot({ width: 100, height: 100 });
    input = createInput(root);
    const seen = record(input);
    firePointer(root, "pointerdown", { pointerId: 4, clientX: 10, clientY: 10 });
    firePointer(root, "pointercancel", { pointerId: 4, clientX: 10, clientY: 10 });
    expect(seen.map((s) => s.phase)).toEqual(["down", "cancel"]);
    expect(input.pointers.size).toBe(0);
  });

  it("ignores pointers that a control swallowed at pointerdown", () => {
    const root = makeRoot({ width: 100, height: 100 });
    const control = document.createElement("div");
    control.addEventListener("pointerdown", (e) => e.stopPropagation());
    root.append(control);
    input = createInput(root);
    const seen = record(input);
    let activity = 0;
    input.onActivity(() => activity++);
    firePointer(control, "pointerdown", { pointerId: 9, clientX: 1, clientY: 1 });
    firePointer(control, "pointerup", { pointerId: 9, clientX: 1, clientY: 1 });
    expect(seen).toEqual([]);
    // Idle still hears about it.
    expect(activity).toBe(1);
  });

  it("expires a real touch that went silent, but not a recent one", () => {
    const root = makeRoot({ width: 100, height: 100 });
    input = createInput(root);
    const seen = record(input);
    firePointer(root, "pointerdown", { pointerId: 2, clientX: 5, clientY: 5 });
    vi.advanceTimersByTime(STALE_TOUCH_MS - 2000);
    firePointer(root, "pointerdown", { pointerId: 3, clientX: 6, clientY: 6 });
    vi.advanceTimersByTime(3000);
    expect(seen.filter((s) => s.phase === "cancel").map((s) => s.p.id)).toEqual([2]);
    expect([...input.pointers.keys()]).toEqual([3]);
  });

  it("keeps a long hold alive while it keeps sending events", () => {
    const root = makeRoot({ width: 100, height: 100 });
    input = createInput(root);
    firePointer(root, "pointerdown", { pointerId: 2, clientX: 5, clientY: 5 });
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(STALE_TOUCH_MS / 2);
      firePointer(root, "pointermove", { pointerId: 2, clientX: 5 + (i % 2), clientY: 5 });
    }
    expect(input.pointers.has(2)).toBe(true);
  });

  it("never expires injected touches, which bots and the emulator hold on purpose", () => {
    const root = makeRoot({ width: 100, height: 100 });
    input = createInput(root);
    const id = input.inject.down(50, 50);
    vi.advanceTimersByTime(STALE_TOUCH_MS * 3);
    expect(input.pointers.has(id)).toBe(true);
  });

  it("drops quiet touches the browser no longer lists", () => {
    const root = makeRoot({ width: 100, height: 100 });
    input = createInput(root);
    const seen = record(input);
    firePointer(root, "pointerdown", { pointerId: 5, clientX: 5, clientY: 5 });
    window.dispatchEvent(new TouchEvent("touchend", { touches: [] }));
    expect(input.pointers.has(5)).toBe(true);
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new TouchEvent("touchstart", { touches: [] }));
    expect(input.pointers.has(5)).toBe(false);
    expect(seen.at(-1)?.phase).toBe("cancel");
  });

  it("treats a repeated pointerdown id as a lost up", () => {
    const root = makeRoot({ width: 100, height: 100 });
    input = createInput(root);
    const seen = record(input);
    firePointer(root, "pointerdown", { pointerId: 8, clientX: 5, clientY: 5 });
    firePointer(root, "pointerdown", { pointerId: 8, clientX: 50, clientY: 50 });
    expect(seen.map((s) => s.phase)).toEqual(["down", "cancel", "down"]);
    expect(input.pointers.get(8)?.x).toBe(50);
  });
});

describe("injection", () => {
  it("dispatches at the element under the point and keeps later events on it", () => {
    const root = makeRoot({ width: 100, height: 100 });
    const button = document.createElement("div");
    const target: string[] = [];
    button.addEventListener("pointerdown", (e) => {
      target.push(e.type);
      e.stopPropagation();
    });
    button.addEventListener("pointermove", (e) => target.push(e.type));
    button.addEventListener("pointerup", (e) => target.push(e.type));
    root.append(button);
    Object.defineProperty(document, "elementFromPoint", {
      value: (x: number) => (x < 50 ? button : root),
      configurable: true,
    });
    input = createInput(root);
    const seen = record(input);
    const id = input.inject.down(10, 10);
    input.inject.move(id, 90, 90);
    input.inject.up(id);
    expect(target).toEqual(["pointerdown", "pointermove", "pointerup"]);
    expect(seen).toEqual([]);
  });

  it("does not count bot touches as activity", () => {
    const root = makeRoot({ width: 100, height: 100 });
    input = createInput(root);
    let activity = 0;
    input.onActivity(() => activity++);
    const id = input.inject.down(10, 10);
    input.inject.up(id);
    expect(activity).toBe(0);
  });
});

describe("debug touch emulator", () => {
  const shiftClick = (x: number, y: number, shiftKey = true) => {
    firePointer(document.body, "pointerdown", {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
      shiftKey,
    });
    firePointer(document.body, "pointerup", {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: x,
      clientY: y,
    });
  };

  it("is off unless debug is passed", () => {
    const root = makeRoot({ width: 400, height: 400 });
    input = createInput(root);
    expect(input.emulating).toBe(false);
    expect(document.querySelector(".hc-touch-emulator")).toBeNull();
    shiftClick(100, 100);
    expect(input.pointers.size).toBe(0);
  });

  it("pins, moves and lifts touches with the mouse when debug is on", () => {
    const root = makeRoot({ width: 400, height: 400 });
    input = createInput(root, { debug: true });
    expect(input.emulating).toBe(true);
    expect(document.querySelector(".hc-touch-emulator")).not.toBeNull();

    shiftClick(100, 100);
    shiftClick(300, 300);
    expect(input.pointers.size).toBe(2);
    const pins = [...input.pointers.values()];
    expect(pins.every((p) => p.id >= SYNTHETIC_ID_BASE && !p.synthetic)).toBe(true);

    // Drag the first pin.
    const mouse = { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1 };
    firePointer(document.body, "pointerdown", { ...mouse, clientX: 100, clientY: 100 });
    firePointer(document.body, "pointermove", { ...mouse, clientX: 150, clientY: 120 });
    firePointer(document.body, "pointerup", { ...mouse, clientX: 150, clientY: 120 });
    expect(pins.map((p) => input?.pointers.get(p.id)?.x)).toEqual([150, 300]);

    // Click it to lift it.
    shiftClick(150, 120, false);
    expect([...input.pointers.values()].map((p) => p.x)).toEqual([300]);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(input.pointers.size).toBe(0);
  });
});
