import { describe, expect, it } from "vitest";
import {
  BLEND,
  createColourSchedule,
  HOLD,
  IRIS_COLOURS,
  LOOKS,
} from "../../../src/apps/gaze/colours";
import { createRng } from "../../../src/core/rng";

describe("iris colours", () => {
  it("has a look for every colour", () => {
    for (const c of IRIS_COLOURS) {
      const l = LOOKS[c];
      for (const hex of [l.base, l.fibre, l.centre, l.deep, l.ring]) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("keeps a chosen colour", () => {
    const s = createColourSchedule(createRng("c"), "green");
    for (let i = 0; i < 3600; i++) s.step(1);
    expect(s.from).toBe("green");
    expect(s.to).toBe("green");
    expect(s.mix).toBe(1);
  });

  it("changes every few minutes, blending slowly, never to the same colour", () => {
    const s = createColourSchedule(createRng("c"), "changes");
    let changes = 0;
    let blending = 0;
    let last = s.to;
    for (let t = 0; t < 2 * 3600; t++) {
      s.step(1);
      if (s.mix < 1) blending++;
      if (s.to !== last) {
        expect(s.from).toBe(last);
        changes++;
        last = s.to;
      }
    }
    const most = (2 * 3600) / HOLD.min;
    const least = (2 * 3600) / (HOLD.max + BLEND);
    expect(changes).toBeGreaterThanOrEqual(Math.floor(least));
    expect(changes).toBeLessThanOrEqual(Math.ceil(most));
    expect(blending).toBeGreaterThan(changes * (BLEND - 2));
  });

  it("blends to a colour set by admin rather than jumping", () => {
    const s = createColourSchedule(createRng("c"), "brown");
    s.set("blue");
    expect(s.from).toBe("brown");
    expect(s.to).toBe("blue");
    expect(s.mix).toBe(0);
    for (let i = 0; i < BLEND + 1; i++) s.step(1);
    expect(s.mix).toBe(1);
  });
});
