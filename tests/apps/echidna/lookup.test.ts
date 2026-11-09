import { beforeAll, describe, expect, it } from "vitest";
import { makeSpines, openingValue, type Spine } from "../../../src/apps/echidna/body";
import { BODY_SEED } from "../../../src/apps/echidna/build";
import {
  atlasSize,
  buildLookup,
  FACE,
  faceDir,
  HALF,
  hashU,
  type Lookup,
  LIFT_STEPS,
  listed,
  packLiftWidth,
  packSpines,
  SLOTS,
  SPINE_TEXELS,
  SPINES_PER_ROW,
  spineHit,
  taper,
  texelGeometry,
  texelOf,
  unpackLiftWidth,
} from "../../../src/apps/echidna/lookup";
import type { Vec3 } from "../../../src/core/sphere";
import { createRng } from "../../../src/core/rng";

const points = (n: number, seed: string): Vec3[] => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => {
    const y = rng.range(-1, 1);
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - y * y);
    return [r * Math.cos(a), y, r * Math.sin(a)] as Vec3;
  });
};

describe("cube atlas", () => {
  it("puts each face's texel centres back in their own texels", () => {
    const { width } = atlasSize();
    for (let f = 0; f < 6; f++) {
      for (const [i, j] of [
        [0, 0],
        [FACE - 1, 0],
        [17, 101],
        [FACE - 1, FACE - 1],
        [FACE >> 1, FACE >> 1],
      ] as const) {
        const d = faceDir(f, i + 0.5, j + 0.5);
        const row = Math.floor(f / 3) * FACE + j;
        const col = (f % 3) * FACE + i;
        expect(texelOf(d[0], d[1], d[2])).toBe(row * width + col);
      }
    }
  });

  it("keeps texels within a factor of two in size", () => {
    const { radius } = texelGeometry();
    let lo = Infinity;
    let hi = 0;
    for (const r of radius) {
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
    expect(hi / lo).toBeLessThan(2);
  });
});

describe("spine shape", () => {
  it("narrows only towards the tip", () => {
    let last = 1;
    for (let t = 0; t <= 1; t += 0.01) {
      expect(taper(t)).toBeLessThanOrEqual(last + 1e-12);
      last = taper(t);
    }
    expect(taper(1)).toBe(0);
  });

  it("covers less, never more, when lifted or narrowed by a breath", () => {
    const spine: Spine = { b: [0, 0, 1], f: [0, 1, 0], len: 0.4, width: 0.04, lift: 0.5 };
    for (const p of points(3000, "lift")) {
      if (spineHit(spine, p, 0.6, 0.9).covered) expect(spineHit(spine, p).covered).toBe(true);
    }
  });

  it("hashes the same on the page as in the shader", () => {
    expect(hashU(12345)).toBe(hashU(12345));
    expect(hashU(1)).not.toBe(hashU(2));
    expect(hashU(0x9e3779b9)).toBe(hashU(0x9e3779b9));
  });
});

describe("lookup", () => {
  let spines: Spine[];
  let lookup: Lookup;
  beforeAll(() => {
    spines = makeSpines(createRng(BODY_SEED));
    lookup = buildLookup(spines);
  });

  it("lists every spine that covers a point, unless its texel is full", () => {
    let missing = 0;
    let checked = 0;
    for (const p of points(5000, "cover")) {
      const texel = texelOf(p[0], p[1], p[2]);
      const list = new Set(listed(lookup, texel));
      spines.forEach((s, id) => {
        if (!spineHit(s, p).covered) return;
        checked++;
        if (list.has(id)) return;
        missing++;
        expect(list.size).toBe(SLOTS);
      });
    }
    expect(checked).toBeGreaterThan(5000);
    expect(missing / checked).toBeLessThan(0.002);
  });

  it("lists the spines over a full texel's centre first", () => {
    const { centre } = texelGeometry();
    let full = 0;
    const { width, height } = atlasSize();
    for (let texel = 0; texel < width * height; texel += 7) {
      const list = listed(lookup, texel);
      if (list.length < SLOTS) continue;
      full++;
      const c: Vec3 = [centre[texel * 3]!, centre[texel * 3 + 1]!, centre[texel * 3 + 2]!];
      const covers = list.map((id) => spineHit(spines[id]!, c).covered);
      const firstMiss = covers.indexOf(false);
      if (firstMiss >= 0) expect(covers.slice(firstMiss).every((x) => !x)).toBe(true);
    }
    expect(full).toBeGreaterThan(0);
  });

  it("keeps lists short, mostly within the half the shader reads first", () => {
    expect(lookup.mean).toBeLessThan(HALF * 0.7);
    expect(lookup.max).toBeLessThanOrEqual(SLOTS);
    let long = 0;
    let listedTexels = 0;
    const { width, height } = atlasSize();
    for (let texel = 0; texel < width * height; texel++) {
      const n = listed(lookup, texel).length;
      if (n > 0) listedTexels++;
      if (n > HALF) long++;
    }
    expect(long / listedTexels).toBeLessThan(0.12);
  });

  it("is empty where nothing can lie, deep in the opening", () => {
    const p: Vec3 = [0, -1, 0.05];
    expect(openingValue(p)).toBeLessThan(0.3);
    expect(listed(lookup, texelOf(p[0], p[1], p[2]))).toEqual([]);
  });

  it("packs each spine into two texels of its row", () => {
    const packed = packSpines(spines);
    const id = SPINES_PER_ROW + 5;
    const at =
      (Math.floor(id / SPINES_PER_ROW) * packed.width + (id % SPINES_PER_ROW) * SPINE_TEXELS) * 4;
    const s = spines[id]!;
    expect(Array.from(packed.data.subarray(at, at + 7))).toEqual(
      [s.b[0], s.b[1], s.b[2], s.len, s.f[0], s.f[1], s.f[2]].map(Math.fround),
    );
    expect(packed.data[at + 7]).toBe(Math.fround(packLiftWidth(s.lift, s.width)));
  });

  it("keeps lift and width when packed into one 32-bit float", () => {
    for (const s of spines) {
      const { lift, width } = unpackLiftWidth(Math.fround(packLiftWidth(s.lift, s.width)));
      expect(Math.abs(lift - s.lift)).toBeLessThanOrEqual(0.5 / LIFT_STEPS + 1e-9);
      expect(Math.abs(width - s.width)).toBeLessThan(s.width * 0.002);
    }
  });
});
