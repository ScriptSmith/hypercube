import { describe, expect, it } from "vitest";
import { VENUE_SIZE } from "../../../src/core/frame";
import { BALL_R, CLIMB_MS, CROSS_V, TABLE_W } from "../../../src/apps/pinball/config";
import {
  EXIT_U,
  buildTable,
  exitU,
  mirroredAt,
  RETURN_U,
  returnU,
} from "../../../src/apps/pinball/layout";
import { endSpeeds, motionAt, pointAlong, polyLength } from "../../../src/apps/pinball/path";

describe("pinball layout", () => {
  it("mirrors every part of the table", () => {
    const a = buildTable({ mirror: false });
    const b = buildTable({ mirror: true });
    expect(b.shapes).toHaveLength(a.shapes.length);
    a.shapes.forEach((s, i) => {
      const t = b.shapes[i]!;
      expect(t.kind).toBe(s.kind);
      if (s.kind === "seg" && t.kind === "seg") {
        expect(t.ax).toBeCloseTo(TABLE_W - s.ax, 6);
        expect(t.by).toBeCloseTo(s.by, 6);
      } else if (s.kind === "circle" && t.kind === "circle") {
        expect(t.x).toBeCloseTo(TABLE_W - s.x, 6);
      }
    });
    // Left is still left: the mirrored left flipper points right from its pivot.
    for (const t of [a, b]) {
      const left = t.flippers.find((f) => f.name === "left")!;
      const right = t.flippers.find((f) => f.name === "right")!;
      expect(left.px).toBeLessThan(right.px);
      expect(Math.cos(left.rest)).toBeGreaterThan(0);
      expect(Math.cos(right.rest)).toBeLessThan(0);
    }
  });

  it("agrees with the deck about where balls leave and arrive", () => {
    for (const mirror of [false, true]) {
      const t = buildTable({ mirror });
      expect(t.exitU).toBeCloseTo(exitU(mirror), 9);
      expect(t.returnU).toBeCloseTo(returnU(mirror), 9);
      expect(t.exitTube.at(-1)!.x / TABLE_W).toBeCloseTo(t.exitU, 9);
      expect(t.returnTube[0]!.x / TABLE_W).toBeCloseTo(t.returnU, 9);
      expect(t.exitTube.at(-1)!.y).toBeLessThan(-BALL_R);
    }
    expect(EXIT_U).toBeGreaterThan(0);
    expect(RETURN_U).toBeLessThan(1);
    expect(mirroredAt(0, 1)).toBe(false);
    expect([0, 1].map((h) => mirroredAt(h, 2))).toEqual([true, false]);
  });

  it("builds the outlane posts down, for a posts gift to raise", () => {
    expect(buildTable({ mirror: false }).posts.every((p) => !p.on)).toBe(true);
    expect(buildTable({ mirror: true }).posts.every((p) => !p.on)).toBe(true);
  });
});

describe("pinball tubes", () => {
  it("move steadily from one end to the other", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: -300 },
      { x: 400, y: -300 },
    ];
    const m = { length: polyLength(pts), ms: 600, v0: 2000, v1: 500 };
    let last = -1;
    for (let t = 0; t <= 600; t += 10) {
      const s = motionAt(m, t).s;
      expect(s).toBeGreaterThanOrEqual(last - 1e-9);
      last = s;
    }
    expect(motionAt(m, 600).s).toBeCloseTo(700, 6);
    expect(motionAt(m, 600).done).toBe(true);
    expect(pointAlong(pts, 500)).toMatchObject({ x: 200, y: -300 });
  });

  it("cross between a table and the screen at the same physical speed", () => {
    // A table's climb ends at CROSS_V table px a second; the screen's chute starts at CROSS_V
    // times its scale, so the ball keeps its pace on the way up.
    const t = buildTable({ mirror: false });
    const climb = { length: polyLength(t.exitTube), ms: CLIMB_MS, v0: 2000, v1: CROSS_V };
    expect(endSpeeds(climb).v1).toBeCloseTo(CROSS_V, 6);
    const k = VENUE_SIZE.screen.width / (6 * TABLE_W);
    const chute = { length: 480, ms: 300, v0: CROSS_V * k, v1: 3500 };
    expect(endSpeeds(chute).v0 / k).toBeCloseTo(CROSS_V, 6);
  });
});
