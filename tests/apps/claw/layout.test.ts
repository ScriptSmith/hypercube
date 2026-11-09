import { describe, expect, it } from "vitest";
import {
  cabinetBox,
  latAt,
  layoutArcade,
  PART,
  PLAY_HEIGHT,
  stripBand,
} from "../../../src/apps/claw/layout";
import { createStrip, DEG, sphereInfo } from "../../../src/core/sphere";

const deg = (r: number) => r / DEG;

describe("claw layout", () => {
  it("puts the strip from 25° up to 50° down on the default ball", () => {
    const s = sphereInfo();
    const band = stripBand(s);
    expect(deg(band.top)).toBeCloseTo(25, 6);
    expect(deg(band.bottom)).toBeCloseTo(-50, 6);
    const l = layoutArcade(s, 4);
    // The glass sits a little below the equator, where most people see it best.
    expect(deg(l.glassLat)).toBeGreaterThan(-15);
    expect(deg(l.glassLat)).toBeLessThan(5);
    // A cabinet's glass is about 2 m across on the ball and its prizes about half a metre.
    expect(l.play.width * l.metresPerU).toBeGreaterThan(1.6);
    expect(l.play.width * l.metresPerU).toBeLessThan(2.6);
    expect(0.7 * l.metresPerU).toBeGreaterThan(0.35);
  });

  it("fits every cabinet in its slot and the strip in the band people see, on any ball", () => {
    const views: ({ top: number; bottom: number } | undefined)[] = [
      undefined,
      { top: 30, bottom: -30 },
      { top: 15, bottom: -15 },
      { top: -10, bottom: -80 },
      { top: 60, bottom: 0 },
    ];
    for (const diameter of [1, 2, 3, 5, 8, 12, 20]) {
      for (const bottom of [0.3, 1, 2.5, 4, 8]) {
        for (const view of views) {
          const s = sphereInfo(undefined, { diameter, bottom, view });
          for (const count of [3, 4]) {
            const where = `d=${diameter} b=${bottom} view=${JSON.stringify(view)} n=${count}`;
            const l = layoutArcade(s, count);
            expect(l.top, where).toBeGreaterThan(l.bottom);
            expect(l.top, where).toBeLessThanOrEqual(s.cover.top + 1e-9);
            expect(l.bottom, where).toBeGreaterThanOrEqual(s.cover.bottom - 1e-9);
            if (s.view.top - s.view.bottom > 34 * DEG) {
              expect(l.top, where).toBeLessThanOrEqual(s.view.top + 1e-9);
              expect(l.bottom, where).toBeGreaterThanOrEqual(s.view.bottom - 1e-9);
            }
            expect(l.cabinets, where).toHaveLength(count);
            expect(l.play.width, where).toBeGreaterThanOrEqual(2.6 - 1e-9);
            expect(l.play.width, where).toBeLessThanOrEqual(5 + 1e-9);
            expect(l.play.height, where).toBe(PLAY_HEIGHT);
            // Cabinets, signs and ledges included, leave room between them.
            const wide = l.bodyW + 2 * PART.marquee.overhang * l.cabinetH;
            expect(wide, where).toBeLessThan(0.92 / count);
            expect(l.cabinetH, where).toBeLessThanOrEqual(l.aspect + 1e-9);
            expect(l.metresPerU, where).toBeGreaterThan(0);
            const centres = l.cabinets.map((c) => c.centre).sort((a, b) => a - b);
            for (let i = 1; i < centres.length; i++) {
              expect(centres[i]! - centres[i - 1]!, where).toBeCloseTo(1 / count, 9);
            }
          }
        }
      }
    }
  });

  it("faces the first cabinet at longitude 0, alternates chutes and keeps 3 wider than 4", () => {
    const s = sphereInfo();
    const four = layoutArcade(s, 4);
    const three = layoutArcade(s, 3);
    expect(four.cabinets[0]!.lon).toBeCloseTo(0, 9);
    expect(three.cabinets[0]!.lon).toBeCloseTo(0, 9);
    expect(four.cabinets.map((c) => c.chute)).toEqual([1, -1, 1, -1]);
    expect(three.play.width).toBeGreaterThan(four.play.width);
  });

  it("scales the cabinet with the strip's width without changing its play area", () => {
    const s = sphereInfo();
    const l = layoutArcade(s, 4);
    for (const width of [640, 1280, 4096]) {
      const box = cabinetBox(l, width);
      const strip = createStrip(s, width, l.top, l.bottom);
      expect(box.height).toBeLessThanOrEqual(strip.height + 1e-6);
      expect(box.glass.w).toBeCloseTo(l.play.width * box.k, 6);
      expect(box.glass.h).toBeCloseTo(PLAY_HEIGHT * box.k, 6);
      expect(box.floorY).toBeCloseTo(box.glass.y + box.glass.h, 6);
      expect(box.bodyW).toBeCloseTo(l.bodyW * width, 6);
    }
  });

  it("finds latitudes down the strip as the Mercator projection does", () => {
    const top = 25 * DEG;
    const bottom = -50 * DEG;
    expect(latAt(top, bottom, 0)).toBeCloseTo(top, 9);
    expect(latAt(top, bottom, 1)).toBeCloseTo(bottom, 9);
    const strip = createStrip(sphereInfo(), 1000, top, bottom);
    for (const f of [0.1, 0.4, 0.75]) {
      expect(strip.y(latAt(top, bottom, f)) / strip.height).toBeCloseTo(f, 6);
    }
  });
});
