import { describe, expect, it } from "vitest";
import {
  layoutMenu,
  type MenuFrame,
  type MenuLayout,
  pageCount,
  pageTiles,
} from "../../../src/apps/menu/layout";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import type { FrameKind, Rect } from "../../../src/core/types";

const KINDS: FrameKind[] = ["panel", "pair", "wall", "kiosk"];
const MIN_TARGET = 120;
/** Tiles are the main target, so they are far larger than the minimum. */
const MIN_TILE = 360;

const frameOf = (kind: FrameKind, over: Partial<MenuFrame> = {}): MenuFrame => {
  const { width, height } = VENUE_SIZE[kind];
  const reach = DEFAULT_REACH[kind];
  return {
    kind,
    width,
    height,
    unit: 1,
    reachTop: { adult: height * (1 - reach.adult), child: height * (1 - reach.child) },
    seams: kind === "pair" ? [width / 2] : [],
    ...over,
  };
};

const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const targets = (l: MenuLayout): Rect[] =>
  [...l.slots, l.prev, l.next].filter((r): r is Rect => r !== null);

describe("pageCount", () => {
  it("is at least one and rounds up", () => {
    expect(pageCount(0, 4)).toBe(1);
    expect(pageCount(4, 4)).toBe(1);
    expect(pageCount(5, 4)).toBe(2);
  });
});

describe("menu layout", () => {
  for (const kind of KINDS) {
    const f = frameOf(kind);
    describe(kind, () => {
      for (const count of [1, 3, 40]) {
        const l = layoutMenu(f, count);

        it(`keeps every target inside the frame and the adult band (${count} apps)`, () => {
          for (const r of targets(l)) {
            expect(r.x).toBeGreaterThanOrEqual(0);
            expect(r.x + r.width).toBeLessThanOrEqual(f.width + 1e-6);
            expect(r.y).toBeGreaterThanOrEqual(f.reachTop.adult - 1e-6);
            expect(r.y + r.height).toBeLessThanOrEqual(f.height + 1e-6);
          }
        });

        it(`makes tiles large and arrows at least ${MIN_TARGET} venue px (${count} apps)`, () => {
          for (const s of l.slots) {
            expect(s.width).toBeGreaterThanOrEqual(MIN_TILE);
            expect(s.height).toBeGreaterThanOrEqual(MIN_TILE);
          }
          for (const a of [l.prev, l.next]) {
            if (!a) continue;
            expect(a.width).toBeGreaterThanOrEqual(MIN_TARGET);
            expect(a.height).toBeGreaterThanOrEqual(MIN_TARGET);
          }
          expect(l.labelSize).toBeGreaterThanOrEqual(56);
          for (const t of l.titles) expect(t.size).toBeGreaterThanOrEqual(84);
        });

        it(`never overlaps two targets (${count} apps)`, () => {
          const all = targets(l);
          for (let i = 0; i < all.length; i++) {
            for (let j = i + 1; j < all.length; j++) {
              expect(overlap(all[i]!, all[j]!), `${i} and ${j}`).toBe(false);
            }
          }
        });

        it(`keeps the title clear of the tiles (${count} apps)`, () => {
          const top = Math.min(...l.slots.map((s) => s.y));
          for (const t of l.titles) expect(t.y + t.size / 2).toBeLessThan(top);
        });
      }

      it("shows arrows and dots only when the apps need more than one page", () => {
        const one = layoutMenu(f, 1);
        expect(one.prev).toBeNull();
        expect(one.next).toBeNull();
        expect(one.dots).toEqual([]);
        const many = layoutMenu(f, 40);
        expect(many.prev).not.toBeNull();
        expect(many.next).not.toBeNull();
        expect(many.dots.length).toBeGreaterThan(0);
        expect(many.perPage).toBeGreaterThan(1);
        expect(layoutMenu(f, many.perPage).prev).toBeNull();
        // Arrows take room, so a page without them can hold more.
        expect(one.perPage).toBeGreaterThanOrEqual(many.perPage);
        expect(layoutMenu(f, one.perPage).prev).toBeNull();
        expect(layoutMenu(f, one.perPage + 1).prev).not.toBeNull();
      });

      it("records a row for every slot", () => {
        const l = layoutMenu(f, 40);
        expect(l.rowOf).toHaveLength(l.slots.length);
        expect(l.slots).toHaveLength(l.perPage);
        expect(l.perPage).toBe(l.cols * l.rows);
      });
    });
  }

  it("puts panel tiles in the lower part, with the first row in children's reach", () => {
    for (const count of [3, 40]) {
      const f = frameOf("panel");
      const l = layoutMenu(f, count);
      expect(Math.min(...l.slots.map((s) => s.y))).toBeGreaterThan(f.height * 0.35);
      const firstRow = l.slots.filter((_, i) => l.rowOf[i] === 0);
      for (const s of firstRow) expect(s.y).toBeGreaterThanOrEqual(f.reachTop.child);
      // The first slot is the lowest.
      expect(l.slots[0]!.y).toBe(Math.max(...l.slots.map((s) => s.y)));
      for (const a of [l.prev, l.next]) if (a) expect(a.y).toBeGreaterThanOrEqual(f.reachTop.child);
    }
  });

  it("keeps a fifth of a panel clear on each side of every seam of a pair", () => {
    for (const span of [2, 3]) {
      const width = 1080 * span;
      const seams = Array.from({ length: span - 1 }, (_, i) => (i + 1) * 1080);
      const f = frameOf("pair", { width, seams });
      for (const count of [1, 3, 40]) {
        const l = layoutMenu(f, count);
        const placed = [...targets(l), ...pageTiles(l, 1), ...pageTiles(l, 3)];
        for (const r of placed) {
          for (const seam of seams) {
            const near = r.x < seam + 216 && r.x + r.width > seam - 216;
            expect(near, `span ${span}, ${count} apps, rect at ${r.x}`).toBe(false);
          }
        }
        expect(l.titles).toHaveLength(span);
        for (const t of l.titles) {
          for (const seam of seams) {
            expect(t.x + t.width / 2 <= seam || t.x - t.width / 2 >= seam).toBe(true);
          }
        }
        expect(l.cols).toBe(span);
      }
    }
  });

  it("puts a pair's arrows at its outer edges", () => {
    const f = frameOf("pair");
    const l = layoutMenu(f, 40);
    expect(l.prev!.x + l.prev!.width).toBeLessThan(f.width * 0.25);
    expect(l.next!.x).toBeGreaterThan(f.width * 0.75);
  });

  it("lays a wall's tiles in one row in the reachable band, under a tall title area", () => {
    const f = frameOf("wall");
    const l = layoutMenu(f, 40);
    expect(new Set(l.slots.map((s) => s.y)).size).toBe(1);
    expect(l.rows).toBe(1);
    expect(l.perPage).toBeGreaterThanOrEqual(4);
    expect(l.titles[0]!.y).toBeLessThan(f.reachTop.adult);
    expect(l.titles[0]!.size).toBeGreaterThanOrEqual(200);
    // Arrows sit low enough for a child.
    for (const a of [l.prev, l.next]) {
      expect(a!.y + a!.height).toBeGreaterThan(f.reachTop.child);
    }
  });

  it("still fits a wall's tiles when the operator lowers the reach", () => {
    const { height } = VENUE_SIZE.wall;
    const f = frameOf("wall", { reachTop: { adult: height * 0.7, child: height * 0.8 } });
    const l = layoutMenu(f, 40);
    for (const s of l.slots) {
      expect(s.y + s.height).toBeLessThanOrEqual(f.height);
      expect(s.height).toBeGreaterThanOrEqual(MIN_TILE);
    }
  });

  it("lays a kiosk out as a grid", () => {
    const l = layoutMenu(frameOf("kiosk"), 40);
    expect(l.cols).toBe(3);
    expect(l.rows).toBe(2);
    expect(new Set(l.slots.map((s) => s.y)).size).toBe(2);
    expect(new Set(l.slots.map((s) => s.x)).size).toBe(3);
  });

  it("scales with the stage unit", () => {
    for (const kind of KINDS) {
      const f = frameOf(kind);
      const half = frameOf(kind, {
        width: f.width / 2,
        height: f.height / 2,
        unit: 0.5,
        reachTop: { adult: f.reachTop.adult / 2, child: f.reachTop.child / 2 },
        seams: f.seams.map((s) => s / 2),
      });
      const a = layoutMenu(f, 40);
      const b = layoutMenu(half, 40);
      expect(b.perPage).toBe(a.perPage);
      a.slots.forEach((s, i) => {
        expect(b.slots[i]!.x).toBeCloseTo(s.x / 2, 6);
        expect(b.slots[i]!.width).toBeCloseTo(s.width / 2, 6);
      });
    }
  });
});

describe("pageTiles", () => {
  it("returns the slots in order for a full page", () => {
    for (const kind of KINDS) {
      const l = layoutMenu(frameOf(kind), 40);
      expect(pageTiles(l, l.perPage)).toEqual(l.slots);
      expect(pageTiles(l, 999)).toEqual(l.slots);
      expect(pageTiles(l, 0)).toEqual([]);
    }
  });

  it("centres a short page's rows on a panel, fuller rows lowest", () => {
    const f = frameOf("panel");
    const l = layoutMenu(f, 3);
    const tiles = pageTiles(l, 3);
    expect(tiles).toHaveLength(3);
    const [a, b, c] = tiles as [Rect, Rect, Rect];
    expect(a.y).toBe(b.y);
    expect(c.y).toBeLessThan(a.y);
    expect(c.x + c.width / 2).toBeCloseTo(f.width / 2, 6);
    const one = pageTiles(l, 1)[0]!;
    expect(one.x + one.width / 2).toBeCloseTo(f.width / 2, 6);
    expect(one.y).toBe(l.slots[0]!.y);
  });

  it("never centres a tile onto a pair's seam", () => {
    const f = frameOf("pair");
    const l = layoutMenu(f, 3);
    expect(pageTiles(l, 3)).toEqual(l.slots.slice(0, 3));
    expect(pageTiles(l, 1)[0]!.x + pageTiles(l, 1)[0]!.width).toBeLessThan(f.width / 2);
  });

  it("spreads a short kiosk page evenly and centres it vertically", () => {
    const f = frameOf("kiosk");
    const l = layoutMenu(f, 4);
    const tiles = pageTiles(l, 4);
    const rows = new Map<number, number>();
    for (const t of tiles) rows.set(t.y, (rows.get(t.y) ?? 0) + 1);
    expect([...rows.values()]).toEqual([2, 2]);
    const two = pageTiles(l, 2);
    const mid = two[0]!.y + two[0]!.height / 2;
    const gridMid = (l.slots[0]!.y + l.slots[l.slots.length - 1]!.y + l.slots[0]!.height) / 2;
    expect(mid).toBeCloseTo(gridMid, 6);
  });

  it("centres a short row on a wall", () => {
    const f = frameOf("wall");
    const l = layoutMenu(f, 3);
    const tiles = pageTiles(l, 3);
    const left = tiles[0]!.x;
    const right = tiles[2]!.x + tiles[2]!.width;
    expect((left + right) / 2).toBeCloseTo(f.width / 2, 6);
  });
});
