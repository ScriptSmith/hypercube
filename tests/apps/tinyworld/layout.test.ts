import { describe, expect, it } from "vitest";
import { contains, overlaps } from "../../../src/apps/tinyworld/config";
import {
  columnsFor,
  hitWidget,
  homeReserve,
  homeWidgets,
  layoutWidget,
  metrics,
  MIN_CONTROL,
  MIN_SWATCH,
  minScale,
  nearestWidget,
  resizeTo,
  swatchSize,
  type WidgetSpec,
} from "../../../src/apps/tinyworld/layout";
import { paletteFor } from "../../../src/apps/tinyworld/swatches";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import { createRng } from "../../../src/core/rng";
import type { FrameKind } from "../../../src/core/types";

const KINDS: FrameKind[] = ["wall", "panel", "pair"];
const SETS = [
  paletteFor("sandbox", "full"),
  paletteFor("sandbox", "child"),
  paletteFor("delta", "full"),
];
const specFor = (kind: FrameKind, palette = SETS[0]!): WidgetSpec => ({
  palette,
  cols: columnsFor(kind),
  size: swatchSize(kind),
});

describe("tinyworld palette widgets", () => {
  for (const kind of KINDS) {
    const { width: W, height: H } = VENUE_SIZE[kind];
    const reach = DEFAULT_REACH[kind];
    const adultTop = H * (1 - reach.adult);
    const childTop = H * (1 - reach.child);

    describe(kind, () => {
      it("starts each widget fully inside its room with every choice reachable by page", () => {
        for (const palette of SETS) {
          const spec = specFor(kind, palette);
          for (const { state, room } of homeWidgets(kind, VENUE_SIZE[kind], reach, spec)) {
            const { layout } = layoutWidget(spec, state, room);
            expect(layout.box.x).toBeGreaterThanOrEqual(room.minX - 0.01);
            expect(layout.box.x + layout.box.width).toBeLessThanOrEqual(room.maxX + 0.01);
            expect(layout.box.y).toBeGreaterThanOrEqual(adultTop - 0.01);
            expect(layout.box.y + layout.box.height).toBeLessThanOrEqual(H);
            const tabs = layout.parts.filter((p) => p.type === "tab");
            expect(tabs).toHaveLength(palette.pages.length > 1 ? palette.pages.length : 0);
          }
        }
      });

      it("keeps controls big enough and inside the widget, whatever the moves and sizes", () => {
        const rng = createRng(`widget-${kind}`);
        for (const palette of SETS) {
          const spec = specFor(kind, palette);
          for (const home of homeWidgets(kind, VENUE_SIZE[kind], reach, spec)) {
            let state = home.state;
            for (let i = 0; i < 60; i++) {
              state = {
                ...state,
                x: state.x + rng.range(-900, 900),
                bottom: state.bottom + rng.range(-900, 900),
                scale: rng.range(0.3, 2.5),
                page: rng.int(palette.pages.length),
              };
              const res = layoutWidget(spec, state, home.room);
              state = res.state;
              const l = res.layout;
              // Inside the frame, adult reach, its own room (so never across a pair's seam).
              expect(l.box.x).toBeGreaterThanOrEqual(home.room.minX - 0.01);
              expect(l.box.x + l.box.width).toBeLessThanOrEqual(home.room.maxX + 0.01);
              expect(l.box.y).toBeGreaterThanOrEqual(adultTop - 0.01);
              expect(l.box.y + l.box.height).toBeLessThanOrEqual(H + 0.01);
              for (const p of l.parts) {
                const min = p.type === "swatch" ? MIN_SWATCH : MIN_CONTROL;
                expect(Math.min(p.box.width, p.box.height)).toBeGreaterThanOrEqual(min - 0.01);
                expect(contains(l.box, p.box.x + 1, p.box.y + 1)).toBe(true);
              }
              // Fire, lava and acid stay above children's reach.
              for (const s of l.swatches) {
                if (s.swatch.danger) expect(s.box.y + s.box.height / 2).toBeLessThan(childTop);
              }
              // Never over the square kept for the runtime's Home control.
              const reserve = homeReserve(kind, VENUE_SIZE[kind], reach);
              if (reserve) expect(overlaps(l.box, reserve)).toBe(false);
              // Parts never overlap one another.
              const boxes = [...l.parts.map((p) => p.box), l.reset];
              for (let a = 0; a < boxes.length; a++) {
                for (let b = a + 1; b < boxes.length; b++)
                  expect(overlaps(boxes[a]!, boxes[b]!)).toBe(false);
              }
            }
          }
        }
      });

      it("puts sand, water and seeds within children's reach at home", () => {
        const spec = specFor(kind);
        const [home] = homeWidgets(kind, VENUE_SIZE[kind], reach, spec);
        const { layout } = layoutWidget(spec, home!.state, home!.room);
        for (const s of layout.swatches) {
          if (["sand", "water", "seed"].includes(s.swatch.id)) {
            expect(s.box.y + s.box.height / 2).toBeGreaterThan(childTop);
          }
        }
        expect(W).toBeGreaterThan(0);
      });
    });
  }

  it("keeps a pair's widgets a tenth of the width clear of the seam", () => {
    const { width: W } = VENUE_SIZE.pair;
    const spec = specFor("pair");
    const homes = homeWidgets("pair", VENUE_SIZE.pair, DEFAULT_REACH.pair, spec);
    expect(homes[0]!.room.maxX).toBeLessThanOrEqual(W / 2 - W * 0.1);
    expect(homes[1]!.room.minX).toBeGreaterThanOrEqual(W / 2 + W * 0.1);
    // Dragged hard towards the seam, they stop short.
    const left = layoutWidget(spec, { ...homes[0]!.state, x: 5000 }, homes[0]!.room).layout;
    const right = layoutWidget(spec, { ...homes[1]!.state, x: -5000 }, homes[1]!.room).layout;
    expect(left.box.x + left.box.width).toBeLessThanOrEqual(W / 2 - W * 0.1 + 0.01);
    expect(right.box.x).toBeGreaterThanOrEqual(W / 2 + W * 0.1 - 0.01);
  });

  it("finds parts under a finger and leaves the gaps to the world", () => {
    const spec = specFor("wall");
    const [home] = homeWidgets("wall", VENUE_SIZE.wall, DEFAULT_REACH.wall, spec);
    const { layout } = layoutWidget(spec, home!.state, home!.room);
    const sw = layout.swatches[0]!;
    expect(hitWidget(layout, sw.box.x + 5, sw.box.y + 5)?.type).toBe("swatch");
    const next = layout.swatches[1]!;
    const gapX = (sw.box.x + sw.box.width + next.box.x) / 2;
    expect(hitWidget(layout, gapX, sw.box.y + sw.box.height / 2)).toBeNull();
    expect(hitWidget(layout, -100, -100)).toBeNull();
  });

  it("grows from its anchored corner when resized, and switches pages without changing size", () => {
    const spec = specFor("wall");
    const [left, right] = homeWidgets("wall", VENUE_SIZE.wall, DEFAULT_REACH.wall, spec);
    const a = layoutWidget(spec, left!.state, left!.room);
    const corner = a.layout.parts.find((p) => p.type === "resize")!.box;
    const from = { scale: a.state.scale, x: corner.x, y: corner.y };
    // The first move goes nowhere: no jump.
    expect(resizeTo(spec, a.state, from, corner.x, corner.y).scale).toBeCloseTo(a.state.scale);
    const grown = layoutWidget(
      spec,
      resizeTo(spec, a.state, from, corner.x + 200, corner.y - 150),
      left!.room,
    );
    expect(grown.layout.scale).toBeGreaterThan(a.layout.scale);
    expect(grown.layout.box.x).toBeCloseTo(a.layout.box.x);
    expect(grown.layout.box.y + grown.layout.box.height).toBeCloseTo(
      a.layout.box.y + a.layout.box.height,
    );
    const b = layoutWidget(spec, right!.state, right!.room);
    const cornerB = b.layout.parts.find((p) => p.type === "resize")!.box;
    const fromB = { scale: b.state.scale, x: cornerB.x, y: cornerB.y };
    const grownRight = layoutWidget(
      spec,
      resizeTo(spec, b.state, fromB, cornerB.x - 300, cornerB.y),
      right!.room,
    );
    expect(grownRight.layout.scale).toBeGreaterThan(b.layout.scale);
    expect(grownRight.layout.box.x + grownRight.layout.box.width).toBeCloseTo(
      b.layout.box.x + b.layout.box.width,
    );
    const shrunk = layoutWidget(spec, { ...a.state, scale: 0.1 }, left!.room);
    expect(shrunk.layout.scale).toBeCloseTo(minScale(spec));
    const page2 = layoutWidget(spec, { ...a.state, page: 2 }, left!.room);
    expect(page2.layout.box).toEqual(a.layout.box);
    expect(page2.layout.swatches.map((s) => s.swatch.id)).toContain("geyser");
  });

  it("assigns positions to the nearest widget's side", () => {
    const spec = specFor("wall");
    const layouts = homeWidgets("wall", VENUE_SIZE.wall, DEFAULT_REACH.wall, spec).map(
      (h) => layoutWidget(spec, h.state, h.room).layout,
    );
    expect(nearestWidget(layouts, 500)).toBe(0);
    expect(nearestWidget(layouts, 6000)).toBe(1);
    expect(metrics(spec).bar).toBeGreaterThanOrEqual(MIN_CONTROL);
  });

  it("keeps the Home square inside the reach band and the frame, clear of a pair's seam", () => {
    for (const kind of KINDS) {
      const { width: W, height: H } = VENUE_SIZE[kind];
      const r = homeReserve(kind, VENUE_SIZE[kind], DEFAULT_REACH[kind])!;
      expect(r.width).toBeGreaterThanOrEqual(kind === "wall" ? 160 : 120);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(W);
      expect(r.y).toBeGreaterThanOrEqual(H * (1 - DEFAULT_REACH[kind].adult));
      if (kind === "pair") expect(r.x).toBeGreaterThan(W / 2 + W * 0.1);
    }
  });
});
