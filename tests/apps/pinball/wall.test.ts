import { describe, expect, it } from "vitest";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import {
  readConfig,
  TABLE_H,
  TABLE_W,
  WALL_DEFAULT,
  WALL_TABLES,
} from "../../../src/apps/pinball/config";
import manifest from "../../../src/apps/pinball/manifest";
import { exitU } from "../../../src/apps/pinball/layout";
import { controlAt } from "../../../src/apps/pinball/pads";
import { RESET_CLEAR, wallLayout, wallPads } from "../../../src/apps/pinball/wallgeo";

const W = VENUE_SIZE.wall.width;
const H = VENUE_SIZE.wall.height;
/** Adult reach on the default wall, a share of its height. */
const ADULT = DEFAULT_REACH.wall.adult;
const PADS = ["left", "right", "upLeft", "upRight", "plunger"] as const;

describe("pinball wall layout", () => {
  it("stands its tables on the bottom edge in their own shares, with the deck's band above", () => {
    for (const n of [4, 5, 6]) {
      const l = wallLayout(W, H, ADULT * H, n, true);
      expect(l.tables).toHaveLength(n);
      const share = W / n;
      l.tables.forEach((t, h) => {
        const tw = TABLE_W * t.place.k;
        // Inside its share, centred, with a gap to each neighbour.
        expect(t.place.x).toBeGreaterThan(share * h);
        expect(t.place.x + tw).toBeLessThan(share * (h + 1));
        expect(t.place.x + tw / 2).toBeCloseTo(share * (h + 0.5), 6);
        expect(t.place.y + TABLE_H * t.place.k).toBeCloseTo(H, 6);
        expect(t.cell).toEqual({ x: share * h, y: t.place.y, w: share, h: TABLE_H * t.place.k });
      });
      // Plungers at the outer edges: the left half's tables are mirrored.
      expect(l.tables.map((t) => t.mirror)).toEqual(
        Array.from({ length: n }, (_, h) => h < Math.floor(n / 2)),
      );
      expect(l.band).toEqual({ x: 0, y: 0, w: W, h: H - TABLE_H * l.k });
      expect(l.band!.h / H).toBeGreaterThan(0.4);
    }
  });

  it("keeps every pad within reach, below room for the reset control, and big enough", () => {
    for (const adult of [0.3, ADULT, 0.5, 0.6]) {
      for (const deck of [true, false]) {
        for (const n of [4, 5, 6]) {
          const l = wallLayout(W, H, adult * H, n, deck);
          for (const t of l.tables) {
            const k = t.place.k;
            for (const c of PADS) {
              const b = t.pads[c];
              expect(b.x).toBeGreaterThanOrEqual(0);
              expect(b.x + b.w).toBeLessThanOrEqual(TABLE_W);
              expect(b.y + b.h).toBeLessThanOrEqual(TABLE_H);
              expect(Math.min(b.w, b.h) * k, `${c} at ${adult}`).toBeGreaterThanOrEqual(150 - 1e-6);
              // Its top, in venue px above the bottom edge, leaves room for the reset control.
              const top = (TABLE_H - b.y) * k;
              if (adult >= 0.3) {
                expect(top, `${c} at ${adult}, ${n} ${deck}`).toBeLessThanOrEqual(
                  adult * H - RESET_CLEAR + 1e-6,
                );
              }
            }
            // Upper pads sit above the main ones, never on them.
            expect(t.pads.upLeft.y + t.pads.upLeft.h).toBeLessThanOrEqual(t.pads.left.y + 1e-6);
          }
        }
      }
    }
  });

  it("has a panel's pads at a panel's proportions when there is room", () => {
    const l = wallLayout(W, H, ADULT * H, 5, true);
    const p = l.tables[2]!.pads;
    expect((TABLE_H - p.left.y) / TABLE_H).toBeCloseTo(0.45, 6);
    expect(p.upLeft.h).toBeCloseTo(424, 6);
    // A touch on each pad works that pad, also on a mirrored table.
    for (const t of l.tables) {
      for (const c of PADS) {
        const b = t.pads[c];
        expect(controlAt(t.pads, b.x + b.w / 2, b.y + b.h / 2, true)).toBe(c);
      }
    }
  });

  it("makes the tables bigger without the deck, and shrinks their pads to stay in reach", () => {
    const on = wallLayout(W, H, ADULT * H, 5, true);
    const off = wallLayout(W, H, ADULT * H, 5, false);
    expect(off.band).toBeNull();
    expect(off.k).toBeGreaterThan(on.k * 1.5);
    expect(off.tables[0]!.place.y).toBeLessThan(on.tables[0]!.place.y);
    const p = wallPads(false, off.k, ADULT * H);
    expect((TABLE_H - p.upLeft.y) * off.k).toBeLessThanOrEqual(ADULT * H - RESET_CLEAR + 1e-6);
  });

  it("puts each table's exit under its chute on the deck", () => {
    const l = wallLayout(W, H, ADULT * H, 6, true);
    l.slots.forEach((s, h) => {
      const t = l.tables[h]!;
      expect(s.at!.tx * l.f).toBeCloseTo(t.place.x, 6);
      expect(s.at!.tw * l.f).toBeCloseTo(TABLE_W * t.place.k, 6);
      expect(s.at!.mirror).toBe(t.mirror);
      expect(exitU(t.mirror)).toBeGreaterThan(0);
    });
  });

  it("offers 4, 5 or 6 tables on a wall, 5 by default", () => {
    const opt = manifest.options?.find((o) => o.key === "tables");
    expect(opt?.type === "enum" && opt.values.map((v) => v.id)).toEqual([...WALL_TABLES]);
    expect(opt?.default).toBe(WALL_DEFAULT);
    expect(opt?.kinds).toEqual(["wall"]);
    expect(readConfig("classic", {}).tables).toBe(5);
    expect(readConfig("classic", { tables: "6" }).tables).toBe(6);
    expect(readConfig("classic", { tables: "9" }).tables).toBe(5);
    expect(manifest.setups.some((s) => s.setup === "solo" && s.kinds.includes("wall"))).toBe(true);
  });
});
