import { describe, expect, it } from "vitest";
import { VENUE_SIZE } from "../../../src/core/frame";
import { displayFor, reachFor } from "../../../src/core/venue";
import {
  layoutFor,
  screenSize,
  screenSky,
  stationLayout,
  targets,
  type TouchKind,
} from "../../../src/apps/gravity/layout";

const SIZES: Record<TouchKind, [number, number]> = {
  wall: [VENUE_SIZE.wall.width, VENUE_SIZE.wall.height],
  panel: [1080, 1920],
  pair: [2160, 1920],
  kiosk: [1920, 1080],
};

const cases = [
  ...(["panel", "pair", "kiosk"] as const).map((kind) => ({ kind, pads: undefined })),
  ...[4, 6, 8].map((pads) => ({ kind: "wall" as const, pads })),
];

describe("layouts", () => {
  for (const { kind, pads } of cases) {
    const [w, h] = SIZES[kind];
    const l = layoutFor(kind, w, h, { pads });
    const reach = reachFor(displayFor(kind));
    const childTop = h * (1 - reach.child);
    const adultTop = h * (1 - reach.adult);
    const name = `${kind}${pads ? ` with ${pads} slingshots` : ""}`;

    it(`keeps every target at least 120 px, inside the frame and apart (${name})`, () => {
      const all = targets(l);
      for (const t of all) {
        expect(t.r * 2, t.what).toBeGreaterThanOrEqual(120);
        expect(t.x - t.r, t.what).toBeGreaterThanOrEqual(0);
        expect(t.x + t.r, t.what).toBeLessThanOrEqual(w);
        expect(t.y - t.r, t.what).toBeGreaterThanOrEqual(0);
        expect(t.y + t.r, t.what).toBeLessThanOrEqual(h);
      }
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i]!;
          const b = all[j]!;
          expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.what} and ${b.what}`).toBeGreaterThan(
            a.r + b.r,
          );
        }
      }
    });

    it(`puts slingshots and pickers in the children's band, the rest above it (${name})`, () => {
      for (const p of l.pads) expect(p.y).toBeGreaterThan(childTop);
      for (const g of l.pickers) for (const b of g) expect(b.y - b.r).toBeGreaterThan(childTop);
      const adult = [...l.launchers, l.slower, l.faster, l.sizes, l.scene];
      for (const b of adult) {
        expect(b.y).toBeGreaterThan(adultTop);
        if (kind !== "kiosk") expect(b.y + b.r).toBeLessThan(childTop);
      }
      // Every body picker sits by its own slingshot.
      l.pickers.forEach((g, i) => {
        const p = l.pads[i]!;
        const near = l.pads.reduce((best, q) =>
          Math.hypot(q.x - g[0]!.x, q.y - g[0]!.y) < Math.hypot(best.x - g[0]!.x, best.y - g[0]!.y)
            ? q
            : best,
        );
        expect(near).toBe(p);
      });
    });

    it(`gives every slingshot a range of speeds round the escape speed (${name})`, () => {
      for (const p of l.pads) {
        expect(p.vmin).toBeGreaterThan(0);
        expect(p.vmax).toBeGreaterThan(p.vmin * 2);
      }
      for (const s of l.launchers) expect(Math.hypot(s.vx, s.vy)).toBeGreaterThan(0);
    });
  }

  it("keeps a pair's controls a fifth of the width clear of the seam", () => {
    const [w, h] = SIZES.pair;
    for (const t of targets(layoutFor("pair", w, h))) {
      expect(Math.abs(t.x - w / 2) - t.r, t.what).toBeGreaterThanOrEqual(w / 5);
    }
  });

  it("gives bank frames the screen's speeds, throwing straight up from their launchers", () => {
    const { W, H } = screenSize(6 * 1080, VENUE_SIZE.screen.width, VENUE_SIZE.screen.height);
    const sky = screenSky(W, H);
    const left = stationLayout("panel", 1080, 1920, 0, sky, 0);
    const mid = stationLayout("panel", 1080, 1920, 3, sky, 3 * 1080);
    expect(mid.pads[0]!.vmax).toBeGreaterThan(left.pads[0]!.vmax);
    for (const s of mid.launchers) {
      expect(s.vx).toBe(0);
      expect(s.vy).toBeLessThan(0);
    }
    expect(left.pads[0]!.color).toBe(0);
    expect(mid.pads[0]!.color).toBe(3);
  });
});
