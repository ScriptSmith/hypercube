import { describe, expect, it } from "vitest";
import { TEXT } from "../../../src/apps/xrd/captions";
import { CHAPTER_IDS, chapterNumbering, WALL_SETS } from "../../../src/apps/xrd/ids";

describe("chapter numbers", () => {
  it("count 1 to 6 across the wall's columns in every set, with no gaps", () => {
    for (const set of Object.values(WALL_SETS)) {
      const numberOf = chapterNumbering(
        "wall",
        set.map((id) => [id]),
      );
      expect(set.map(numberOf)).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  it("are the poster's numbers on every other kind", () => {
    for (const kind of ["panel", "pair", "kiosk"]) {
      const numberOf = chapterNumbering(kind, [CHAPTER_IDS.slice(0, 6), CHAPTER_IDS.slice(6)]);
      for (const id of CHAPTER_IDS) expect(numberOf(id)).toBe(TEXT[id].number);
    }
  });
});
