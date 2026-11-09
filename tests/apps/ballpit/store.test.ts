import { describe, expect, it } from "vitest";
import {
  addDays,
  browserKV,
  dayOf,
  keyFor,
  loadDay,
  MAX_KEYS,
  memoryKV,
  PREFIX,
  prune,
  saveDay,
  scopeOf,
  storedSums,
} from "../../../src/apps/ballpit/store";
import { createTally } from "../../../src/apps/ballpit/tally";

const scope = scopeOf("a-screen", "main");

describe("daily totals in storage", () => {
  it("survive a reload", () => {
    const kv = memoryKV();
    const day = "2026-10-18";
    const before = createTally(day);
    for (let i = 0; i < 7; i++) before.vote("travel", "a-p1", i % 6);
    before.apply("travel", 0, "a-p2", 3, 4);
    before.vote("season", "a-p1", 0);
    expect(saveDay(kv, scope, before)).toBe(true);

    // The page reloads: a fresh tally starts from what was stored.
    const after = createTally(day);
    after.reset(day, loadDay(kv, scope, day));
    expect(after.sums("travel")).toEqual(before.sums("travel"));
    expect(after.sums("season")).toEqual([1, 0, 0, 0]);
    // And keeps counting from there without double counting the stored votes.
    expect(after.vote("travel", "a-p1", 0)).toEqual({ g: 0, n: 3 });
    expect(after.apply("travel", 0, "a-p2", 3, 4)).toBe(0);
  });

  it("keeps seven days and prunes older and malformed keys", () => {
    const kv = memoryKV();
    const today = "2026-10-18";
    for (let d = 0; d < 12; d++) {
      const t = createTally(addDays(today, -d));
      t.vote("travel", "x", 0);
      saveDay(kv, scope, t);
    }
    kv.set(`${PREFIX}${scope}.garbage`, "{}");
    kv.set("someone.else", "keep me");
    prune(kv, today);
    const days = kv
      .keys()
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => k.slice(-10))
      .sort();
    expect(days).toEqual(Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)));
    expect(kv.get("someone.else")).toBe("keep me");
  });

  it("caps how many keys it keeps across frames and groups", () => {
    const kv = memoryKV();
    const today = "2026-10-18";
    for (let f = 0; f < MAX_KEYS + 10; f++) {
      const t = createTally(addDays(today, -(f % 3)));
      t.vote("travel", "x", 0);
      saveDay(kv, scopeOf(`f${f}`, "main"), t);
    }
    prune(kv, today);
    const keys = kv.keys().filter((k) => k.startsWith(PREFIX));
    expect(keys.length).toBe(MAX_KEYS);
    // The newest days are the ones kept.
    expect(keys.filter((k) => k.endsWith(today)).length).toBe(Math.ceil((MAX_KEYS + 10) / 3));
  });

  it("reads yesterday's sums for the marks", () => {
    const kv = memoryKV();
    const t = createTally("2026-10-17");
    t.vote("pet", "a", 1);
    t.vote("pet", "b", 1);
    t.vote("pet", "b", 3);
    saveDay(kv, scope, t);
    expect(storedSums(kv, scope, "2026-10-17", "pet", 4)).toEqual([0, 2, 0, 1]);
    expect(storedSums(kv, scope, "2026-10-16", "pet", 4)).toBeNull();
  });

  it("survives storage that is missing, blocked or full, or holds junk", () => {
    const g = globalThis as { window?: unknown };
    const saved = g.window;
    try {
      // No window at all.
      delete g.window;
      const none = browserKV();
      expect(none.get("x")).toBeNull();
      expect(none.set("x", "y")).toBe(false);
      expect(none.keys()).toEqual([]);
      expect(() => none.remove("x")).not.toThrow();
      // Storage that throws on every call, as a blocked or full one does.
      const throwing = {
        get length(): number {
          throw new Error("blocked");
        },
        key: () => {
          throw new Error("blocked");
        },
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      };
      g.window = { localStorage: throwing };
      const kv = browserKV();
      expect(kv.get("x")).toBeNull();
      expect(kv.set("x", "y")).toBe(false);
      expect(kv.keys()).toEqual([]);
      expect(() => kv.remove("x")).not.toThrow();
      expect(() => prune(kv, "2026-10-18")).not.toThrow();
      expect(saveDay(kv, scope, createTally("2026-10-18"))).toBe(false);
    } finally {
      g.window = saved;
    }
    const kv = memoryKV();
    kv.set(keyFor(scope, "2026-10-18"), "not json");
    expect(loadDay(kv, scope, "2026-10-18").size).toBe(0);
    kv.set(keyFor(scope, "2026-10-18"), JSON.stringify({ q: { travel: { g: 0, r: { a: [1] } } } }));
    expect(loadDay(kv, scope, "2026-10-18").size).toBe(0);
  });

  it("names days in local time", () => {
    const ms = Date.UTC(2026, 9, 18, 15, 30);
    expect(dayOf(ms, 0)).toBe("2026-10-18");
    // Brisbane-style +10:00 is already the next day.
    expect(dayOf(ms, 600)).toBe("2026-10-19");
    expect(dayOf(ms, -600)).toBe("2026-10-18");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("makes storage-safe scopes", () => {
    expect(scopeOf("a.b/c", "g 1")).toBe("a_b_c~g_1");
    expect(scopeOf("x".repeat(200), "g").length).toBeLessThanOrEqual(96);
  });
});
