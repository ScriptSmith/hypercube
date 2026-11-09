import { describe, expect, it } from "vitest";
import {
  brightness,
  CRYSTAL_IDS,
  CRYSTALS,
  cellAtoms,
  dSpacing,
  electrons,
  parseOp,
  powderRings,
  type Ring,
  structureFactor,
  twoTheta,
} from "../../../src/apps/xrd/crystals";

const CU = 1.5406;
const NBS = 1.5405;

/** Published lines: d (Å) and relative height, strongest first where it matters. */
const PUBLISHED: Record<string, { hkl: string; d: number; I: number }[]> = {
  // NBS Circular 539 vol. I p. 11 (Swanson and Tatge 1953).
  aluminium: [
    { hkl: "111", d: 2.338, I: 100 },
    { hkl: "200", d: 2.024, I: 47 },
    { hkl: "220", d: 1.431, I: 22 },
    { hkl: "311", d: 1.221, I: 24 },
    { hkl: "222", d: 1.169, I: 7 },
    { hkl: "400", d: 1.0124, I: 2 },
  ],
  // NBS Circular 539 vol. II p. 41 (Swanson and Fuyat 1953).
  salt: [
    { hkl: "111", d: 3.258, I: 13 },
    { hkl: "200", d: 2.821, I: 100 },
    { hkl: "220", d: 1.994, I: 55 },
    { hkl: "311", d: 1.701, I: 2 },
    { hkl: "222", d: 1.628, I: 15 },
    { hkl: "400", d: 1.41, I: 6 },
  ],
  // NBS Circular 539 vol. I p. 65.
  kcl: [
    { hkl: "200", d: 3.146, I: 100 },
    { hkl: "220", d: 2.224, I: 59 },
    { hkl: "222", d: 1.816, I: 23 },
    { hkl: "400", d: 1.573, I: 8 },
    { hkl: "420", d: 1.407, I: 20 },
  ],
  // NBS Monograph 25 section 13 p. 35.
  silicon: [
    { hkl: "111", d: 3.13552, I: 100 },
    { hkl: "220", d: 1.92011, I: 55 },
    { hkl: "311", d: 1.63747, I: 30 },
    { hkl: "400", d: 1.35772, I: 6 },
    { hkl: "331", d: 1.24593, I: 11 },
  ],
  // NBS Circular 539 vol. II p. 5.
  diamond: [
    { hkl: "111", d: 2.06, I: 100 },
    { hkl: "220", d: 1.261, I: 27 },
    { hkl: "311", d: 1.0754, I: 16 },
  ],
  // NBS Circular 539 vol. 9 p. 3 (1960 revision).
  corundum: [
    { hkl: "012", d: 3.479, I: 74 },
    { hkl: "104", d: 2.552, I: 92 },
    { hkl: "110", d: 2.379, I: 42 },
    { hkl: "113", d: 2.085, I: 100 },
    { hkl: "024", d: 1.74, I: 43 },
    { hkl: "116", d: 1.601, I: 81 },
  ],
  // NBS Circular 539 vol. IV p. 68.
  zircon: [
    { hkl: "101", d: 4.434, I: 45 },
    { hkl: "200", d: 3.302, I: 100 },
    { hkl: "112", d: 2.518, I: 45 },
    { hkl: "312", d: 1.712, I: 40 },
  ],
  // NBS Monograph 25 section 18 p. 61.
  quartz: [
    { hkl: "100", d: 4.257, I: 22 },
    { hkl: "101", d: 3.342, I: 100 },
    { hkl: "112", d: 1.8179, I: 14 },
  ],
};

const near = (rings: Ring[], d: number) =>
  rings.reduce((best, r) => (Math.abs(r.d - d) < Math.abs(best.d - d) ? r : best));

describe("crystal data", () => {
  it("fills each cell with the right atoms", () => {
    for (const id of CRYSTAL_IDS) {
      const c = CRYSTALS[id];
      const counts: Record<string, number> = {};
      for (const a of cellAtoms(c)) counts[a.sp] = (counts[a.sp] ?? 0) + 1;
      expect(counts, id).toEqual(c.expect);
    }
  });

  it("reads symmetry operations", () => {
    expect(parseOp("-y,x-y,z+1/3")).toEqual({
      m: [0, -1, 0, 1, -1, 0, 0, 0, 1],
      t: [0, 0, 1 / 3],
    });
  });

  it("knows each atom's electrons, ions included", () => {
    expect(electrons("Al")).toBeCloseTo(13, 1);
    expect(electrons("K+")).toBeCloseTo(18, 1);
    expect(electrons("Cl-")).toBeCloseTo(18, 1);
    expect(electrons("H")).toBeCloseTo(1, 2);
  });
});

describe("the physics", () => {
  it("gives aluminium's and salt's Bragg angles under copper", () => {
    const al = CRYSTALS.aluminium.cell;
    expect(twoTheta(dSpacing(al, 1, 1, 1), CU)).toBeCloseTo(38.47, 1);
    const salt = CRYSTALS.salt.cell;
    expect(twoTheta(dSpacing(salt, 2, 0, 0), CU)).toBeCloseTo(31.7, 1);
    expect(twoTheta(0.5, CU)).toBeNull();
  });

  it("gives aluminium's spacings", () => {
    const al = { ...CRYSTALS.aluminium.cell, a: 4.05, b: 4.05, c: 4.05 };
    const ds = [
      [1, 1, 1],
      [2, 0, 0],
      [2, 2, 0],
      [3, 1, 1],
      [2, 2, 2],
      [4, 0, 0],
    ].map(([h, k, l]) => dSpacing(al, h!, k!, l!));
    const card = [2.338, 2.025, 1.432, 1.221, 1.169, 1.013];
    ds.forEach((d, i) => expect(Math.abs(d - card[i]!)).toBeLessThan(0.0006));
  });

  it("names aluminium's rings by the ratio 3 : 4 : 8 : 11 : 12 : 16", () => {
    const rings = powderRings(CRYSTALS.aluminium, CU).slice(0, 6);
    const s2 = rings.map((r) => r.S * r.S);
    const ratio = s2.map((v) => Math.round((3 * v) / s2[0]!));
    expect(ratio).toEqual([3, 4, 8, 11, 12, 16]);
    expect(rings.map((r) => r.hkl.join(""))).toEqual(["111", "200", "220", "311", "222", "400"]);
    expect(rings[0]!.multiplicity).toBe(8);
    expect(rings[1]!.multiplicity).toBe(6);
  });

  it("removes the face-centred and diamond absences", () => {
    const al = CRYSTALS.aluminium;
    const top = brightness(al, 1, 1, 1);
    expect(brightness(al, 1, 0, 0)).toBeLessThan(top * 1e-9);
    expect(brightness(al, 1, 1, 0)).toBeLessThan(top * 1e-9);
    expect(brightness(al, 2, 1, 0)).toBeLessThan(top * 1e-9);
    const c = CRYSTALS.diamond;
    expect(brightness(c, 2, 0, 0)).toBeLessThan(brightness(c, 1, 1, 1) * 1e-9);
    expect(brightness(c, 2, 2, 2)).toBeLessThan(brightness(c, 1, 1, 1) * 1e-9);
    expect(brightness(c, 4, 0, 0)).toBeGreaterThan(brightness(c, 1, 1, 1) * 0.1);
  });

  it("nearly loses potassium chloride's odd spots, both ions having 18 electrons", () => {
    const kcl = CRYSTALS.kcl;
    const salt = CRYSTALS.salt;
    const oddK = brightness(kcl, 1, 1, 1) / brightness(kcl, 2, 0, 0);
    const oddNa = brightness(salt, 1, 1, 1) / brightness(salt, 2, 0, 0);
    expect(oddK).toBeLessThan(0.005);
    expect(oddNa).toBeGreaterThan(oddK * 10);
    const F = structureFactor(kcl, 3, 1, 1);
    expect((F.re ** 2 + F.im ** 2) / brightness(kcl, 2, 0, 0)).toBeLessThan(0.005);
  });

  it("puts every crystal's published lines where the source measured them", () => {
    for (const [id, lines] of Object.entries(PUBLISHED)) {
      const rings = powderRings(CRYSTALS[id as keyof typeof CRYSTALS], NBS);
      for (const l of lines) {
        const r = near(rings, l.d);
        expect(Math.abs(r.d - l.d), `${id} ${l.hkl}`).toBeLessThan(0.003);
      }
      // The strongest computed line is one of the source's three strongest.
      const top3 = [...lines].sort((a, b) => b.I - a.I).slice(0, 3);
      const strongest = rings.reduce((a, b) => (b.height > a.height ? b : a));
      expect(
        top3.some((l) => Math.abs(l.d - strongest.d) < 0.006),
        `${id}: strongest at ${strongest.d.toFixed(3)}`,
      ).toBe(true);
    }
  });

  it("matches the measured heights within 15 points on every line above 10", () => {
    for (const id of ["aluminium", "salt", "kcl", "silicon", "zircon", "quartz"] as const) {
      const rings = powderRings(CRYSTALS[id], NBS);
      for (const l of PUBLISHED[id]!) {
        if (l.I <= 10) continue;
        const r = near(rings, l.d);
        expect(
          Math.abs(r.height - l.I),
          `${id} ${l.hkl}: ${r.height.toFixed(1)} against ${l.I}`,
        ).toBeLessThanOrEqual(15);
      }
    }
  });

  it("keeps recent ring sets, and gives each caller its own array", () => {
    const a = powderRings(CRYSTALS.aluminium, CU, { maxTwoTheta: 170 });
    const b = powderRings(CRYSTALS.aluminium, CU, { maxTwoTheta: 170 });
    expect(b).not.toBe(a);
    expect(b[0]).toBe(a[0]);
    a.reverse();
    expect(powderRings(CRYSTALS.aluminium, CU, { maxTwoTheta: 170 })[0]).toBe(b[0]);
    // Many wavelengths, as from the spectrum's slider: the oldest sets go, and answers stay right.
    for (let i = 0; i < 40; i++) powderRings(CRYSTALS.salt, 1 + i / 100);
    expect(powderRings(CRYSTALS.aluminium, CU, { maxTwoTheta: 170 })).toEqual(b);
  });

  it("puts aluminium's three strongest rings in the measured order", () => {
    const rings = powderRings(CRYSTALS.aluminium, NBS);
    const top = [...rings]
      .sort((a, b) => b.height - a.height)
      .slice(0, 3)
      .map((r) => r.hkl.join(""));
    expect(top).toEqual(["111", "200", "311"]);
  });

  it("orders aluminium's and salt's heights as measured", () => {
    for (const id of ["aluminium", "salt", "kcl", "silicon"] as const) {
      const rings = powderRings(CRYSTALS[id], NBS);
      const lines = PUBLISHED[id]!;
      const computed = lines.map((l) => near(rings, l.d).height);
      // Each pair the source ranks clearly (by more than 2 to 1) comes out the same way round.
      for (let i = 0; i < lines.length; i++) {
        for (let j = 0; j < lines.length; j++) {
          if (lines[i]!.I > lines[j]!.I * 2) {
            expect(computed[i]!, `${id} ${lines[i]!.hkl} over ${lines[j]!.hkl}`).toBeGreaterThan(
              computed[j]!,
            );
          }
        }
      }
    }
  });
});
