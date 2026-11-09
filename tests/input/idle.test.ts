// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIdle, type IdleHandle } from "../../src/core/idle";
import { createInput, type InputHandle } from "../../src/core/input";
import { firePointer, makeRoot, useFakeClock } from "./dom";

let root: HTMLElement;
let input: InputHandle;
let idle: IdleHandle;
let changes: boolean[];

beforeEach(() => {
  useFakeClock();
  root = makeRoot({ width: 100, height: 100 });
  input = createInput(root);
  idle = createIdle(input, 60_000);
  changes = [];
  idle.on((v) => changes.push(v));
});

afterEach(() => {
  idle.dispose();
  input.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("idle", () => {
  it("goes idle after the timeout and wakes on a touch", () => {
    vi.advanceTimersByTime(59_000);
    expect(idle.idle).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(idle.idle).toBe(true);
    firePointer(root, "pointerdown", { pointerId: 1 });
    expect(idle.idle).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("counts presses that a control or station overlay swallows", () => {
    const overlay = document.createElement("div");
    overlay.addEventListener("pointerdown", (e) => e.stopPropagation());
    root.append(overlay);
    vi.advanceTimersByTime(50_000);
    firePointer(overlay, "pointerdown", { pointerId: 1 });
    vi.advanceTimersByTime(50_000);
    expect(idle.idle).toBe(false);
  });

  it("ignores bot touches", () => {
    for (let i = 0; i < 70; i++) {
      const id = input.inject.down(10, 10);
      vi.advanceTimersByTime(1000);
      input.inject.up(id);
    }
    expect(idle.idle).toBe(true);
  });

  it("stays awake while held, and pokes count as activity", () => {
    const release = idle.hold();
    vi.advanceTimersByTime(10 * 60_000);
    expect(idle.idle).toBe(false);
    release();
    release();
    vi.advanceTimersByTime(30_000);
    idle.poke();
    vi.advanceTimersByTime(59_000);
    expect(idle.idle).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(idle.idle).toBe(true);
  });
});
