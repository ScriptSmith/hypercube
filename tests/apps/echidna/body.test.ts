import { describe, expect, it } from "vitest";
import {
  angle,
  BACK_LENGTH,
  CROWN,
  flow,
  HEAD,
  LIFT_MAX,
  LIFT_MIN,
  makeSpines,
  normalize,
  openingValue,
  progress,
  SPACING,
  TAIL,
  TAIL_REACH,
  TAIL_TUCK,
  WHORL_BARE,
  WHORL_REACH,
  WHORLS,
} from "../../../src/apps/echidna/body";
import { BODY_SEED } from "../../../src/apps/echidna/build";
import { spineHit, taper } from "../../../src/apps/echidna/lookup";
import type { Vec3 } from "../../../src/core/sphere";
import { createRng } from "../../../src/core/rng";

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Evenly spread random directions. */
const points = (n: number, seed = "pts"): Vec3[] => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => {
    const y = rng.range(-1, 1);
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - y * y);
    return [r * Math.cos(a), y, r * Math.sin(a)] as Vec3;
  });
};

/** On the spiny coat, clear of the opening, the crown, the whorls' centres and the tail's own sweep. */
const onCoat = (p: Vec3) =>
  openingValue(p) > 1.4 &&
  angle(p, HEAD) > CROWN + 0.15 &&
  angle(p, TAIL) > 0.2 &&
  WHORLS.every((w) => angle(p, w) > 0.12);

const nearestWhorl = (p: Vec3) => WHORLS.reduce((a, b) => (angle(p, a) <= angle(p, b) ? a : b));

const tangentAt = (p: Vec3): Vec3 => {
  const t = normalize([p[1], -p[0], 0.3]);
  const k = dot(t, p);
  return normalize([t[0] - p[0] * k, t[1] - p[1] * k, t[2] - p[2] * k]);
};

describe("flow", () => {
  it("is a unit tangent everywhere on the coat", () => {
    for (const p of points(4000).filter(onCoat)) {
      const f = flow(p)!;
      expect(Math.hypot(...f)).toBeCloseTo(1, 6);
      expect(Math.abs(dot(f, p))).toBeLessThan(1e-6);
    }
  });

  it("flares out of the whorls on the crown, then runs towards the tail and under it", () => {
    let nearHead = 0;
    let inward = 0;
    for (const p of points(20000).filter(onCoat)) {
      const f = flow(p)!;
      const e = 1e-4;
      const ahead = normalize([p[0] + f[0] * e, p[1] + f[1] * e, p[2] + f[2] * e]);
      const dh = angle(p, HEAD);
      const dt = angle(p, TAIL);
      const w = nearestWhorl(p);
      const away = angle(ahead, w) > angle(p, w);
      if (dh < WHORL_REACH[0]) {
        // On the crown they lie away from the nearer whorl (bar the odd one between them).
        nearHead++;
        if (!away) inward++;
        continue;
      }
      const k = dot(TAIL_TUCK, p);
      const tuck = normalize([
        TAIL_TUCK[0] - p[0] * k,
        TAIL_TUCK[1] - p[1] * k,
        TAIL_TUCK[2] - p[2] * k,
      ]);
      const onwards = progress(ahead) > progress(p);
      const under = dot(f, tuck) > 0;
      // Near the tail they lie down and under the body, as the tail tucks in; far from both
      // ends they lie away from the head; between, one or the other.
      if (dt < 0.4) expect(under).toBe(true);
      else if (dt > TAIL_REACH && dh > WHORL_REACH[1]) expect(onwards).toBe(true);
      else expect(onwards || under || away).toBe(true);
    }
    expect(nearHead).toBeGreaterThan(50);
    expect(inward / nearHead).toBeLessThan(0.02);
  });

  it("turns smoothly: nearby points lie almost the same way", () => {
    let worst = 0;
    for (const p of points(4000).filter(onCoat)) {
      const t = tangentAt(p);
      const q = normalize([p[0] + t[0] * 0.01, p[1] + t[1] * 0.01, p[2] + t[2] * 0.01]);
      worst = Math.max(worst, angle(flow(p)!, flow(q)!));
    }
    expect(worst).toBeLessThan(0.12);
  });
});

describe("spines", () => {
  const spines = makeSpines(createRng(BODY_SEED));

  it("are the same on every run", () => {
    const again = makeSpines(createRng(BODY_SEED));
    expect(again.length).toBe(spines.length);
    expect(again[123]).toEqual(spines[123]);
  });

  it("number several thousand, none in the opening, on the crown or at a whorl's centre", () => {
    expect(spines.length).toBeGreaterThan(5500);
    expect(spines.length).toBeLessThan(8000);
    for (const s of spines) {
      expect(openingValue(s.b)).toBeGreaterThanOrEqual(1);
      expect(angle(s.b, HEAD)).toBeGreaterThanOrEqual(CROWN);
      for (const w of WHORLS) expect(angle(s.b, w)).toBeGreaterThanOrEqual(WHORL_BARE);
      expect(s.lift).toBeGreaterThanOrEqual(LIFT_MIN);
      expect(s.lift).toBeLessThanOrEqual(LIFT_MAX);
      expect(Math.abs(dot(s.f, s.b))).toBeLessThan(1e-9);
      expect(s.len).toBeGreaterThan(0.25 * BACK_LENGTH);
      expect(s.len).toBeLessThan(1.1 * BACK_LENGTH);
      expect(s.width).toBeLessThan(s.len / 4);
    }
  });

  it("don't clump: no two bases closer than a third of the spacing", () => {
    let closest = Infinity;
    for (let i = 0; i < spines.length; i++) {
      for (let j = i + 1; j < spines.length; j++) {
        const a = spines[i]!.b;
        const b = spines[j]!.b;
        closest = Math.min(closest, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      }
    }
    expect(closest).toBeGreaterThan(SPACING / 3);
  });

  it("leave no bald patches: most of the coat covered as they rest, and small gaps where it isn't", () => {
    const coat = points(6000, "coat").filter(onCoat);
    let covered = 0;
    let deep = 0;
    for (const p of coat) {
      let depth = 0;
      let gap = Infinity;
      for (const s of spines) {
        const hit = spineHit(s, p, s.lift);
        if (hit.covered) depth++;
        else if (hit.t > -1) {
          const along = Math.max(-hit.a, hit.a - s.len, 0);
          const across = Math.max(
            Math.abs(hit.x) - (s.width / 2) * taper(Math.min(1, Math.max(0, hit.t))),
            0,
          );
          gap = Math.min(gap, Math.hypot(along, across));
        }
      }
      if (depth > 0) covered++;
      else expect(gap).toBeLessThan(0.035);
      if (depth > 6) deep++;
    }
    // Fur shows between the tufts, but only a little, and tufts gather a few spines, not heaps.
    expect(covered / coat.length).toBeGreaterThan(0.88);
    expect(deep / coat.length).toBeLessThan(0.03);
  });

  it("grow from everywhere on the back and sides", () => {
    const away = points(4000, "away").filter(
      (p) => onCoat(p) && angle(p, HEAD) > 0.5 && angle(p, TAIL) > 0.5,
    );
    for (const p of away) {
      let near = Infinity;
      for (const s of spines) near = Math.min(near, angle(p, s.b));
      expect(near).toBeLessThan(SPACING * 1.1);
    }
  });
});
