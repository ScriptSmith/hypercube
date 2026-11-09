import { describe, expect, it } from "vitest";
import { allLines, CONDITIONS, PARTS } from "../../../src/apps/eye/captions";
import { hitAt, sliderValue, sliderX } from "../../../src/apps/eye/controls";
import { fitSize, GLYPH, wrapCount } from "../../../src/apps/eye/fit";
import {
  type ButtonId,
  type Layout,
  layoutFor,
  MIN_TARGET,
  type Rect,
  SEAM_SHARE,
  slidersFor,
} from "../../../src/apps/eye/layout";
import { VENUE_SIZE } from "../../../src/core/frame";
import type { FrameKind } from "../../../src/core/types";
import { DEFAULT_VENUE, displayFor, reachFor } from "../../../src/core/venue";

const SIZES: Record<Exclude<FrameKind, "screen" | "sphere">, [number, number]> = {
  panel: [VENUE_SIZE.panel.width, VENUE_SIZE.panel.height],
  pair: [VENUE_SIZE.pair.width, VENUE_SIZE.pair.height],
  wall: [VENUE_SIZE.wall.width, VENUE_SIZE.wall.height],
  kiosk: [VENUE_SIZE.kiosk.width, VENUE_SIZE.kiosk.height],
};

const reachTop = (kind: FrameKind) => {
  const r = reachFor(displayFor(kind, kind === "pair" ? 2 : 1, DEFAULT_VENUE));
  const h = SIZES[kind as keyof typeof SIZES][1];
  return { adult: h * (1 - r.adult), child: h * (1 - r.child) };
};

const cases: { name: string; kind: FrameKind; l: Layout }[] = [];
for (const kind of Object.keys(SIZES) as (keyof typeof SIZES)[]) {
  for (const screenUp of [false, true]) {
    const [width, height] = SIZES[kind];
    cases.push({
      name: `${kind}${screenUp ? " under a screen" : ""}`,
      kind,
      l: layoutFor({ kind, width, height, reachTop: reachTop(kind), screenUp }),
    });
  }
}

const controls = (l: Layout): { name: string; r: Rect }[] => [
  ...l.sliderSlots.map((r, i) => ({ name: `slider ${i}`, r })),
  ...l.tiles.map((r, i) => ({ name: `tile ${i}`, r })),
  ...Object.entries(l.buttons).map(([k, r]) => ({ name: k, r: r! })),
  { name: "more", r: l.more },
  ...l.chips.map((r, i) => ({ name: `chip ${i}`, r })),
];

const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe.each(cases)("layout: $name", ({ kind, l }) => {
  it("keeps every touch target at least 120 venue px", () => {
    for (const c of controls(l)) {
      expect(c.r.width, c.name).toBeGreaterThanOrEqual(MIN_TARGET);
      expect(c.r.height, c.name).toBeGreaterThanOrEqual(MIN_TARGET);
    }
    expect(l.tiles).toHaveLength(11);
  });

  it("keeps controls inside the frame, within adult reach, and apart", () => {
    const top = reachTop(kind).adult;
    const list = controls(l);
    for (const c of list) {
      expect(c.r.x, c.name).toBeGreaterThanOrEqual(0);
      expect(c.r.y, c.name).toBeGreaterThanOrEqual(top - 1);
      expect(c.r.x + c.r.width, c.name).toBeLessThanOrEqual(l.width + 1e-6);
      expect(c.r.y + c.r.height, c.name).toBeLessThanOrEqual(l.height + 1e-6);
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        expect(overlap(list[i]!.r, list[j]!.r), `${list[i]!.name} and ${list[j]!.name}`).toBe(
          false,
        );
      }
    }
  });

  it("puts the children's controls (tiles, near, far, glasses) in the children's band", () => {
    const child = reachTop(kind).child;
    const low = [...l.tiles, l.buttons.near!, l.buttons.far!, l.buttons.corrA!, l.buttons.corrB!];
    for (const r of low) expect(r.y).toBeGreaterThanOrEqual(child - 1);
  });

  it("keeps the card, the views and the eye from overlapping the controls", () => {
    for (const c of controls(l)) {
      if (c.name === "more") continue;
      expect(overlap(c.r, l.card), `${c.name} on the card`).toBe(false);
      for (const v of l.views) expect(overlap(c.r, v.rect), `${c.name} on a view`).toBe(false);
      if (l.viewCaption)
        expect(overlap(c.r, l.viewCaption), `${c.name} on the view caption`).toBe(false);
      // "Only this part" sits in the eye's corner on purpose.
      if (c.name !== "only") {
        expect(overlap(c.r, l.eye) && kind !== "wall", `${c.name} on the eye`).toBe(false);
      }
    }
  });

  it("fits every caption line in the card and every view line under the view", () => {
    const pad = { x: l.text.caption * 0.8 * 2, y: l.text.caption * 0.55 * 2 };
    const box = { width: l.card.width - pad.x, height: l.card.height - pad.y };
    const titles = [
      ...PARTS.map((p) => p.name),
      ...CONDITIONS.map((c) => c.name),
      "Reading glasses",
    ];
    const longest = titles.reduce((a, b) => (b.length > a.length ? b : a));
    for (const line of allLines()) {
      const size = fitSize(box, line.text, l.text.caption, l.text.min, {
        text: longest,
        scale: 1.32,
      });
      expect(size, line.text).not.toBeNull();
    }
    if (l.viewCaption) {
      const vbox = { width: l.viewCaption.width - l.text.view * 0.8, height: l.viewCaption.height };
      const lines = CONDITIONS.flatMap((c) => (c.view ? [c.view.main, ...c.view.more] : []));
      for (const line of lines)
        expect(fitSize(vbox, line.text, l.text.view, l.text.min), line.text).not.toBeNull();
    }
  });

  it("fits every button, tile and chip label at or above the smallest size", () => {
    const fitsIn = (text: string, w: number, h: number, px: number) => {
      const words = text.split(" ");
      if (Math.max(...words.map((x) => x.length)) * px * GLYPH > w) return false;
      return wrapCount(text, w, px) * px * 1.05 <= h;
    };
    const labels = [
      "Near",
      "Far",
      "Glasses",
      "Contact lens",
      "Reading glasses",
      "New lens",
      "Hard lens",
      "What they notice",
      "Eye test map",
      "Deutan",
      "Protan",
      "Next part",
      "Previous part",
      "Only this part",
      "Show all",
    ];
    for (const [id, r] of Object.entries(l.buttons)) {
      // Without its icon if need be; the padding is 10 venue px a side.
      const w = r!.width - 20;
      for (const text of labels) {
        expect(fitsIn(text, w, r!.height - 6, l.text.min), `${id}: ${text}`).toBe(true);
      }
    }
    const tile = l.tiles[0]!;
    const iconSize = Math.min(tile.height * 0.5, tile.width * 0.55);
    for (const c of CONDITIONS) {
      expect(
        fitsIn(c.tile, tile.width - 12, tile.height - iconSize - 14, l.text.min * 0.85),
        c.tile,
      ).toBe(true);
    }
    for (const chip of l.chips) {
      for (const p of PARTS)
        expect(fitsIn(p.name, chip.width - 24, chip.height, l.text.min * 0.85), p.name).toBe(true);
    }
  });

  it("has a view on its own, two side by side on the wall, none under a screen", () => {
    if (l.views.length === 0) expect(l.viewCaption).toBeNull();
    if (kind === "wall") {
      expect(l.views.map((v) => v.label)).toEqual(["Typical eye", "This eye"]);
      expect(l.chips).toHaveLength(21);
    }
  });

  it("finds each control by touch, and sliders give back their value", () => {
    const shown = {
      sliders: l.sliderSlots.length,
      buttons: new Set(Object.keys(l.buttons) as ButtonId[]),
      more: true,
    };
    l.tiles.forEach((r, i) => {
      expect(hitAt(l, r.x + r.width / 2, r.y + r.height / 2, shown)).toEqual({
        kind: "tile",
        index: i,
      });
    });
    const s = l.sliderSlots[0]!;
    expect(hitAt(l, s.x + 5, s.y + s.height / 2, shown)).toEqual({ kind: "slider", slot: 0 });
    for (const v of [0, 0.25, 0.8, 1]) expect(sliderValue(s, sliderX(s, v))).toBeCloseTo(v, 9);
    expect(hitAt(l, l.eye.x + l.eye.width / 2, l.eye.y + 30, shown)).toEqual({ kind: "eye" });
  });
});

describe("the pair's seam", () => {
  it("keeps controls a fifth of the width away from it", () => {
    for (const screenUp of [false, true]) {
      const l = layoutFor({
        kind: "pair",
        width: 2160,
        height: 1920,
        reachTop: reachTop("pair"),
        screenUp,
      });
      const seam = 1080;
      for (const c of controls(l)) {
        const d = Math.max(c.r.x - seam, seam - (c.r.x + c.r.width));
        expect(d, c.name).toBeGreaterThanOrEqual(2160 * SEAM_SHARE - 1e-6);
      }
    }
  });
});

describe("sliders", () => {
  it("show the strength slider only for conditions with a strength", () => {
    expect(slidersFor("myopia", 4)).toEqual(["length", "radius", "age", "light"]);
    expect(slidersFor("astigmatism", 4)[0]).toBe("strength");
    expect(slidersFor("cataract", 6)).toContain("strength");
    expect(slidersFor("typical", 6)).not.toContain("strength");
  });

  it("scale a layout uniformly for a frame of another size", () => {
    const l = layoutFor({
      kind: "panel",
      width: 1080,
      height: 2100,
      reachTop: { adult: 0, child: 1200 },
      screenUp: false,
    });
    expect(l.height).toBe(2100);
    expect(l.tiles[0]!.width).toBeGreaterThan(100);
  });
});
