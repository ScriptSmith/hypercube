import { describe, expect, it } from "vitest";
import {
  BUTTON_R,
  type Circle,
  type Layout,
  layoutFor,
  nominalLayout,
  PAD_R,
} from "../../../src/apps/tiltmaze/layout";
import type { FrameKind, Rect } from "../../../src/core/types";
import { DEFAULT_VENUE, displayFor, reachFor } from "../../../src/core/venue";

const input = (kind: FrameKind, over: { boards?: number; together?: boolean } = {}) => {
  const d = displayFor(kind, 2, DEFAULT_VENUE);
  const reach = reachFor(d);
  return {
    kind,
    width: d.width,
    height: d.height,
    reachTop: { adult: d.height * (1 - reach.adult), child: d.height * (1 - reach.child) },
    seams: kind === "pair" ? [d.width / 2] : [],
    boards: over.boards ?? 3,
    together: over.together ?? false,
  };
};

const CASES: { name: string; layout: Layout; i: ReturnType<typeof input> }[] = [];
for (const kind of ["panel", "kiosk"] as const)
  CASES.push({ name: kind, i: input(kind), layout: layoutFor(input(kind)) });
for (const together of [false, true]) {
  const i = input("pair", { together });
  CASES.push({ name: `pair ${together ? "together" : "side"}`, i, layout: layoutFor(i) });
}
for (const boards of [2, 3, 4]) {
  const i = input("wall", { boards });
  CASES.push({ name: `wall ${boards}`, i, layout: layoutFor(i) });
}

const inside = (r: Rect, W: number, H: number) =>
  r.x >= 0 && r.y >= 0 && r.x + r.width <= W + 1e-6 && r.y + r.height <= H + 1e-6;
const circleBox = (c: Circle): Rect => ({
  x: c.x - c.r,
  y: c.y - c.r,
  width: 2 * c.r,
  height: 2 * c.r,
});
const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Every touch target of a layout, by board. */
const targets = (l: Layout) =>
  l.boards.map((s) => {
    const list: Rect[] = [circleBox(s.minus), circleBox(s.plus)];
    if (s.pad) list.push(circleBox(s.pad));
    if (s.levers) list.push(s.levers.h.hit, s.levers.v.hit);
    return list;
  });

describe("tiltmaze layouts", () => {
  it("make the right number of boards", () => {
    const n = (name: string) => CASES.find((c) => c.name === name)!.layout.boards.length;
    expect(n("panel")).toBe(1);
    expect(n("kiosk")).toBe(1);
    expect(n("pair side")).toBe(2);
    expect(n("pair together")).toBe(1);
    expect(n("wall 2")).toBe(2);
    expect(n("wall 4")).toBe(4);
  });

  for (const c of CASES) {
    it(`${c.name}: keeps targets big, inside the frame and apart`, () => {
      const { layout, i } = c;
      const all = targets(layout).flat();
      for (const r of all) {
        expect(inside(r, i.width, i.height)).toBe(true);
        expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(120);
      }
      for (let a = 0; a < all.length; a++) {
        for (let b = a + 1; b < all.length; b++) expect(overlap(all[a]!, all[b]!)).toBe(false);
      }
      expect(BUTTON_R * 2).toBeGreaterThanOrEqual(120);
    });

    it(`${c.name}: puts pads and levers in the children's band and the level control in adult reach`, () => {
      const { layout, i } = c;
      for (const s of layout.boards) {
        if (s.pad) {
          expect(s.pad.y - s.pad.r).toBeGreaterThanOrEqual(i.reachTop.child);
          expect(2 * s.pad.r).toBeGreaterThanOrEqual(
            c.i.kind === "wall" ? 2 * PAD_R.wall - 40 : 360,
          );
        }
        if (s.levers) {
          for (const l of [s.levers.h, s.levers.v]) {
            expect(Math.min(l.y0, l.y1) - l.knob).toBeGreaterThanOrEqual(i.reachTop.child);
          }
        }
        for (const b of [s.minus, s.plus]) {
          expect(b.y - b.r).toBeGreaterThanOrEqual(i.reachTop.adult);
          // On a wall, clear of the children's band.
          if (i.kind === "wall") expect(b.y + b.r).toBeLessThanOrEqual(i.reachTop.child);
        }
      }
    });

    it(`${c.name}: puts each board's tube above its board, inside its lane`, () => {
      for (const s of c.layout.boards) {
        expect(s.tube.y).toBeLessThan(s.focus.y + s.focus.height * 0.2);
        expect(s.tube.x).toBeGreaterThan(s.lane.x);
        expect(s.tube.x).toBeLessThan(s.lane.x + s.lane.width);
        expect(s.focus.width).toBeGreaterThan(300);
        expect(s.focus.height).toBeGreaterThan(300);
        // The jar and rails sit above the boards.
        expect(c.layout.run.railBottom).toBeLessThan(s.focus.y);
      }
    });
  }

  it("keeps a pair's players and their controls on their own side of the seam", () => {
    const side = CASES.find((c) => c.name === "pair side")!;
    const seam = side.i.seams[0]!;
    targets(side.layout).forEach((list, b) => {
      for (const r of list) {
        if (b === 0) expect(r.x + r.width).toBeLessThan(seam - 60);
        else expect(r.x).toBeGreaterThan(seam + 60);
      }
    });
    side.layout.boards.forEach((s, b) => {
      if (b === 0) expect(s.focus.x + s.focus.width).toBeLessThan(seam - 50);
      else expect(s.focus.x).toBeGreaterThan(seam + 50);
      // Pads at the outer edges.
      expect(Math.abs(s.pad!.x - seam)).toBeGreaterThan(seam * 0.6);
    });
    const tog = CASES.find((c) => c.name === "pair together")!;
    const s = tog.layout.boards[0]!;
    const h = s.levers!.h.hit;
    const v = s.levers!.v.hit;
    expect(h.x + h.width).toBeLessThan(seam - 200);
    expect(v.x).toBeGreaterThan(seam + 200);
    expect(s.levers!.h.axis).toBe("x");
    expect(s.levers!.v.axis).toBe("y");
    // The tube rises clear of the seam.
    expect(Math.abs(s.tube.x - seam)).toBeGreaterThan(120);
  });

  it("gives a screen the same tubes a frame lays out for itself", () => {
    for (const kind of ["panel", "pair"] as const) {
      for (const together of [false, true]) {
        const n = nominalLayout(kind, { together });
        const own = layoutFor(input(kind, { together }));
        expect(n.boards.map((b) => b.tube)).toEqual(own.boards.map((b) => b.tube));
      }
    }
  });
});
