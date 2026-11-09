import { describe, expect, it } from "vitest";
import { hull2, hull3, hullEdges, hullVolume, type Vec3 } from "../../../src/apps/fourd/hull";
import {
  ease,
  presetPath,
  pathAt,
  restRot,
  slowTurn,
  startTurning,
  turningAt,
} from "../../../src/apps/fourd/orient";
import {
  alignTurn,
  apply,
  copyMat,
  det,
  distance,
  fromPair,
  identity,
  mul,
  orthoError,
  planeTurn,
  slerpRot,
  toPair,
  turnBy,
} from "../../../src/apps/fourd/rot";
import { createRng } from "../../../src/core/rng";
import { FAMILIES, featureDirs, shapeOf } from "../../../src/apps/fourd/shapes";
import {
  crossings,
  cutOf,
  depthScale,
  EYE,
  extent,
  leverOf,
  project,
  shadowRadius,
  slice2,
  slice3,
  slice4,
  turned,
} from "../../../src/apps/fourd/slice";

const randomRot = (seed: number, turns = 20) => {
  const rng = createRng(seed);
  const m = identity();
  for (let i = 0; i < turns; i++) {
    const a = rng.int(4);
    let b = rng.int(4);
    if (b === a) b = (a + 1) % 4;
    turnBy(m, a, b, rng.range(-Math.PI, Math.PI));
  }
  return m;
};

describe("rotations", () => {
  it("a plane turn carries one axis towards the other", () => {
    const m = planeTurn(0, 3, Math.PI / 2);
    const v = [0, 0, 0, 0];
    apply(m, [1, 0, 0, 0], v);
    expect(v.map((x) => Math.round(x * 1e9) / 1e9)).toEqual([0, 0, 0, 1]);
  });

  it("stays orthonormal over a million random turns", () => {
    const rng = createRng(7);
    const m = identity();
    for (let i = 0; i < 1_000_000; i++) {
      const a = rng.int(4);
      const b = (a + 1 + rng.int(3)) % 4;
      turnBy(m, a, b, rng.range(-0.05, 0.05));
    }
    expect(orthoError(m)).toBeLessThan(1e-12);
    expect(det(m)).toBeCloseTo(1, 12);
  });

  it("round-trips through a quaternion pair", () => {
    for (let seed = 1; seed < 40; seed++) {
      const m = randomRot(seed);
      const { a, b } = toPair(m);
      const back = fromPair(a, b);
      expect(distance(m, back)).toBeLessThan(1e-9);
    }
  });

  it("slerps through rotations from end to end, however far apart", () => {
    for (let seed = 1; seed < 20; seed++) {
      const m0 = randomRot(seed);
      const m1 = randomRot(seed + 100);
      expect(distance(slerpRot(m0, m1, 0), m0)).toBeLessThan(1e-12);
      expect(distance(slerpRot(m0, m1, 1), m1)).toBeLessThan(1e-12);
      for (const t of [0.1, 0.5, 0.9]) {
        const m = slerpRot(m0, m1, t);
        expect(orthoError(m)).toBeLessThan(1e-12);
        expect(det(m)).toBeCloseTo(1, 9);
      }
      // Small steps stay small.
      const a = slerpRot(m0, m1, 0.5);
      const b = slerpRot(m0, m1, 0.51);
      expect(distance(a, b)).toBeLessThan(0.2);
    }
    // Opposite in a plane.
    const half = planeTurn(0, 3, Math.PI);
    const mid = slerpRot(identity(), half, 0.5);
    expect(orthoError(mid)).toBeLessThan(1e-12);
  });

  it("aligns one direction with another in one plane", () => {
    const a = [0.5, 0.5, 0.5, 0.5];
    const u = [0, 0, 0, -1];
    const m = alignTurn(a, u, 1);
    const v = [0, 0, 0, 0];
    apply(m, a, v);
    v.forEach((x, i) => expect(x).toBeCloseTo(u[i]!, 9));
    expect(orthoError(m)).toBeLessThan(1e-12);
    // Already aligned, and exactly opposite.
    expect(distance(alignTurn(u, u, 1), identity())).toBeLessThan(1e-12);
    const opp = alignTurn([0, 0, 0, 1], u, 1);
    apply(opp, [0, 0, 0, 1], v);
    v.forEach((x, i) => expect(x).toBeCloseTo(u[i]!, 9));
  });

  it("multiplies in order", () => {
    const a = planeTurn(0, 1, 0.3);
    const b = planeTurn(1, 2, 0.7);
    const ab = mul(a, b);
    const v = [0, 0, 0, 0];
    const w = [0, 0, 0, 0];
    apply(b, [1, 2, 3, 4], v);
    apply(a, v, w);
    const u = [0, 0, 0, 0];
    apply(ab, [1, 2, 3, 4], u);
    u.forEach((x, i) => expect(x).toBeCloseTo(w[i]!, 12));
  });
});

describe("shapes", () => {
  const counts: Record<string, [number, number]> = {
    cube2: [4, 4],
    cube3: [8, 12],
    cube4: [16, 32],
    pyramid2: [3, 3],
    pyramid3: [4, 6],
    pyramid4: [5, 10],
    diamond2: [4, 4],
    diamond3: [6, 12],
    diamond4: [8, 24],
  };
  for (const [key, [v, e]] of Object.entries(counts)) {
    it(`${key} has ${v} corners and ${e} edges, on the unit sphere`, () => {
      const fam = key.slice(0, -1) as (typeof FAMILIES)[number];
      const dim = Number(key.slice(-1)) as 2 | 3 | 4;
      const s = shapeOf(fam, dim);
      expect(s.verts.length).toBe(v);
      expect(s.edges.length).toBe(e);
      for (const p of s.verts) expect(Math.hypot(...p)).toBeCloseTo(1, 12);
      // Every edge has the same length.
      const lens = s.edges.map(([i, j]) =>
        Math.hypot(...s.verts[i]!.map((x, k) => x - s.verts[j]![k]!)),
      );
      for (const l of lens) expect(l).toBeCloseTo(lens[0]!, 12);
      // Nothing past the shape's own dimensions.
      for (const p of s.verts) for (let k = dim; k < 4; k++) expect((p as number[])[k]).toBe(0);
    });
  }

  it("lists faces of every dimension", () => {
    expect(featureDirs("cube", 4, 3).length).toBe(8);
    expect(featureDirs("cube", 4, 2).length).toBe(24);
    expect(featureDirs("cube", 4, 1).length).toBe(32);
    expect(featureDirs("cube", 4, 0).length).toBe(16);
    expect(featureDirs("diamond", 4, 3).length).toBe(16);
    expect(featureDirs("diamond", 4, 0).length).toBe(8);
    expect(featureDirs("pyramid", 4, 3).length).toBe(5);
    expect(featureDirs("pyramid", 4, 1).length).toBe(10);
    expect(featureDirs("ball", 4, 0)).toEqual([]);
  });
});

describe("hull", () => {
  it("orders a square's corners and drops points on its edges", () => {
    const loop = hull2([
      [0, 0],
      [1, 0],
      [0.5, 0],
      [1, 1],
      [0, 1],
      [0.5, 0.5],
    ]);
    expect(loop.length).toBe(4);
    expect(new Set(loop)).toEqual(new Set([0, 1, 3, 4]));
  });

  it("finds a cube's six square faces", () => {
    const pts: Vec3[] = [];
    for (let i = 0; i < 8; i++) pts.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
    // Points inside and on faces change nothing.
    pts.push([0, 0, 0], [1, 0, 0], [0.2, -1, 0.3]);
    const h = hull3(pts);
    expect(h.kind).toBe("solid");
    expect(h.faces.length).toBe(6);
    for (const f of h.faces) expect(f.length).toBe(4);
    expect(hullEdges(h).length).toBe(12);
    expect(hullVolume(h)).toBeCloseTo(8, 9);
    // Outward normals: each face's centre is along its normal.
    h.faces.forEach((f, i) => {
      const c = [0, 1, 2].map((k) => f.reduce((s, j) => s + h.points[j]![k]!, 0) / f.length);
      const n = h.normals[i]!;
      expect(c[0]! * n[0] + c[1]! * n[1] + c[2]! * n[2]).toBeGreaterThan(0.9);
    });
  });

  it("copes with degenerate input", () => {
    expect(hull3([]).kind).toBe("empty");
    expect(hull3([[1, 2, 3]]).kind).toBe("point");
    expect(
      hull3([
        [1, 2, 3],
        [1, 2, 3 + 1e-12],
      ]).kind,
    ).toBe("point");
    const seg = hull3([
      [0, 0, 0],
      [1, 1, 1],
      [0.5, 0.5, 0.5],
      [2, 2, 2],
    ]);
    expect(seg.kind).toBe("segment");
    expect(seg.points.length).toBe(2);
    const flat = hull3([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0.5, 0.5, 0],
      [0.5, 0.5, 0],
    ]);
    expect(flat.kind).toBe("polygon");
    expect(flat.faces[0]!.length).toBe(4);
    expect(hull3([[Number.NaN, 0, 0]]).kind).toBe("empty");
  });

  it("finds a tilted solid from random points inside a sphere and on it", () => {
    const rng = createRng(3);
    const pts: Vec3[] = [];
    for (let i = 0; i < 40; i++) {
      const v: Vec3 = [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)];
      pts.push(v);
    }
    const h = hull3(pts);
    expect(h.kind).toBe("solid");
    // Every point is inside or on every face plane.
    h.faces.forEach((f, i) => {
      const n = h.normals[i]!;
      const p0 = h.points[f[0]!]!;
      const d = n[0] * p0[0] + n[1] * p0[1] + n[2] * p0[2];
      for (const p of pts) expect(n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - d).toBeLessThan(1e-6);
    });
    // Euler: V - E + F = 2 for the corners actually used.
    const used = new Set(h.faces.flat());
    expect(used.size - hullEdges(h).length + h.faces.length).toBe(2);
  });
});

const sliceOf = (fam: (typeof FAMILIES)[number], k: number | null, cut: number) => {
  const s = shapeOf(fam, 4);
  const from = identity();
  const rot = k === null ? restRot(s) : pathAt(presetPath(s, restRot(s), k), restRot(s), 1);
  void from;
  return slice4(s, turned(s, rot), cut);
};

describe("slices", () => {
  it("a tesseract cell first gives cubes, the same all the way through", () => {
    const s = shapeOf("cube", 4);
    const rot = restRot(s);
    expect(distance(rot, identity())).toBeLessThan(1e-12);
    const e = extent(s, rot, 3);
    expect(e.lo).toBeCloseTo(-0.5, 12);
    expect(e.hi).toBeCloseTo(0.5, 12);
    for (const cut of [-0.4, 0, 0.3]) {
      const sl = slice4(s, turned(s, rot), cut);
      expect(sl.kind).toBe("hull");
      if (sl.kind !== "hull") continue;
      expect(sl.hull.kind).toBe("solid");
      expect(sl.hull.faces.length).toBe(6);
      expect(hullVolume(sl.hull)).toBeCloseTo(1, 9);
    }
    expect(slice4(s, turned(s, rot), 0.6).kind).toBe("none");
  });

  it("a tesseract corner first gives a tetrahedron near the end and an octahedron in the middle", () => {
    const s = shapeOf("cube", 4);
    const corner = pathAt(presetPath(s, restRot(s), 0), restRot(s), 1);
    const e = extent(s, corner, 3);
    expect(e.lo).toBeCloseTo(-1, 9);
    expect(e.hi).toBeCloseTo(1, 9);
    const pts = turned(s, corner);
    const near = slice4(s, pts, -0.8);
    expect(near.kind === "hull" && near.hull.kind).toBe("solid");
    if (near.kind === "hull") {
      expect(near.hull.faces.length).toBe(4);
      for (const f of near.hull.faces) expect(f.length).toBe(3);
    }
    const mid = slice4(s, pts, 0);
    if (mid.kind !== "hull") throw new Error("no slice");
    expect(mid.hull.points.length).toBe(6);
    expect(mid.hull.faces.length).toBe(8);
    for (const f of mid.hull.faces) expect(f.length).toBe(3);
    // Truncated between: hexagons and triangles.
    const between = slice4(s, pts, -0.3);
    if (between.kind !== "hull") throw new Error("no slice");
    expect(between.hull.faces.length).toBe(8);
    // The tip: a single point.
    const tip = slice4(s, pts, -1);
    expect(tip.kind === "hull" && tip.hull.kind).toBe("point");
  });

  it("a cube face, edge and corner first through a flat world", () => {
    const s = shapeOf("cube", 3);
    const rest = restRot(s);
    const at = (k: number | null, cut: number) => {
      const rot = k === null ? rest : pathAt(presetPath(s, rest, k), rest, 1);
      return slice3(s, turned(s, rot), cut);
    };
    const sq = at(null, 0.1);
    expect(sq.kind === "poly" && sq.points.length).toBe(4);
    const rect = at(1, 0);
    if (rect.kind !== "poly") throw new Error("no slice");
    expect(rect.points.length).toBe(4);
    const sides = rect.points.map((p, i) => {
      const q = rect.points[(i + 1) % 4]!;
      return Math.hypot(p[0] - q[0], p[1] - q[1]);
    });
    // Edge first through the middle: a √2 by 1 rectangle (edge 2/√3).
    const edge = 2 / Math.sqrt(3);
    expect(Math.max(...sides)).toBeCloseTo(edge * Math.SQRT2, 9);
    expect(Math.min(...sides)).toBeCloseTo(edge, 9);
    const tri = at(0, -0.6);
    expect(tri.kind === "poly" && tri.points.length).toBe(3);
    const hex = at(0, 0);
    expect(hex.kind === "poly" && hex.points.length).toBe(6);
  });

  it("the 4-ball's slices are spheres", () => {
    const s = shapeOf("ball", 4);
    const pts = turned(s, identity());
    const sl = slice4(s, pts, 0.6);
    expect(sl).toEqual({ kind: "ball", r: expect.closeTo(0.8, 12) });
    expect(slice4(s, pts, 1.01).kind).toBe("none");
    expect(slice4(s, pts, 1)).toEqual({ kind: "ball", r: 0 });
    expect(slice3(shapeOf("ball", 3), [], 0.6)).toEqual({
      kind: "circle",
      r: expect.closeTo(0.8, 12),
    });
    expect(slice2(shapeOf("ball", 2), [], 0.6)).toEqual({
      kind: "span",
      lo: expect.closeTo(-0.8, 12),
      hi: expect.closeTo(0.8, 12),
    });
  });

  it("a square across a line", () => {
    const s = shapeOf("cube", 2);
    const sl = slice2(s, turned(s, restRot(s)), 0.2);
    expect(sl.kind).toBe("span");
    if (sl.kind === "span") expect(sl.hi - sl.lo).toBeCloseTo(Math.SQRT2, 9);
  });

  it("every family slices anywhere along its travel without failing", () => {
    for (const fam of FAMILIES) {
      for (const k of [null, 0, 1, 2, 3]) {
        for (let c = -1.1; c <= 1.1; c += 0.05) expect(() => sliceOf(fam, k, c)).not.toThrow();
      }
    }
  });

  it("crossings drop the hidden axis", () => {
    const s = shapeOf("cube", 3);
    const c = crossings(s, turned(s, identity()), 1, 0);
    expect(c.length).toBe(4);
    for (const p of c) expect(p.length).toBe(2);
  });

  it("projects along w with the eye at EYE", () => {
    expect(depthScale(0)).toBe(1);
    expect(depthScale(1)).toBeCloseTo(EYE / (EYE - 1), 12);
    const out: Vec3 = [0, 0, 0];
    project([0.5, 0, 0, 0.5], out);
    expect(out[0]).toBeCloseTo(0.5 * depthScale(0.5), 12);
    // The tesseract's inner cube is 0.6 of its outer.
    expect(depthScale(-0.5) / depthScale(0.5)).toBeCloseTo(0.6, 12);
    // Nothing in the unit 4-ball projects past the shadow radius.
    const rng = createRng(5);
    for (let i = 0; i < 2000; i++) {
      const v = [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)];
      const n = Math.hypot(...v);
      const p = v.map((x) => x / n) as [number, number, number, number];
      project(p, out);
      expect(Math.hypot(...out)).toBeLessThanOrEqual(shadowRadius() + 1e-9);
    }
  });

  it("maps levers to cuts and back", () => {
    for (const dim of [2, 3, 4] as const) {
      for (const t of [-1, -0.3, 0, 0.7, 1]) expect(leverOf(dim, cutOf(dim, t))).toBeCloseTo(t, 12);
    }
    expect(cutOf(2, 1)).toBeLessThan(0);
    expect(cutOf(4, 1)).toBeGreaterThan(1);
  });
});

describe("orientations", () => {
  it("rests facet first, and the first buttons put that face first", () => {
    for (const fam of ["cube", "pyramid", "diamond"] as const) {
      for (const dim of [2, 3, 4] as const) {
        const s = shapeOf(fam, dim);
        const rest = restRot(s);
        expect(orthoError(rest)).toBeLessThan(1e-12);
        // A facet first: the lowest along the hidden axis is a whole facet (dim corners or more).
        const hidden = dim === 4 ? 3 : dim === 3 ? 1 : 0;
        const sign = dim === 2 ? -1 : 1;
        const hs = turned(s, rest).map((v) => sign * v[hidden]!);
        const lo = Math.min(...hs);
        expect(hs.filter((h) => Math.abs(h - lo) < 1e-9).length).toBeGreaterThanOrEqual(dim);
        // Corner first: one corner alone at the start.
        const corner = pathAt(presetPath(s, rest, 0), rest, 1);
        const hc = turned(s, corner).map((v) => sign * v[hidden]!);
        const lc = Math.min(...hc);
        expect(hc.filter((h) => Math.abs(h - lc) < 1e-9).length).toBe(1);
        // Pressing it again does nothing.
        expect(presetPath(s, corner, 0)).toBeNull();
      }
    }
  });

  it("eases a first button's turn and arrives exactly", () => {
    const s = shapeOf("cube", 4);
    const t = startTurning(s, restRot(s), 0, 1000);
    expect(t).not.toBeNull();
    const m = identity();
    expect(turningAt(t!, 1000, m)).toBe(false);
    expect(distance(m, restRot(s))).toBeLessThan(1e-12);
    expect(turningAt(t!, 1000 + t!.ms, m)).toBe(true);
    const corner = pathAt(presetPath(s, restRot(s), 0), restRot(s), 1);
    expect(distance(m, corner)).toBeLessThan(1e-9);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5, 12);
  });

  it("the slow turn is a function of the clock alone and stays a rotation for years", () => {
    const s = shapeOf("cube", 4);
    const t = 1.76e12;
    const a = slowTurn(s, t);
    const b = slowTurn(s, t);
    expect(distance(a, b)).toBe(0);
    expect(orthoError(slowTurn(s, t + 123_456_789))).toBeLessThan(1e-12);
    // It moves, slowly.
    const c = slowTurn(s, t + 100);
    expect(distance(a, c)).toBeGreaterThan(0);
    expect(distance(a, c)).toBeLessThan(0.05);
  });

  it("copies keep their own storage", () => {
    const a = identity();
    const b = copyMat(a);
    turnBy(b, 0, 1, 1);
    expect(distance(a, identity())).toBe(0);
  });
});
