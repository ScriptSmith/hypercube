import { describe, expect, it } from "vitest";
import {
  createSprinkler,
  fieldAt,
  grainCount,
  grainSize,
  keepOn,
  levels,
  MAX_GRAINS,
  MIN_GRAINS,
  scatter,
  stateSize,
  stepGrain,
} from "../../../src/apps/chladni/grains";
import { lift } from "../../../src/apps/chladni/drive";
import {
  formModes,
  halfSides,
  type Mode,
  modeId,
  modesFor,
  onPlate,
  type PlateShape,
  shapeAt,
} from "../../../src/apps/chladni/modes";
import { createRng } from "../../../src/core/rng";

const gauss = (rnd: () => number): [number, number] => {
  const r = Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd())));
  const a = 2 * Math.PI * rnd();
  return [r * Math.cos(a), r * Math.sin(a)];
};

/**
 * Run the CPU reference of the GPU step for `seconds` with modes ringing at `amps` (in step) and
 * `quarter` (a quarter cycle out), on the square plate or a stretched one.
 */
const ring = (
  shape: PlateShape,
  amps: Record<number, number>,
  seconds: number,
  n = 1500,
  opts: { quarter?: Record<number, number>; stretch?: number } = {},
) => {
  const form = { stretch: opts.stretch ?? 0, wide: true, turn: 0 };
  const modes: readonly Mode[] = formModes(shape, form);
  const rng = createRng("grains-test");
  const rnd = () => rng.next();
  const pts = scatter(shape, n, rnd);
  const re = new Float64Array(modes.length);
  const im = new Float64Array(modes.length);
  for (const [i, v] of Object.entries(amps)) re[Number(i)] = v;
  for (const [i, v] of Object.entries(opts.quarter ?? {})) im[Number(i)] = v;
  const active = [...new Set([...Object.keys(amps), ...Object.keys(opts.quarter ?? {})])].map(
    Number,
  );
  const size = re.map((r, i) => Math.hypot(r, im[i]!));
  const { level, wave2 } = levels(modes, active, size);
  const half = halfSides(form);
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    for (const p of pts) {
      const f = fieldAt(modes, active, re, im, p[0], p[1]);
      const s = stepGrain(shape, f, level, wave2, lift(level), dt, p[0], p[1], gauss(rnd), half);
      p[0] = s.u;
      p[1] = s.v;
    }
  }
  return { modes, pts, active };
};

const stillShare = (
  pts: [number, number][],
  w: (u: number, v: number) => number,
  limit = 0.15,
): number => pts.filter(([u, v]) => Math.abs(w(u, v)) < limit).length / pts.length;

describe("sand on a ringing plate (CPU reference of the GPU step)", () => {
  for (const shape of ["square", "round"] as PlateShape[]) {
    const modes = modesFor(shape);
    for (const i of [0, Math.floor(modes.length / 2), modes.length - 1]) {
      it(`${shape} ${modeId(modes[i]!)}: most grains gather where the mode is still within 4 s`, () => {
        const before = ring(shape, { [i]: 1 }, 0);
        const w = (u: number, v: number) => shapeAt(modes[i]!, u, v);
        const start = stillShare(before.pts, w);
        const after = ring(shape, { [i]: 1 }, 4);
        const end = stillShare(after.pts, w);
        expect(start).toBeLessThan(0.45);
        expect(end, `${start.toFixed(2)} at the start`).toBeGreaterThan(0.85);
      });
    }
  }

  it("two notes together gather the sand where their in-phase sum is still", () => {
    const modes = modesFor("square");
    const { pts } = ring("square", { 2: 0.7, 10: 0.7 }, 4);
    const w = (u: number, v: number) =>
      0.7 * shapeAt(modes[2]!, u, v) + 0.7 * shapeAt(modes[10]!, u, v);
    expect(stillShare(pts, w, 0.2)).toBeGreaterThan(0.8);
  });

  it("on a stretched plate, gathers the sand on the stretched figure", () => {
    const modes = formModes("square", { stretch: 1, wide: true, turn: 0 });
    for (const i of [1, 6]) {
      const { pts } = ring("square", { [i]: 1 }, 4, 1500, { stretch: 1 });
      const w = (u: number, v: number) => shapeAt(modes[i]!, u, v);
      expect(stillShare(pts, w), modeId(modes[i]!)).toBeGreaterThan(0.8);
    }
  });

  it("breaks a figure's lines into dots when a neighbour rings a quarter cycle out of step", () => {
    const modes = modesFor("square");
    const a = (u: number, v: number) => shapeAt(modes[4]!, u, v);
    const b = (u: number, v: number) => shapeAt(modes[5]!, u, v);
    // In step, the two make one figure with continuous lines; out of step (a heavily damped
    // plate) nothing is still except where both are, so the sand runs into those dots.
    const inStep = ring("square", { 4: 0.8, 5: 0.6 }, 4);
    const outOfStep = ring("square", { 4: 0.8 }, 4, 1500, { quarter: { 5: 0.6 } });
    const sum = (u: number, v: number) => 0.8 * a(u, v) + 0.6 * b(u, v);
    const dots = (pts: [number, number][]) =>
      pts.filter(([u, v]) => Math.abs(a(u, v)) < 0.12 && Math.abs(b(u, v)) < 0.12).length /
      pts.length;
    expect(stillShare(inStep.pts, sum, 0.15)).toBeGreaterThan(0.8);
    expect(dots(outOfStep.pts)).toBeGreaterThan(dots(inStep.pts) + 0.25);
  });

  it("leaves the sand where it is while the plate is too quiet to lift it", () => {
    const rng = createRng("quiet");
    const pts = scatter("square", 200, () => rng.next());
    const modes = modesFor("square");
    const a = new Float64Array(modes.length);
    a[3] = 0.3;
    const { level, wave2 } = levels(modes, [3], a);
    expect(lift(level)).toBe(0);
    for (const [u, v] of pts) {
      const s = stepGrain(
        "square",
        fieldAt(modes, [3], a, new Float64Array(modes.length), u, v),
        level,
        wave2,
        lift(level),
        1 / 60,
        u,
        v,
        [1, -1],
      );
      expect(s.u).toBe(u);
      expect(s.v).toBe(v);
    }
  });

  it("keeps every grain on the plate", () => {
    for (const shape of ["square", "round"] as PlateShape[]) {
      for (const [u, v] of [
        [1.2, 0.3],
        [-1.05, -1.4],
        [0.9, 0.9],
        [0, -1.3],
      ] as const) {
        const [a, b] = keepOn(shape, u, v);
        expect(onPlate(shape, a, b), `${shape} ${u},${v}`).toBe(true);
      }
    }
  });
});

describe("sprinkling fresh sand", () => {
  it("lands every grain exactly once over the spell", () => {
    const s = createSprinkler();
    s.start(1000, 2000, 42);
    const hashes = Array.from(
      { length: 5000 },
      (_, i) => ((i * 2654435761) % 4294967296) / 4294967296,
    );
    const landed: number[] = Array.from({ length: hashes.length }, () => 0);
    for (let t = 1000; t <= 3200; t += 37) {
      const span = s.span(t);
      if (!span) continue;
      expect(span.seed).toBe(42);
      hashes.forEach((h, i) => {
        if (h >= span.from && h < span.to) landed[i] = (landed[i] ?? 0) + 1;
      });
    }
    expect(landed.every((n) => n === 1)).toBe(true);
    expect(s.busy).toBe(false);
    expect(s.span(4000)).toBeNull();
  });
});

describe("grain budget", () => {
  it("about 300,000 grains on a full-height wall plate, fewer on smaller plates and slower GPUs", () => {
    const wall = grainCount(2330, "square", 1, false);
    expect(wall).toBeGreaterThan(250_000);
    expect(wall).toBeLessThanOrEqual(MAX_GRAINS);
    expect(grainCount(980, "square", 1, false)).toBeLessThan(wall / 4);
    expect(grainCount(2330, "square", 0.5, false)).toBeCloseTo(wall / 4, -3);
    expect(grainCount(2330, "square", 1, true)).toBeLessThan(wall / 4);
    expect(grainCount(3680, "square", 1, false)).toBe(MAX_GRAINS);
    expect(grainCount(100, "round", 0.25, true)).toBe(MIN_GRAINS);
  });

  it("sizes grains to cover the same share of any plate", () => {
    const big = grainSize(2330, 2330, "square", 300_000);
    const small = grainSize(980, 980, "square", Math.round((300_000 * 980 ** 2) / 2330 ** 2));
    expect(small).toBeCloseTo(big, 1);
    // A stretched plate drawn smaller shrinks its grains with it.
    expect(grainSize(1000, 500, "square", 4096)).toBeLessThan(grainSize(880, 880, "square", 4096));
  });

  it("packs the state texture with no more rows than needed", () => {
    for (const n of [4096, 9000, 65_536, 300_000]) {
      const s = stateSize(n);
      expect(s.width * s.height).toBeGreaterThanOrEqual(n);
      expect(s.width * (s.height - 1)).toBeLessThan(n);
    }
  });
});
