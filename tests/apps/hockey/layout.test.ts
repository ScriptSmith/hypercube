import { describe, expect, it } from "vitest";
import { VENUE_SIZE } from "../../../src/core/frame";
import {
  apply,
  boxToRect,
  deckLayout,
  invert,
  layoutFor,
  SEAM_CLEAR,
} from "../../../src/apps/hockey/layout";
import type { Rect } from "../../../src/core/types";
import { layoutInput } from "./helpers";

const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - 1e-6 &&
  inner.y >= outer.y - 1e-6 &&
  inner.x + inner.width <= outer.x + outer.width + 1e-6 &&
  inner.y + inner.height <= outer.y + outer.height + 1e-6;

const stations = (l: ReturnType<typeof layoutFor>) =>
  l.tables.flatMap((t) => t.lanes.flatMap((lane) => lane.players.flatMap((p) => p.station ?? [])));

describe("hockey layout", () => {
  it("inverts lane transforms", () => {
    for (const t of [
      { a: 1, b: 0, c: 0, d: 1, e: 40, f: 300 },
      { a: -1, b: 0, c: 0, d: 1, e: 6440, f: 300 },
      { a: 0, b: -1, c: 1, d: 0, e: 30, f: 1890 },
    ]) {
      const p = apply(t, 123, 45);
      const q = apply(invert(t), p.x, p.y);
      expect(q.x).toBeCloseTo(123);
      expect(q.y).toBeCloseTo(45);
    }
  });

  it("keeps pair stations at the outer halves, clear of the seam", () => {
    const l = layoutFor(layoutInput("pair"));
    const [left, right] = stations(l);
    expect(left!.x + left!.width).toBeLessThanOrEqual(1080 - 2160 * SEAM_CLEAR);
    expect(right!.x).toBeGreaterThanOrEqual(1080 + 2160 * SEAM_CLEAR);
    // The table itself crosses the seam.
    const lane = l.tables[0]!.lanes[0]!;
    expect(lane.rect.x).toBeLessThan(1080);
    expect(lane.rect.x + lane.rect.width).toBeGreaterThan(1080);
  });

  it("gives a panel one station over the whole panel, with the bot at the top", () => {
    const l = layoutFor(layoutInput("panel"));
    const [player, bot] = l.tables[0]!.lanes[0]!.players;
    expect(player!.station).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
    expect(bot!.station).toBeNull();
    // The player's goal is at the bottom of the panel.
    const goal = apply(l.tables[0]!.lanes[0]!.toVenue, 0, 0);
    expect(goal.y).toBeGreaterThan(1800);
  });

  it("puts four wall tables in reach with scores above, or three with child lanes", () => {
    const reach = layoutInput("wall").reachTop;
    const four = layoutFor(layoutInput("wall"));
    expect(four.tables).toHaveLength(4);
    for (const t of four.tables) {
      expect(t.hud!.y + t.hud!.height).toBeLessThanOrEqual(reach.adult + 1e-6);
      for (const s of t.scores) expect(s.y + s.size / 2).toBeLessThan(reach.adult);
      for (const lane of t.lanes) expect(lane.rect.y).toBeGreaterThanOrEqual(reach.adult);
    }
    for (const s of stations(four)) expect(s.y).toBeGreaterThanOrEqual(reach.adult);

    // Child lanes need a wide enough band between child and adult reach.
    const H = VENUE_SIZE.wall.height;
    const wide = { adult: H * 0.55, child: H * 0.75 };
    const three = layoutFor(layoutInput("wall", { childLane: true, reachTop: wide }));
    expect(three.tables).toHaveLength(3);
    for (const t of three.tables) {
      const [adult, child] = t.lanes;
      expect(child!.child).toBe(true);
      expect(child!.rect.y).toBeGreaterThanOrEqual(wide.child);
      expect(adult!.rect.y + adult!.rect.height).toBeLessThanOrEqual(wide.child);
      expect(child!.params.maxPuck).toBeLessThan(adult!.params.maxPuck);
    }
  });

  it("drops the child lane when reach leaves no room for it", () => {
    const l = layoutFor(
      layoutInput("wall", { childLane: true, reachTop: { adult: 1900, child: 2100 } }),
    );
    expect(l.tables).toHaveLength(4);
    expect(l.tables.every((t) => t.lanes.length === 1)).toBe(true);
  });

  it("never lets stations overlap and keeps touch targets large", () => {
    for (const kind of ["panel", "pair", "kiosk", "wall"] as const) {
      for (const versus of [false, true]) {
        const list = stations(layoutFor(layoutInput(kind, { versus, childLane: kind === "wall" })));
        for (const s of list) {
          expect(s.width, kind).toBeGreaterThanOrEqual(120);
          expect(s.height, kind).toBeGreaterThanOrEqual(120);
          expect(
            inside(s, {
              x: 0,
              y: 0,
              width: layoutInput(kind).width,
              height: layoutInput(kind).height,
            }),
          ).toBe(true);
        }
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i]!;
            const b = list[j]!;
            const apart =
              a.x + a.width <= b.x ||
              b.x + b.width <= a.x ||
              a.y + a.height <= b.y ||
              b.y + b.height <= a.y;
            expect(apart, `${kind} ${versus}`).toBe(true);
          }
        }
      }
    }
  });

  it("puts each reset control in the corner by the player's own goal", () => {
    const corner = (kind: "panel" | "pair" | "kiosk" | "wall", over = {}) =>
      layoutFor(layoutInput(kind, over))
        .tables.flatMap((t) => t.lanes.flatMap((l) => l.players))
        .filter((p) => p.station)
        .map((p) => [p.side, p.resetCorner]);
    expect(corner("panel")).toEqual([[0, "bottom-right"]]);
    for (const kind of ["pair", "kiosk", "wall"] as const) {
      for (const [side, c] of corner(kind, { childLane: true })) {
        expect(c).toBe(side === 0 ? "top-left" : "top-right");
      }
    }
    expect(new Set(corner("wall", { versus: true, side: 0 }).map(([, c]) => c))).toEqual(
      new Set(["top-left"]),
    );
    expect(new Set(corner("wall", { versus: true, side: 1 }).map(([, c]) => c))).toEqual(
      new Set(["top-right"]),
    );
  });

  it("gives each player's mallet area the strip under its station", () => {
    const l = layoutFor(layoutInput("kiosk"));
    const lane = l.tables[0]!.lanes[0]!;
    for (const p of lane.players) {
      const area = boxToRect(lane.toVenue, p.area);
      expect(area.x).toBeGreaterThanOrEqual(p.station!.x - 1e-6);
      expect(area.x + area.width).toBeLessThanOrEqual(p.station!.x + p.station!.width + 1e-6);
    }
  });

  it("mirrors versus ends so both frames read as one long table", () => {
    const a = layoutFor(layoutInput("wall", { versus: true, side: 0 }));
    const b = layoutFor(layoutInput("wall", { versus: true, side: 1 }));
    const la = a.tables[0]!.lanes[0]!;
    const lb = b.tables[0]!.lanes[0]!;
    // Lane x = 0 is each side's own goal: left on side 0, right on side 1.
    expect(apply(la.toVenue, 0, 0).x).toBeLessThan(100);
    expect(apply(lb.toVenue, 0, 0).x).toBeGreaterThan(VENUE_SIZE.wall.width - 100);
    // The open end runs to the frame edge.
    expect(apply(la.toVenue, la.params.length, 0).x).toBeCloseTo(VENUE_SIZE.wall.width);
    expect(apply(lb.toVenue, lb.params.length, 0).x).toBeCloseTo(0);
    // Pucks are handed over as their leading edge reaches the open end.
    expect(la.params.ends).toEqual([
      { kind: "goal", side: 0 },
      { kind: "open", side: 1, leaveAt: -1 },
    ]);
    // Both ends of the table are at the same height, so a puck crosses at the same height.
    expect(la.rect.y).toBeCloseTo(lb.rect.y);
    expect(la.rect.height).toBeCloseTo(lb.rect.height);
    expect(la.players).toHaveLength(3);
    // Players are ordered from the goal outwards on both sides.
    for (const lane of [la, lb]) {
      const x0 = lane.players.map((p) => p.area.x0);
      expect([...x0].sort((p, q) => p - q)).toEqual(x0);
    }
    // Side 0's score is on the left on both frames.
    for (const l of [a, b]) {
      const s0 = l.tables[0]!.scores.find((s) => s.side === 0)!;
      const s1 = l.tables[0]!.scores.find((s) => s.side === 1)!;
      expect(s0.x).toBeLessThan(s1.x);
    }
  });
});

describe("hockey layout: bands, long wall, versus players, defence", () => {
  const laneRects = (l: ReturnType<typeof layoutFor>) =>
    l.tables.flatMap((t) => t.lanes.map((lane) => lane.rect));

  it("fits each lane inside the band its players share, stations unchanged", () => {
    const band = { top: 1500, bottom: 2200 };
    for (const [kind, id] of [
      ["pair", "t0"],
      ["kiosk", "t0"],
      ["panel", "t0"],
    ] as const) {
      const plain = layoutFor(layoutInput(kind));
      const fitted = layoutFor(layoutInput(kind, { bands: { [id]: { top: 300, bottom: 900 } } }));
      const r = laneRects(fitted)[0]!;
      expect(r.y, kind).toBeGreaterThanOrEqual(300);
      expect(r.y + r.height, kind).toBeLessThanOrEqual(900);
      expect(stations(fitted), kind).toEqual(stations(plain));
    }
    const wall = layoutFor(layoutInput("wall", { bands: { t1: band } }));
    const [t0, t1] = wall.tables;
    expect(t1!.lanes[0]!.rect.y).toBeGreaterThanOrEqual(band.top);
    expect(t1!.lanes[0]!.rect.y + t1!.lanes[0]!.rect.height).toBeLessThanOrEqual(band.bottom);
    expect(t0!.lanes[0]!.rect).toEqual(layoutFor(layoutInput("wall")).tables[0]!.lanes[0]!.rect);
  });

  it("lays a short panel band across the panel and moves the scores out of the table", () => {
    const l = layoutFor(layoutInput("panel", { bands: { t0: { top: 1300, bottom: 1880 } } }));
    const t = l.tables[0]!;
    const lane = t.lanes[0]!;
    expect(lane.rect.width).toBeGreaterThan(lane.rect.height);
    expect(lane.rect.y).toBeGreaterThanOrEqual(1300);
    for (const s of t.scores) {
      expect(s.faint).toBe(false);
      expect(s.y + s.size / 2).toBeLessThan(lane.rect.y);
    }
  });

  it("never shrinks a lane below a playable width", () => {
    const l = layoutFor(layoutInput("pair", { bands: { t0: { top: 900, bottom: 1000 } } }));
    expect(laneRects(l)[0]!.height).toBeGreaterThanOrEqual(360);
  });

  it("spans the wall with one long table, seats alternating sides", () => {
    for (const players of [1, 2, 3, 4]) {
      const l = layoutFor(layoutInput("wall", { wall: "long", players }));
      expect(l.tables).toHaveLength(1);
      const lane = l.tables[0]!.lanes[0]!;
      expect(lane.rect.width).toBeGreaterThan(VENUE_SIZE.wall.width - 180);
      expect(lane.players).toHaveLength(players * 2);
      expect(lane.players.map((p) => p.side).slice(0, 2)).toEqual([0, 1]);
      for (const p of lane.players) {
        // Each side's zones work out from its own goal.
        const near = p.side === 0 ? p.area.x0 : lane.params.length - p.area.x1;
        expect(near).toBeLessThan(lane.params.length / 2);
      }
    }
    // One player a side leaves the middle open.
    const lone = layoutFor(layoutInput("wall", { wall: "long", players: 1 })).tables[0]!.lanes[0]!;
    expect(lone.players[1]!.area.x0 - lone.players[0]!.area.x1).toBeGreaterThan(2000);
  });

  it("gives versus one to four players per wall, starting at the goal", () => {
    for (const side of [0, 1] as const) {
      for (const players of [1, 2, 3, 4]) {
        const lane = layoutFor(layoutInput("wall", { versus: true, side, players })).tables[0]!
          .lanes[0]!;
        expect(lane.players).toHaveLength(players);
        expect(lane.players[0]!.area.x0).toBe(0);
      }
      const pair = layoutFor(layoutInput("pair", { versus: true, side, players: 4 }));
      expect(pair.tables[0]!.lanes[0]!.players).toHaveLength(2);
    }
  });

  it("builds defence rinks with a slot per station along the bottom", () => {
    for (const [kind, slots] of [
      ["wall", 6],
      ["pair", 2],
      ["kiosk", 2],
      ["panel", 1],
    ] as const) {
      const l = layoutFor(layoutInput(kind, { variant: "defence" }));
      const t = l.tables[0]!;
      const lane = t.lanes[0]!;
      const p = lane.params;
      expect(p.mouths[0], kind).toHaveLength(slots);
      expect(p.ends[1].kind, kind).toBe("wall");
      expect(t.defence?.local, kind).toBe(true);
      lane.players.forEach((pl, i) => {
        const mouth = p.mouths[0][i]!;
        // The slot sits under its own station, and the zone stays low on the rink.
        const centre = apply(lane.toVenue, 0, (mouth.y0 + mouth.y1) / 2);
        expect(centre.x).toBeGreaterThan(pl.station!.x);
        expect(centre.x).toBeLessThan(pl.station!.x + pl.station!.width);
        expect(pl.area.x1).toBeLessThanOrEqual(p.length * 0.45 + 1e-6);
        expect(t.defence!.targets.x0).toBeGreaterThan(pl.area.x1);
      });
    }
    const banked = layoutFor(layoutInput("panel", { variant: "defence", deck: true }));
    expect(banked.tables[0]!.lanes[0]!.params.ends[1].kind).toBe("open");
    expect(banked.tables[0]!.defence?.local).toBe(false);
  });

  it("lines the deck's openings up with the frames below it", () => {
    const { width, height } = VENUE_SIZE.screen;
    const l = deckLayout({ width, height, count: 6, speed: 1 });
    const lane = l.tables[0]!.lanes[0]!;
    const mouths = lane.params.mouths[0];
    expect(mouths).toHaveLength(6);
    mouths.forEach((m, i) => {
      const mid = apply(lane.toVenue, 0, (m.y0 + m.y1) / 2);
      expect(mid.x).toBeCloseTo(((i + 0.5) / 6) * width, 0);
      expect(mid.y).toBeCloseTo(height);
      expect(m.slot).toBe(i);
    });
  });
});
