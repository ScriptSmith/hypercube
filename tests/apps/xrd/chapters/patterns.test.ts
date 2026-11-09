import { describe, expect, it } from "vitest";
import {
  A,
  blow,
  decode,
  encode,
  GRAINS,
  lookOf,
  patternJob,
  MAP_FOR,
  RING_ORDERS,
  ringRadius,
  spotBrightness,
  START,
} from "../../../../src/apps/xrd/chapters/patterns";
import { TEXT } from "../../../../src/apps/xrd/captions";
import { intensity } from "../../../../src/apps/xrd/engine/pattern";

const ringMean = (a: Float64Array, n: number, r: number) => {
  let s = 0;
  let c = 0;
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) {
      const d = Math.hypot(col - n / 2, n / 2 - row);
      if (Math.abs(d - r) <= 1) {
        s += a[row * n + col]!;
        c++;
      }
    }
  return s / c;
};

describe("chapter 6", () => {
  it("names what the pattern shows", () => {
    expect(lookOf(START)).toBe("spots");
    expect(lookOf({ crush: 3, lineUp: 0, map: false })).toBe("rings");
    expect(lookOf({ crush: 3, lineUp: 0.8, map: false })).toBe("arcs");
    expect(lookOf({ crush: 3, lineUp: 1, map: false })).toBe("spots");
    // The square toy repeats every 90°: grains strayed by ±45° or more already make full rings.
    expect(lookOf({ crush: 3, lineUp: 0.75, map: false })).toBe("rings");
    expect(lookOf({ crush: 3, lineUp: 0.9, map: false })).toBe("arcs");
    expect(MAP_FOR).toEqual({ spots: "zircon", rings: "corundum", arcs: "foil" });
  });

  it("round-trips its state", () => {
    const s = { crush: 2, lineUp: 0.37, map: true };
    expect(decode(encode(s))).toEqual(s);
    expect(GRAINS[0]).toBe(1);
  });

  it("draws rings at |S| = 1/a for a crushed powder, the same at every grid size", () => {
    for (const n of [256, 512]) {
      const job = patternJob({ crush: 3, lineUp: 0, map: false }, n);
      const I = intensity(job.source, n, job.span, new Float64Array(n * n));
      const r10 = job.span / A;
      const between = ringMean(I, n, r10 * 1.2);
      expect(ringMean(I, n, r10), `n ${n}`).toBeGreaterThan(between * 5);
    }
  });
});

describe("chapter 6, grinding", () => {
  it("grinds one blow at a time and stops at the finest powder", () => {
    let s = { ...START };
    const seen = [s.crush];
    for (let i = 0; i < GRAINS.length + 2; i++) {
      s = blow(s);
      seen.push(s.crush);
    }
    expect(seen.slice(0, GRAINS.length)).toEqual([0, 1, 2, 3, 4]);
    expect(blow(s)).toBe(s);
  });

  it("names the move as grinding to powder", () => {
    expect(TEXT.patterns.labels.crush).toBe("Grind to powder");
    expect(TEXT.patterns.verb.toLowerCase()).toContain("powder");
    expect(TEXT.patterns.so.text.toLowerCase()).toContain("powder");
  });
});

describe("chapter 6, the single crystal's spots", () => {
  const n = 256;
  const job = patternJob(START, n);
  const I = intensity(job.source, n, job.span, new Float64Array(n * n));
  /** The brightest pixel near spot (h k). */
  const peak = (h: number, k: number) => {
    const cx = n / 2 + (h * job.span) / A;
    const cy = n / 2 - (k * job.span) / A;
    let best = 0;
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++)
        best = Math.max(best, I[(Math.round(cy) + dy) * n + Math.round(cx) + dx]!);
    return best;
  };

  it("draws each spot's glow as bright as the flat model makes it", () => {
    expect(spotBrightness(1, 0)).toBeCloseTo(1, 9);
    const ref = Math.sqrt(peak(1, 0));
    for (const [h, k] of [
      [1, 1],
      [2, 0],
      [2, 1],
    ] as const) {
      const model = Math.sqrt(peak(h, k)) / ref;
      expect(spotBrightness(h, k), `(${h} ${k})`).toBeLessThan(1);
      expect(Math.abs(spotBrightness(h, k) - model), `(${h} ${k})`).toBeLessThan(0.15);
    }
  });

  it("draws the rings to come through the spots, at |S| = √(h² + k²) / a", () => {
    expect(RING_ORDERS[0]).toBe(1);
    for (const m of RING_ORDERS) {
      expect(ringRadius(m)).toBeCloseTo(Math.sqrt(m) / A, 12);
      // Some spot (h k) with h² + k² = m exists, so the circle runs through spots.
      let found = false;
      for (let a = 0; a <= 3; a++)
        for (let b = 0; b <= 3; b++) if (a * a + b * b === m) found = true;
      expect(found, `order ${m}`).toBe(true);
    }
  });
});
