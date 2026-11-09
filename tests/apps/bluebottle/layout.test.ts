import { describe, expect, it } from "vitest";
import { CELL } from "../../../src/apps/bluebottle/config";
import {
  type Box,
  cellAt,
  cellCentre,
  screenLayout,
  seamsOf,
  touchLayout,
  WASH_SIZE,
} from "../../../src/apps/bluebottle/layout";
import { createToday } from "../../../src/apps/bluebottle/today";
import { reachFor } from "../../../src/core/venue";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import { displayFor } from "../../../src/core/venue";

const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5;

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const FRAMES = [
  {
    name: "panel",
    kind: "panel" as const,
    venue: VENUE_SIZE.panel,
    reach: DEFAULT_REACH.panel,
    span: 1,
  },
  {
    name: "pair",
    kind: "pair" as const,
    venue: VENUE_SIZE.pair,
    reach: DEFAULT_REACH.pair,
    span: 2,
  },
  {
    name: "pair of three",
    kind: "pair" as const,
    venue: { width: 3240, height: 1920 },
    reach: reachFor(displayFor("pair", 3)),
    span: 3,
  },
  {
    name: "wall",
    kind: "wall" as const,
    venue: VENUE_SIZE.wall,
    reach: DEFAULT_REACH.wall,
    span: 1,
  },
];

describe("touch layout", () => {
  for (const f of FRAMES) {
    for (const bank of [false, true]) {
      it(`fits a ${f.name}${bank ? " in a bank" : ""}`, () => {
        const l = touchLayout(f.kind, f.venue, f.reach, bank);
        // Cells are at least 135 venue px and fill the width.
        expect(l.cell).toBeGreaterThanOrEqual(CELL);
        expect(l.cols * l.cell).toBeCloseTo(f.venue.width, 6);
        // No cell straddles a seam.
        for (const s of seamsOf(f.venue.width, f.span)) {
          const k = (s - l.beach.x) / l.cell;
          expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
        }
        // The beach sits at the bottom, inside the adult reach.
        expect(l.beach.y + l.beach.height).toBeCloseTo(f.venue.height, 6);
        expect(l.beach.y).toBeGreaterThanOrEqual(f.venue.height * (1 - f.reach.adult) - 1);
        // Child rows are exactly those whose centres are in the child band.
        const childTop = f.venue.height * (1 - f.reach.child);
        for (let r = 0; r < l.rows; r++) {
          const centre = l.beach.y + (r + 0.5) * l.cell;
          expect(r >= l.rows - l.kid).toBe(centre >= childTop);
        }
        expect(l.kid).toBeGreaterThan(0);
        // Sky things stay in the sky and clear of the wash control.
        const sky = { x: 0, y: 0, width: f.venue.width, height: l.beach.y };
        for (const b of [
          l.tower,
          l.progress,
          l.flags,
          l.today,
          l.banner,
          ...(l.map ? [l.map] : []),
        ])
          expect(inside(b, sky)).toBe(true);
        for (const w of l.wash) {
          expect(w.width).toBeGreaterThanOrEqual(WASH_SIZE);
          expect(inside(w, sky)).toBe(true);
          for (const b of [l.tower, l.progress, l.flags, l.today])
            expect(overlap(w, b)).toBe(false);
          // Out of children's reach, within adults'.
          expect(w.y + w.height).toBeLessThan(childTop);
          expect(w.y + w.height).toBeGreaterThan(f.venue.height * (1 - f.reach.adult));
          // Never beside a seam.
          for (const s of seamsOf(f.venue.width, f.span)) {
            expect(Math.min(Math.abs(w.x - s), Math.abs(w.x + w.width - s))).toBeGreaterThan(200);
          }
        }
        if (l.home) {
          expect(inside(l.home, sky)).toBe(true);
          for (const w of l.wash) expect(overlap(l.home, w)).toBe(false);
        }
        expect(l.map !== null).toBe(bank && f.kind !== "wall");
      });
    }
  }

  it("gives a panel 8 columns of 11 rows with a sky of about 400 px", () => {
    const l = touchLayout("panel", VENUE_SIZE.panel, DEFAULT_REACH.panel, false);
    expect([l.cols, l.rows, l.kid]).toEqual([8, 11, 7]);
    expect(l.beach.y).toBeGreaterThanOrEqual(400);
  });

  it("gives the wall 42 columns of 6 rows, 5 of them low enough for children", () => {
    const l = touchLayout("wall", VENUE_SIZE.wall, DEFAULT_REACH.wall, false);
    expect([l.cols, l.rows, l.kid]).toEqual([42, 6, 5]);
  });

  it("maps points to cells and back", () => {
    const l = touchLayout("pair", VENUE_SIZE.pair, DEFAULT_REACH.pair, false);
    for (let r = 0; r < l.rows; r++)
      for (let c = 0; c < l.cols; c++) {
        const p = cellCentre(l, c, r);
        expect(cellAt(l, p.x, p.y)).toEqual({ c, r });
      }
    expect(cellAt(l, 10, l.beach.y - 1)).toBeNull();
  });
});

describe("screen layout", () => {
  it("spans the map across the screen so each frame's columns sit above it", () => {
    for (const cols of [40, 48, 80, 160]) {
      const l = screenLayout(VENUE_SIZE.screen, cols, 11);
      expect(l.map.x).toBe(0);
      expect(l.map.width).toBe(VENUE_SIZE.screen.width);
    }
  });

  it("keeps the map clear of the sky's contents for any bank", () => {
    const screen = { x: 0, y: 0, ...VENUE_SIZE.screen };
    for (const cols of [8, 16, 24, 32, 40, 80, 160]) {
      const l = screenLayout(VENUE_SIZE.screen, cols, 11);
      expect(inside(l.map, screen), `${cols}`).toBe(true);
      expect(l.map.height).toBeLessThanOrEqual(VENUE_SIZE.screen.height * 0.72 + 1e-6);
      expect(l.map.width / cols).toBeCloseTo(l.map.height / 11, 6);
      for (const b of [l.tower, l.progress, l.flags, l.today, l.banner]) {
        expect(inside(b, screen), `${cols}`).toBe(true);
        expect(overlap(b, l.map), `${cols}`).toBe(false);
      }
      expect(overlap(l.banner, l.progress)).toBe(false);
      expect(overlap(l.progress, l.flags)).toBe(false);
    }
  });
});

describe("today", () => {
  it("counts patches cleared today and forgets earlier days", () => {
    const t = createToday();
    const day = new Date(2026, 9, 18, 10).getTime();
    t.add(day);
    t.add(day + 1000);
    expect(t.count(day + 2000)).toBe(2);
    expect(t.count(day + 24 * 3600 * 1000)).toBe(0);
  });

  it("stays bounded", () => {
    const t = createToday();
    const day = new Date(2026, 9, 18, 10).getTime();
    for (let i = 0; i < 500; i++) t.add(day + i);
    expect(t.count(day + 600)).toBe(60);
  });
});
