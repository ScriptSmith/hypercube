import { describe, expect, it } from "vitest";
import { readConfig } from "../../../src/apps/chladni/config";
import { glideAt, glideScale } from "../../../src/apps/chladni/modes";
import { createTune, NOTE_MS } from "../../../src/apps/chladni/tune";
import { createRng } from "../../../src/core/rng";

const notes = [
  { key: 0, mode: 0 },
  { key: 1, mode: 4 },
  { key: 2, mode: 8 },
];
const strips = [{ strip: 0, scale: glideScale([1, 4, 9]) }];

describe("attract tune", () => {
  it("holds notes about six seconds, rests between, and never repeats a note at once", () => {
    const tune = createTune(createRng("t"), notes, []);
    let prev: number | null = null;
    let last = -1;
    let runStart = 0;
    const runs: number[] = [];
    for (let t = 0; t < 120_000; t += 50) {
      const s = tune.update(t);
      const key = s.note?.key ?? null;
      if (key !== prev) {
        if (prev !== null) runs.push(t - runStart);
        if (key !== null) {
          expect(key).not.toBe(last);
          last = key;
        }
        runStart = t;
        prev = key;
      }
    }
    expect(runs.length).toBeGreaterThan(8);
    for (const r of runs) expect(Math.abs(r - NOTE_MS)).toBeLessThanOrEqual(60);
  });

  it("now and then glides a needle onto a note's mark", () => {
    const tune = createTune(createRng("b"), notes, strips);
    let sweeps = 0;
    let lastT: number | null = null;
    for (let t = 0; t < 300_000; t += 50) {
      const s = tune.update(t);
      if (s.glide) {
        lastT = s.glide.t;
        expect(s.glide.freq).toBeCloseTo(glideAt(strips[0]!.scale, s.glide.t), 9);
      } else if (lastT !== null) {
        sweeps++;
        // Each sweep settles on a mark.
        expect(strips[0]!.scale.marks.some((m) => m !== null && Math.abs(m - lastT!) < 1e-6)).toBe(
          true,
        );
        lastT = null;
      }
    }
    expect(sweeps).toBeGreaterThan(3);
  });

  it("asks for fresh sand every few notes, during a rest", () => {
    const tune = createTune(createRng("sand"), notes, strips);
    let sprinkles = 0;
    for (let t = 0; t < 200_000; t += 50) {
      const s = tune.update(t);
      if (s.sprinkle) {
        sprinkles++;
        expect(s.note).toBeNull();
        expect(s.glide).toBeNull();
      }
    }
    expect(sprinkles).toBeGreaterThan(2);
    expect(sprinkles).toBeLessThan(10);
  });

  it("waits after a restart", () => {
    const tune = createTune(createRng("r"), notes, []);
    tune.restart(1000, 3000);
    expect(tune.update(3900).note).toBeNull();
    expect(tune.update(4100).note).not.toBeNull();
  });
});

describe("options", () => {
  it("are clamped and defaulted", () => {
    expect(readConfig("square", {}, "panel")).toEqual({
      shape: "square",
      keys: 6,
      sand: "sand",
      glide: true,
      damp: true,
      puck: true,
      stretch: true,
      damping: true,
      plates: 1,
    });
    const c = readConfig(
      "round",
      { keys: 40, sand: "gold", glide: false, damp: false, plates: 2, puck: false, damping: false },
      "wall",
    );
    expect(c).toEqual({
      shape: "round",
      keys: 10,
      sand: "sand",
      glide: false,
      damp: false,
      puck: false,
      // A disc has no honest stretch.
      stretch: false,
      damping: false,
      plates: 2,
    });
    expect(readConfig("nope", { plates: 2, keys: 1.2 }, "panel")).toMatchObject({
      shape: "square",
      plates: 1,
      keys: 4,
    });
  });
});
