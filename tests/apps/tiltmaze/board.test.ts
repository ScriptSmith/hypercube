import { describe, expect, it } from "vitest";
import { CHANGE_S, createBoard, ENTER_S, GONE_S, SINK_S } from "../../../src/apps/tiltmaze/board";
import { DEG, DEMO_MAX_LEVEL, HANDLING, HZ, MAX_LEVEL } from "../../../src/apps/tiltmaze/config";
import { createControls, PAD_REACH, padCommand } from "../../../src/apps/tiltmaze/controls";
import { layoutFor } from "../../../src/apps/tiltmaze/layout";
import { cellCentre } from "../../../src/apps/tiltmaze/maze";
import { placeBall } from "../../../src/apps/tiltmaze/physics";
import { createRng } from "../../../src/core/rng";

const DT = 1 / HZ;

const boardOf = (holes = false, speed: "gentle" | "lively" = "gentle") =>
  createBoard({
    index: 0,
    orient: "portrait",
    holes,
    handling: HANDLING[speed],
    rng: createRng("board"),
    human: () => true,
  });

const run = (b: ReturnType<typeof boardOf>, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * HZ); i++) b.step(DT);
};

describe("tiltmaze pad", () => {
  it("tips towards where you touch, more the further out, never past the rim", () => {
    const pad = { x: 500, y: 1600, r: 200 };
    expect(padCommand(pad, 500, 1600)).toEqual({ x: 0, y: 0 });
    const right = padCommand(pad, 500 + pad.r * PAD_REACH, 1600);
    expect(right.x).toBeCloseTo(1, 9);
    expect(right.y).toBeCloseTo(0, 9);
    const half = padCommand(pad, 500, 1600 - (pad.r * PAD_REACH) / 2);
    expect(half.y).toBeCloseTo(-0.5, 9);
    const far = padCommand(pad, 900, 2000);
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(1, 9);
    expect(far.x).toBeCloseTo(far.y, 9);
  });

  it("follows the latest finger on a pad and falls back when it lifts", () => {
    const layout = layoutFor({
      kind: "panel",
      width: 1080,
      height: 1920,
      reachTop: { adult: 0, child: 1047 },
      seams: [],
      boards: 3,
      together: false,
    });
    const pad = layout.boards[0]!.pad!;
    const c = createControls(layout);
    expect(c.down(1, pad.x + 100, pad.y, false)).toEqual({ board: 0, kind: "pad" });
    expect(c.down(2, pad.x - 100, pad.y, true)).toEqual({ board: 0, kind: "pad" });
    expect(c.pad(0)!.x).toBeLessThan(0);
    expect(c.pad(0)!.synthetic).toBe(true);
    c.up(2);
    expect(c.pad(0)!.x).toBeGreaterThan(0);
    // Sliding off the pad keeps steering, clamped.
    c.move(1, pad.x + 2000, pad.y);
    expect(c.pad(0)!.x).toBeCloseTo(1, 9);
    c.up(1);
    expect(c.pad(0)).toBeNull();
    // A touch away from the pad takes nothing.
    expect(c.down(3, 20, 20, false)).toBeNull();
  });

  it("reads a lever from end to end", () => {
    const layout = layoutFor({
      kind: "pair",
      width: 2160,
      height: 1920,
      reachTop: { adult: 0, child: 1047 },
      seams: [1080],
      boards: 3,
      together: true,
    });
    const { h, v } = layout.boards[0]!.levers!;
    const c = createControls(layout);
    expect(c.down(1, h.x1, h.y1, false)?.kind).toBe("h");
    expect(c.lever(0, "h")!.v).toBeCloseTo(1, 9);
    c.move(1, (h.x0 + h.x1) / 2, h.y0);
    expect(c.lever(0, "h")!.v).toBeCloseTo(0, 9);
    expect(c.down(2, v.x0, v.y0, false)?.kind).toBe("v");
    expect(c.lever(0, "v")!.v).toBeCloseTo(-1, 9);
  });
});

describe("tiltmaze board", () => {
  it("tips at a bounded rate up to its largest tilt and eases back level", () => {
    for (const speed of ["gentle", "lively"] as const) {
      const h = HANDLING[speed];
      const b = boardOf(false, speed);
      b.steer(3, 0);
      expect(b.target.x).toBeCloseTo(h.maxTilt, 9);
      let prev = 0;
      for (let i = 0; i < HZ; i++) {
        b.step(DT);
        expect(b.tilt.x - prev).toBeLessThanOrEqual(h.rate * DT + 1e-12);
        expect(b.tilt.x).toBeLessThanOrEqual(h.maxTilt + 1e-12);
        prev = b.tilt.x;
      }
      expect(b.tilt.x).toBeCloseTo(h.maxTilt, 3);
      // At most about 12 degrees, and visible as motion: it takes a while to get there.
      expect(h.maxTilt).toBeLessThanOrEqual(12.5 * DEG);
      expect(h.maxTilt / h.rate).toBeGreaterThan(0.15);
      b.steer(0, 0);
      run(b, 1);
      expect(Math.abs(b.tilt.x)).toBeLessThan(0.001);
    }
  });

  it("finishes once in the goal, levels up and drops a new ball in at the next maze's start", () => {
    const b = boardOf();
    b.mode = "people";
    run(b, ENTER_S + 0.05);
    expect(b.phase).toBe("roll");
    const g = cellCentre(b.maze, b.maze.goal);
    const first = b.maze;
    placeBall(b.ball, g.x, g.z);
    run(b, 1);
    expect(b.events.filter((e) => e.type === "finished")).toHaveLength(1);
    expect(b.counts.finished).toBe(1);
    expect(b.level).toBe(2);
    expect(b.phase).toBe("change");
    expect(b.maze).not.toBe(first);
    for (let i = 0; i < CHANGE_S * HZ && b.phase === "change"; i++) b.step(DT);
    expect(b.phase).toBe("enter");
    const s = cellCentre(b.maze, b.maze.start);
    expect(b.ball.x).toBeCloseTo(s.x, 9);
    expect(b.ball.z).toBeCloseTo(s.z, 9);
  });

  it("swallows the ball in a hole and brings it back at the start", () => {
    const b = boardOf(true);
    b.setLevel(4);
    run(b, CHANGE_S + ENTER_S + 0.05);
    expect(b.phase).toBe("roll");
    const h = b.maze.holes[0]!;
    placeBall(b.ball, h.x, h.z);
    run(b, 0.1);
    expect(b.phase).toBe("sink");
    expect(b.counts.falls).toBe(1);
    expect(b.events.filter((e) => e.type === "fell")).toHaveLength(1);
    run(b, SINK_S + GONE_S);
    expect(b.phase).toBe("enter");
    const s = cellCentre(b.maze, b.maze.start);
    expect(b.ball.x).toBeCloseTo(s.x, 9);
    expect(b.level).toBe(4);
  });

  it("keeps the demonstration on the first levels and caps people at the top level", () => {
    const b = boardOf();
    b.mode = "demo";
    const seen = new Set<number>();
    for (let k = 0; k < 6; k++) {
      run(b, CHANGE_S + ENTER_S + 0.05);
      seen.add(b.level);
      const g = cellCentre(b.maze, b.maze.goal);
      placeBall(b.ball, g.x, g.z);
      run(b, 1);
    }
    expect(Math.max(...seen)).toBeLessThanOrEqual(DEMO_MAX_LEVEL);
    b.mode = "people";
    b.setLevel(MAX_LEVEL + 3);
    expect(b.level).toBe(MAX_LEVEL);
    b.setLevel(-2);
    expect(b.level).toBe(1);
  });
});
