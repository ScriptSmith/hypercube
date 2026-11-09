import { describe, expect, it } from "vitest";
import {
  A_MAX,
  clean,
  crystalAtoms,
  decode,
  encode,
  N_MAX,
  N_MIN,
  patternJob,
  playAt,
  SHAPES,
  shapeOf,
  squashed,
  START,
  STATE_RANGES,
  steps,
} from "../../../../src/apps/xrd/chapters/inverse/model";
import { checkState } from "../../../../src/apps/xrd/chapter";
import { intensity } from "../../../../src/apps/xrd/engine/pattern";

const N = 256;

const patternOf = (s: Parameters<typeof patternJob>[0]) => {
  const job = patternJob(s, N);
  return { I: intensity(job.source, N, job.span, new Float64Array(N * N)), span: job.span };
};

/** Value at offset (kx, ky) from the centre, ky upward. */
const at = (a: Float64Array, kx: number, ky: number) =>
  a[(N / 2 - Math.round(ky)) * N + (N / 2 + Math.round(kx))]!;

/** The brightest pixel within `r` pixels of (kx, ky). */
const peakNear = (a: Float64Array, kx: number, ky: number, r = 3) => {
  let best = { kx: 0, ky: 0, v: -1 };
  for (let dx = -r; dx <= r; dx++)
    for (let dy = -r; dy <= r; dy++) {
      const v = at(a, kx + dx, ky + dy);
      if (v > best.v) best = { kx: Math.round(kx) + dx, ky: Math.round(ky) + dy, v };
    }
  return best;
};

/** Half width at half height of the spot at (kx, 0) along x, pixels. */
const halfWidth = (a: Float64Array, kx: number) => {
  const p = peakNear(a, kx, 0, 2);
  let w = 0;
  while (w < 40 && at(a, p.kx + w + 1, p.ky) > p.v / 2) w++;
  return w + 0.5;
};

describe("chapter 7", () => {
  it("round-trips its state and keeps it in range", () => {
    const s = { a: 3.25, b: 6.4, turn: 33, repeats: 7 };
    expect(decode(encode(s))).toEqual(s);
    expect(checkState({ state: STATE_RANGES }, encode(START))).not.toBeNull();
    for (let t = 0; t < 40; t += 0.7)
      expect(checkState({ state: STATE_RANGES }, encode(playAt(t))), `t ${t}`).not.toBeNull();
    expect(clean({ a: 100, b: 0, turn: -30, repeats: 99 })).toEqual({
      a: A_MAX,
      b: 2.5,
      turn: 330,
      repeats: N_MAX,
    });
  });

  it("puts a square lattice's spots at multiples of 1/a, turning with the crystal", () => {
    for (const turn of [0, 30]) {
      const s = { a: 4, b: 4, turn, repeats: 8 };
      const { I, span } = patternOf(s);
      const { as, bs } = steps(s);
      // Pattern pixels are 1/span Å⁻¹ apart.
      for (const [m, n] of [
        [1, 0],
        [0, 1],
        [2, 0],
        [1, 1],
      ] as const) {
        const kx = (m * as[0] + n * bs[0]) * span;
        const ky = (m * as[1] + n * bs[1]) * span;
        const p = peakNear(I, kx, ky);
        expect(Math.hypot(p.kx - kx, p.ky - ky), `(${m} ${n}) at ${turn}°`).toBeLessThanOrEqual(
          1.5,
        );
        // Halfway to the next spot it is dark.
        expect(at(I, kx - (as[0] * span) / 2, ky - (as[1] * span) / 2)).toBeLessThan(p.v * 0.02);
      }
      expect(Math.hypot(as[0], as[1])).toBeCloseTo(1 / 4, 9);
    }
  });

  it("spreads the pattern the other way when the crystal is squashed", () => {
    const wide = SHAPES[2]!;
    const s = { ...wide, turn: 0, repeats: 6 };
    expect(wide.a).toBeGreaterThan(wide.b);
    const { I, span } = patternOf(s);
    // Wide in real space, tall in the pattern: the step along x is the shorter one.
    const px = span / wide.a;
    const py = span / wide.b;
    expect(py).toBeGreaterThan(px * 1.5);
    expect(peakNear(I, px, 0).v).toBeGreaterThan(at(I, px / 2, 0) * 50);
    expect(peakNear(I, 0, py).v).toBeGreaterThan(at(I, 0, py / 2) * 50);
    expect(squashed(s)).toBe(true);
    expect(squashed(START)).toBe(false);
    expect(shapeOf(s)).toBe(2);
  });

  it("makes fatter spots from a crystal with fewer repeats, about 1/L wide", () => {
    const widths = [N_MIN, 4, 8].map((repeats) => {
      const s = { a: 4, b: 4, turn: 0, repeats };
      const { I, span } = patternOf(s);
      return { w: halfWidth(I, span / 4), L: repeats * 4, span };
    });
    expect(widths[0]!.w).toBeGreaterThan(widths[1]!.w);
    expect(widths[1]!.w).toBeGreaterThan(widths[2]!.w);
    // The full width at half height is about span/L pixels (1/L Å⁻¹), give or take the taper.
    for (const x of widths) {
      const full = 2 * x.w;
      expect(full / (x.span / x.L), `L ${x.L}`).toBeGreaterThan(0.5);
      expect(full / (x.span / x.L), `L ${x.L}`).toBeLessThan(2.2);
    }
  });

  it("keeps the biggest turned crystal inside the engine's grid", () => {
    const atoms = crystalAtoms({ a: A_MAX, b: A_MAX, turn: 45, repeats: N_MAX });
    const half = patternJob(START, N).span / 2;
    for (let i = 0; i < atoms.count; i++) {
      expect(Math.abs(atoms.data[i * 4]!)).toBeLessThan(half - 2);
      expect(Math.abs(atoms.data[i * 4 + 1]!)).toBeLessThan(half - 2);
    }
    expect(atoms.count).toBe(N_MAX * N_MAX);
  });
});

describe("chapter 7's figure and demo", () => {
  it("keeps its 120 px grips apart and past the crystal's edges, above or beside it", async () => {
    const { gripPlaces, GRIP_APART, GRIP_OFF, GRIP_R } =
      await import("../../../../src/apps/xrd/chapters/inverse");
    expect(2 * GRIP_R).toBeGreaterThanOrEqual(120);
    for (const beside of [false, true])
      for (const W of [10, 40, 90, 160, 300])
        for (const H of [10, 40, 90, 160, 300]) {
          const g = gripPlaces(W, H, beside);
          const pts = [g.a, g.b, g.turn];
          for (let i = 0; i < 3; i++)
            for (let j = i + 1; j < 3; j++)
              expect(
                Math.hypot(pts[i]!.u - pts[j]!.u, pts[i]!.v - pts[j]!.v),
                `${beside} ${W} ${H}`,
              ).toBeGreaterThanOrEqual(GRIP_APART - 1e-9);
          expect(Math.abs(g.a.u)).toBeGreaterThanOrEqual(W + GRIP_OFF - 1e-9);
          if (beside) expect(Math.abs(g.b.u)).toBeGreaterThanOrEqual(W + GRIP_OFF - 1e-9);
          else expect(g.b.v).toBeGreaterThanOrEqual(H + GRIP_OFF - 1e-9);
        }
  });

  it("changes one thing at a time in its demo: the shape, back, the repeats, then tall", async () => {
    const { default: def } = await import("../../../../src/apps/xrd/chapters/inverse");
    const stub = new Proxy({}, { get: () => () => undefined });
    const ch = def.create(stub as never);
    const steps = ch
      .demo()
      .filter((d): d is { control: string; to?: number } => "control" in d)
      .map((d) => `${d.control}:${d.to}`);
    expect(steps[0]).toBe("shape:2");
    const back = steps.indexOf("shape:1");
    const firstRepeats = steps.findIndex((s) => s.startsWith("repeats"));
    expect(back).toBeGreaterThan(0);
    expect(firstRepeats).toBeGreaterThan(back);
    expect(steps.at(-1)).toBe("shape:0");
  });
});
