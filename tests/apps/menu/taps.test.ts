import { describe, expect, it } from "vitest";
import { createTapTracker } from "../../../src/apps/menu/taps";

/** Two 400 x 400 tiles side by side at y 0 to 400, with a gap between x 400 and 500. */
const hit = (x: number, y: number) => {
  if (y < 0 || y > 400) return -1;
  if (x >= 0 && x <= 400) return 0;
  if (x >= 500 && x <= 900) return 1;
  return -1;
};

const tracker = () => createTapTracker({ hit, slop: 120, swipe: 200 });

describe("tap tracker", () => {
  it("launches a tile tapped in place", () => {
    const t = tracker();
    t.down(1, 200, 200);
    expect(t.armed()).toEqual(new Set([0]));
    expect(t.up(1, 205, 198)).toEqual({ type: "launch", index: 0 });
    expect(t.armed()).toEqual(new Set());
  });

  it("cancels a press that slides off its tile, even if it comes back", () => {
    const t = tracker();
    t.down(1, 380, 200);
    t.move(1, 420, 200);
    expect(t.armed()).toEqual(new Set());
    t.move(1, 380, 200);
    expect(t.up(1, 380, 200)).toBeNull();
  });

  it("cancels a press that lifts on another tile", () => {
    const t = tracker();
    t.down(1, 350, 200);
    expect(t.up(1, 520, 200)).toBeNull();
  });

  it("cancels a press that travels too far within its tile", () => {
    const t = tracker();
    t.down(1, 50, 50);
    t.move(1, 200, 200);
    expect(t.up(1, 60, 60)).toBeNull();
  });

  it("turns the page on a sideways swipe, and launches nothing", () => {
    const t = tracker();
    t.down(1, 800, 200);
    t.move(1, 600, 210);
    expect(t.up(1, 550, 220)).toEqual({ type: "page", dir: 1 });
    t.down(2, 100, 200);
    expect(t.up(2, 450, 180)).toEqual({ type: "page", dir: -1 });
  });

  it("ignores short or mostly vertical strokes", () => {
    const t = tracker();
    t.down(1, 450, 0);
    expect(t.up(1, 450, 390)).toBeNull();
    t.down(2, 450, 100);
    expect(t.up(2, 600, 100)).toBeNull();
    t.down(3, 100, 0);
    expect(t.up(3, 350, 300)).toBeNull();
  });

  it("does nothing for a background tap or an unknown finger", () => {
    const t = tracker();
    t.down(1, 450, 200);
    expect(t.armed()).toEqual(new Set());
    expect(t.up(1, 450, 200)).toBeNull();
    expect(t.up(99, 200, 200)).toBeNull();
    t.move(98, 200, 200);
  });

  it("forgets cancelled fingers and clears on demand", () => {
    const t = tracker();
    t.down(1, 200, 200);
    t.cancel(1);
    expect(t.up(1, 200, 200)).toBeNull();
    t.down(2, 200, 200);
    t.down(3, 600, 200);
    expect(t.armed()).toEqual(new Set([0, 1]));
    t.clear();
    expect(t.armed()).toEqual(new Set());
    expect(t.up(2, 200, 200)).toBeNull();
  });

  it("tracks each finger on its own", () => {
    const t = tracker();
    t.down(1, 200, 200);
    t.down(2, 600, 200);
    t.move(2, 450, 200);
    expect(t.armed()).toEqual(new Set([0]));
    expect(t.up(2, 450, 200)).toBeNull();
    expect(t.up(1, 200, 200)).toEqual({ type: "launch", index: 0 });
  });

  it("drops the oldest fingers when lifts go missing", () => {
    const t = tracker();
    for (let id = 0; id < 100; id++) t.down(id, 200, 200);
    expect(t.up(0, 200, 200)).toBeNull();
    expect(t.up(99, 200, 200)).toEqual({ type: "launch", index: 0 });
  });

  it("re-reads thresholds, so they can follow the current layout", () => {
    let slop = 10;
    const t = createTapTracker({
      hit,
      get slop() {
        return slop;
      },
      swipe: 200,
    });
    t.down(1, 200, 200);
    expect(t.up(1, 230, 200)).toBeNull();
    slop = 100;
    t.down(2, 200, 200);
    expect(t.up(2, 230, 200)).toEqual({ type: "launch", index: 0 });
  });
});
