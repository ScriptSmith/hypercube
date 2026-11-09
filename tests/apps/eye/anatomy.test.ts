import { describe, expect, it } from "vitest";
import { CORNEA_RADIUS, DISC_ARC, globe, lensProfile } from "../../../src/apps/eye/anatomy";
import { navarro } from "../../../src/apps/eye/optics";
import { createOrbit, ORBIT } from "../../../src/apps/eye/orbit";

describe("the model's anatomy", () => {
  it("puts the inner retina at the back exactly at the axial length", () => {
    for (const L of [21, 24.2, 27]) {
      const g = globe(L);
      const back = g.retina.inner[g.retina.inner.length - 1]!;
      expect(back[0]).toBeCloseTo(L, 6);
      expect(back[1]).toBeCloseTo(0, 6);
    }
  });

  it("is about 24 mm across and meets the cornea at the limbus", () => {
    const g = globe(24.2);
    expect(Math.max(...g.sclera.outer.map((p) => p[1])) * 2).toBeCloseTo(24, 0);
    expect(g.limbus[1]).toBeCloseTo(CORNEA_RADIUS, 6);
    // The ora serrata is about 5 mm in front of the equator.
    expect(g.equator[0] - g.ora[0]).toBeGreaterThan(4.5);
    expect(g.equator[0] - g.ora[0]).toBeLessThan(5.6);
  });

  it("thins the back wall in a long eye (Vurgese et al. 2012)", () => {
    const wall = (L: number) => {
      const g = globe(L);
      const o = g.sclera.outer[g.sclera.outer.length - 1]![0];
      const i = g.sclera.inner[g.sclera.inner.length - 1]![0];
      return o - i;
    };
    expect(wall(24.2)).toBeCloseTo(0.9, 1);
    expect(wall(27)).toBeLessThan(wall(24.2));
  });

  it("puts the disc on the nose side about 4.3 mm from the fovea", () => {
    const g = globe(24.2);
    const [x, r] = g.disc.at;
    const back = g.retina.inner[g.retina.inner.length - 1]!;
    expect(Math.hypot(x - back[0], r - back[1])).toBeGreaterThan(DISC_ARC * 0.9);
    expect(Math.hypot(x - back[0], r - back[1])).toBeLessThan(DISC_ARC * 1.05);
  });

  it("makes the lens about 4 mm thick and 9 to 10 mm across, rounder when it focuses", () => {
    const relaxed = lensProfile(navarro(0), 3.6);
    expect(relaxed.backX - relaxed.frontX).toBeCloseTo(4, 6);
    expect(relaxed.equator[1] * 2).toBeGreaterThan(8.5);
    expect(relaxed.equator[1] * 2).toBeLessThan(10.5);
    const near = lensProfile(navarro(6), 3.6);
    expect(near.backX - near.frontX).toBeGreaterThan(4);
    expect(near.equator[1]).toBeLessThan(relaxed.equator[1]);
  });
});

describe("turning the eye", () => {
  it("turns within its limits on a drag and calls a short touch a tap", () => {
    const o = createOrbit();
    o.begin(1, 100, 100, 0);
    expect(o.end(1, 100)).toBe(true);
    o.begin(2, 100, 100, 0);
    o.move(2, 5000, -5000, 50);
    expect(o.end(2, 100)).toBe(false);
    expect(o.azimuth).toBe(ORBIT.minAzimuth);
    expect(o.elevation).toBe(ORBIT.minElevation);
    // It eases home a while after the last turn.
    for (let t = 0; t < 40; t++) o.step(1, 30_000 + t * 1000);
    expect(o.azimuth).toBeCloseTo(ORBIT.azimuth, 1);
  });
});
