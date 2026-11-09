import { describe, expect, it } from "vitest";
import { columnSpan, laneAt, lanesFor, SEAM_KEEP } from "../../../src/apps/treetop/layout";

const panel = { width: 1080, height: 1920, seams: [] };
const pair = { width: 2160, height: 1920, seams: [1080] };

describe("lane layout", () => {
  it("makes a panel one full lane in race", () => {
    const [lane, ...rest] = lanesFor(panel, "race");
    expect(rest).toEqual([]);
    expect(lane!.rect).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
    expect(lane!.touch).toEqual(lane!.rect);
    expect(lane!.scale).toBe(1);
  });

  it("stacks a child lane under an adult lane in pads, each 960 tall", () => {
    const lanes = lanesFor(panel, "pads");
    expect(lanes.map((l) => [l.pad, l.rect.y, l.rect.height, l.scale, l.adult])).toEqual([
      ["child", 960, 960, 0.5, false],
      ["adult", 0, 960, 0.5, true],
    ]);
    expect(laneAt(lanes, 500, 1500)?.pad).toBe("child");
    expect(laneAt(lanes, 500, 300)?.pad).toBe("adult");
  });

  it("keeps a pair's flap zones 220 venue px from the seam", () => {
    const lanes = lanesFor(pair, "race");
    expect(lanes).toHaveLength(2);
    const [left, right] = lanes;
    expect(left!.touch.x + left!.touch.width).toBe(1080 - SEAM_KEEP);
    expect(right!.touch.x).toBe(1080 + SEAM_KEEP);
    expect(left!.dim).toEqual([{ x: 860, y: 0, width: 220, height: 1920 }]);
    expect(laneAt(lanes, 1000, 900)).toBe(null);
    expect(laneAt(lanes, 1200, 900)).toBe(null);
    expect(laneAt(lanes, 100, 900)?.slot).toBe(0);
    expect(laneAt(lanes, 2100, 900)?.slot).toBe(1);
    expect(lanesFor(pair, "pads")).toHaveLength(4);
    for (const l of lanesFor(pair, "pads")) {
      const nearest = Math.min(
        Math.abs(l.touch.x - 1080),
        Math.abs(l.touch.x + l.touch.width - 1080),
      );
      expect(nearest).toBeGreaterThanOrEqual(SEAM_KEEP);
    }
  });

  it("puts each lane's screen column directly above it", () => {
    expect(columnSpan(0, 0, 1, 10)).toEqual({ x0: 0, x1: 0.1 });
    expect(columnSpan(9, 0, 1, 10)).toEqual({ x0: 0.9, x1: 1 });
    expect(columnSpan(2, 1, 2, 5)).toEqual({ x0: 0.5, x1: 0.6 });
    const quarter = columnSpan(4, 3, 4, 5);
    expect(quarter.x0).toBeCloseTo(0.95);
    expect(quarter.x1).toBeCloseTo(1);
  });
});
