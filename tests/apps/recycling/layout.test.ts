import { describe, expect, it } from "vitest";
import { inletsFor, PAIR_CLEAR } from "../../../src/apps/recycling/layout";
import { pointAt } from "../../../src/apps/recycling/paths";
import { layoutOf, TOUCH_KINDS } from "./helpers";

const VARIANTS = ["sort", "simple"] as const;

describe("recycling layouts", () => {
  for (const kind of TOUCH_KINDS) {
    for (const variant of VARIANTS) {
      const L = layoutOf(kind, variant);
      const label = `${kind} ${variant}`;

      it(`${label}: every line has its bins, belts and an inlet inside the frame`, () => {
        const lines = { panel: 1, pair: 2, kiosk: 1, wall: 3 }[kind];
        expect(L.lines.length, label).toBe(lines);
        for (const line of L.lines) {
          const kinds = L.bins
            .filter((b) => b.line === line.index)
            .map((b) => b.kind)
            .sort();
          expect(kinds, label).toEqual(
            variant === "simple"
              ? ["recycle", "rubbish"]
              : ["compost", "dropoff", "recycle", "rubbish"],
          );
          expect(line.belts.length, label).toBe(kind === "kiosk" ? 1 : 2);
          expect(line.inlet.x).toBeGreaterThan(0);
          expect(line.inlet.x).toBeLessThan(L.width);
        }
        for (const b of L.belts) {
          for (const x of [b.start, b.end]) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(L.width);
          }
          expect(b.length).toBeGreaterThan(L.d * 4);
          // The tube ends where a resting item sits at the belt's start.
          const end = pointAt(b.tube, b.tube.length);
          expect(end.x).toBeCloseTo(b.start, 3);
          expect(end.y).toBeCloseTo(b.y - L.r, 3);
        }
        for (const s of L.bins) {
          expect(s.x - s.w / 2).toBeGreaterThanOrEqual(0);
          expect(s.x + s.w / 2).toBeLessThanOrEqual(L.width);
          expect(s.bottom).toBeLessThanOrEqual(L.height);
        }
      });

      it(`${label}: items are big and bin mouths wide`, () => {
        expect(L.d).toBeGreaterThanOrEqual(kind === "wall" ? 180 : 140);
        for (const s of L.bins) {
          const mouth = s.mouth.x1 - s.mouth.x0;
          // Pairs keep their bins clear of the seam, so their household bins are a little narrower.
          expect(mouth, `${label} ${s.kind}`).toBeGreaterThanOrEqual(kind === "pair" ? 265 : 300);
          expect(mouth).toBeGreaterThan(L.d * 1.6);
        }
      });

      it(`${label}: no two bins overlap`, () => {
        for (const a of L.bins) {
          for (const b of L.bins) {
            if (a === b) continue;
            const apart =
              a.x + a.w / 2 <= b.x - b.w / 2 + 0.01 ||
              b.x + b.w / 2 <= a.x - a.w / 2 + 0.01 ||
              a.bottom <= b.top ||
              b.bottom <= a.top;
            expect(apart, `${label} ${a.kind} ${b.kind}`).toBe(true);
          }
        }
      });

      it(`${label}: the slow belt and the bins it feeds are lowest, in the children's band`, () => {
        for (const line of L.lines) {
          const belts = line.belts.map((i) => L.belts[i]!);
          const slow = belts.find((b) => b.speed === "slow");
          const fast = belts.find((b) => b.speed === "fast");
          if (kind === "kiosk") {
            expect(belts[0]!.speed).toBe("mid");
            continue;
          }
          expect(slow && fast).toBeTruthy();
          expect(slow!.y).toBeGreaterThan(fast!.y);
          // A resting item on the slow belt is within a child's reach; the fast one's is not.
          expect(slow!.y - L.r).toBeGreaterThanOrEqual(L.childTop);
          expect(fast!.y - L.r).toBeLessThan(L.childTop);
          expect(fast!.y - L.r).toBeGreaterThanOrEqual(L.adultTop);
          for (const s of L.bins.filter((b) => b.line === line.index && b.kind !== "dropoff")) {
            expect(s.top, `${label} ${s.kind}`).toBeGreaterThanOrEqual(L.childTop);
            expect(s.top).toBeGreaterThan(slow!.y);
            expect(s.band).toBe("child");
            expect(s.belt).toBe(slow!.id);
          }
          if (variant === "sort") {
            const box = L.bins.find((b) => b.line === line.index && b.kind === "dropoff")!;
            expect(box.top).toBeGreaterThanOrEqual(L.adultTop);
            if (kind === "wall") expect(box.top).toBeGreaterThanOrEqual(L.childTop);
            else expect(box.belt).toBe(fast!.id);
          }
        }
      });

      it(`${label}: an open lid fits between the belt above and the bin`, () => {
        for (const s of L.bins) {
          const above = L.belts[s.belt]!;
          const lid = Math.min(s.w * 0.4, (s.bottom - s.top) * 0.3);
          if (above.y < s.top) expect(s.top - lid).toBeGreaterThanOrEqual(above.y + L.d * 0.2);
        }
      });
    }
  }

  it("pairs keep belts' items and bin mouths clear of the seam", () => {
    for (const variant of VARIANTS) {
      const L = layoutOf("pair", variant);
      const seam = L.width / 2;
      for (const s of L.bins) {
        expect(Math.min(Math.abs(s.mouth.x0 - seam), Math.abs(s.mouth.x1 - seam))).toBeGreaterThan(
          PAIR_CLEAR,
        );
        expect(s.mouth.x0 < seam && s.mouth.x1 > seam).toBe(false);
      }
      for (const b of L.belts) {
        // Belts carry items outward, away from the seam.
        expect(Math.abs(b.end - seam)).toBeGreaterThan(Math.abs(b.start - seam));
        expect(Math.abs(b.start - seam)).toBeGreaterThanOrEqual(PAIR_CLEAR);
      }
      // Each half is a mirror of the other, so its players stand at the outer sides.
      for (const s of L.bins.filter((b) => b.line === 0)) {
        const twin = L.bins.find((b) => b.line === 1 && b.kind === s.kind)!;
        expect(twin.x).toBeCloseTo(L.width - s.x, 3);
      }
    }
  });

  it("the screen aims at the same inlets the frames use", () => {
    for (const kind of ["panel", "pair", "kiosk", "wall"] as const) {
      const L = layoutOf(kind);
      const us = inletsFor(kind);
      expect(us.length).toBe(L.lines.length);
      L.lines.forEach((line, i) => expect(line.inlet.x / L.width).toBeCloseTo(us[i]!, 6));
    }
  });

  it("the park holds a few things on small frames and twelve on a wall", () => {
    expect(layoutOf("wall").parkSlots).toBe(12);
    for (const kind of ["panel", "pair", "kiosk"] as const) {
      const n = layoutOf(kind).parkSlots;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(12);
    }
  });
});
