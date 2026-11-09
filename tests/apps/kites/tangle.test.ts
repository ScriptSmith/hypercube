import { describe, expect, it } from "vitest";
import {
  CATCH_S,
  createTangles,
  crossing,
  FREE_S,
  type Line,
  MAX_S,
} from "../../../src/apps/kites/tangle";

const line = (key: string, x0: number, x1: number, y1 = 1, group = key): Line => ({
  key,
  group,
  x0,
  y0: 0,
  x1,
  y1,
});

/** Two lines from 0.2 and 0.4 that cross (or not) depending on where their kites are. */
const crossed = (): Line[] => [line("a", 0.2, 0.6), line("b", 0.4, 0.1)];
const apart = (): Line[] => [line("a", 0.2, 0.1), line("b", 0.4, 0.6)];

const run = (t: ReturnType<typeof createTangles>, lines: Line[], seconds: number, dt = 0.05) => {
  const events = [];
  for (let s = 0; s < seconds - 1e-9; s += dt) events.push(...t.update(lines, dt));
  return events;
};

describe("crossing lines", () => {
  it("are found where they cross", () => {
    const c = crossing(line("a", 0, 1), line("b", 1, 0));
    expect(c).not.toBeNull();
    expect(c!.x).toBeCloseTo(0.5);
    expect(c!.y).toBeCloseTo(0.5);
    expect(crossing(line("a", 0, 0), line("b", 1, 1))).toBeNull();
  });

  it("don't count when they only brush past at a shallow angle", () => {
    expect(crossing(line("a", 0, 0.1), line("b", 0.05, 0.02))).toBeNull();
  });

  it("don't count right where they leave the ground side by side", () => {
    expect(
      crossing(line("a", 0, 1, 1), { key: "b", group: "b", x0: 0.01, y0: 0, x1: -0.5, y1: 1 }),
    ).toBeNull();
  });
});

describe("tangles", () => {
  it("catch after the lines have crossed for a second", () => {
    const t = createTangles();
    expect(run(t, crossed(), CATCH_S - 0.1)).toHaveLength(0);
    const ev = run(t, crossed(), 0.2);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.on).toBe(true);
    expect(t.caught("a")).toBe(true);
    expect(t.caught("b")).toBe(true);
    expect(t.active()).toHaveLength(1);
  });

  it("never catch a kite sweeping through a line", () => {
    const t = createTangles();
    const events = [];
    // b's kite sweeps right to left across a's line, the crossing sliding up and down it.
    for (let i = 0; i < 200; i++) {
      const x = 0.9 - 0.8 * ((i * 0.05) % 2 < 1 ? (i * 0.05) % 1 : 1 - ((i * 0.05) % 1));
      events.push(...t.update([line("a", 0.2, 0.6), line("b", 0.4, x, 0.9)], 0.05));
    }
    expect(events.filter((e) => e.on)).toHaveLength(0);
  });

  it("never catch a brief crossing", () => {
    const t = createTangles();
    for (let i = 0; i < 20; i++) {
      run(t, crossed(), 0.5);
      run(t, apart(), 0.5);
    }
    expect(t.active()).toHaveLength(0);
  });

  it("end once the lines have uncrossed for a moment", () => {
    const t = createTangles();
    run(t, crossed(), CATCH_S + 0.1);
    expect(run(t, apart(), FREE_S - 0.15)).toHaveLength(0);
    const ev = run(t, apart(), 0.3);
    expect(ev.map((e) => e.on)).toEqual([false]);
    expect(t.caught("a")).toBe(false);
  });

  it("end by themselves after a while, and don't catch again until they have come apart", () => {
    const t = createTangles();
    run(t, crossed(), CATCH_S + 0.1);
    const ev = run(t, crossed(), MAX_S + 0.2);
    expect(ev.filter((e) => !e.on)).toHaveLength(1);
    expect(t.caught("a")).toBe(false);
    expect(run(t, crossed(), 30).filter((e) => e.on)).toHaveLength(0);
    run(t, apart(), 5);
    expect(run(t, crossed(), CATCH_S + 0.2).filter((e) => e.on)).toHaveLength(1);
  });

  it("don't count crossings near the ground", () => {
    // Crossing at a height of about 0.15.
    expect(crossing(line("a", 0, 1, 0.5), line("b", 0.4, 0, 0.5))).toBeNull();
    expect(crossing(line("a", 0, 1, 1), line("b", 0.6, 0, 1))).not.toBeNull();
  });

  it("end when a line goes away", () => {
    const t = createTangles();
    run(t, crossed(), CATCH_S + 0.1);
    const ev = t.update([line("a", 0.2, 0.6)], 0.05);
    expect(ev.map((e) => e.on)).toEqual([false]);
    expect(t.size).toBe(0);
  });

  it("never catch two autopilot kites", () => {
    const t = createTangles();
    const [a, b] = crossed();
    run(
      t,
      [
        { ...a!, auto: true },
        { ...b!, auto: true },
      ],
      3,
    );
    expect(t.active()).toHaveLength(0);
    run(t, [{ ...a!, auto: true }, b!], 1.2);
    expect(t.active()).toHaveLength(1);
  });

  it("ignore lines of the same patch", () => {
    const t = createTangles();
    const [a, b] = crossed();
    run(
      t,
      [
        { ...a!, group: "p" },
        { ...b!, group: "p" },
      ],
      3,
    );
    expect(t.active()).toHaveLength(0);
  });

  it("stay bounded with many lines", () => {
    const t = createTangles();
    const lines = Array.from({ length: 40 }, (_, i) => line(`k${i}`, i / 40, 1 - i / 40));
    run(t, lines, 2);
    expect(t.size).toBeLessThanOrEqual(512);
    t.clear();
    expect(t.size).toBe(0);
  });
});
