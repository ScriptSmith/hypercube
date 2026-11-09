import { describe, expect, it } from "vitest";
import { maxFlashesPerSecond, transitions } from "../../../src/apps/discoball/safety";

const wave = (hz: number, seconds: number, f: (t: number) => number) =>
  Float32Array.from({ length: hz * seconds }, (_, i) => f(i / hz));

describe("discoball flash rule", () => {
  it("counts a light flickering five times a second as five flashes a second", () => {
    const s = wave(60, 4, (t) => (Math.floor(t * 10) % 2 ? 0.5 : 0.1));
    expect(maxFlashesPerSecond(s, 60)).toBe(5);
  });

  it("ignores changes under a tenth of full brightness, however fast", () => {
    const s = wave(60, 4, (t) => 0.3 + 0.045 * Math.sin(t * 2 * Math.PI * 8));
    expect(transitions(s)).toEqual([]);
    expect(maxFlashesPerSecond(s, 60)).toBe(0);
  });

  it("counts slow swells as at most one flash a second", () => {
    const s = wave(60, 10, (t) => 0.3 + 0.3 * Math.sin(t * 2 * Math.PI * 0.5));
    expect(maxFlashesPerSecond(s, 60)).toBeLessThanOrEqual(1);
    expect(transitions(s).length).toBeGreaterThan(5);
  });

  it("ignores changes that stay brighter than 0.8", () => {
    const s = wave(60, 4, (t) => (Math.floor(t * 10) % 2 ? 0.95 : 0.82));
    expect(maxFlashesPerSecond(s, 60)).toBe(0);
  });

  it("finds a burst of flashes inside a long quiet series", () => {
    const s = wave(60, 20, (t) => (t > 12 && t < 13 && Math.floor(t * 8) % 2 ? 0.6 : 0.05));
    expect(maxFlashesPerSecond(s, 60)).toBe(4);
  });
});
