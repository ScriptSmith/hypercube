import { describe, expect, it } from "vitest";
import { DEG, TAU } from "../../../src/apps/trig/config";
import {
  angleAbout,
  graphTheta,
  graphX,
  grabOf,
  hitAt,
  type Layout,
  lerpPic,
  MIN_TARGET,
  type Pic,
  pointAt,
  ringOf,
  SEAM_SHARE,
} from "../../../src/apps/trig/layout";
import type { FrameKind, Rect } from "../../../src/core/types";
import { layoutOf, reachTop, SIZES } from "./helpers";

interface Case {
  name: string;
  kind: FrameKind;
  l: Layout;
}

const cases: Case[] = [];
for (const kind of ["panel", "pair", "wall", "kiosk"] as const) {
  for (const steps of [false, true]) {
    for (const bank of kind === "panel" || kind === "pair" ? [false, true] : [false]) {
      cases.push({
        name: `${bank ? "bank" : "solo"} ${kind}${steps ? " steps" : ""}`,
        kind,
        l: layoutOf(kind, { steps, bank }),
      });
    }
  }
}
const screens = [false, true].map((bank) => ({
  name: `${bank ? "bank" : "lone"} screen`,
  l: layoutOf("screen", { bank }),
}));

/** The controls on show together: "Show me" and Back and Next take turns in one place. */
const controls = (l: Layout, stepping: boolean): { name: string; r: Rect }[] => [
  ...(l.wheel
    ? [
        {
          name: "wheel",
          r: {
            x: l.wheel.x - l.wheel.r,
            y: l.wheel.y - l.wheel.r,
            width: 2 * l.wheel.r,
            height: 2 * l.wheel.r,
          },
        },
      ]
    : []),
  ...l.toggles.map((t) => ({ name: t.fn, r: t.rect })),
  ...(l.walk && !stepping ? [{ name: "walk", r: l.walk }] : []),
  ...(l.back && stepping ? [{ name: "back", r: l.back }] : []),
  ...(l.next && stepping ? [{ name: "next", r: l.next }] : []),
];

const allControls = (l: Layout) => [
  ...controls(l, false),
  ...controls(l, true).filter((c) => c.name === "back" || c.name === "next"),
];

const overlap = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height + gap &&
  b.y < a.y + a.height + gap;

const inside = (r: Rect, w: number, h: number) =>
  r.x >= 0 && r.y >= 0 && r.x + r.width <= w + 1e-6 && r.y + r.height <= h + 1e-6;

const ringBox = (p: Pic): Rect => {
  const o = ringOf(p).outer;
  return { x: p.cx - o, y: p.cy - o, width: 2 * o, height: 2 * o };
};

describe("trig layout", () => {
  it.each(cases)("$name: controls are big enough, inside the frame and apart", ({ l }) => {
    // `steps` never shows everything, so it has no "Show me".
    for (const stepping of l.walk ? [false, true] : [true]) {
      const cs = controls(l, stepping);
      expect(cs.length).toBeGreaterThanOrEqual(5);
      for (const c of cs) {
        expect(Math.min(c.r.width, c.r.height), c.name).toBeGreaterThanOrEqual(MIN_TARGET);
        expect(inside(c.r, l.width, l.height), c.name).toBe(true);
      }
      for (let i = 0; i < cs.length; i++) {
        for (let j = i + 1; j < cs.length; j++) {
          expect(overlap(cs[i]!.r, cs[j]!.r, 8), `${cs[i]!.name} and ${cs[j]!.name}`).toBe(false);
        }
      }
    }
  });

  it.each(cases)("$name: every frame with buttons can step through the walk-through", ({ l }) => {
    if (!l.touch) return;
    expect(l.back).not.toBeNull();
    expect(l.next).not.toBeNull();
    expect(l.dots).not.toBeNull();
  });

  it.each(cases)(
    "$name: controls keep off the circle, the graph's curves and the text",
    ({ l }) => {
      const p = l.pic;
      const curves: Rect = { x: p.x0, y: p.cy - p.r, width: p.x1 - p.x0, height: 2 * p.r };
      for (const c of allControls(l)) {
        for (const pic of [l.pic, l.zoom!, l.zoomArc!]) {
          expect(overlap(c.r, ringBox(pic)), `${c.name} on the circle`).toBe(false);
        }
        if (l.readoutZoom) {
          expect(overlap(c.r, l.readoutZoom), `${c.name} on the readout`).toBe(false);
        }
        expect(overlap(c.r, curves), `${c.name} on the curves`).toBe(false);
        expect(overlap(c.r, l.readout), `${c.name} on the readout`).toBe(false);
        expect(overlap(c.r, l.caption), `${c.name} on the caption`).toBe(false);
      }
    },
  );

  it.each(cases)(
    "$name: the wheel, toggles and buttons are in the children's band",
    ({ kind, l }) => {
      const child = reachTop(kind).child;
      for (const c of allControls(l)) expect(c.r.y, c.name).toBeGreaterThanOrEqual(child - 1);
    },
  );

  it.each(cases)("$name: the picture fits the frame, and its zoom too", ({ l }) => {
    for (const p of [l.pic, l.zoom!, l.zoomArc!]) {
      expect(p.cx - p.r).toBeGreaterThanOrEqual(0);
      expect(p.cy - p.r).toBeGreaterThanOrEqual(0);
      expect(p.cy + p.r).toBeLessThanOrEqual(l.height);
      expect(p.x0).toBeLessThan(l.width);
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.right).toBeLessThanOrEqual(l.width);
      expect(p.bottom).toBeLessThanOrEqual(l.height);
      expect(p.s).toBeLessThanOrEqual(p.r + 1e-9);
    }
    expect(l.pic.x1).toBeLessThanOrEqual(l.pic.right);
    // The zoom is used before the waves: there the arc unrolls at its true length.
    expect(l.zoom!.s).toBe(l.zoom!.r);
    expect(l.zoom!.r).toBeGreaterThan(l.pic.r * 1.2);
    expect(l.zoomArc!.s).toBe(l.zoomArc!.r);
    // The arc step leaves room along the axis for at least half a turn unrolled.
    expect(l.zoomArc!.right - l.zoomArc!.x0).toBeGreaterThan(Math.PI * l.zoomArc!.r * 0.85);
    if (l.readoutZoom) {
      expect(inside(l.readoutZoom, l.width, l.height)).toBe(true);
      // Clear of the zoomed circle, and below the axis the arc lies down along.
      for (const z of [l.zoom!, l.zoomArc!]) {
        expect(overlap(l.readoutZoom, ringBox(z))).toBe(false);
        expect(l.readoutZoom.y).toBeGreaterThan(z.cy);
      }
    }
    expect(inside(l.readout, l.width, l.height)).toBe(true);
    expect(inside(l.caption, l.width, l.height)).toBe(true);
  });

  it("unrolls the arc at its true length on walls, kiosks and screens", () => {
    for (const l of [layoutOf("wall"), layoutOf("kiosk"), ...screens.map((s) => s.l)]) {
      expect(l.pic.s).toBe(l.pic.r);
    }
    // Panels and pairs fit a whole turn by squeezing the graph along.
    expect(layoutOf("panel").pic.s).toBeLessThan(layoutOf("panel").pic.r);
    expect(layoutOf("pair").pic.s).toBeLessThan(layoutOf("pair").pic.r);
  });

  it("puts the wall's circle centre at the top of adult reach, so its lower half and the waves' are reachable", () => {
    const l = layoutOf("wall");
    const adult = reachTop("wall").adult;
    for (const p of [l.pic, l.zoom!]) {
      expect(p.cy).toBeGreaterThanOrEqual(adult);
      expect(p.cy).toBeLessThan(adult + p.r * 0.25);
    }
    // The graph's lower half is in reach.
    expect(l.graph.y + l.graph.height).toBeGreaterThan(l.pic.cy + l.pic.r);
  });

  it("keeps a pair's controls a fifth of the width from the seam", () => {
    // So two fingers on opposite sides are never close enough to the seam to be dropped.
    for (const steps of [false, true]) {
      for (const bank of [false, true]) {
        const l = layoutOf("pair", { steps, bank });
        const seam = l.width / 2;
        const margin = l.width * SEAM_SHARE;
        for (const c of allControls(l)) {
          const left = c.r.x + c.r.width <= seam - margin;
          const right = c.r.x >= seam + margin;
          expect(left || right, c.name).toBe(true);
        }
      }
    }
  });

  it.each(screens)("$name: is a picture with no controls", ({ l }) => {
    expect(allControls(l)).toEqual([]);
    expect(l.touch).toBe(false);
    expect(hitAt(l, l.pic, 0, l.pic.cx, l.pic.cy)).toBeNull();
  });

  it("gives the bank screen a row of beads below the picture, and the lone screen none", () => {
    const [lone, bank] = screens.map((s) => s.l);
    expect(lone!.beads).toBeNull();
    const b = bank!.beads!;
    expect(b.y - b.amp - b.r).toBeGreaterThan(bank!.pic.bottom);
    expect(b.y + b.amp + b.r).toBeLessThanOrEqual(bank!.height);
  });

  it("marks bank frames with a strip along the top edge, and solo frames not", () => {
    expect(layoutOf("panel", { bank: true }).strip).toMatchObject({ x: 0, y: 0, width: 1080 });
    expect(layoutOf("panel").strip).toBeNull();
  });

  it("finds a free spot for the runtime's Home control", () => {
    for (const { l } of cases) {
      const home: Rect = { x: l.home.x, y: l.home.y, width: 160, height: 160 };
      expect(inside(home, l.width, l.height)).toBe(true);
      for (const c of allControls(l)) expect(overlap(home, c.r), c.name).toBe(false);
      if (l.dots) {
        const n = 7;
        const span = (n - 1) * l.dots.gap + 2 * l.dots.r;
        const row: Rect = {
          x: l.dots.x - span / 2,
          y: l.dots.y - l.dots.r,
          width: span,
          height: 2 * l.dots.r,
        };
        expect(overlap(home, row), `${l.kind}: Home on the step dots`).toBe(false);
      }
    }
  });

  it("stays inside frames of other sizes, centred and kept to the bottom", () => {
    for (const [kind, w, h] of [
      ["panel", 1200, 2000],
      ["wall", 7000, 2600],
      ["kiosk", 2000, 1125],
    ] as const) {
      const l = layoutOf(kind, { width: w, height: h });
      for (const c of allControls(l)) expect(inside(c.r, w, h), `${kind} ${c.name}`).toBe(true);
      // Kept to the bottom edge: the wheel is as far above it as on the venue size.
      const base = layoutOf(kind);
      expect(h - l.wheel!.y).toBeCloseTo(SIZES[kind][1] - base.wheel!.y, 9);
      expect(l.pic.cx - w / 2).toBeCloseTo(base.pic.cx - SIZES[kind][0] / 2, 9);
    }
  });
});

describe("trig picture geometry", () => {
  it("maps angles to the point, the graph and back", () => {
    const p = layoutOf("panel").pic;
    for (const d of [0, 30, 90, 135, 200, 270, 359]) {
      const a = d * DEG;
      const pt = pointAt(p, a);
      expect(angleAbout(p.cx, p.cy, pt.x, pt.y)).toBeCloseTo(a, 9);
      expect(graphTheta(p, graphX(p, a))).toBeCloseTo(a, 9);
    }
    expect(graphTheta(p, p.x0 - 50)).toBe(0);
    expect(graphTheta(p, p.x1 + 50)).toBe(TAU);
  });

  it("puts the graph's origin on the circle at (1, 0), on the line x = 1", () => {
    for (const kind of ["panel", "pair", "wall", "kiosk", "screen"] as const) {
      const p = layoutOf(kind).pic;
      expect(p.x0).toBeCloseTo(pointAt(p, 0).x, 9);
      expect(p.x1).toBeCloseTo(p.x0 + TAU * p.s, 9);
    }
  });

  it("slides between the full picture and the zoom", () => {
    const l = layoutOf("wall");
    const half = lerpPic(l.pic, l.zoom!, 0.5);
    expect(half.r).toBeCloseTo((l.pic.r + l.zoom!.r) / 2, 9);
    expect(half.x0).toBeCloseTo(half.cx + half.r, 9);
    expect(lerpPic(l.pic, l.zoom!, 0)).toBe(l.pic);
    expect(lerpPic(l.pic, l.zoom!, 1)).toBe(l.zoom);
  });

  it("hit tests the wheel, the point, the ring and the graph", () => {
    const l = layoutOf("wall");
    const p = l.pic;
    const th = 300 * DEG;
    expect(hitAt(l, p, th, l.wheel!.x, l.wheel!.y)).toBe("wheel");
    const pt = pointAt(p, th);
    expect(hitAt(l, p, th, pt.x + grabOf(p) * 0.5, pt.y)).toBe("point");
    expect(hitAt(l, p, th, p.cx - p.r, p.cy)).toBe("ring");
    expect(hitAt(l, p, th, p.cx, p.cy + p.r * 0.6)).toBe("ring");
    expect(hitAt(l, p, th, graphX(p, 3), p.cy - p.r * 0.5)).toBe("graph");
    expect(hitAt(l, p, th, graphX(p, 3), p.cy, false)).toBeNull();
    // Right of the line x = 1 and off the circle, the graph owns the touch.
    expect(hitAt(l, p, th, p.x0 + 10, p.cy - p.r * 0.7)).toBe("graph");
    // The zoomed circle is hit where it is drawn.
    const z = l.zoom!;
    expect(hitAt(l, z, th, z.cx, z.cy + z.r)).toBe("ring");
    expect(hitAt(l, z, th, z.cx, z.cy + z.r, false)).toBe("ring");
  });
});
