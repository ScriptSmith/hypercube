import { describe, expect, it } from "vitest";
import { surfacesOf } from "../../../src/apps/optics/pieces";
import {
  BAND_BITS,
  BITS,
  LENS_INDEX,
  WHITE,
  crystalShare,
  indexOf,
  popcount,
} from "../../../src/apps/optics/spectrum";
import {
  MAT_GLASS,
  MAT_MIRROR,
  MAT_SPLIT,
  MAX_DEPTH,
  MAX_SEGS,
  type Scene,
  type Seg,
  type Source,
  type Surface,
  segment,
  trace,
} from "../../../src/apps/optics/trace";

const BOX = { x: -2000, y: -2000, width: 4000, height: 4000 };
const scene = (surfaces: Surface[], crystals: Scene["crystals"] = []): Scene => ({
  surfaces,
  crystals,
  box: BOX,
  bodies: 8,
});
const ray = (x: number, y: number, angle: number, extra: Partial<Source> = {}): Source => ({
  x,
  y,
  dx: Math.cos(angle),
  dy: Math.sin(angle),
  bits: WHITE,
  level: 1,
  guide: false,
  hops: 0,
  ...extra,
});
const dir = (s: Seg) => {
  const l = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
  return [(s.x1 - s.x0) / l, (s.y1 - s.y0) / l] as const;
};
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/** A glass box (screen-clockwise corners, so normals face out). */
const glassBox = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  glass: "crown" | "flint" = "crown",
) => {
  const pts: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  return pts.map((a, i) => {
    const b = pts[(i + 1) % 4]!;
    return segment(a[0], a[1], b[0], b[1], MAT_GLASS, { glass, body: 0 });
  });
};

describe("reflection", () => {
  it("leaves at the angle it arrives, measured from the normal", () => {
    for (const mirrorDeg of [10, 30, 45, 60, 75, 100, 135]) {
      for (const inDeg of [0, 15, 40, -20]) {
        const m = rad(mirrorDeg);
        // A mirror through the origin, its face towards the incoming light.
        let s = segment(
          -Math.cos(m) * 300,
          -Math.sin(m) * 300,
          Math.cos(m) * 300,
          Math.sin(m) * 300,
          MAT_MIRROR,
        );
        const a = rad(inDeg);
        const src = ray(-Math.cos(a) * 500, -Math.sin(a) * 500, a);
        if (s.nx * src.dx + s.ny * src.dy > 0) {
          s = segment(
            Math.cos(m) * 300,
            Math.sin(m) * 300,
            -Math.cos(m) * 300,
            -Math.sin(m) * 300,
            MAT_MIRROR,
          );
        }
        const t = trace(scene([s]), [src]);
        if (t.segs.length < 2) continue;
        const [ox, oy] = dir(t.segs[1]!);
        const inc = Math.abs(src.dx * s.nx + src.dy * s.ny);
        const out = Math.abs(ox * s.nx + oy * s.ny);
        expect(out).toBeCloseTo(inc, 9);
        // The reflected ray is on the face's side.
        expect(ox * s.nx + oy * s.ny).toBeGreaterThan(0);
      }
    }
  });

  it("stops at a mirror's dark back", () => {
    const s = segment(0, -100, 0, 100, MAT_MIRROR);
    // The face points right (+x); light from the right reflects, from the left stops.
    const fromLeft = trace(scene([s]), [ray(-500, 0, 0)]);
    expect(fromLeft.segs.length).toBe(1);
    const fromRight = trace(scene([s]), [ray(500, 0, Math.PI)]);
    expect(fromRight.segs.length).toBe(2);
  });
});

describe("refraction", () => {
  it("follows Snell's law into and out of glass", () => {
    const n = LENS_INDEX;
    for (const inDeg of [0, 10, 25, 40, 55, 70]) {
      const a = rad(inDeg);
      // Light coming down onto the top face of a glass slab.
      const t = trace(scene(glassBox(-1000, 0, 1000, 400)), [
        ray(-Math.sin(a) * 300, -Math.cos(a) * 300, Math.PI / 2 - a),
      ]);
      const inside = t.segs[1]!;
      const [dx, dy] = dir(inside);
      const sin2 = Math.abs(dx);
      expect(Math.sin(a)).toBeCloseTo(n * sin2, 9);
      expect(dy).toBeGreaterThan(0);
      // Out through the parallel bottom face at the angle it came in.
      const [ex] = dir(t.segs[2]!);
      expect(Math.abs(ex)).toBeCloseTo(Math.sin(a), 9);
    }
  });

  it("reflects totally inside glass beyond the critical angle", () => {
    const n = LENS_INDEX;
    const critical = Math.asin(1 / n);
    const box = glassBox(-500, -500, 500, 500);
    for (const [offDeg, escapes] of [
      [deg(critical) - 3, true],
      [deg(critical) + 3, false],
    ] as const) {
      const a = rad(offDeg);
      // From inside, heading for the top face at `offDeg` from its normal.
      const t = trace(scene(box), [ray(0, 0, -Math.PI / 2 + a)]);
      const [, dy1] = dir(t.segs[1]!);
      if (escapes) expect(dy1).toBeLessThan(0);
      else expect(dy1).toBeGreaterThan(0);
    }
  });
});

describe("dispersion", () => {
  it("has a higher index for shorter wavelengths, by Cauchy's formula", () => {
    for (let b = 1; b < BITS; b++)
      expect(indexOf("flint", b)).toBeGreaterThan(indexOf("flint", b - 1));
    expect(indexOf("crown", 0)).toBe(indexOf("crown", BITS - 1));
  });

  it("sends violet through a prism at a larger angle than red", () => {
    const prism = surfacesOf({ kind: "prism", x: 0, y: 0, turn: 0, r: 200 }, 0);
    // Light rising 25 degrees into the middle of the prism's left face, near minimum deviation.
    const up = rad(-25);
    const t = trace(scene(prism), [ray(-600, -47 + 518 * Math.tan(rad(25)), up)]);
    const out = t.segs.filter((s) => s.from === 0 && s.to !== 0);
    expect(out.length).toBe(BITS);
    const angle = (bit: number) => {
      const s = out.find((x) => x.bits === 1 << bit)!;
      const [dx, dy] = dir(s);
      return Math.atan2(dy, dx);
    };
    // Each step to a shorter wavelength bends further from the incoming direction.
    const dev = Array.from({ length: BITS }, (_, b) => angle(b) - up);
    for (let b = 1; b < BITS; b++) expect(dev[b]).toBeGreaterThan(dev[b - 1]!);
    const spread = deg(dev[BITS - 1]! - dev[0]!);
    expect(spread).toBeGreaterThan(5);
    expect(spread).toBeLessThan(25);
  });

  it("keeps white light white through a lens", () => {
    const lens = surfacesOf({ kind: "convex", x: 0, y: 0, turn: 0, r: 120 }, 0);
    const t = trace(scene(lens), [ray(-500, 30, 0)]);
    expect(t.segs.every((s) => s.bits === WHITE)).toBe(true);
  });
});

describe("lenses", () => {
  const bundle = (offsets: number[]) => offsets.map((o) => ray(-600, o, 0));
  const crossings = (t: ReturnType<typeof trace>) =>
    t.segs
      .filter((s) => s.from === 0 && s.to !== 0)
      .map((s) => {
        const [dx, dy] = dir(s);
        // Where the ray crosses the axis (y = 0).
        return s.x0 + (dx * -s.y0) / dy;
      });

  it("brings a parallel bundle to a focus near the lensmaker's focal length", () => {
    const r = 120;
    const lens = surfacesOf({ kind: "convex", x: 0, y: 0, turn: 0, r }, 0);
    const t = trace(scene(lens), bundle([-30, -15, 15, 30]));
    const xs = crossings(t);
    expect(xs.length).toBe(4);
    // A face of half-height 0.9 r and depth 0.27 r has radius (h^2 + s^2) / 2s.
    const h = 0.9 * r;
    const s = 0.27 * r;
    const R = (h * h + s * s) / (2 * s);
    const f = R / (2 * (LENS_INDEX - 1));
    for (const x of xs) {
      expect(x).toBeGreaterThan(f * 0.75);
      expect(x).toBeLessThan(f * 1.15);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(f * 0.12);
  });

  it("spreads a parallel bundle through a concave lens", () => {
    const lens = surfacesOf({ kind: "concave", x: 0, y: 0, turn: 0, r: 120 }, 0);
    const t = trace(scene(lens), bundle([-40, 40]));
    const out = t.segs.filter((s) => s.from === 0 && s.to !== 0);
    expect(out.length).toBe(2);
    for (const s of out) {
      const [, dy] = dir(s);
      expect(Math.sign(dy)).toBe(Math.sign(s.y0));
    }
  });
});

describe("filters, splitters and crystals", () => {
  it("passes only a filter's band", () => {
    const f = surfacesOf({ kind: "filter", x: 0, y: 0, turn: 6, r: 120, band: "g" }, 0);
    const t = trace(scene(f), [ray(-500, 0, 0)]);
    expect(t.segs[1]!.bits).toBe(BAND_BITS.g);
    const red = trace(scene(f), [ray(-500, 0, 0, { bits: 1 })]);
    expect(red.segs.length).toBe(1);
  });

  it("halves light both ways at a splitter", () => {
    const s = segment(-100, 100, 100, -100, MAT_SPLIT, { body: 0 });
    const t = trace(scene([s]), [ray(-500, 0, 0)]);
    const after = t.segs.filter((x) => x.from === 0);
    expect(after.length).toBe(2);
    for (const a of after) expect(a.level).toBeCloseTo(0.5, 9);
    const dirs = after.map(dir).map(([dx, dy]) => [Math.round(dx), Math.round(dy)].join(","));
    expect(dirs.sort()).toEqual(["0,-1", "1,0"]);
  });

  it("lights a crystal only from light passing through it", () => {
    const k = { x: 300, y: 0, r: 40, band: "w" as const, need: 0.06 };
    const hit = trace(scene([], [k]), [ray(-500, 30, 0)]);
    const miss = trace(scene([], [k]), [ray(-500, 50, 0)]);
    expect(hit.real[0]).toBeCloseTo(1, 9);
    expect(miss.real[0]).toBe(0);
    const guide = trace(scene([], [k]), [ray(-500, 0, 0, { guide: true })]);
    expect(guide.real[0]).toBe(0);
    expect(guide.guide[0]).toBeCloseTo(1, 9);
  });

  it("lights coloured crystals only from light within their band", () => {
    expect(crystalShare("r", WHITE, 1)).toBe(0);
    expect(crystalShare("r", 1, 1)).toBeCloseTo(0.5, 9);
    expect(crystalShare("r", BAND_BITS.r, 1)).toBeCloseTo(1, 9);
    expect(crystalShare("b", BAND_BITS.r, 1)).toBe(0);
    expect(crystalShare("w", 1, 1)).toBeCloseTo(1 / BITS, 9);
    expect(crystalShare("w", WHITE, 0.5)).toBeCloseTo(0.5, 9);
    expect(popcount(BAND_BITS.r | BAND_BITS.g | BAND_BITS.b)).toBe(BITS);
  });
});

describe("limits", () => {
  it("stops a ray bouncing between two mirrors after its interaction limit", () => {
    const a = segment(-300, -200, -300, 200, MAT_MIRROR);
    const b = segment(300, 200, 300, -200, MAT_MIRROR);
    // Normals face each other: a's points +x, b's points -x.
    expect(a.nx).toBeGreaterThan(0);
    expect(b.nx).toBeLessThan(0);
    const t = trace(scene([a, b]), [ray(0, 0, 0.001)]);
    expect(t.truncated).toBe(true);
    expect(t.segs.length).toBeLessThanOrEqual(MAX_DEPTH + 1);
  });

  it("keeps a hall of mirrors and splitters within the segment limit", () => {
    // Counter-clockwise on screen, so every face looks inwards.
    const walls = [
      segment(-400, -400, -400, 400, MAT_MIRROR),
      segment(-400, 400, 400, 400, MAT_MIRROR),
      segment(400, 400, 400, -400, MAT_MIRROR),
      segment(400, -400, -400, -400, MAT_MIRROR),
    ];
    const splitters = [
      segment(-150, -100, -50, 0, MAT_SPLIT),
      segment(50, 100, 150, 0, MAT_SPLIT),
      segment(-100, 150, 0, 50, MAT_SPLIT),
    ];
    // Keep the light bright enough that only the counts stop it.
    const t = trace(scene([...walls, ...splitters]), [ray(-300, -20, 0.3)], {
      depth: MAX_DEPTH,
      minLevel: 1e-12,
      segs: MAX_SEGS,
    });
    expect(t.truncated).toBe(true);
    expect(t.segs.length).toBeLessThanOrEqual(MAX_SEGS);
  });

  it("drops light below the brightness cut-off", () => {
    const splitters = Array.from({ length: 8 }, (_, i) =>
      segment(100 * (i + 1), -60, 100 * (i + 1) + 1, 60, MAT_SPLIT),
    );
    const t = trace(scene(splitters), [ray(0, 0, 0)]);
    expect(t.segs.every((s) => s.level >= 0.05)).toBe(true);
  });

  it("gives the same light for the same scene, every time", () => {
    const prism = surfacesOf({ kind: "prism", x: 0, y: 0, turn: 3, r: 150 }, 0);
    const lens = surfacesOf({ kind: "convex", x: 400, y: 50, turn: 1, r: 120 }, 1);
    const src = [ray(-700, 20, 0.05), ray(-700, -40, -0.1, { bits: 0b11 })];
    const a = trace(scene([...prism, ...lens]), src);
    const b = trace(scene([...prism, ...lens]), src);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
