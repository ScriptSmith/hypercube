import { describe, expect, it } from "vitest";
import { parseParams } from "../src/core/params";
import {
  apply3,
  createStrip,
  DEG,
  direction,
  latLonOf,
  multiply3,
  orthonormalize3,
  rotationAbout,
  sphereInfo,
  sphereMap,
  surfacePoint,
  viewBand,
  wrapLon,
  wrapOffsets,
} from "../src/core/sphere";
import { DEFAULT_VENUE, displayFor } from "../src/core/venue";

const close3 = (a: readonly number[], b: readonly number[], digits = 9) => {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i] ?? NaN, digits);
};

describe("sphere geometry", () => {
  it("turns latitude and longitude into directions and back", () => {
    close3(direction(0, 0), [0, 0, 1]);
    close3(direction(0, Math.PI / 2), [1, 0, 0]);
    close3(direction(Math.PI / 2, 1.3), [0, 1, 0]);
    for (const [lat, lon] of [
      [0.3, -2.9],
      [-1.2, 0.4],
      [0, 3],
    ] as const) {
      const back = latLonOf(direction(lat, lon));
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
    }
  });

  it("puts the surface round a centre hung at the venue's height", () => {
    const s = sphereInfo();
    expect(s.radius).toBe(DEFAULT_VENUE.sphere.diameterM / 2);
    expect(s.centreY).toBe(DEFAULT_VENUE.sphere.bottomM + s.radius);
    close3(surfacePoint(s, -Math.PI / 2, 0), [0, DEFAULT_VENUE.sphere.bottomM, 0]);
  });

  it("wraps longitude into one turn", () => {
    expect(wrapLon(Math.PI)).toBeCloseTo(-Math.PI);
    expect(wrapLon(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1);
    expect(wrapLon(7 * Math.PI + 0.2)).toBeCloseTo(-Math.PI + 0.2);
  });

  it("maps a whole-sphere feed linearly", () => {
    const s = sphereInfo();
    const m = sphereMap(s, 4000, 2000);
    expect(m.x(-Math.PI)).toBeCloseTo(0);
    expect(m.x(0)).toBeCloseTo(2000);
    expect(m.y(Math.PI / 2)).toBeCloseTo(0);
    expect(m.y(0)).toBeCloseTo(1000);
    expect(m.y(-Math.PI / 2)).toBeCloseTo(2000);
    expect(m.lat(m.y(0.7))).toBeCloseTo(0.7);
    expect(m.lon(m.x(-2.1))).toBeCloseTo(-2.1);
    expect(m.stretch(0)).toBeCloseTo(1);
    expect(m.stretch(60 * DEG)).toBeCloseTo(2);
    expect(m.stretch(Math.PI / 2)).toBe(64);
  });

  it("maps a partial sphere's rows to its covered latitudes", () => {
    const s = sphereInfo(undefined, { cover: { top: 60, bottom: -30 } });
    const m = sphereMap(s, 3600, 900);
    expect(m.y(60 * DEG)).toBeCloseTo(0);
    expect(m.y(-30 * DEG)).toBeCloseTo(900);
    expect(m.pxPerLat).toBeCloseTo(900 / (90 * DEG));
    expect(s.view.top).toBeLessThanOrEqual(60 * DEG + 1e-9);
    expect(s.view.bottom).toBeGreaterThanOrEqual(-30 * DEG - 1e-9);
  });

  it("finds a visible band for a ball hung over people's heads", () => {
    const s = sphereInfo();
    // People underneath see the bottom pole; nobody sees the top well.
    expect(s.view.bottom).toBeCloseTo(-Math.PI / 2, 2);
    expect(s.view.top).toBeGreaterThan(20 * DEG);
    expect(s.view.top).toBeLessThan(60 * DEG);
    // Standing farther back shows more of the top.
    const near = viewBand(
      2,
      5,
      { top: Math.PI / 2, bottom: -Math.PI / 2 },
      {
        eyes: [1.6],
        far: 5,
        grazing: 25 * DEG,
      },
    );
    const far = viewBand(
      2,
      5,
      { top: Math.PI / 2, bottom: -Math.PI / 2 },
      {
        eyes: [1.6],
        far: 30,
        grazing: 25 * DEG,
      },
    );
    expect(far.top).toBeGreaterThan(near.top);
  });

  it("takes the view band from the URL when given", () => {
    const s = sphereInfo(undefined, { view: { top: -10, bottom: 30 } });
    expect(s.view.top).toBeCloseTo(30 * DEG);
    expect(s.view.bottom).toBeCloseTo(-10 * DEG);
  });

  it("draws something near the seam on both edges", () => {
    expect(wrapOffsets(-20, 30, 1000)).toEqual([0, 1000]);
    expect(wrapOffsets(980, 1010, 1000)).toEqual([-1000, 0]);
    expect(wrapOffsets(100, 200, 1000)).toEqual([0]);
  });
});

describe("Mercator strip", () => {
  const s = sphereInfo();

  it("keeps small shapes round", () => {
    const strip = createStrip(s, 4096, 50 * DEG, -50 * DEG);
    for (const lat of [-40 * DEG, 0, 30 * DEG]) {
      // A step of one pixel across and one down covers the same distance on the ball.
      const across = (1 / strip.perMetre) * Math.cos(lat);
      const y = strip.y(lat);
      const down = s.radius * Math.abs(strip.lat(y + 1) - strip.lat(y));
      expect(down / across).toBeCloseTo(1, 2);
    }
  });

  it("round-trips latitude and longitude", () => {
    const strip = createStrip(s, 2000, 40 * DEG, -60 * DEG);
    expect(strip.y(40 * DEG)).toBeCloseTo(0);
    expect(strip.y(-60 * DEG)).toBeCloseTo(strip.height);
    expect(strip.lat(strip.y(-0.3))).toBeCloseTo(-0.3);
    expect(strip.lon(strip.x(1.1))).toBeCloseTo(1.1);
  });

  it("copies the band's rows onto the feed in slices", () => {
    const strip = createStrip(s, 1000, 30 * DEG, -30 * DEG);
    const map = sphereMap(s, 1000, 500);
    const calls: number[][] = [];
    const g = {
      drawImage: (...args: unknown[]) => calls.push(args.slice(1) as number[]),
    } as unknown as CanvasRenderingContext2D;
    strip.draw(g, {} as CanvasImageSource, map);
    expect(calls.length).toBeGreaterThan(5);
    const first = calls[0] ?? [];
    const last = calls.at(-1) ?? [];
    expect(first[5]).toBeCloseTo(map.y(30 * DEG));
    expect((last[5] ?? 0) + (last[7] ?? 0)).toBeCloseTo(map.y(-30 * DEG));
    expect(first[1]).toBeCloseTo(0);
    expect((last[1] ?? 0) + (last[3] ?? 0)).toBeCloseTo(strip.height);
    // Destination rows tile the band with no gaps.
    for (let i = 1; i < calls.length; i++) {
      const prev = calls[i - 1] ?? [];
      expect(calls[i]?.[5]).toBeCloseTo((prev[5] ?? 0) + (prev[7] ?? 0));
    }
  });
});

describe("rotations", () => {
  it("turns about an axis, right-handed", () => {
    const r = rotationAbout([0, 1, 0], Math.PI / 2);
    close3(apply3(r, [0, 0, 1]), [1, 0, 0]);
    close3(apply3(multiply3(r, r), [0, 0, 1]), [0, 0, -1]);
  });

  it("stays a rotation after many small turns", () => {
    let m = rotationAbout([1, 0, 0], 0);
    const step = rotationAbout([0.3, 1, 0.2], 0.01);
    for (let i = 0; i < 20000; i++) {
      m = multiply3(step, m);
      if (i % 100 === 0) m = orthonormalize3(m);
    }
    const v = apply3(m, [0.2, -0.5, 0.84]);
    expect(Math.hypot(...v)).toBeCloseTo(Math.hypot(0.2, -0.5, 0.84), 9);
  });
});

describe("sphere frames", () => {
  it("reads the sphere parameters", () => {
    const p = parseParams("?kind=sphere&sphere=8,3.2&cover=80,-60&view=40,-60&look=globe");
    expect(p.kind).toBe("sphere");
    expect(p.sphere).toEqual({ diameter: 8, bottom: 3.2 });
    expect(p.cover).toEqual({ top: 80, bottom: -60 });
    expect(p.view).toEqual({ top: 40, bottom: -60 });
    expect(p.look).toBe("globe");
    const plain = parseParams("?kind=sphere&sphere=6&cover=10");
    expect(plain.sphere).toEqual({ diameter: 6, bottom: null });
    expect(plain.cover).toBeNull();
    expect(plain.look).toBe("flat");
  });

  it("is a non-touch display the size of its feed", () => {
    const d = displayFor("sphere");
    expect(d.touch).toBe(false);
    expect(d.width / d.height).toBe(2);
    expect(d.widthM).toBe(DEFAULT_VENUE.sphere.diameterM);
  });
});
