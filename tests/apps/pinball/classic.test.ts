import { describe, expect, it } from "vitest";
import { buildTable } from "../../../src/apps/pinball/layout";
import { botGame, rig } from "./helpers";

describe("pinball classic table", () => {
  it("plays exactly as before the themes: the same bot games give the same scores", () => {
    // Recorded on 2026-11-08 before the table was split into a skeleton and a middle. Any change
    // to the classic table's shapes, order of events or rules shows up here.
    const expected: [boolean, number, number, number][] = [
      [false, 3, 57600, 7],
      [false, 5, 141970, 7],
      [false, 11, 206500, 7],
      [true, 3, 56080, 5],
      [true, 5, 172890, 8],
      [true, 11, 34100, 6],
    ];
    for (const [mirror, seed, score, drains] of expected) {
      const r = rig({ mirror, config: { balls: 5 } });
      r.table.start("bot");
      botGame(r, seed, 240, true);
      expect([r.table.score, r.table.stats.drains], `mirror ${mirror} seed ${seed}`).toEqual([
        score,
        drains,
      ]);
    }
  });

  it("keeps its middle: lanes, three bumpers, the target bank and the spinner", () => {
    const t = buildTable({ mirror: false });
    expect(t.theme).toBe("classic");
    expect(t.shapes).toHaveLength(30);
    expect(t.shapes.filter((s) => s.tag === "bumper")).toHaveLength(3);
    expect(t.shapes.filter((s) => s.tag === "target")).toHaveLength(3);
    expect(t.rollovers.map((r) => r.tag)).toEqual([
      "lane",
      "lane",
      "lane",
      "inlane",
      "inlane",
      "outlane",
      "outlane",
    ]);
    expect(t.gates.map((g) => g.tag)).toEqual(["deck", "spinner"]);
  });
});
