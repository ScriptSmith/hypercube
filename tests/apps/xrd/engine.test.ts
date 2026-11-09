import { describe, expect, it } from "vitest";
import { fft1, fft2, planFor, shift2 } from "../../../src/apps/xrd/engine/fft";
import {
  grainAtoms,
  helixAtoms,
  latticeAtoms,
  rasterise,
  scatterGrains,
  squareCell,
} from "../../../src/apps/xrd/engine/model";
import {
  intensity,
  keepMask,
  runPattern,
  runSynth,
  synthesise,
} from "../../../src/apps/xrd/engine/pattern";

const N = 256;
const SPAN = 128;

const pattern = (src: Parameters<typeof intensity>[0], n = N, span = SPAN) =>
  intensity(src, n, span, new Float64Array(n * n));

/** Value at offset (kx, ky) from the centre, ky upward. */
const at = (a: Float64Array, kx: number, ky: number, n = N) => a[(n / 2 - ky) * n + (n / 2 + kx)]!;

/** The brightest pixel outside `minR` pixels of the centre, as an offset with ky upward. */
const brightest = (a: Float64Array, minR: number, n = N) => {
  let best = { kx: 0, ky: 0, v: -1 };
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const kx = col - n / 2;
      const ky = n / 2 - row;
      if (Math.hypot(kx, ky) < minR) continue;
      const v = a[row * n + col]!;
      if (v > best.v) best = { kx, ky, v };
    }
  }
  return best;
};

/** Mean over a ring of radius r (pixels), and the mean over the band between rings. */
const ringMean = (a: Float64Array, r: number, width = 1, n = N) => {
  let s = 0;
  let c = 0;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const d = Math.hypot(col - n / 2, n / 2 - row);
      if (Math.abs(d - r) <= width) {
        s += a[row * n + col]!;
        c++;
      }
    }
  }
  return s / Math.max(1, c);
};

const correlate = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  return sab / Math.sqrt(saa * sbb);
};

describe("the FFT", () => {
  it("matches a direct transform and inverts", () => {
    const n = 16;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin(i * 0.7) + (i % 3);
    const r0 = re.slice();
    const plan = planFor(n);
    fft1(re, im, plan);
    for (let k = 0; k < n; k++) {
      let sr = 0;
      let si = 0;
      for (let j = 0; j < n; j++) {
        sr += r0[j]! * Math.cos((-2 * Math.PI * k * j) / n);
        si += r0[j]! * Math.sin((-2 * Math.PI * k * j) / n);
      }
      expect(re[k]).toBeCloseTo(sr, 9);
      expect(im[k]).toBeCloseTo(si, 9);
    }
    fft1(re, im, plan, 0, 1, true);
    for (let i = 0; i < n; i++) expect(re[i]).toBeCloseTo(r0[i]!, 9);
  });

  it("centres frequency zero in 2D", () => {
    const n = 8;
    const re = new Float64Array(n * n).fill(1);
    const im = new Float64Array(n * n);
    fft2(re, im, n);
    shift2(re, n);
    expect(re[(n / 2) * n + n / 2]).toBeCloseTo(n * n, 9);
    expect(re[0]).toBeCloseTo(0, 9);
  });
});

describe("the diffraction engine", () => {
  it("puts a square lattice's spots at multiples of 1/a, turning with it", () => {
    const a = 4;
    for (const angle of [0, (25 * Math.PI) / 180]) {
      const atoms = latticeAtoms({
        ...squareCell(a),
        extent: { radius: 56, taper: 16 },
        angle,
      });
      const p = pattern({ atoms });
      // Spots 1/a apart are span/a = 32 pixels apart in the pattern.
      const step = SPAN / a;
      const b = brightest(p, step / 2);
      expect(Math.hypot(b.kx, b.ky)).toBeCloseTo(step, 0);
      const turned = Math.atan2(b.ky, b.kx);
      // The first spot lies along a lattice direction: the turn modulo a quarter turn.
      const rel = (((turned - angle) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
      expect(Math.min(rel, Math.PI / 2 - rel)).toBeLessThan(0.06);
      // Between spots it is dark.
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const mid = at(p, Math.round((step / 2) * c), Math.round((step / 2) * s));
      expect(mid).toBeLessThan(b.v * 0.01);
    }
  });

  it("makes spots narrower as the crystal grows", () => {
    const widths = [4, 8, 16].map((cells) => {
      const atoms = latticeAtoms({ ...squareCell(4), extent: { na: cells, nb: cells } });
      const p = pattern({ atoms });
      const peak = at(p, 32, 0);
      let w = 0;
      while (w < 16 && at(p, 32 + w + 1, 0) > peak / 2) w++;
      return w;
    });
    expect(widths[0]!).toBeGreaterThan(widths[1]!);
    expect(widths[1]!).toBeGreaterThanOrEqual(widths[2]!);
    // A crystal L across gives spots about 1/L wide: 4 cells of 4 Å, 16 Å, 8 pixels.
    expect(widths[0]!).toBeGreaterThanOrEqual(2);
  });

  it("turns a powder's spots into rings at |S| = 1/d", () => {
    const a = 4;
    const grains = scatterGrains({ count: 1, field: 0, size: 20, seed: 1, spread: 0 });
    const base = grainAtoms(squareCell(a), grains, 20);
    const angles = new Float32Array(160);
    for (let i = 0; i < angles.length; i++) angles[i] = (i * 2.399963) % (2 * Math.PI);
    const p = pattern({ atoms: base, angles });
    const r10 = SPAN / a; // (1 0): d = a
    const r11 = (SPAN * Math.SQRT2) / a; // (1 1): d = a/√2
    const between = ringMean(p, (r10 + r11) / 2);
    expect(ringMean(p, r10)).toBeGreaterThan(between * 8);
    expect(ringMean(p, r11)).toBeGreaterThan(between * 4);
    // Smooth all the way round: no quarter of the (1 0) ring is far dimmer than another.
    const quarter = (q: number) => {
      let s = 0;
      for (let i = 0; i < 90; i++) {
        const t = ((q * 90 + i + 0.5) * Math.PI) / 180;
        s += at(p, Math.round(r10 * Math.cos(t)), Math.round(r10 * Math.sin(t)));
      }
      return s;
    };
    const qs = [0, 1, 2, 3].map(quarter);
    expect(Math.min(...qs) / Math.max(...qs)).toBeGreaterThan(0.6);
  });

  it("draws a helix as an X with layer lines 1/P apart, the fourth missing for DNA's offset", () => {
    const n = 256;
    const span = 256;
    const pitch = 34;
    const one = helixAtoms({ pitch, radius: 10, strands: 1, offset: 0, perTurn: 10, turns: 6 });
    const p1 = pattern({ atoms: one }, n, span);
    const lineAt = (p: Float64Array, l: number) => {
      // Brightest value along layer line l, away from the meridian's centre.
      const ky = Math.round((l * span) / pitch);
      let m = 0;
      for (let kx = -40; kx <= 40; kx++) m = Math.max(m, at(p, kx, ky, n));
      return m;
    };
    const between = (p: Float64Array, l: number) => {
      const ky = Math.round(((l + 0.5) * span) / pitch);
      let m = 0;
      for (let kx = -40; kx <= 40; kx++) m = Math.max(m, at(p, kx, ky, n));
      return m;
    };
    for (const l of [1, 2, 3]) expect(lineAt(p1, l)).toBeGreaterThan(between(p1, l) * 4);
    // The X: on layer line l the brightest spot moves out from the meridian as l grows.
    const spotX = (p: Float64Array, l: number) => {
      const ky = Math.round((l * span) / pitch);
      let best = 0;
      let bx = 0;
      for (let kx = 0; kx <= 60; kx++) {
        const v = at(p, kx, ky, n);
        if (v > best) {
          best = v;
          bx = kx;
        }
      }
      return bx;
    };
    expect(spotX(p1, 2)).toBeGreaterThan(spotX(p1, 1));
    expect(spotX(p1, 3)).toBeGreaterThan(spotX(p1, 2));
    const two = helixAtoms({ pitch, radius: 10, strands: 2, offset: 3 / 8, perTurn: 10, turns: 6 });
    const p2 = pattern({ atoms: two }, n, span);
    const ratio = (l: number) => lineAt(p2, l) / lineAt(p1, l);
    expect(ratio(4)).toBeLessThan(ratio(3) * 0.15);
    expect(ratio(4)).toBeLessThan(ratio(5) * 0.15);
  });

  it("rebuilds the model as more spots are added", () => {
    const n = 128;
    const span = 64;
    // Eight cells of 8 Å across the grid, so every reflection lands on a pixel.
    const atoms = latticeAtoms({
      a: [8, 0],
      b: [0, 8],
      basis: [
        { u: 0, v: 0, z: 20, sigma: 0.7 },
        { u: 0.35, v: 0.6, z: 8, sigma: 0.7 },
      ],
      extent: { na: 8, nb: 8 },
    });
    const truth = rasterise(atoms, n, span, new Float64Array(n * n));
    const scores = [0.15, 0.3, 0.6, 1.2].map((maxS) =>
      correlate(synthesise({ op: "synth", n, span, source: { atoms }, maxS }), truth),
    );
    for (let i = 1; i < scores.length; i++) expect(scores[i]!).toBeGreaterThan(scores[i - 1]!);
    expect(scores.at(-1)!).toBeGreaterThan(0.95);
  });

  it("keeps only the listed spots and their mirror images", () => {
    const m = keepMask(16, 16, new Int32Array([2, 1]), null);
    expect(m[(8 - 1) * 16 + 8 + 2]).toBe(1);
    expect(m[(8 + 1) * 16 + 8 - 2]).toBe(1);
    expect(m.reduce((s, v) => s + v, 0)).toBe(2);
  });

  it("makes a swapped picture look like the one whose phases it kept", () => {
    const n = 64;
    const span = 64;
    const disc = (cx: number, cy: number, r: number) => {
      const d = new Float32Array(n * n);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) if (Math.hypot(x - cx, y - cy) < r) d[y * n + x] = 1;
      return d;
    };
    const bar = () => {
      const d = new Float32Array(n * n);
      for (let y = 10; y < 54; y++) for (let x = 40; x < 48; x++) d[y * n + x] = 1;
      for (let y = 40; y < 48; y++) for (let x = 6; x < 30; x++) d[y * n + x] = 1;
      return d;
    };
    const a = disc(22, 20, 10);
    const b = bar();
    const swapped = synthesise({
      op: "synth",
      n,
      span,
      source: { density: a },
      phases: { density: b },
    });
    expect(correlate(swapped, b)).toBeGreaterThan(0.5);
    expect(correlate(swapped, b)).toBeGreaterThan(correlate(swapped, a) + 0.3);
  });

  it("scales a pattern to bytes with a dark beam stop", () => {
    const atoms = latticeAtoms({ ...squareCell(4), extent: { radius: 40, taper: 10 } });
    const r = runPattern({
      op: "pattern",
      n: 128,
      span: 64,
      source: { atoms },
      scale: "sqrt",
      stop: 0.05,
    });
    expect(r.bytes.length).toBe(128 * 128);
    expect(r.bytes[64 * 128 + 64]).toBe(0);
    expect(Math.max(...r.bytes)).toBe(255);
    const s = runSynth({ op: "synth", n: 64, span: 64, source: { atoms }, maxS: 0.5 });
    expect(Math.max(...s.bytes)).toBe(255);
  });
});
