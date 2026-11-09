import { describe, expect, it } from "vitest";
import { createHistory } from "../../../src/apps/tangle/history";

describe("history", () => {
  it("merges a line's consecutive short segments", () => {
    const h = createHistory(16);
    for (let i = 0; i < 9; i++) h.add(i * 3, 0, (i + 1) * 3, 0, 2, i * 0.01);
    // 27 units at up to 12 per entry.
    expect(h.count).toBe(3);
    expect(Array.from(h.data.slice(0, 6))).toEqual([0, 0, 12, 0, 2, 0]);
    // Another line, or a jump after a gap, starts a new entry.
    h.add(27, 0, 30, 0, 3, 0.1);
    h.add(40, 0, 43, 0, 2, 0.1);
    expect(h.count).toBe(5);
  });

  it("forgets old segments and stays within its size", () => {
    const h = createHistory(4);
    for (let i = 0; i < 10; i++) h.add(i * 100, 0, i * 100 + 1, 0, 0, i);
    expect(h.count).toBe(4);
    expect(h.data[h.start * 6 + 5]).toBe(6);
    h.trim(8);
    expect(h.count).toBe(2);
    h.clear();
    expect(h.count).toBe(0);
  });
});
