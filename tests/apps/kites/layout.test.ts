import { describe, expect, it } from "vitest";
import { venueFrame } from "./helpers";
import { gripAt, layoutFor, type LayoutInput, SEAM_CLEAR } from "../../../src/apps/kites/layout";
import type { Variant } from "../../../src/apps/kites/config";
import type { Rect } from "../../../src/core/types";

/** Venue sizes and default reach tops (adult, child). */
const FRAMES: Record<string, [number, number, number, number]> = Object.fromEntries(
  (["panel", "pair", "wall"] as const).map((kind) => {
    const f = venueFrame(kind);
    return [kind, [f.width, f.height, f.reachTop.adult, f.reachTop.child]];
  }),
);

const input = (
  kind: "panel" | "pair" | "wall",
  variant: Variant = "duo",
  flyers = 6,
): LayoutInput => {
  const [width, height, adult, child] = FRAMES[kind]!;
  return {
    kind,
    width,
    height,
    reachTop: { adult, child },
    seams: kind === "pair" ? [1080] : [],
    variant,
    flyers,
  };
};

const inside = (r: Rect, w: number, h: number) =>
  r.x >= 0 && r.y >= 0 && r.x + r.width <= w + 1e-9 && r.y + r.height <= h + 1e-9;

describe("layout", () => {
  for (const kind of ["panel", "pair", "wall"] as const) {
    for (const variant of ["duo", "single"] as const) {
      it(`puts the spool low and the stunt bar high on a ${kind} (${variant})`, () => {
        const [W, H, adult, child] = FRAMES[kind]!;
        const l = layoutFor(input(kind, variant));
        expect(l.patches).toHaveLength(kind === "panel" ? 1 : kind === "pair" ? 2 : 6);
        for (const p of l.patches) {
          const s = p.spool;
          // The spool button is in the child band, clear of the bottom edge and the reset.
          expect(s.y - s.r).toBeGreaterThanOrEqual(child);
          expect(s.y + s.r).toBeLessThanOrEqual(H - 100);
          expect(inside(s.hit, W, H)).toBe(true);
          expect(s.hit.x).toBeLessThanOrEqual(s.x - s.r);
          expect(s.hit.x + s.hit.width).toBeGreaterThanOrEqual(s.x + s.r);
          expect(s.hit.y).toBeLessThanOrEqual(s.y - s.r);
          expect(s.hit.y + s.hit.height).toBeGreaterThanOrEqual(s.y + s.r);
          expect(Math.hypot(p.reset.x - s.x, p.reset.y - s.y)).toBeGreaterThan(s.r + p.reset.r);
          // Big for children: at least 300 venue px on panels, and about 35 cm on the wall.
          if (kind !== "wall")
            expect(2 * s.r).toBeGreaterThanOrEqual(variant === "single" ? 440 : 300);
          else expect(2 * s.r).toBeGreaterThanOrEqual(variant === "single" ? 220 : 170);
          // In the lower part of the child band.
          expect(s.y).toBeGreaterThan(child + (H - child) * 0.4);
          if (variant === "single") {
            expect(p.stunt).toBeNull();
            continue;
          }
          const st = p.stunt!;
          for (const g of [st.left, st.right]) {
            expect(g.restY - g.h / 2).toBeGreaterThanOrEqual(adult);
            expect(g.restY + g.travel + g.h / 2).toBeLessThanOrEqual(child);
            expect(g.h).toBeGreaterThanOrEqual(120);
            expect(g.w).toBeGreaterThanOrEqual(kind === "wall" ? 120 : 200);
            expect(inside(g.hit, W, H)).toBe(true);
            expect(g.x - g.w / 2).toBeGreaterThanOrEqual(p.x0);
            expect(g.x + g.w / 2).toBeLessThanOrEqual(p.x1);
          }
          if (kind !== "wall") expect(st.right.x - st.left.x).toBeGreaterThanOrEqual(400);
          else expect(st.right.x - st.left.x).toBeGreaterThanOrEqual(300);
          // The sky's bottom is above every control.
          expect(l.horizon).toBeLessThan(st.left.restY - st.left.h / 2);
        }
        for (const p of l.patches) {
          expect(2 * p.reset.r).toBeGreaterThanOrEqual(120);
          expect(p.reset.x - p.reset.r).toBeGreaterThanOrEqual(p.x0);
          expect(p.reset.x + p.reset.r).toBeLessThanOrEqual(p.x1);
          expect(p.reset.y + p.reset.r).toBeLessThanOrEqual(H);
        }
      });
    }
  }

  it("keeps every control clear of a pair's seam", () => {
    for (const variant of ["duo", "single"] as const) {
      const l = layoutFor(input("pair", variant));
      for (const p of l.patches) {
        const rects = [p.spool.hit];
        if (p.stunt) rects.push(p.stunt.left.hit, p.stunt.right.hit);
        for (const r of rects) {
          expect(r.x + r.width <= 1080 - SEAM_CLEAR || r.x >= 1080 + SEAM_CLEAR).toBe(true);
        }
        expect(Math.abs(p.reset.x - 1080)).toBeGreaterThanOrEqual(SEAM_CLEAR + p.reset.r);
      }
    }
  });

  it("fits four to eight flyers along the wall", () => {
    for (let n = 4; n <= 8; n++) {
      const l = layoutFor(input("wall", "duo", n));
      expect(l.patches).toHaveLength(n);
      for (const p of l.patches) {
        expect(p.stunt!.left.hit.x).toBeGreaterThanOrEqual(p.x0);
        expect(p.stunt!.right.hit.x + p.stunt!.right.hit.width).toBeLessThanOrEqual(p.x1);
      }
      // The runtime's Home control (bottom right) misses the last patch's controls.
      const home = l.home!;
      const last = l.patches.at(-1)!;
      expect(last.spool.hit.x + last.spool.hit.width).toBeLessThan(home.x);
      expect(last.reset.x + last.reset.r).toBeLessThan(home.x);
    }
  });

  it("finds the grip under a finger", () => {
    const l = layoutFor(input("pair"));
    const p = l.patches[1]!;
    expect(gripAt(l, p.spool.x, p.spool.y)).toEqual({ patch: 1, grip: "spool" });
    expect(gripAt(l, p.spool.x + p.spool.r * 0.9, p.spool.y)).toEqual({ patch: 1, grip: "spool" });
    expect(gripAt(l, p.stunt!.left.x, p.stunt!.left.restY + 50)).toEqual({
      patch: 1,
      grip: "left",
    });
    expect(gripAt(l, p.stunt!.right.x, p.stunt!.right.restY)).toEqual({ patch: 1, grip: "right" });
    expect(gripAt(l, 1080, 1200)).toBeNull();
    expect(gripAt(l, 500, 100)).toBeNull();
    const single = layoutFor(input("panel", "single"));
    expect(gripAt(single, 200, 1900)).toEqual({ patch: 0, grip: "spool" });
  });
});
