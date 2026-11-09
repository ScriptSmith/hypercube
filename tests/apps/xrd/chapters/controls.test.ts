/**
 * Every chapter's controls, laid out on every kind of card: big enough, inside the card's safe
 * area (clear of a pair's seam), children's controls within a child's reach. Chapters are made
 * with a stand-in environment; nothing here draws.
 */
import { describe, expect, it } from "vitest";
import { CHAPTERS } from "../../../../src/apps/xrd/chapters";
import type { ChapterEnv } from "../../../../src/apps/xrd/chapter";
import { readConfig } from "../../../../src/apps/xrd/config";
import { Choice, type Control, Rotary } from "../../../../src/apps/xrd/controls";
import { createLink } from "../../../../src/apps/xrd/formula";
import { CHAPTER_IDS, type ChapterId } from "../../../../src/apps/xrd/ids";
import {
  type CardLayout,
  type CardSpec,
  layoutFrame,
  type Rect,
  withSplit,
} from "../../../../src/apps/xrd/layout";
import type { FrameKind, Rng } from "../../../../src/core/types";
import { DEFAULT_VENUE, displayFor, reachFor } from "../../../../src/core/venue";
import { VENUE_SIZE } from "../../../../src/core/frame";

type TouchKind = Exclude<FrameKind, "screen" | "sphere">;

const SIZES: Record<TouchKind, [number, number]> = {
  panel: [1080, 1920],
  pair: [2160, 1920],
  wall: [VENUE_SIZE.wall.width, VENUE_SIZE.wall.height],
  kiosk: [1920, 1080],
};

const CARDS: Record<TouchKind, CardSpec[]> = {
  panel: [{ bottom: "tabs", tabs: 11 }],
  pair: [
    { bottom: "tabs", tabs: 6 },
    { bottom: "tabs", tabs: 5 },
  ],
  wall: Array.from({ length: 6 }, () => ({ bottom: "none" as const })),
  kiosk: [{ bottom: "tabs", tabs: 11 }],
};

const reachTop = (kind: TouchKind) => {
  const r = reachFor(displayFor(kind, kind === "pair" ? 2 : 1, DEFAULT_VENUE));
  const h = SIZES[kind][1];
  return { adult: h * (1 - r.adult), child: h * (1 - r.child) };
};

const rng = (): Rng => {
  let a = 1;
  const next = () => {
    a = (a * 16807) % 2147483647;
    return a / 2147483647;
  };
  const r: Rng = {
    next,
    int: (n) => Math.floor(next() * n),
    range: (lo, hi) => lo + next() * (hi - lo),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    fork: () => rng(),
  };
  return r;
};

const envFor = (id: ChapterId, kind: TouchKind): ChapterEnv => ({
  id,
  kind,
  config: readConfig({}),
  rng: rng(),
  engine: () => {
    throw new Error("no engine in layout tests");
  },
  layer3d: () => {
    throw new Error("no 3D in layout tests");
  },
  maps: { canvas: () => null, ready: () => false, draw: () => null, dispose() {} },
  link: createLink(),
  earn() {},
  now: () => 0,
});

const inside = (outer: Rect, r: Rect, slack = 0.5) =>
  r.x >= outer.x - slack &&
  r.y >= outer.y - slack &&
  r.x + r.width <= outer.x + outer.width + slack &&
  r.y + r.height <= outer.y + outer.height + slack;

/** The rects a finger aims at: a choice's cells, a rotary's circle, or the control. */
const targets = (c: Control): Rect[] => {
  if (c instanceof Choice) return c.cells();
  if (c instanceof Rotary) {
    const k = c.circle();
    return [{ x: k.x - k.r, y: k.y - k.r, width: 2 * k.r, height: 2 * k.r }];
  }
  return [c.rect];
};

describe("every chapter's controls on every kind", () => {
  for (const kind of Object.keys(SIZES) as TouchKind[]) {
    const [width, height] = SIZES[kind];
    const reach = reachTop(kind);
    const frame = layoutFrame({
      kind,
      width,
      height,
      reachTop: reach,
      cards: CARDS[kind],
      maths: true,
    });
    for (const id of CHAPTER_IDS) {
      it(`${id} on a ${kind}`, () => {
        for (const base of frame.cards) {
          const def = CHAPTERS[id];
          const card: CardLayout = withSplit(base, def.split ?? 0.5);
          const ch = def.create(envFor(id, kind));
          ch.layout(card);
          expect(ch.controls.length, "has something to touch").toBeGreaterThan(0);
          for (const c of ch.controls) {
            if (!c.visible) continue;
            const name = `${id} ${c.id} on ${kind}`;
            if (c.kind !== "pad")
              expect(inside(card.safe, c.rect), `${name} inside the safe area`).toBe(true);
            expect(inside(card.rect, c.rect), `${name} inside the card`).toBe(true);
            for (const t of targets(c)) {
              expect(Math.min(t.width, t.height), `${name} target`).toBeGreaterThanOrEqual(
                card.target - 0.5,
              );
              expect(t.y + t.height, `${name} reachable`).toBeGreaterThan(reach.adult);
              if (c.band === "child")
                expect(t.y, `${name} in a child's reach`).toBeGreaterThanOrEqual(reach.child - 0.5);
            }
          }
          ch.dispose();
        }
      });
    }
  }
});
