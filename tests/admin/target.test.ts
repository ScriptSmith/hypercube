import { describe, expect, it } from "vitest";
import {
  describeTarget,
  type FrameFacts,
  matchTarget,
  readTarget,
  type Target,
} from "../../src/core/admin/target";

const frame = (over: Partial<FrameFacts> = {}): FrameFacts => ({
  frame: "p3",
  group: "bank",
  zone: "A",
  side: 0,
  app: "diag",
  ...over,
});

describe("matchTarget", () => {
  const cases: [Target, Partial<FrameFacts>, boolean][] = [
    [{ k: "all" }, {}, true],
    [{ k: "frames", ids: ["p1", "p3"] }, {}, true],
    [{ k: "frames", ids: ["p1", "p2"] }, {}, false],
    [{ k: "frames", ids: [] }, {}, false],
    [{ k: "group", group: "bank" }, {}, true],
    [{ k: "group", group: "wall" }, {}, false],
    [{ k: "zone", zone: "A" }, {}, true],
    [{ k: "zone", zone: "B" }, {}, false],
    [{ k: "zone", zone: "A" }, { zone: undefined }, false],
    [{ k: "side", side: 0 }, {}, true],
    [{ k: "side", side: 1 }, {}, false],
    [{ k: "side", side: 1, group: "bank" }, { side: 1 }, true],
    [{ k: "side", side: 1, group: "other" }, { side: 1 }, false],
    [{ k: "app", app: "diag" }, {}, true],
    [{ k: "app", app: "idle" }, {}, false],
  ];
  it.each(cases)("%j against %j is %s", (target, over, expected) => {
    expect(matchTarget(target, frame(over))).toBe(expected);
  });
});

describe("readTarget", () => {
  it("accepts every well-formed target unchanged", () => {
    const targets: Target[] = [
      { k: "all" },
      { k: "frames", ids: ["a", "b"] },
      { k: "group", group: "g" },
      { k: "zone", zone: "z" },
      { k: "side", side: 1 },
      { k: "side", side: 0, group: "g" },
      { k: "app", app: "diag" },
    ];
    for (const t of targets) expect(readTarget(JSON.parse(JSON.stringify(t)))).toEqual(t);
  });

  it("drops stray fields", () => {
    expect(readTarget({ k: "all", ids: ["x"] })).toEqual({ k: "all" });
  });

  it("rejects malformed targets", () => {
    for (const bad of [
      null,
      "all",
      [],
      { k: "everyone" },
      { k: "frames", ids: "a" },
      { k: "frames", ids: ["a", 3] },
      { k: "frames", ids: Array.from({ length: 200 }, (_, i) => `f${i}`) },
      { k: "group", group: "" },
      { k: "side", side: 2 },
      { k: "side", side: 1, group: 4 },
      { k: "app" },
    ]) {
      expect(readTarget(bad)).toBeNull();
    }
  });
});

describe("describeTarget", () => {
  it("reads plainly", () => {
    expect(describeTarget({ k: "all" })).toBe("all frames");
    expect(describeTarget({ k: "frames", ids: ["a"] })).toBe("1 frame");
    expect(describeTarget({ k: "frames", ids: ["a", "b"] })).toBe("2 frames");
    expect(describeTarget({ k: "side", side: 1, group: "versus" })).toBe("side B of versus");
    expect(describeTarget({ k: "app", app: "diag" })).toBe("frames running diag");
  });
});
