import { describe, expect, it } from "vitest";
import { CHAPTER_IDS, WALL_SETS } from "../../../src/apps/xrd/ids";
import { pulseAt, relayTurn, tourAt } from "../../../src/apps/xrd/relay";
import { frameChapters, shares, slotOf, slotsIn } from "../../../src/apps/xrd/shares";
import { REST_MS, SCREEN_RUN_MS, TURN_MS } from "../../../src/apps/xrd/config";

describe("bank chapter shares", () => {
  it("splits the eleven in order, as evenly as possible, extras first, for 1 to 10 frames", () => {
    for (let n = 1; n <= 10; n++) {
      const s = shares(n);
      expect(s).toHaveLength(n);
      expect(s.flat()).toEqual([...CHAPTER_IDS]);
      const sizes = s.map((x) => x.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      // Larger runs come first.
      for (let i = 1; i < n; i++) expect(sizes[i]!).toBeLessThanOrEqual(sizes[i - 1]!);
    }
  });

  it("puts spectrum and interference together on the first of six panels", () => {
    const s = shares(6);
    expect(s[0]).toEqual(["spectrum", "interference"]);
    expect(s.map((x) => x.length)).toEqual([2, 2, 2, 2, 2, 1]);
    expect(s[5]).toEqual(["mystery"]);
  });

  it("gives five panels three, then two each, and three pairs two chapters per half", () => {
    expect(shares(5).map((x) => x.length)).toEqual([3, 2, 2, 2, 2]);
    const halves = Array.from({ length: 3 }, (_, pos) =>
      frameChapters({ kind: "pair", bank: true, pos, count: 3, set: "highlights" }),
    ).flat();
    expect(halves).toEqual(shares(6));
    expect(halves[0]).toEqual(["spectrum", "interference"]);
  });

  it("splits a solo pair into chapters 1 to 6 and 7 to 11", () => {
    const [a, b] = frameChapters({
      kind: "pair",
      bank: false,
      pos: 0,
      count: 1,
      set: "highlights",
    });
    expect(a).toEqual(CHAPTER_IDS.slice(0, 6));
    expect(b).toEqual(CHAPTER_IDS.slice(6));
  });

  it("gives a solo panel or kiosk every chapter, and the wall its set", () => {
    expect(frameChapters({ kind: "panel", bank: false, pos: 0, count: 1, set: "first" })).toEqual([
      [...CHAPTER_IDS],
    ]);
    expect(frameChapters({ kind: "kiosk", bank: false, pos: 0, count: 1, set: "first" })).toEqual([
      [...CHAPTER_IDS],
    ]);
    for (const set of ["highlights", "first", "last"] as const) {
      const w = frameChapters({ kind: "wall", bank: false, pos: 0, count: 1, set });
      expect(w.map((x) => x[0])).toEqual([...WALL_SETS[set]]);
      expect(w).toHaveLength(6);
    }
  });

  it("numbers slots along the bank", () => {
    expect(slotsIn("panel", 6)).toBe(6);
    expect(slotsIn("pair", 3)).toBe(6);
    expect(slotOf("pair", 2, 1)).toBe(5);
    expect(slotOf("panel", 7, 0)).toBe(7);
  });

  it("wraps when there are more slots than chapters", () => {
    expect(shares(12).map((x) => x[0])).toEqual([...CHAPTER_IDS, "spectrum"]);
  });
});

describe("attract schedules", () => {
  it("passes the relay along every chapter in turn, then the screen's run", () => {
    const n = CHAPTER_IDS.length;
    const seen: number[] = [];
    for (let t = 0; t < n * TURN_MS + SCREEN_RUN_MS; t += TURN_MS / 2) {
      const turn = relayTurn(t, n, true);
      if (seen.at(-1) !== turn.index) seen.push(turn.index);
    }
    expect(seen).toEqual([...Array.from({ length: n }, (_, i) => i), -1]);
    const a = relayTurn(5 * TURN_MS + 10, n, true);
    const b = relayTurn(5 * TURN_MS + 4000, n, true);
    expect(a.serial).toBe(b.serial);
    expect(relayTurn(5 * TURN_MS + 10 + n * TURN_MS + SCREEN_RUN_MS, n, true).serial).not.toBe(
      a.serial,
    );
  });

  it("runs the beam's pulse to the chapter whose turn begins", () => {
    const centres = [0.05, 0.15, 0.25];
    const start = pulseAt({ index: 2, at: 0, serial: 2 }, centres)!;
    const end = pulseAt({ index: 2, at: 1799, serial: 2 }, centres)!;
    expect(start.f).toBeCloseTo(0.15, 3);
    expect(end.f).toBeCloseTo(0.25, 3);
    expect(pulseAt({ index: 2, at: 5000, serial: 2 }, centres)).toBeNull();
    expect(pulseAt({ index: -1, at: 0, serial: 3 }, centres)).toBeNull();
  });

  it("tours a card's chapters, each demo then a rest", () => {
    const a = tourAt(100, 4);
    expect(a).toMatchObject({ index: 0, phase: "demo" });
    expect(tourAt(TURN_MS + 100, 4)).toMatchObject({ index: 0, phase: "rest" });
    expect(tourAt(TURN_MS + REST_MS + 100, 4)).toMatchObject({ index: 1, phase: "demo" });
    expect(tourAt(4 * (TURN_MS + REST_MS) + 1, 4).index).toBe(0);
  });
});
