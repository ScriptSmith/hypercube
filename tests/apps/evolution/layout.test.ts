import { describe, expect, it } from "vitest";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import type { FrameKind } from "../../../src/core/types";
import { hitAt, type Layout, layoutFor } from "../../../src/apps/evolution/layout";

const make = (kind: FrameKind, ponds = 3): Layout => {
  const s = VENUE_SIZE[kind];
  const r = DEFAULT_REACH[kind];
  return layoutFor({
    kind,
    width: s.width,
    height: s.height,
    reachTop: { adult: s.height * (1 - r.adult), child: s.height * (1 - r.child) },
    seams: kind === "pair" ? [s.width / 2] : [],
    ponds,
  });
};

const boxes = (l: Layout) => l.ponds.flatMap((p) => [...p.tiles.map((t) => t.box), p.small, p.big]);

describe("evolution layout", () => {
  for (const [kind, ponds] of [
    ["panel", 1],
    ["pair", 1],
    ["wall", 1],
    ["wall", 3],
    ["wall", 4],
  ] as const) {
    it(`fits ${kind}${kind === "wall" ? ` with ${ponds} ponds` : ""}: ponds low, controls in the adults' band`, () => {
      const l = make(kind, ponds);
      const s = VENUE_SIZE[kind];
      const r = DEFAULT_REACH[kind];
      const childTop = s.height * (1 - r.child);
      const adultTop = s.height * (1 - r.adult);
      expect(l.ponds).toHaveLength(kind === "wall" ? ponds : kind === "pair" ? 2 : 1);
      for (const p of l.ponds) {
        expect(p.water.y).toBeGreaterThanOrEqual(childTop - 1);
        expect(p.water.y + p.water.h).toBeLessThanOrEqual(s.height);
        expect(p.box.w).toBeGreaterThan(800);
        for (const b of [...p.tiles.map((t) => t.box), p.small, p.big]) {
          expect(b.y).toBeGreaterThanOrEqual(adultTop - 1);
          expect(b.y + b.h).toBeLessThan(p.water.y);
          expect(Math.min(b.w, b.h)).toBeGreaterThanOrEqual(140);
          expect(b.x).toBeGreaterThanOrEqual(p.water.x - 1);
          expect(b.x + b.w).toBeLessThanOrEqual(p.water.x + p.water.w + 1);
        }
      }
      // Nothing overlaps.
      const all = boxes(l);
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i]!;
          const b = all[j]!;
          const overlap =
            a.x < b.x + b.w - 1 &&
            b.x < a.x + a.w - 1 &&
            a.y < b.y + b.h - 1 &&
            b.y < a.y + a.h - 1;
          expect(overlap).toBe(false);
        }
      }
      expect(l.tree.y + l.tree.h).toBeLessThan(Math.min(...all.map((b) => b.y)));
    });
  }

  it("keeps every control 120 px from a pair's seam, and each pond to its own half", () => {
    const l = make("pair");
    const seam = 1080;
    for (const b of boxes(l)) {
      const d = b.x + b.w <= seam ? seam - (b.x + b.w) : b.x - seam;
      expect(d).toBeGreaterThanOrEqual(120);
    }
    expect(l.ponds[0]!.water.x + l.ponds[0]!.water.w).toBeLessThanOrEqual(seam - 40);
    expect(l.ponds[1]!.water.x).toBeGreaterThanOrEqual(seam + 40);
  });

  it("makes wall tiles bigger than a panel's", () => {
    expect(make("wall").ponds[0]!.tiles[0]!.box.w).toBeGreaterThan(
      make("panel").ponds[0]!.tiles[0]!.box.w,
    );
  });

  it("finds tiles, switch halves and ponds under a touch", () => {
    const l = make("pair");
    const t = l.ponds[1]!.tiles[2]!;
    expect(hitAt(l, t.box.x + 10, t.box.y + 10)).toEqual({ kind: "tile", pond: 1, floor: t.floor });
    const b = l.ponds[0]!.big;
    expect(hitAt(l, b.x + b.w / 2, b.y + b.h / 2)).toEqual({
      kind: "mutation",
      pond: 0,
      value: "big",
    });
    const w = l.ponds[1]!.water;
    expect(hitAt(l, w.x + w.w / 2, w.y + w.h / 2)).toEqual({ kind: "pond", pond: 1 });
    expect(hitAt(l, 1080, 200)).toBeNull();
  });
});
