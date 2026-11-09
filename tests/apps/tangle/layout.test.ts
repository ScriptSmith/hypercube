import { describe, expect, it } from "vitest";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import {
  AIM_MIN,
  frameLayout,
  type LayoutInput,
  PAD_MIN,
  PAD_STRIP,
  resetRect as layoutReset,
  SEAM_CLEAR,
  sideAt,
} from "../../../src/apps/tangle/layout";
import { aimAt } from "../../../src/apps/tangle/pads";
import { bankSlots, insetFor, localSlots } from "../../../src/apps/tangle/slots";
import { arenaParams } from "../../../src/apps/tangle/arena";
import {
  decodeAim,
  decodeAlive,
  decodeRound,
  decodeSeat,
  decodeTurn,
  encodeAim,
  encodeRound,
  encodeSeat,
  encodeTurn,
  packHeading,
  stationKey,
  unpackHeading,
} from "../../../src/apps/tangle/protocol";
import type { Rect } from "../../../src/core/types";

/** The default wall and screen. */
const WALL = VENUE_SIZE.wall;
const SCREEN = VENUE_SIZE.screen;

const input = (kind: LayoutInput["kind"], over: Partial<LayoutInput> = {}): LayoutInput => {
  const size = VENUE_SIZE[kind as "panel"];
  return {
    kind,
    width: size.width,
    height: size.height,
    seams: kind === "pair" ? [1080] : [],
    reachTop: kind === "wall" ? WALL.height * (1 - DEFAULT_REACH.wall.adult) : 0,
    wallStations: 8,
    perFrame: 1,
    ...over,
  };
};

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The platform's reset control while playing, for an uncalibrated station (see core/stations/view.ts). */
const resetRect = (rect: Rect, corner: string, reachTop: number): Rect => {
  const top = Math.min(Math.max(reachTop, rect.y), rect.y + rect.height - 400);
  const h = rect.y + rect.height - top;
  const r = Math.max(120, Math.min(150, h * 0.3));
  const x = corner.endsWith("left")
    ? rect.x + rect.width * 0.05 + 28
    : rect.x + rect.width * 0.95 - 28 - r;
  return { x, y: top + 28, width: r, height: r };
};

const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - 1e-6 &&
  inner.y >= outer.y - 1e-6 &&
  inner.x + inner.width <= outer.x + outer.width + 1e-6 &&
  inner.y + inner.height <= outer.y + outer.height + 1e-6;

describe("layout", () => {
  for (const n of [4, 6, 8]) {
    it(`puts ${n} wall stations along the bottom strip with big pads clear of the reset control`, () => {
      const i = input("wall", { wallStations: n });
      const lay = frameLayout(i);
      expect(lay.stations).toHaveLength(n);
      expect(lay.arena).toEqual({
        x: 0,
        y: 0,
        width: WALL.width,
        height: WALL.height - PAD_STRIP,
      });
      for (const s of lay.stations) {
        expect(s.rect.width).toBeCloseTo(WALL.width / n);
        expect(s.rect.y).toBe(WALL.height - PAD_STRIP);
        for (const p of s.pads) {
          expect(Math.min(p.width, p.height)).toBeGreaterThanOrEqual(PAD_MIN.wall);
          expect(inside(p, s.rect)).toBe(true);
          expect(overlaps(p, resetRect(s.rect, s.resetCorner, i.reachTop))).toBe(false);
          // Every wall pad is in the child band (the lowest 25 % of the wall).
          expect(p.y).toBeGreaterThan(WALL.height * 0.75);
        }
        expect(overlaps(s.pads[0]!, s.pads[1]!)).toBe(false);
        expect(s.u).toBeCloseTo((s.rect.x + s.rect.width / 2) / WALL.width);
      }
      expect(lay.stations[0]!.resetCorner).toBe("top-left");
      expect(lay.stations[n - 1]!.resetCorner).toBe("top-right");
    });
  }

  it("puts a panel's pads in its lower half, in child reach", () => {
    const lay = frameLayout(input("panel"));
    expect(lay.stations).toHaveLength(1);
    const s = lay.stations[0]!;
    expect(s.u).toBe(0.5);
    for (const p of s.pads) {
      expect(Math.min(p.width, p.height)).toBeGreaterThanOrEqual(PAD_MIN.panel);
      expect(p.y).toBeGreaterThan(1920 * 0.5);
      expect(overlaps(p, resetRect(s.rect, s.resetCorner, 0))).toBe(false);
    }
    expect(lay.arena.height).toBeLessThanOrEqual(s.rect.y);
    expect(lay.status[0]!.y + lay.status[0]!.height).toBeLessThanOrEqual(s.rect.y);
  });

  it("stacks a low and a high station on a panel with two per frame", () => {
    const lay = frameLayout(input("panel", { perFrame: 2 }));
    const [low, high] = lay.stations as [(typeof lay.stations)[0], (typeof lay.stations)[0]];
    expect(low.tier).toBe("low");
    expect(high.tier).toBe("high");
    expect([low.u, high.u]).toEqual([0.3, 0.7]);
    for (const p of low.pads) {
      // Bottom 40 %.
      expect(p.y).toBeGreaterThanOrEqual(1920 * 0.6);
      expect(Math.min(p.width, p.height)).toBeGreaterThanOrEqual(PAD_MIN.panel);
    }
    for (const p of high.pads) {
      // Between 55 % and 85 % up from the bottom.
      expect(p.y).toBeGreaterThanOrEqual(1920 * 0.15 - 1e-6);
      expect(p.y + p.height).toBeLessThanOrEqual(1920 * 0.45 + 1e-6);
      expect(Math.min(p.width, p.height)).toBeGreaterThanOrEqual(PAD_MIN.panel);
      expect(overlaps(p, resetRect(high.rect, high.resetCorner, 0))).toBe(false);
    }
    expect(overlaps(low.rect, high.rect)).toBe(false);
  });

  for (const perFrame of [1, 2] as const) {
    it(`keeps a pair's stations ${SEAM_CLEAR} px from the seam (${perFrame} per half)`, () => {
      const lay = frameLayout(input("pair", { perFrame }));
      expect(lay.stations).toHaveLength(2 * perFrame);
      for (const s of lay.stations) {
        expect(s.rect.x + s.rect.width <= 1080 - SEAM_CLEAR || s.rect.x >= 1080 + SEAM_CLEAR).toBe(
          true,
        );
        for (const p of s.pads) {
          expect(Math.min(p.width, p.height)).toBeGreaterThanOrEqual(PAD_MIN.panel);
          expect(
            Math.min(Math.abs(p.x - 1080), Math.abs(p.x + p.width - 1080)),
          ).toBeGreaterThanOrEqual(SEAM_CLEAR);
          expect(overlaps(p, resetRect(s.rect, s.resetCorner, 0))).toBe(false);
        }
      }
      // Reset controls go on the outer side, away from the seam.
      expect(lay.stations[0]!.resetCorner).toBe("top-left");
      expect(lay.stations.at(-1)!.resetCorner).toBe("top-right");
    });
  }

  for (const kind of ["panel", "pair"] as const) {
    for (const perFrame of [1, 2] as const) {
      it(`keeps the ${kind}'s own arena clear of every station (${perFrame} per frame)`, () => {
        const lay = frameLayout(input(kind, { perFrame }));
        const a = lay.arena;
        expect(a.width).toBe(kind === "pair" ? 2160 : 1080);
        expect(a.height).toBeGreaterThanOrEqual(300);
        expect(inside(a, { x: 0, y: 0, width: lay.width, height: lay.height })).toBe(true);
        for (const s of lay.stations) {
          // Not under the station overlay, its pads, or its heading arrow and status.
          expect(overlaps(a, s.rect), `station ${s.index}`).toBe(false);
          for (const p of s.pads) expect(overlaps(a, p), `pad of station ${s.index}`).toBe(false);
          expect(overlaps(a, s.info), `info of station ${s.index}`).toBe(false);
        }
      });
    }
  }

  it("splits a station into a left and a right half", () => {
    const s = frameLayout(input("panel")).stations[0]!;
    expect(sideAt(s, 100, 1700)).toBe(-1);
    expect(sideAt(s, 1000, 1700)).toBe(1);
    expect(sideAt(s, 500, 100)).toBeNull();
  });
});

describe("direction pad layout", () => {
  const H = { wall: WALL.height, panel: 1920, pair: 1920 } as const;
  const cases: { name: string; i: LayoutInput; min: number }[] = [
    ...([4, 6, 8] as const).map((n) => ({
      name: `wall, ${n} stations`,
      i: input("wall", { wallStations: n, pads: "aim" }),
      min: AIM_MIN.wall,
    })),
    ...(["panel", "pair"] as const).flatMap((kind) =>
      ([1, 2] as const).map((perFrame) => ({
        name: `${kind}, ${perFrame} per panel`,
        i: input(kind, { perFrame, pads: "aim" }),
        // Three 300 px pads don't fit across a pair's half once it keeps clear of the seam.
        min: kind === "pair" && perFrame === 2 ? AIM_MIN.wall : AIM_MIN.panel,
      })),
    ),
  ];

  for (const c of cases) {
    it(`lays out four big direction pads (${c.name})`, () => {
      const lay = frameLayout(c.i);
      const kind = c.i.kind as keyof typeof H;
      const height = H[kind];
      const stations =
        c.i.kind === "wall" ? c.i.wallStations : (c.i.seams.length + 1) * c.i.perFrame;
      expect(lay.stations).toHaveLength(stations);
      for (const s of lay.stations) {
        expect(s.kind).toBe("aim");
        expect(s.pads).toHaveLength(4);
        const reset = layoutReset(s.rect, s.resetCorner, c.i.reachTop);
        expect(reset).toEqual(resetRect(s.rect, s.resetCorner, c.i.reachTop));
        expect(inside(reset, s.rect)).toBe(true);
        expect(overlaps(reset, s.info)).toBe(false);
        expect(s.info.width).toBeGreaterThan(200);
        expect(s.rect.height).toBeGreaterThanOrEqual(400);
        s.pads.forEach((p, d) => {
          expect(Math.min(p.width, p.height), `pad ${d} of ${s.index}`).toBeGreaterThanOrEqual(
            c.min,
          );
          expect(Math.min(p.width, p.height)).toBeGreaterThanOrEqual(120);
          expect(inside(p, s.rect)).toBe(true);
          expect(overlaps(p, reset), `pad ${d} and reset of ${s.index}`).toBe(false);
          expect(overlaps(p, s.info)).toBe(false);
          expect(overlaps(p, lay.arena), `pad ${d} and the arena`).toBe(false);
          for (const seam of c.i.seams) {
            expect(
              Math.min(Math.abs(p.x - seam), Math.abs(p.x + p.width - seam)),
            ).toBeGreaterThanOrEqual(SEAM_CLEAR);
            expect(p.x >= seam || p.x + p.width <= seam).toBe(true);
          }
          s.pads.forEach((q, e) => {
            if (e !== d) expect(overlaps(p, q), `pads ${d} and ${e}`).toBe(false);
          });
          // Each pad sits the way it points from the middle of the set.
          const cx = p.x + p.width / 2;
          const cy = p.y + p.height / 2;
          const mx = s.pads[1]!.x + s.pads[1]!.width / 2;
          if (d === 0) expect(cx).toBeGreaterThan(mx);
          if (d === 2) expect(cx).toBeLessThan(mx);
          if (d === 3) expect(cy).toBeLessThan(s.pads[1]!.y);
          // A touch on a pad presses that pad.
          expect(aimAt(s, cx, cy)).toBe(d);
          // Height bands: the child band, or for two per panel the low and high bands.
          if (s.tier === "only") {
            expect(p.y).toBeGreaterThanOrEqual(kind === "wall" ? height * 0.75 : height * 0.5);
          } else if (s.tier === "low") {
            expect(p.y).toBeGreaterThanOrEqual(height * 0.6);
          } else {
            expect(p.y).toBeGreaterThanOrEqual(height * 0.15 - 1e-6);
            expect(p.y + p.height).toBeLessThanOrEqual(height * 0.5);
          }
        });
        expect(aimAt(s, s.rect.x + s.rect.width / 2, s.rect.y - 200)).toBe(-1);
      }
      for (const a of lay.stations) {
        for (const b of lay.stations) {
          if (a !== b) expect(overlaps(a.rect, b.rect)).toBe(false);
        }
      }
      expect(lay.arena.height).toBeGreaterThanOrEqual(300);
      for (const r of lay.status) if (r) expect(r.height).toBeGreaterThan(400);
    });
  }

  it("keeps the turn pads as they were", () => {
    expect(frameLayout(input("panel"))).toEqual(frameLayout(input("panel", { pads: "turn" })));
    expect(frameLayout(input("panel")).stations[0]!.pads).toHaveLength(2);
  });
});

describe("slots", () => {
  it("starts each line just above its station, heading up", () => {
    const rect = { width: WALL.width, height: WALL.height - PAD_STRIP };
    const inset = insetFor(rect.width, rect.height);
    const w = rect.width - inset.left - inset.right;
    const h = rect.height - inset.top - inset.bottom;
    const p = arenaParams(w, h);
    const us = frameLayout(input("wall")).stations.map((s) => s.u);
    const slots = localSlots(us, WALL.width, inset.left, w, h, p);
    const stations = slots.filter((s) => !s.virtual);
    expect(stations).toHaveLength(8);
    stations.forEach((s, i) => {
      expect(s.start.x + inset.left).toBeCloseTo(((i + 0.5) / 8) * WALL.width);
      expect(s.start.heading).toBeCloseTo(-Math.PI / 2);
      expect(s.start.y).toBeGreaterThan(h - p.radius * 1.5);
      expect(s.color).toBe(i);
    });
    expect(slots.filter((s) => s.virtual).every((s) => s.start.heading > 0)).toBe(true);
  });

  it("places a bank's lines over their frames, at (pos + u) / count across the screen", () => {
    const W = SCREEN.width;
    const inset = insetFor(W, SCREEN.height);
    const w = W - inset.left - inset.right;
    const h = SCREEN.height - inset.top - inset.bottom;
    const p = arenaParams(w, h);
    const one = bankSlots(6, () => "panel", 1, "turn", W, inset.left, w, h, p).filter(
      (s) => !s.virtual,
    );
    expect(one.map((s) => s.key)).toEqual(
      Array.from({ length: 6 }, (_, pos) => stationKey(pos, 0)),
    );
    one.forEach((s, pos) => expect(s.start.x + inset.left).toBeCloseTo(((pos + 0.5) / 6) * W));
    const two = bankSlots(6, () => "panel", 2, "turn", W, inset.left, w, h, p).filter(
      (s) => !s.virtual,
    );
    expect(two).toHaveLength(12);
    expect(two[0]!.start.x + inset.left).toBeCloseTo((0.3 / 6) * W);
    expect(two[1]!.start.x + inset.left).toBeCloseTo((0.7 / 6) * W);
    // Lines 9 to 16 have hollow heads.
    expect(two.slice(8).every((s) => s.style === 1)).toBe(true);
    expect(two.slice(0, 8).every((s) => s.style === 0)).toBe(true);
    const pairs = bankSlots(3, () => "pair", 1, "turn", W, inset.left, w, h, p).filter(
      (s) => !s.virtual,
    );
    expect(pairs).toHaveLength(6);
    // Each over its pads: the left half's station is clear of the seam, so left of the middle.
    expect(pairs[0]!.start.x + inset.left).toBeLessThan((0.25 / 3) * W);
    expect(pairs[1]!.start.x + inset.left).toBeGreaterThan((0.75 / 3) * W);
  });
});

describe("protocol", () => {
  it("round-trips messages and rejects bad ones", () => {
    expect(decodeTurn(encodeTurn({ k: 9, d: -1, q: 7, b: false }))).toEqual({
      k: 9,
      d: -1,
      q: 7,
      b: false,
    });
    expect(decodeSeat(encodeSeat({ k: 3, on: true, q: 1, b: true }))).toEqual({
      k: 3,
      on: true,
      q: 1,
      b: true,
    });
    const round = {
      r: 4,
      p: "play" as const,
      s: 100,
      e: 60_100,
      a: false,
      k: [0, 4, -1],
      m: [0, 2, 2],
    };
    expect(decodeRound(encodeRound(round))).toEqual(round);
    expect(decodeAlive({ r: 4, l: [1, 0], h: [12, 250], pl: [] })).toEqual({
      r: 4,
      l: [1, 0],
      h: [12, 250],
      pl: [],
    });
    expect(decodeAim(encodeAim({ k: 5, g: 3, n: 12, q: 40, b: false }))).toEqual({
      k: 5,
      g: 3,
      n: 12,
      q: 40,
      b: false,
    });
    expect(decodeAim({ k: 5, g: -1, n: 0, q: 1 })).toEqual({ k: 5, g: -1, n: 0, q: 1, b: false });
    expect(decodeAim({ k: 5, g: 4, n: 0, q: 1 })).toBeNull();
    expect(decodeAim({ k: 5, g: 1, n: -1, q: 1 })).toBeNull();
    expect(decodeAim({ k: 5, g: 1.5, n: 0, q: 1 })).toBeNull();
    expect(decodeTurn({ k: 9, d: 2, q: 1 })).toBeNull();
    expect(decodeTurn({ k: -1, d: 0, q: 1 })).toBeNull();
    expect(decodeTurn("turn")).toBeNull();
    expect(decodeRound({ ...round, p: "party" })).toBeNull();
    expect(decodeRound({ ...round, k: [0, 1], m: [0] })).toBeNull();
    expect(decodeRound({ ...round, k: Array.from({ length: 200 }, () => 0), m: [] })).toBeNull();
    expect(decodeAlive({ r: 4, l: [1, 0], h: [12], pl: [] })).toBeNull();
    expect(decodeAlive({ r: 4, l: [1], h: [999], pl: [] })).toBeNull();
  });

  it("packs headings into 256ths of a turn", () => {
    for (const a of [0, 1, -Math.PI / 2, Math.PI, 7]) {
      const back = unpackHeading(packHeading(a));
      const diff = Math.atan2(Math.sin(back - a), Math.cos(back - a));
      expect(Math.abs(diff)).toBeLessThan((Math.PI * 2) / 256);
    }
    expect(packHeading(-Math.PI / 2)).toBe(192);
  });
});
