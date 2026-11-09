import { describe, expect, it } from "vitest";
import type { FrameState } from "../../src/core/admin/agent";
import {
  buildRows,
  buildSelectors,
  describeRow,
  formatAgo,
  formatDuration,
  rowFacts,
  rowsFor,
} from "../../src/core/admin/model";
import type { RosterEntry } from "../../src/core/types";

const NOW = 10_000_000;

const entry = (frame: string, over: Partial<RosterEntry> = {}): RosterEntry => ({
  frame,
  app: "idle",
  group: "g",
  kind: "panel",
  role: "station",
  pos: 0,
  joinedAt: 1,
  ...over,
});

const state = (over: Partial<FrameState> = {}): FrameState => ({
  setup: "bank",
  role: "station",
  group: "g",
  side: 0,
  pos: 0,
  count: 6,
  app: "idle",
  variant: null,
  override: null,
  ...over,
});

describe("buildRows", () => {
  it("groups by zone, then side, then position, and lists consoles apart", () => {
    const roster = [
      entry("zb9-p1", { zone: "B9", pos: 1 }),
      entry("za-p2", { zone: "A", pos: 2 }),
      entry("za-p1", { zone: "A", pos: 1 }),
      entry("zb10", { zone: "B10" }),
      entry("loose"),
      entry("admin-abc", { app: "admin", group: "admin", kind: "kiosk" }),
      entry("cb", { zone: "A", group: "c", pos: 0 }),
      entry("ca", { zone: "A", group: "c", pos: 1 }),
    ];
    const states = new Map([
      ["cb", state({ setup: "corner", group: "c", side: 1 })],
      ["ca", state({ setup: "corner", group: "c", side: 0, pos: 1 })],
    ]);
    const view = buildRows(roster, states, { hub: "za-p1", self: "admin-abc", now: NOW });
    expect(view.consoles.map((c) => c.frame)).toEqual(["admin-abc"]);
    expect(view.zones.map((z) => z.zone)).toEqual(["A", "B9", "B10", null]);
    const zoneA = view.zones[0];
    expect(zoneA?.sides.map((s) => [s.side, s.rows.map((r) => r.frame)])).toEqual([
      [null, ["za-p1", "za-p2"]],
      [0, ["ca"]],
      [1, ["cb"]],
    ]);
    expect(view.rows.find((r) => r.frame === "za-p1")?.hub).toBe(true);
  });

  it("labels rows by name, then display, then frame id, and reads status facts", () => {
    const roster = [
      entry("p1", {
        display: "D1",
        rtt: 23,
        duplicate: true,
        status: {
          app: "diag",
          variant: "fast",
          fps: 59,
          uptime: 3720,
          lastTouch: NOW - 5 * 60_000,
          errors: 2,
          lastError: "boom",
          override: true,
        },
      }),
      entry("p2", { display: "D2", status: { lastTouch: 0 } }),
      entry("p3"),
    ];
    const states = new Map([["p1", state({ name: "Left panel" })]]);
    const rows = buildRows(roster, states, { hub: null, self: "x", now: NOW }).rows;
    const [p1, p2, p3] = ["p1", "p2", "p3"].map((f) => rows.find((r) => r.frame === f));
    expect(rows.map((r) => r.label)).toEqual(["D2", "Left panel", "p3"]);
    expect(p1).toMatchObject({
      label: "Left panel",
      app: "diag",
      variant: "fast",
      duplicate: true,
      override: true,
      errors: 2,
      lastError: "boom",
    });
    expect(rowFacts(p1!)).toEqual(["59 fps", "up 1 h 2 min", "touched 5 min ago", "23 ms"]);
    expect(p2?.label).toBe("D2");
    expect(rowFacts(p2!)).toEqual(["no touches yet"]);
    expect(p3?.label).toBe("p3");
    expect(rowFacts(p3!)).toEqual([]);
    expect(describeRow(p1!)).toBe("panel · station · 1 of 6 · group g");
  });
});

describe("selectors", () => {
  it("offers all, groups, zones, sides and apps, and picks the matching rows", () => {
    const roster = [
      entry("a", { zone: "A", group: "bank", status: { app: "diag" } }),
      entry("b", { zone: "A", group: "bank" }),
      entry("c", { zone: "B", group: "match" }),
    ];
    const states = new Map([["c", state({ setup: "versus", group: "match", side: 1 })]]);
    const rows = buildRows(roster, states, { hub: null, self: "x", now: NOW }).rows;
    const selectors = buildSelectors(rows);
    expect(selectors.map((s) => s.label)).toEqual([
      "All",
      "Group bank",
      "Group match",
      "Zone A",
      "Zone B",
      "match side A",
      "match side B",
      "Running diag",
      "Running idle",
    ]);
    const pick = (label: string) => {
      const s = selectors.find((x) => x.label === label);
      return s ? rowsFor(s.target, rows).map((r) => r.frame) : [];
    };
    expect(pick("All")).toEqual(["a", "b", "c"]);
    expect(pick("Zone A")).toEqual(["a", "b"]);
    expect(pick("match side B")).toEqual(["c"]);
    expect(pick("match side A")).toEqual([]);
    expect(pick("Running idle")).toEqual(["b", "c"]);
  });
});

describe("formatting", () => {
  it("formats durations and ages plainly", () => {
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(3 * 60)).toBe("3 min");
    expect(formatDuration(3 * 3600 + 120)).toBe("3 h 2 min");
    expect(formatDuration(3 * 86400 + 3600)).toBe("3 d 1 h");
    expect(formatAgo(30_000)).toBe("under a minute ago");
    expect(formatAgo(12 * 60_000)).toBe("12 min ago");
    expect(formatAgo(5 * 3600_000)).toBe("5 h ago");
  });
});
