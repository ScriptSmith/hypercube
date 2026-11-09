import { describe, expect, it } from "vitest";
import { MIN_TARGET, MIN_TARGET_WALL } from "../../../src/apps/xrd/config";
import {
  type CardLayout,
  type CardSpec,
  inRect,
  layoutFrame,
  MAX_SPLIT,
  MIN_SPLIT,
  type Rect,
  withSplit,
  withWatchShare,
} from "../../../src/apps/xrd/layout";
import type { FrameKind } from "../../../src/core/types";
import { DEFAULT_VENUE, displayFor, reachFor } from "../../../src/core/venue";
import { VENUE_SIZE } from "../../../src/core/frame";

type TouchKind = Exclude<FrameKind, "screen" | "sphere">;

const SIZES: Record<TouchKind, [number, number]> = {
  panel: [1080, 1920],
  pair: [2160, 1920],
  wall: [VENUE_SIZE.wall.width, VENUE_SIZE.wall.height],
  kiosk: [1920, 1080],
};

const reachTop = (kind: TouchKind) => {
  const r = reachFor(displayFor(kind, kind === "pair" ? 2 : 1, DEFAULT_VENUE));
  const h = SIZES[kind][1];
  return { adult: h * (1 - r.adult), child: h * (1 - r.child) };
};

const inside = (outer: Rect, r: Rect, slack = 0.5) =>
  r.x >= outer.x - slack &&
  r.y >= outer.y - slack &&
  r.x + r.width <= outer.x + outer.width + slack &&
  r.y + r.height <= outer.y + outer.height + slack;

const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

interface Case {
  name: string;
  kind: TouchKind;
  cards: CardSpec[];
}

const CASES: Case[] = [
  { name: "solo panel", kind: "panel", cards: [{ bottom: "tabs", tabs: 11 }] },
  {
    name: "bank panel with Back and Next",
    kind: "panel",
    cards: [{ bottom: "nav", reserve: "nav" }],
  },
  { name: "bank panel", kind: "panel", cards: [{ bottom: "none", reserve: "nav" }] },
  {
    name: "solo pair",
    kind: "pair",
    cards: [
      { bottom: "tabs", tabs: 6 },
      { bottom: "tabs", tabs: 5 },
    ],
  },
  {
    name: "bank pair",
    kind: "pair",
    cards: [
      { bottom: "nav", reserve: "nav" },
      { bottom: "none", reserve: "nav" },
    ],
  },
  {
    name: "wall",
    kind: "wall",
    cards: Array.from({ length: 6 }, () => ({ bottom: "none" as const })),
  },
  { name: "kiosk", kind: "kiosk", cards: [{ bottom: "tabs", tabs: 11 }] },
];

const build = (c: Case, maths = true) => {
  const [width, height] = SIZES[c.kind];
  return layoutFrame({
    kind: c.kind,
    width,
    height,
    reachTop: reachTop(c.kind),
    cards: c.cards,
    maths,
  });
};

/** Every touch rect the shell lays out, with the band it belongs to. */
const touchRects = (l: CardLayout): { r: Rect; child: boolean; name: string }[] => [
  ...(l.maths ? [{ r: l.maths, child: false, name: "maths" }] : []),
  ...l.tabs.map((r, i) => ({ r, child: true, name: `tab ${i}` })),
  ...(l.nav
    ? [
        { r: l.nav.back, child: true, name: "back" },
        { r: l.nav.next, child: true, name: "next" },
      ]
    : []),
];

describe("layouts on every kind", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      const f = build(c);
      const reach = reachTop(c.kind);
      const target = c.kind === "wall" ? MIN_TARGET_WALL : MIN_TARGET;

      it("fits every card's parts inside it, without overlaps", () => {
        expect(f.cards).toHaveLength(c.cards.length);
        for (const l of f.cards) {
          for (const r of [
            l.head,
            l.watch,
            l.text,
            l.figure,
            l.adult,
            l.child,
            ...touchRects(l).map((t) => t.r),
          ]) {
            expect(inside(l.rect, r), JSON.stringify(r)).toBe(true);
          }
          const parts = [l.head, l.watch, l.text, l.figure, l.adult, l.child];
          for (let i = 0; i < parts.length; i++)
            for (let j = i + 1; j < parts.length; j++)
              expect(overlap(parts[i]!, parts[j]!), `${i} ${j}`).toBe(false);
          for (const t of touchRects(l)) {
            for (const p of [l.head, l.watch, l.text, l.figure])
              expect(overlap(t.r, p), `${t.name} over a part`).toBe(false);
          }
        }
      });

      it("keeps targets at least the minimum, and children's controls lowest and within their reach", () => {
        for (const l of f.cards) {
          expect(l.target).toBe(target);
          for (const t of touchRects(l)) {
            expect(Math.min(t.r.width, t.r.height), t.name).toBeGreaterThanOrEqual(target - 0.5);
            expect(t.r.y, `${t.name} in adult reach`).toBeGreaterThanOrEqual(reach.adult - 0.5);
            if (t.child)
              expect(t.r.y, `${t.name} in child reach`).toBeGreaterThanOrEqual(reach.child - 0.5);
          }
          expect(l.child.y, "children's band in reach").toBeGreaterThanOrEqual(reach.child - 0.5);
          expect(l.child.y).toBeGreaterThan(l.adult.y);
          expect(l.adult.y, "adults' band in reach").toBeGreaterThanOrEqual(reach.adult - 0.5);
          expect(l.child.height).toBeGreaterThanOrEqual(target);
          expect(l.adult.height).toBeGreaterThanOrEqual(target);
          expect(l.figure.y, "the figure in reach").toBeGreaterThanOrEqual(reach.adult - 0.5);
        }
      });

      it("threads the beam through every figure at one height", () => {
        const ys = new Set(f.cards.map((l) => l.beamY));
        expect(ys.size).toBe(1);
        for (const l of f.cards) {
          expect(l.beamY).toBeGreaterThan(l.figure.y);
          expect(l.beamY).toBeLessThan(l.figure.y + l.figure.height);
        }
      });

      it("keeps the beam where it is whatever split a chapter asks for", () => {
        for (const l of f.cards) {
          for (const s of [MIN_SPLIT, 0.4, 0.5, MAX_SPLIT, 0.1, 0.9]) {
            const k = withSplit(l, s);
            expect(k.beamY).toBe(l.beamY);
            expect(k.beamY).toBeGreaterThan(k.figure.y);
            expect(k.beamY).toBeLessThan(k.figure.y + k.figure.height);
            expect(k.watch.height).toBeGreaterThan(100);
            expect(
              overlap(k.watch, k.text) || overlap(k.text, k.figure) || overlap(k.figure, k.adult),
            ).toBe(false);
            expect(k.figure.y).toBeGreaterThanOrEqual(reach.adult - 0.5);
          }
        }
      });
    });
  }
});

describe("the pair's seam", () => {
  it("keeps every control a fifth of the pair's width from the seam", () => {
    for (const c of CASES.filter((x) => x.kind === "pair")) {
      const f = build(c);
      const seam = 1080;
      for (const l of f.cards) {
        for (const r of [l.adult, l.child, ...touchRects(l).map((t) => t.r)]) {
          const d = Math.max(r.x - seam, seam - (r.x + r.width));
          expect(d, JSON.stringify(r)).toBeGreaterThanOrEqual(2160 * 0.2 - 0.5);
        }
        expect(inRect(l.safe, seam, 900)).toBe(false);
        expect(l.outer).not.toBeNull();
      }
      expect(f.cards[0]!.maths!.x).toBeLessThan(f.cards[0]!.adult.x);
      expect(f.cards[1]!.maths!.x).toBeGreaterThan(f.cards[1]!.adult.x);
    }
  });
});

describe("the wall", () => {
  it("puts six even columns under the banner", () => {
    const f = build(CASES.find((c) => c.kind === "wall")!);
    const cw = VENUE_SIZE.wall.width / 6;
    expect(f.banner).not.toBeNull();
    expect(f.cards.map((l) => l.rect.width)).toEqual([cw, cw, cw, cw, cw, cw]);
    f.cards.forEach((l, i) => {
      expect(l.rect.x).toBe(i * cw);
      expect(l.rect.y).toBe(f.banner!.height);
    });
  });
});

describe("the bank", () => {
  it("lines the figure up on frames with and without Back and Next", () => {
    const a = build(CASES[1]!).cards[0]!;
    const b = build(CASES[2]!).cards[0]!;
    expect(a.figure).toEqual(b.figure);
    expect(a.beamY).toBe(b.beamY);
    expect(a.nav).not.toBeNull();
    expect(b.nav).toBeNull();
    expect(b.child.height).toBeGreaterThan(a.child.height);
  });

  it("hides the Maths button when the option is off", () => {
    const f = build(CASES[0]!, false);
    expect(f.cards[0]!.maths).toBeNull();
    expect(f.cards[0]!.adult.width).toBeGreaterThan(build(CASES[0]!).cards[0]!.adult.width);
  });
});

describe("the kiosk", () => {
  it("gives a chapter's figure more of the width when it asks, keeping tabs and targets", () => {
    const kiosk = CASES.find((c) => c.kind === "kiosk")!;
    const l = build(kiosk).cards[0]!;
    const narrow = withWatchShare(l, 0.34);
    expect(narrow.watch.width).toBeLessThan(l.watch.width);
    expect(narrow.figure.width).toBeGreaterThan(l.figure.width);
    expect(narrow.tabs).toEqual(l.tabs);
    expect(narrow.maths!.height).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(narrow.figure.x).toBeGreaterThan(narrow.watch.x + narrow.watch.width);
    expect(withWatchShare(l, 0.47)).toEqual(l);
    // Columns are left as they are.
    const panel = build(CASES[0]!).cards[0]!;
    expect(withWatchShare(panel, 0.34)).toBe(panel);
  });
});
