import { describe, expect, it } from "vitest";
import { createGestures, type GestureEvent } from "../../../src/apps/transit/gesture";

const make = () => createGestures({ slop: 10, pinch: 200 });
const pans = (events: GestureEvent[]) =>
  events.reduce((sum, e) => (e.kind === "pan" ? { dx: sum.dx + e.dx, dy: sum.dy + e.dy } : sum), {
    dx: 0,
    dy: 0,
  });
const zoom = (events: GestureEvent[]) =>
  events.reduce((k, e) => (e.kind === "zoom" ? k * e.scale : k), 1);

describe("map gestures", () => {
  it("a touch that stays within the slop is a tap, wherever it lifts", () => {
    const g = make();
    g.down(1, 100, 100, 0);
    expect(g.move(1, 106, 104, 50)).toEqual([]);
    expect(g.up(1, 107, 105, 120)).toEqual([{ kind: "tap", x: 107, y: 105 }]);
    expect(g.active).toBe(false);
    expect(g.fingers).toBe(0);
  });

  it("a drag moves the ground with the finger, slop included, and is never a tap", () => {
    const g = make();
    g.down(1, 100, 100, 0);
    const first = g.move(1, 115, 100, 16);
    expect(first[0]).toEqual({ kind: "start" });
    expect(pans(first)).toEqual({ dx: 15, dy: 0 });
    expect(g.active).toBe(true);
    expect(pans(g.move(1, 140, 130, 32))).toEqual({ dx: 25, dy: 30 });
    const end = g.up(1, 140, 130, 300);
    expect(end.some((e) => e.kind === "tap")).toBe(false);
    expect(end.at(-1)).toMatchObject({ kind: "end" });
    expect(g.active).toBe(false);
  });

  it("lets go with the finger's speed, or none after it stopped", () => {
    const g = make();
    g.down(1, 0, 0, 0);
    for (let i = 1; i <= 10; i++) g.move(1, i * 16, 0, i * 16);
    const fast = g.up(1, 160, 0, 164).at(-1)!;
    expect(fast.kind).toBe("end");
    if (fast.kind === "end") expect(fast.vx).toBeGreaterThan(700);

    g.down(2, 0, 0, 1000);
    for (let i = 1; i <= 10; i++) g.move(2, i * 16, 0, 1000 + i * 16);
    const still = g.up(2, 160, 0, 1400).at(-1)!;
    if (still.kind === "end") expect(Math.abs(still.vx)).toBeLessThan(1);
  });

  it("a second finger near the first pinches: spreading zooms in about the middle", () => {
    const g = make();
    g.down(1, 100, 100, 0);
    g.move(1, 120, 100, 16);
    expect(g.down(2, 200, 100, 20)).toEqual([]);
    const out = g.move(2, 280, 100, 40);
    expect(zoom(out)).toBeCloseTo(160 / 80, 6);
    const z = out.find((e) => e.kind === "zoom")!;
    expect(z).toMatchObject({ x: 200, y: 100 });
    // The midpoint moved from 160 to 200.
    expect(pans(out)).toEqual({ dx: 40, dy: 0 });
    // Neither finger of a pinch taps when it lifts.
    expect(g.up(2, 280, 100, 60).some((e) => e.kind === "tap")).toBe(false);
    // The first finger carries on panning without a jump.
    expect(pans(g.move(1, 130, 100, 80))).toEqual({ dx: 10, dy: 0 });
  });

  it("two fingers that land together and spread pinch from where they landed", () => {
    const g = make();
    g.down(1, 100, 100, 0);
    g.down(2, 160, 100, 5);
    const a = g.move(1, 80, 100, 20);
    expect(a[0]).toEqual({ kind: "start" });
    const b = g.move(2, 180, 100, 25);
    expect(zoom([...a, ...b])).toBeCloseTo(100 / 60, 6);
    expect(pans([...a, ...b]).dx).toBeCloseTo(0, 9);
  });

  it("someone else's finger far away neither pans nor pinches, but can still tap", () => {
    const g = make();
    g.down(1, 100, 100, 0);
    g.move(1, 130, 100, 16);
    g.down(2, 2000, 100, 20);
    expect(g.move(2, 2100, 100, 40)).toEqual([]);
    g.down(3, 3000, 100, 50);
    expect(g.up(3, 3000, 100, 90)).toEqual([{ kind: "tap", x: 3000, y: 100 }]);
    // Their drag ends quietly, and the owner keeps the map.
    expect(g.up(2, 2100, 100, 100)).toEqual([]);
    expect(g.active).toBe(true);
    expect(pans(g.move(1, 150, 100, 120))).toEqual({ dx: 20, dy: 0 });
  });

  it("the second finger takes over when the owner lifts first", () => {
    const g = make();
    g.down(1, 100, 100, 0);
    g.move(1, 120, 100, 16);
    g.down(2, 150, 100, 20);
    g.up(1, 120, 100, 30);
    expect(g.active).toBe(true);
    expect(pans(g.move(2, 170, 110, 50))).toEqual({ dx: 20, dy: 10 });
    expect(g.up(2, 170, 110, 400).at(-1)).toMatchObject({ kind: "end" });
  });

  it("a cancelled drag ends without a glide, and is bounded and clearable", () => {
    const g = make();
    g.down(1, 0, 0, 0);
    g.move(1, 50, 0, 16);
    expect(g.cancel(1)).toEqual([{ kind: "end", vx: 0, vy: 0 }]);
    for (let i = 0; i < 50; i++) g.down(100 + i, i * 1000, 0, 0);
    expect(g.fingers).toBe(20);
    g.clear();
    expect(g.fingers).toBe(0);
    expect(g.up(100, 0, 0, 10)).toEqual([]);
  });

  it("limits a single pinch step, so a jumpy touch can't fling the zoom", () => {
    const g = make();
    g.down(1, 100, 100, 0);
    g.down(2, 102, 100, 0);
    const out = [...g.move(1, 0, 100, 16), ...g.move(2, 300, 100, 20)];
    for (const e of out) if (e.kind === "zoom") expect(e.scale).toBeLessThanOrEqual(2);
  });
});
