// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBotHand, createInput, type InputHandle } from "../../src/core/input";
import type { Pointer } from "../../src/core/types";
import { makeRoot, useFakeClock } from "./dom";

let input: InputHandle;
let log: { phase: string; x: number; y: number; synthetic: boolean }[];

beforeEach(() => {
  useFakeClock();
  input = createInput(makeRoot({ width: 1000, height: 1000 }));
  log = [];
  for (const phase of ["down", "move", "up", "cancel"] as const) {
    input.on(phase, (p: Pointer) => log.push({ phase, x: p.x, y: p.y, synthetic: p.synthetic }));
  }
});

afterEach(() => {
  input.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("bot hand", () => {
  it("taps through the input path", async () => {
    const hand = createBotHand(input);
    const done = hand.tap(100, 200);
    expect(hand.touches).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(log.map((e) => e.phase)).toEqual(["down", "up"]);
    expect(log.every((e) => e.synthetic)).toBe(true);
    expect(hand.touches).toBe(0);
  });

  it("drags along a path at an even pace and ends on the last point", async () => {
    const hand = createBotHand(input);
    const path = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 300 },
    ];
    const done = hand.drag(path, 480);
    await vi.advanceTimersByTimeAsync(240);
    const mid = log.at(-1);
    expect(mid?.x).toBeCloseTo(300, 0);
    expect(mid?.y).toBeCloseTo(0, 0);
    await vi.advanceTimersByTimeAsync(300);
    await done;
    expect(log.at(-1)).toMatchObject({ phase: "up", x: 300, y: 300 });
    expect(log.filter((e) => e.phase === "move").length).toBeGreaterThan(20);
  });

  it("holds over time and can be steered and released", async () => {
    const hand = createBotHand(input);
    const finger = hand.press(10, 10);
    finger.move(20, 30);
    expect(input.pointers.get(finger.id)).toMatchObject({ x: 20, y: 30 });
    const holding = hand.hold(500, 500, 10_000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(hand.touches).toBe(2);
    hand.release();
    await holding;
    expect(hand.touches).toBe(0);
    expect(input.pointers.size).toBe(0);
  });
});
