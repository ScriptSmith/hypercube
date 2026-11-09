import { describe, expect, it } from "vitest";
import {
  coefficient,
  createTrack,
  fitArrows,
  hear,
  pause,
  SETTLE_MS,
  settle,
  shown,
} from "../../../src/apps/airflow/forces";

describe("force arrows", () => {
  it("shrink a large shape's arrows together to keep them in its tunnel or chimney", () => {
    const wall = { x: 0, y: 0, width: 5760, height: 2160 };
    // Room enough: drawn as they are.
    expect(
      fitArrows(
        1000,
        1000,
        [
          { x: 400, y: 0 },
          { x: 0, y: -300 },
        ],
        wall,
        40,
      ),
    ).toBe(1);
    // A drag arrow that would run off the right edge, and a lift that fits.
    const drag = { x: 900, y: 0 };
    const lift = { x: 0, y: -500 };
    const k = fitArrows(5300, 1200, [drag, lift], wall, 40);
    expect(5300 + drag.x * k).toBeCloseTo(5720, 6);
    // Both shrink by the same share, so lift still reads as five ninths of drag.
    expect((lift.y * k) / (drag.x * k)).toBeCloseTo(-5 / 9, 9);
    // A lift arrow off the top and a drag off the right: the tighter one sets the share.
    const both = fitArrows(
      5480,
      300,
      [
        { x: 600, y: 0 },
        { x: 0, y: -1300 },
      ],
      wall,
      40,
    );
    expect(both).toBeCloseTo(Math.min((5720 - 5480) / 600, (300 - 40) / 1300), 9);
    // A shape already at the edge draws none.
    expect(fitArrows(5750, 300, [{ x: 100, y: 0 }], wall, 40)).toBe(0);
    // A chimney's sides bound a lift arrow pointing across it.
    const chimney = { x: 1080, y: 0, width: 840, height: 1920 };
    const across = fitArrows(
      1700,
      900,
      [
        { x: 0, y: -300 },
        { x: 400, y: 0 },
      ],
      chimney,
      40,
    );
    expect(1700 + 400 * across).toBeCloseTo(1880, 6);
  });

  it("measure force per the shape's length now, so a shape twice the size reads the same", () => {
    // Drag on a 2D body grows with its size: twice the length, twice the force.
    expect(coefficient(0.02, 0.05, 20)).toBeCloseTo(coefficient(0.04, 0.05, 40), 12);
    expect(coefficient(0.02, 0.05, 20)).toBeCloseTo(0.02 / (0.5 * 0.0025 * 20), 12);
    // Below a cell long, the length counts as one.
    expect(coefficient(0.01, 0.05, 0.2)).toBeCloseTo(coefficient(0.01, 0.05, 1), 12);
  });

  it("ease towards steady readings", () => {
    const t = createTrack();
    for (let i = 0; i < 40; i++) hear(t, 1.4, 0.3, i * 160, 0.16);
    expect(t.drag).toBeCloseTo(1.4, 3);
    expect(t.lift).toBeCloseTo(0.3, 3);
    expect(shown(t)).toBe(1);
  });

  it("shrug off a single pulse", () => {
    const t = createTrack();
    for (let i = 0; i < 20; i++) hear(t, 1.4, 0, i * 160, 0.16);
    hear(t, 35, -20, 3200, 0.16);
    expect(Math.abs(t.drag - 1.4)).toBeLessThan(0.05);
    expect(Math.abs(t.lift)).toBeLessThan(0.05);
    hear(t, Number.NaN, 0, 3360, 0.16);
    expect(t.drag).toBeCloseTo(1.4, 1);
  });

  it("hide the arrows of a shape just swapped in until its readings settle", () => {
    const t = createTrack();
    for (let i = 0; i < 20; i++) hear(t, 1.4, 0.2, i * 160, 0.16);
    settle(t, 4000);
    expect(shown(t)).toBe(0);
    hear(t, 9, 9, 4000 + SETTLE_MS / 2, 0.16);
    expect(t.heard).toBe(0);
    for (let i = 0; i < 4; i++) hear(t, 0.8, 0.5, 4000 + SETTLE_MS + i * 160, 0.16);
    expect(shown(t)).toBe(1);
    expect(t.drag).toBeGreaterThan(0.5);
  });

  it("hide while a shape moves fast and come back from where they were", () => {
    const t = createTrack();
    for (let i = 0; i < 20; i++) hear(t, 1.4, 0.2, i * 160, 0.16);
    pause(t, 3200, 500);
    expect(shown(t)).toBe(0);
    hear(t, 30, 30, 3360, 0.16);
    expect(t.drag).toBeCloseTo(1.4, 2);
    hear(t, 1.5, 0.2, 3800, 0.16);
    expect(t.drag).toBeGreaterThan(1.39);
    expect(t.drag).toBeLessThan(1.5);
    for (let i = 0; i < 3; i++) hear(t, 1.5, 0.2, 3960 + i * 160, 0.16);
    expect(shown(t)).toBe(1);
  });
});
