import { describe, expect, it } from "vitest";
import { computeGeometry, readConfig } from "../../../src/apps/tinyworld/config";
import { createControls, type WidgetHost } from "../../../src/apps/tinyworld/controls";
import { E } from "../../../src/apps/tinyworld/elements";
import {
  columnsFor,
  hitWidget,
  homeWidgets,
  layoutWidget,
  nearestWidget,
  resizeTo,
  swatchSize,
  type WidgetLayout,
  type WidgetSpec,
} from "../../../src/apps/tinyworld/layout";
import { createPieceSet, type Piece } from "../../../src/apps/tinyworld/pieces";
import { createHands } from "../../../src/apps/tinyworld/pour";
import { paletteFor } from "../../../src/apps/tinyworld/swatches";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";

/** The palette view's hit testing and state, without the DOM. */
const fakeWidgets = (spec: WidgetSpec) => {
  const homes = homeWidgets("wall", VENUE_SIZE.wall, DEFAULT_REACH.wall, spec);
  const states = homes.map((h) => h.state);
  const layouts: WidgetLayout[] = [];
  const relayout = (i: number) => {
    const r = layoutWidget(spec, states[i]!, homes[i]!.room);
    states[i] = r.state;
    layouts[i] = r.layout;
  };
  homes.forEach((_, i) => relayout(i));
  let drag: { scale: number; x: number; y: number } | null = null;
  const host: WidgetHost = {
    hit(x, y) {
      for (let i = 0; i < layouts.length; i++) {
        const part = hitWidget(layouts[i]!, x, y);
        if (part) return { widget: i, part };
      }
      return null;
    },
    moveBy(i, dx, dy) {
      states[i] = { ...states[i]!, x: states[i]!.x + dx, bottom: states[i]!.bottom + dy };
      relayout(i);
    },
    resizeTo(i, x0, y0, x, y) {
      if (!drag || drag.x !== x0 || drag.y !== y0) drag = { scale: states[i]!.scale, x: x0, y: y0 };
      states[i] = resizeTo(spec, states[i]!, drag, x, y);
      relayout(i);
    },
    setPage(i, page) {
      states[i] = { ...states[i]!, page };
      relayout(i);
    },
  };
  return { host, layouts, states };
};

const setup = (variant: "sandbox" | "delta" = "sandbox") => {
  const config = readConfig("wall", variant, {});
  const geometry = computeGeometry({ ...VENUE_SIZE.wall, unit: 1 }, config.cell);
  const spec: WidgetSpec = {
    palette: paletteFor(variant, "full"),
    cols: columnsFor("wall"),
    size: swatchSize("wall"),
  };
  const w = fakeWidgets(spec);
  const pieces = createPieceSet(
    {
      cap: 8,
      gap: 50,
      stack: 1.25,
      jitter: 0,
      bounds: { x: 0, y: 0, ...VENUE_SIZE.wall },
      keepOut: [],
    },
    "wall",
  );
  let t = 0;
  const hands = createHands({
    radius: 520,
    ttlMs: 60_000,
    max: 16,
    pickMs: 30_000,
    placeMs: 15_000,
    burst: 6,
    refill: 0.35,
    fallback: E.SAND,
    side: (x) => nearestWidget(w.layouts, x),
  });
  const stamps: { op: string; piece: Piece }[] = [];
  const tools: string[] = [];
  const removed: { x: number; y: number }[] = [];
  const controls = createControls({
    geometry,
    widgets: w.host,
    pieces,
    hands,
    movable: variant === "delta",
    rand: () => 0.5,
    now: () => t,
    stamp: (op, piece) => stamps.push({ op, piece }),
    placeTool: (kind) => tools.push(kind),
    tapPlaced: () => false,
    removeAt: (x, y) => removed.push({ x, y }),
    pressed: () => {},
  });
  /** Centre of a swatch in widget 0, opening its page first if needed. */
  const swatch = (id: string) => {
    const page = spec.palette.pages.findIndex((p) => p.swatches.some((s) => s.id === id));
    if (page >= 0) w.host.setPage(0, page);
    const s = w.layouts[0]!.swatches.find((x) => x.swatch.id === id)!;
    return { x: s.box.x + s.box.width / 2, y: s.box.y + s.box.height / 2 };
  };
  const emitted: { element: number; mode: number }[] = [];
  const emit = () => {
    emitted.length = 0;
    controls.emit(
      (_a, _b, _c, _d, _r, _chance, element, _life, mode = 0) => emitted.push({ element, mode }),
      1 / 60,
      24,
    );
    t += 16;
    return emitted;
  };
  const tap = (id: number, x: number, y: number) => {
    controls.down(id, x, y, false);
    controls.up(id, false);
  };
  return { controls, pieces, stamps, tools, removed, swatch, emit, tap, widgets: w, spec };
};

describe("tinyworld controls", () => {
  it("pours sand from a finger that lands in the world", () => {
    const s = setup();
    s.controls.down(1, 2000, 2000, false);
    expect(s.emit().map((e) => e.element)).toEqual([E.SAND]);
  });

  it("changes element with a plain tap on a swatch", () => {
    const s = setup();
    const w = s.swatch("water");
    s.tap(1, w.x, w.y);
    s.controls.down(2, 1500, 2000, false);
    expect(s.emit()[0]!.element).toBe(E.WATER);
  });

  // The round 2 bug, end to end: pour sand, tap water, pour again in the same place.
  it("changes element for a spot that was already pouring", () => {
    const s = setup();
    s.controls.down(1, 1500, 2000, false);
    s.emit();
    s.controls.up(1, false);
    const w = s.swatch("water");
    s.tap(2, w.x, w.y);
    s.controls.down(3, 1500, 2000, false);
    expect(s.emit()[0]!.element).toBe(E.WATER);
    s.controls.up(3, false);
    s.controls.down(4, 1500, 2000, false);
    expect(s.emit()[0]!.element).toBe(E.WATER);
  });

  it("drags an element out of its swatch and pours it", () => {
    const s = setup();
    const w = s.swatch("seed");
    s.controls.down(1, w.x, w.y, false);
    expect(s.emit()).toHaveLength(0);
    s.controls.move(1, 1500, 1900);
    expect(s.emit()[0]!.element).toBe(E.SEED);
  });

  it("pours into the world through a gap in the palette", () => {
    const s = setup();
    const l = s.widgets.layouts[0]!;
    const [a, b] = l.swatches;
    const gap = { x: (a!.box.x + a!.box.width + b!.box.x) / 2, y: a!.box.y + a!.box.height / 2 };
    s.controls.down(1, gap.x, gap.y, false);
    expect(s.emit()).toHaveLength(1);
  });

  it("changes page from a tab, and moves and resizes the widget by its handles", () => {
    const s = setup();
    const l0 = s.widgets.layouts[0]!;
    const tab = l0.parts.find((p) => p.type === "tab" && p.page === 2)!;
    s.tap(1, tab.box.x + 10, tab.box.y + 10);
    expect(s.widgets.layouts[0]!.swatches.some((x) => x.swatch.id === "geyser")).toBe(true);
    const grip = l0.parts.find((p) => p.type === "move")!;
    const before = s.widgets.layouts[0]!.box;
    s.controls.down(2, grip.box.x + 10, grip.box.y + 10, false);
    s.controls.move(2, grip.box.x + 410, grip.box.y - 30);
    s.controls.up(2, false);
    const moved = s.widgets.layouts[0]!.box;
    expect(moved.x).toBeCloseTo(before.x + 400);
    // The bottom follows the finger; the top moves less as the danger row needs less lift.
    expect(moved.y + moved.height).toBeCloseTo(before.y + before.height - 40);
    const corner = s.widgets.layouts[0]!.parts.find((p) => p.type === "resize")!;
    s.controls.down(3, corner.box.x + 5, corner.box.y + 5, false);
    s.controls.move(3, corner.box.x + 300, corner.box.y - 200);
    s.controls.up(3, false);
    expect(s.widgets.layouts[0]!.scale).toBeGreaterThan(1);
    // None of that poured anything.
    expect(s.emit()).toHaveLength(0);
  });

  it("places a piece where the finger lifts after a tap on its swatch, then pours again", () => {
    const s = setup();
    const b = s.swatch("block");
    s.tap(1, b.x, b.y);
    s.controls.down(2, 1500, 1800, false);
    expect(s.emit()).toHaveLength(0);
    s.controls.move(2, 1600, 1850);
    s.controls.up(2, false);
    expect(s.stamps.map((x) => x.op)).toEqual(["place"]);
    expect(s.pieces.list[0]!.x).toBeCloseTo(1600);
    s.controls.down(3, 1500, 2100, false);
    expect(s.emit()).toHaveLength(1);
  });

  it("carries a gadget or a beetle out of its swatch and drops it", () => {
    const s = setup();
    for (const id of ["geyser", "beetle"]) {
      const g = s.swatch(id);
      s.controls.down(9, g.x, g.y, false);
      s.controls.move(9, 2500, 2000);
      s.controls.up(9, false);
    }
    expect(s.tools).toEqual(["geyser", "beetle"]);
  });

  it("drops nothing when a placing touch is cancelled", () => {
    const s = setup();
    const b = s.swatch("bowl");
    s.controls.down(1, b.x, b.y, false);
    s.controls.move(1, 1500, 1900);
    s.controls.up(1, true);
    expect(s.pieces.list).toHaveLength(0);
  });

  it("moves barriers in the delta", () => {
    const s = setup("delta");
    const b = s.swatch("platform");
    s.controls.down(1, b.x, b.y, false);
    s.controls.move(1, 2500, 2000);
    s.controls.up(1, false);
    const placed = s.pieces.list[0]!;
    s.controls.down(2, placed.x, placed.y, false);
    expect(s.stamps.at(-1)?.op).toBe("remove");
    s.controls.move(2, 3000, 1900);
    s.controls.up(2, false);
    expect(s.stamps.at(-1)?.op).toBe("place");
    expect(s.pieces.list[0]!.x).toBeCloseTo(3000);
  });

  it("limits how many fingers it tracks", () => {
    const s = setup();
    for (let i = 0; i < 100; i++) s.controls.down(i, 1000 + i * 30, 2000, false);
    expect(s.controls.fingers.size).toBeLessThanOrEqual(40);
    expect(s.emit().length).toBeLessThanOrEqual(24);
  });

  it("removes with the Remove tool: erases matter and takes away what it touches", () => {
    const s = setup();
    const r = s.swatch("remove");
    s.tap(1, r.x, r.y);
    s.controls.down(2, 2500, 2000, false);
    s.controls.move(2, 2600, 2000);
    const out = s.emit();
    expect(out).toEqual([{ element: E.EMPTY, mode: 2 }]);
    expect(s.removed.length).toBeGreaterThanOrEqual(2);
  });
});
