import { describe, expect, it } from "vitest";
import { figureMask, lineDistance } from "../../../src/apps/chladni/figure";
import { lift, LIFT_FROM, LIFT_FULL } from "../../../src/apps/chladni/drive";
import { qOf } from "../../../src/apps/chladni/knobs";
import {
  bessel,
  besselPrimeZero,
  coupling,
  type Drive,
  DRIVE_GAIN,
  formModes,
  glideAt,
  glidePosOf,
  glideScale,
  HOME,
  type Mode,
  modeId,
  modesFor,
  onPlate,
  plateGrid,
  type PlateShape,
  type Point,
  Q,
  response,
  ringsAt,
  sample,
  saturate,
  shapeAt,
  soloKeyModes,
  spared,
  SPLIT,
  targets,
  turnToward,
} from "../../../src/apps/chladni/modes";

const SHAPES: PlateShape[] = ["square", "round"];

/** J_n(x) by its power series, as an independent reference. */
const seriesJ = (n: number, x: number): number => {
  let sum = 0;
  let term = (x / 2) ** n;
  for (let k = 1; k <= n; k++) term /= k;
  for (let k = 0; k < 60; k++) {
    sum += term;
    term *= -(x * x) / 4 / ((k + 1) * (k + 1 + n));
  }
  return sum;
};

describe("Bessel functions", () => {
  it("match the power series", () => {
    for (const n of [0, 1, 2, 3, 5, 6]) {
      for (const x of [0, 0.5, 1.7, 3.2, 6.4, 9.1, 11.7]) {
        expect(bessel(n, x).j, `J_${n}(${x})`).toBeCloseTo(seriesJ(n, x), 6);
      }
    }
  });

  it("give the derivative too", () => {
    for (const n of [0, 1, 3, 6]) {
      for (const x of [0.4, 2.5, 7.3, 11]) {
        const h = 1e-4;
        const fd = (seriesJ(n, x + h) - seriesJ(n, x - h)) / (2 * h);
        expect(bessel(n, x).dj).toBeCloseTo(fd, 5);
      }
    }
  });

  it("find the textbook zeros of J_n'", () => {
    const known: [number, number, number][] = [
      [1, 0, 1.8412],
      [2, 0, 3.0542],
      [0, 0, 3.8317],
      [3, 0, 4.2012],
      [1, 1, 5.3314],
      [0, 1, 7.0156],
      [2, 1, 6.7061],
      [0, 2, 10.1735],
    ];
    for (const [n, s, k] of known)
      expect(besselPrimeZero(n, s), `j'_${n},${s + 1}`).toBeCloseTo(k, 3);
  });
});

describe("plate modes", () => {
  for (const shape of SHAPES) {
    const modes = modesFor(shape);

    it(`${shape}: are in frequency order, distinct and spaced apart`, () => {
      expect(modes.length).toBeGreaterThanOrEqual(8);
      expect(modes.length).toBeLessThanOrEqual(20);
      expect(modes[0]!.freq).toBe(1);
      expect(new Set(modes.map(modeId)).size).toBe(modes.length);
      for (let i = 1; i < modes.length; i++) {
        expect(modes[i]!.index).toBe(i);
        // Neighbours at least 7 % apart, so a glide passes between their resonances.
        expect(modes[i]!.freq / modes[i - 1]!.freq, modeId(modes[i]!)).toBeGreaterThan(1.07);
      }
    });

    it(`${shape}: every mode peaks at 1 on the plate`, () => {
      for (const m of modes) {
        let peak = 0;
        for (const [u, v] of plateGrid(shape, 120))
          peak = Math.max(peak, Math.abs(shapeAt(m, u, v)));
        expect(peak, modeId(m)).toBeGreaterThan(0.97);
        expect(peak, modeId(m)).toBeLessThan(1.03);
      }
    });

    it(`${shape}: gradients match finite differences`, () => {
      const h = 1e-5;
      for (const m of modes) {
        for (const [u, v] of [
          [0.31, -0.42],
          [-0.55, 0.12],
          [0.05, 0.6],
        ] as const) {
          const s = sample(m, u, v);
          const du = (shapeAt(m, u + h, v) - shapeAt(m, u - h, v)) / (2 * h);
          const dv = (shapeAt(m, u, v + h) - shapeAt(m, u, v - h)) / (2 * h);
          expect(s.du, `${modeId(m)} du`).toBeCloseTo(du, 3);
          expect(s.dv, `${modeId(m)} dv`).toBeCloseTo(dv, 3);
        }
      }
    });

    it(`${shape}: each key's picture lights exactly the mode's still lines`, () => {
      const size = 96;
      for (const m of modes) {
        const mask = figureMask(m, size, size, 2);
        let lit = 0;
        let inside = 0;
        for (let iy = 0; iy < size; iy++) {
          for (let ix = 0; ix < size; ix++) {
            const u = -1 + (2 * (ix + 0.5)) / size;
            const v = -1 + (2 * (iy + 0.5)) / size;
            if (!onPlate(shape, u, v)) continue;
            inside++;
            const a = mask[iy * size + ix]!;
            // Lit pixels sit on a still line (within a couple of pixels), and every pixel that
            // a still line crosses is lit.
            const d = lineDistance(m, u, v) * (size / 2);
            if (a > 0.5) {
              lit++;
              expect(Math.abs(shapeAt(m, u, v)), `${modeId(m)} at ${u},${v}`).toBeLessThan(0.3);
              expect(d).toBeLessThan(2.5);
            }
            if (d < 0.5) expect(a, `${modeId(m)} line at ${u},${v}`).toBeGreaterThan(0.5);
          }
        }
        expect(lit / inside, modeId(m)).toBeGreaterThan(0.01);
        expect(lit / inside, modeId(m)).toBeLessThan(0.35);
      }
    });
  }

  it("have their still lines where the textbook says", () => {
    const sq = modesFor("square");
    const by = (id: string) => sq.find((m) => modeId(m) === id)!;
    // cos(pi x) cos(pi y): a cross through the middle.
    for (const t of [-0.8, -0.3, 0.2, 0.7]) {
      expect(shapeAt(by("s1-1+"), 0, t)).toBeCloseTo(0, 9);
      expect(shapeAt(by("s1-1+"), t, 0)).toBeCloseTo(0, 9);
      // cos(2 pi x) - cos(2 pi y): both diagonals.
      expect(shapeAt(by("s2-0-"), t, t)).toBeCloseTo(0, 9);
      expect(shapeAt(by("s2-0-"), t, -t)).toBeCloseTo(0, 9);
    }
    const rd = modesFor("round");
    const r = (id: string) => rd.find((m) => modeId(m) === id)!;
    // One nodal circle at j_0,1 / j'_0,1 of the radius.
    const ring = 2.404826 / 3.831706;
    for (const a of [0, 1, 2, 3, 4, 5]) {
      expect(shapeAt(r("r0.1"), ring * Math.sin(a), ring * Math.cos(a))).toBeCloseTo(0, 4);
    }
    // n nodal diameters, one of them horizontal for odd n.
    expect(shapeAt(r("r1.0"), 0.6, 0)).toBeCloseTo(0, 9);
    for (let k = 0; k < 6; k++) {
      const th = (Math.PI / 3) * (k + 0.5);
      expect(shapeAt(r("r3.0"), 0.5 * Math.sin(th), -0.5 * Math.cos(th))).toBeCloseTo(0, 6);
    }
  });
});

describe("driven response", () => {
  const modes = modesFor("square");

  it("peaks at the mode's own frequency", () => {
    for (const m of modes) {
      expect(response(m.freq, m.freq)).toBeCloseTo(1, 9);
      let best = 0;
      let at = 0;
      for (let f = m.freq * 0.8; f <= m.freq * 1.2; f += m.freq * 0.0005) {
        const r = response(f, m.freq);
        if (r > best) {
          best = r;
          at = f;
        }
      }
      expect(Math.abs(at / m.freq - 1)).toBeLessThan(0.002);
    }
  });

  it("is too weak between two neighbouring notes to lift the sand, wherever the drive point", () => {
    for (const shape of SHAPES) {
      const list = modesFor(shape);
      for (let i = 1; i < list.length; i++) {
        const f = Math.sqrt(list[i - 1]!.freq * list[i]!.freq);
        // The worst case: a drive point where every mode moves fully.
        const level = saturate(DRIVE_GAIN * Math.hypot(...list.map((m) => response(f, m.freq))));
        expect(level, `${shape} between ${i - 1} and ${i}`).toBeLessThan(LIFT_FROM);
      }
    }
  });

  it("widens with damping, and moves neighbours out of step with the resonance", () => {
    const modes = modesFor("square");
    const light = qOf(0);
    const heavy = qOf(1);
    for (const m of modes) {
      for (const off of [1.01, 1.03, 1.07]) {
        const f = m.freq * off;
        expect(response(f, m.freq, heavy)).toBeGreaterThan(response(f, m.freq, Q));
        expect(response(f, m.freq, Q)).toBeGreaterThan(response(f, m.freq, light));
      }
    }
    // Half-power width is about f / Q.
    const width = (q: number) => {
      let f = 1;
      while (response(f, 1, q) > Math.SQRT1_2) f += 1e-4;
      return 2 * (f - 1);
    };
    expect(width(heavy) / width(Q)).toBeGreaterThan((0.8 * Q) / heavy);
    expect(width(heavy) / width(Q)).toBeLessThan((1.2 * Q) / heavy);
    // A key on a lightly damped plate rings its own figure; heavily damped, its neighbours join
    // in, a quarter cycle out of step, so the figure blurs.
    const key: Drive = { kind: "key", mode: 6, freq: 0, level: 1 };
    const at = HOME.square;
    const others = (q: number) => {
      const t = targets(modes, [key], at, [], q);
      let rest = 0;
      for (let i = 0; i < modes.length; i++) if (i !== 6) rest += t.re[i]! ** 2 + t.im[i]! ** 2;
      return Math.sqrt(rest) / Math.hypot(t.re[6]!, t.im[6]!);
    };
    expect(others(Q)).toBeLessThan(0.05);
    expect(others(heavy)).toBeGreaterThan(0.5);
  });
});

describe("the drive point", () => {
  const press = (m: Mode): Drive => ({ kind: "key", mode: m.index, freq: 0, level: 1 });
  const level = (modes: readonly Mode[], m: Mode, at: Point) => {
    const t = targets(modes, [press(m)], at, []);
    return Math.hypot(...t.re, ...t.im);
  };

  /** A point on a still line of `m`, scanning rows and columns from places that move. */
  const stillPoint = (m: Mode): Point | null => {
    for (let i = 0; i < 400; i++) {
      const c = -0.8 + (1.6 * i) / 400;
      for (let x = -0.8; x < 0.8; x += 0.002) {
        for (const [p, q] of [
          [
            { u: x, v: c },
            { u: x + 0.002, v: c },
          ],
          [
            { u: c, v: x },
            { u: c, v: x + 0.002 },
          ],
        ] as const) {
          const a = shapeAt(m, p.u, p.v);
          const b = shapeAt(m, q.u, q.v);
          if (a * b < 0) {
            const k = a / (a - b);
            return { u: p.u + (q.u - p.u) * k, v: p.v + (q.v - p.v) * k };
          }
        }
      }
    }
    return null;
  };

  it("square: a figure won't ring with the drive point on its still line, and rings from a place that moves", () => {
    const modes = modesFor("square");
    for (const m of modes) {
      let most = { u: 0, v: 0, w: 0 };
      for (const [u, v] of plateGrid("square", 80)) {
        const w = Math.abs(shapeAt(m, u, v));
        if (Math.hypot(u, v) < 0.9 && w > most.w) most = { u, v, w };
      }
      const still = stillPoint(m);
      expect(still, modeId(m)).not.toBeNull();
      const dead = targets(modes, [press(m)], still!, []);
      expect(Math.hypot(dead.re[m.index]!, dead.im[m.index]!), modeId(m)).toBeLessThan(0.03);
      expect(level(modes, m, still!), modeId(m)).toBeLessThan(LIFT_FROM);
      const t = targets(modes, [press(m)], most, []);
      expect(Math.hypot(t.re[m.index]!, t.im[m.index]!), modeId(m)).toBeGreaterThan(0.95);
    }
  });

  it("round: spokes turn to follow the drive point, so only a nodal circle (or the middle) silences a figure", () => {
    for (const m of modesFor("round")) {
      // The first radius where J_n(k r) is zero inside the plate, or the middle for spokes alone.
      let r = 0;
      for (let x = 0.05; x < 0.95; x += 0.001) {
        if (bessel(m.n, m.k * x).j * bessel(m.n, m.k * (x + 0.001)).j < 0) {
          r = x + 0.0005;
          break;
        }
      }
      if (r === 0 && m.n === 0) continue;
      for (const angle of [0.3, 2.1, -1.2]) {
        const at = { u: r * Math.sin(angle), v: -r * Math.cos(angle) };
        const modes = formModes("round", { stretch: 0, wide: true, turn: angle });
        const dead = targets(modes, [press(modes[m.index]!)], at, []);
        expect(Math.hypot(dead.re[m.index]!, dead.im[m.index]!), modeId(m)).toBeLessThan(0.03);
        // At the rim, the same direction rings it.
        const rim = { u: 0.97 * Math.sin(angle), v: -0.97 * Math.cos(angle) };
        expect(level(modes, modes[m.index]!, rim), modeId(m)).toBeGreaterThan(0.6);
      }
    }
  });

  it("rings a mode in proportion to its motion at the drive point, until the shaker tops out", () => {
    const modes = modesFor("square");
    const m = modes[3]!;
    let most = 0;
    for (const [u, v] of plateGrid("square", 24)) {
      const c = Math.abs(coupling(m, { u, v }));
      const t = targets(modes, [press(m)], { u, v }, []);
      const own = Math.hypot(t.re[3]!, t.im[3]!);
      if (c < 0.15) {
        expect(own).toBeGreaterThan(DRIVE_GAIN * c * 0.9 - 1e-3);
        expect(own).toBeLessThan(DRIVE_GAIN * c * 1.01 + 1e-3);
      }
      most = Math.max(most, own);
    }
    expect(most).toBeGreaterThan(0.97);
    expect(most).toBeLessThanOrEqual(1);
  });

  for (const shape of SHAPES) {
    // A disc's figures face the drive point, so at home they are turned towards it.
    const modes = formModes(shape, { stretch: 0, wide: true, turn: turnToward(HOME[shape]) });
    it(`${shape}: its home rings every figure well`, () => {
      for (const m of modes) {
        const l = level(modes, m, HOME[shape]);
        expect(l, modeId(m)).toBeGreaterThan(0.62);
        expect(lift(l), modeId(m)).toBeGreaterThan(0.75);
        expect(ringsAt(m, HOME[shape]), modeId(m)).toBeGreaterThan(0.62);
      }
      expect(LIFT_FULL).toBeLessThan(0.75);
    });
  }

  it("turns a disc's figures to put the drive point on their axis", () => {
    const base = modesFor("round");
    for (const turn of [0.4, 1.3, -2.2]) {
      const turned = formModes("round", { stretch: 0, wide: true, turn });
      for (const m of turned) {
        const b = base[m.index]!;
        // The turned figure is the unturned one rotated by `turn`.
        for (const [u, v] of [
          [0.3, -0.5],
          [-0.6, 0.2],
        ] as const) {
          const c = Math.cos(turn);
          const s = Math.sin(turn);
          // theta is measured from straight up, clockwise in screen terms.
          const ru = u * c - v * s;
          const rv = u * s + v * c;
          expect(shapeAt(m, ru, rv), modeId(m)).toBeCloseTo(shapeAt(b, u, v), 6);
        }
        // So a drive point along the turn never sits on a diameter.
        const p = { u: 0.97 * Math.sin(turn), v: -0.97 * Math.cos(turn) };
        expect(Math.abs(coupling(m, p))).toBeCloseTo(Math.abs(shapeAt(b, 0, -0.97)), 6);
      }
    }
  });
});

describe("a stretched plate", () => {
  const square = modesFor("square");
  const form = (stretch: number, wide = true) => formModes("square", { stretch, wide, turn: 0 });

  it("is the square plate at no stretch", () => {
    expect(form(0)).toBe(square);
  });

  for (const stretch of [0.3, 1]) {
    for (const wide of [true, false]) {
      it(`peaks every mode at 1 and keeps its gradients (stretch ${stretch}, ${wide ? "wide" : "tall"})`, () => {
        for (const m of form(stretch, wide)) {
          let peak = 0;
          for (const [u, v] of plateGrid("square", 120))
            peak = Math.max(peak, Math.abs(shapeAt(m, u, v)));
          expect(peak, modeId(m)).toBeGreaterThan(0.97);
          expect(peak, modeId(m)).toBeLessThan(1.03);
          const h = 1e-5;
          const s = sample(m, 0.31, -0.42);
          expect(s.du).toBeCloseTo(
            (shapeAt(m, 0.31 + h, -0.42) - shapeAt(m, 0.31 - h, -0.42)) / (2 * h),
            3,
          );
          expect(s.dv).toBeCloseTo(
            (shapeAt(m, 0.31, -0.42 + h) - shapeAt(m, 0.31, -0.42 - h)) / (2 * h),
            3,
          );
        }
      });
    }
  }

  it("follows each product's wavenumber along the sides, so pairs part as it stretches", () => {
    const low = (1 + 1) * (1 + SPLIT);
    // At 2:1 the sides are sqrt(2) and 1/sqrt(2) of the square's: (n / Lx)^2 + (m / Ly)^2.
    const full = form(1);
    const product = (n: number, m: number) => (n * n) / 2 + m * m * 2;
    const by = (id: string) => full.find((m) => modeId(m) === id)!;
    // s2-0: cos(2 pi x) and cos(2 pi y) differ by 4 times; with the coupling they lie just
    // outside the products' own frequencies.
    const minus = by("s2-0-").freq * low;
    const plus = by("s2-0+").freq * low;
    expect(minus).toBeLessThan(product(2, 0));
    expect(minus).toBeGreaterThan(product(2, 0) * 0.95);
    expect(plus).toBeGreaterThan(product(0, 2));
    expect(plus).toBeLessThan(product(0, 2) * 1.02);
    // A pair's split grows steadily from the square's.
    for (const id of ["s2-0", "s3-1", "s5-1"]) {
      let prev = 0;
      for (const st of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
        const f = form(st);
        const ratio =
          f.find((m) => modeId(m) === `${id}+`)!.freq / f.find((m) => modeId(m) === `${id}-`)!.freq;
        expect(ratio, `${id} at ${st}`).toBeGreaterThan(prev);
        prev = ratio;
      }
      expect(prev).toBeGreaterThan(1.5);
    }
    // n = m modes have no partner; they simply follow the sides.
    expect(by("s1-1+").freq).toBeCloseTo((0.5 + 2) / 2, 6);
  });

  it("turns each figure from the square's sum or difference into a single product", () => {
    for (const m of form(1)) {
      if (m.n === m.m) continue;
      const big = Math.max(Math.abs(m.a), Math.abs(m.b));
      const small = Math.min(Math.abs(m.a), Math.abs(m.b));
      expect(small / big, modeId(m)).toBeLessThan(0.15);
    }
    for (const m of form(0.02)) {
      if (m.n === m.m) continue;
      expect(Math.abs(Math.abs(m.a) - Math.abs(m.b)), modeId(m)).toBeLessThan(0.3);
    }
  });

  it("is the same plate turned, whichever way its long side runs", () => {
    const wide = form(0.6, true);
    const tall = form(0.6, false);
    wide.forEach((m, i) => {
      const t = tall[i]!;
      expect(t.freq).toBeCloseTo(m.freq, 9);
      for (const [u, v] of [
        [0.2, -0.7],
        [-0.45, 0.33],
      ] as const) {
        expect(Math.abs(shapeAt(t, v, u))).toBeCloseTo(Math.abs(shapeAt(m, u, v)), 6);
      }
    });
  });
});

describe("damping by a finger", () => {
  const modes = modesFor("square");
  const cross = modes.find((m) => modeId(m) === "s1-1+")!;
  const home = HOME.square;
  const size = (t: { re: Float64Array; im: Float64Array }, i: number) =>
    Math.hypot(t.re[i]!, t.im[i]!);

  it("spares a mode that is still under the finger and damps one that moves", () => {
    // s1-1+ is still along u = 0 and moves most near the corners.
    expect(spared(cross, [{ u: 0, v: 0.5 }])).toBeGreaterThan(0.99);
    expect(spared(cross, [{ u: 0.9, v: 0.9 }])).toBeLessThan(0.1);
  });

  const press = (m: Mode): Drive => ({ kind: "key", mode: m.index, freq: 0, level: 1 });

  it("leaves a key's figure alone when the finger is on one of its lines", () => {
    const free = targets(modes, [press(cross)], home, []);
    const t = targets(modes, [press(cross)], home, [{ u: 0, v: -0.4 }]);
    expect(size(t, cross.index)).toBeCloseTo(size(free, cross.index), 3);
    expect(size(t, cross.index)).toBeGreaterThan(0.65);
    for (let i = 0; i < modes.length; i++)
      if (i !== cross.index) expect(size(t, i)).toBeLessThan(0.02);
  });

  it("fades a key's figure under a moving finger and grows figures with a still line there", () => {
    for (const m of modes) {
      // The point where this mode moves most, away from the rim.
      let p = { u: 0, v: 0 };
      let most = -1;
      for (const [u, v] of plateGrid("square", 40)) {
        const w = Math.abs(shapeAt(m, u, v));
        if (Math.hypot(u, v) < 0.85 && w > most) {
          most = w;
          p = { u, v };
        }
      }
      const t = targets(modes, [press(m)], home, [p]);
      expect(size(t, m.index), modeId(m)).toBeLessThan(0.1);
      let grown = -1;
      for (let i = 0; i < modes.length; i++) {
        if (i !== m.index && (grown < 0 || size(t, i) > size(t, grown))) grown = i;
      }
      expect(size(t, grown), modeId(m)).toBeGreaterThan(0.2);
      // What grows is still where the finger is.
      expect(Math.abs(shapeAt(modes[grown]!, p.u, p.v)), modeId(m)).toBeLessThan(0.2);
    }
  });

  it("rings no more than the drives ask", () => {
    const t = targets(modes, [press(cross)], home, [{ u: 0.7, v: 0.7 }]);
    expect(Math.hypot(...t.re, ...t.im)).toBeLessThanOrEqual(1.0001);
  });
});

describe("glide scale", () => {
  const notes = [2, 2.5, 3.1];

  it("puts the notes at evenly spaced marks and hits them exactly", () => {
    const s = glideScale(notes, 1.7, 3.6);
    expect(s.marks).toHaveLength(3);
    const gap = s.marks[1]! - s.marks[0]!;
    expect(s.marks[2]! - s.marks[1]!).toBeCloseTo(gap, 9);
    s.marks.forEach((t, i) => expect(glideAt(s, t!)).toBeCloseTo(notes[i]!, 9));
  });

  it("never falls, holds on each note near its mark, and reaches towards the neighbours", () => {
    const s = glideScale(notes, 1.7, 3.6);
    let prev = 0;
    for (let t = 0; t <= 1.0000001; t += 0.01) {
      const f = glideAt(s, t);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    const gap = s.marks[1]! - s.marks[0]!;
    for (const [i, t] of s.marks.entries()) {
      expect(glideAt(s, t! - gap * 0.1)).toBeCloseTo(notes[i]!, 9);
      expect(glideAt(s, t! + gap * 0.1)).toBeCloseTo(notes[i]!, 9);
    }
    expect(glideAt(s, s.marks[0]! + gap / 2)).toBeGreaterThan(notes[0]! * 1.05);
    expect(glideAt(s, 0)).toBeLessThan(2);
    expect(glideAt(s, 0)).toBeGreaterThan(1.7);
    expect(glideAt(s, 1)).toBeGreaterThan(3.1);
    expect(glideAt(s, 1)).toBeLessThan(3.6);
  });

  it("finds a frequency's place along the strip", () => {
    const s = glideScale(notes);
    for (const t of [0.05, 0.3, 0.5, 0.77, 0.95]) {
      const f = glideAt(s, t);
      expect(glideAt(s, glidePosOf(s, f)!)).toBeCloseTo(f, 6);
    }
    expect(glidePosOf(s, 100)).toBeNull();
  });

  it("keeps its axis when the plate stretches, and slides each mark to its note's new place", () => {
    const axis = glideScale(notes, 1.7, 3.6);
    const moved = [2.2, 2.4, 3.9];
    const s = glideScale(moved, 1.8, 4.5, axis);
    expect(s.marks[0]).not.toBeNull();
    expect(s.marks[1]).not.toBeNull();
    // 3.9 is past the strip's end now.
    expect(s.marks[2]).toBeNull();
    for (let i = 0; i < 2; i++) expect(glideAt(s, s.marks[i]!)).toBeCloseTo(moved[i]!, 6);
    // A note keeps its place on the axis: the new mark sits where the old scale had that pitch.
    expect(s.marks[0]!).toBeCloseTo(glidePosOf(axis, 2.2)!, 1);
    // The same notes give back the square's scale.
    const same = glideScale(notes, 1.7, 3.6, axis);
    same.marks.forEach((t, i) => expect(t).toBeCloseTo(axis.marks[i]!, 6));
    for (const t of [0.1, 0.35, 0.8]) expect(glideAt(same, t)).toBeCloseTo(glideAt(axis, t), 6);
    // Notes that change order move their marks past each other.
    const crossed = glideScale([2.6, 2.4, 3.1], 1.7, 3.6, axis);
    expect(crossed.marks[0]!).toBeGreaterThan(crossed.marks[1]!);
  });

  it("is near each note for a finger's width around its mark", () => {
    const modes = modesFor("square");
    const keys = soloKeyModes(3, modes.length).map((i) => modes[i]!.freq);
    const s = glideScale(keys);
    // On a 600 venue px strip, 30 px either side of a mark still rings the note well.
    const near = 30 / 600;
    for (let i = 0; i < keys.length; i++) {
      for (const d of [-near, near]) {
        expect(response(glideAt(s, s.marks[i]! + d), keys[i]!)).toBeGreaterThan(0.5);
      }
    }
  });
});

describe("solo keys", () => {
  it("spread through the plate's modes, lowest first", () => {
    for (const n of [4, 5, 6, 7, 8, 9, 10]) {
      const keys = soloKeyModes(n, 16);
      expect(keys).toHaveLength(n);
      expect(keys[0]).toBe(0);
      expect(keys[n - 1]).toBe(15);
      for (let i = 1; i < n; i++) expect(keys[i]!).toBeGreaterThan(keys[i - 1]!);
    }
    expect(soloKeyModes(10, 6)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
