import { describe, expect, it } from "vitest";
import { SNAP_PX, SPACING } from "../../../src/apps/traffic/config";
import { startCount } from "../../../src/apps/traffic/driver";
import {
  carNear,
  type CircleShape,
  circleLength,
  frameLayout,
  type FrameLayout,
  LANE_KERB,
  type LayoutInput,
  type Placement,
  ringLengthFor,
} from "../../../src/apps/traffic/layout";
import { CAR_LENGTH, createRing, jams, STEP_HZ, stepRing } from "../../../src/apps/traffic/model";
import type { FrameKind, Rect } from "../../../src/core/types";
import { displayFor, reachFor } from "../../../src/core/venue";

const input = (kind: FrameKind, opts: Partial<LayoutInput> = {}): LayoutInput => {
  const d = displayFor(kind, kind === "pair" ? 2 : 1);
  const r = reachFor(d);
  return {
    kind,
    width: d.width,
    height: d.height,
    reachTop: { adult: d.height * (1 - r.adult), child: d.height * (1 - r.child) },
    seams: kind === "pair" ? [d.width / 2] : [],
    bank: null,
    versus: false,
    road: "circle",
    ...opts,
  };
};

const CASES: [string, LayoutInput][] = [
  ["wall", input("wall")],
  ["versus wall", input("wall", { versus: true })],
  ["lone panel", input("panel")],
];

/** How far a rect is from the circle's centre, at its nearest point. */
const fromCentre = (c: CircleShape, r: Rect): number =>
  Math.hypot(
    Math.max(r.x - c.cx, 0, c.cx - r.x - r.width),
    Math.max(r.y - c.cy, 0, c.cy - r.y - r.height),
  );

/** The rect lies wholly outside the road (beyond its outer kerb). */
const offRoad = (c: CircleShape, r: Rect): boolean => fromCentre(c, r) >= c.r + c.lane * LANE_KERB;

const apart = (a: Rect, b: Rect) =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

const inside = (r: Rect, l: FrameLayout) =>
  r.x >= 0 && r.y >= 0 && r.x + r.width <= l.width && r.y + r.height <= l.height;

describe("traffic circle layout", () => {
  for (const [name, inp] of CASES) {
    it(`${name}: the circle is inside the frame and every car passes through reach`, () => {
      const l = frameLayout(inp);
      const c = l.circle!;
      expect(c).not.toBeNull();
      expect(l.path!.kind).toBe("circle");
      expect(inside(l.road, l)).toBe(true);
      // Its lowest arc is in the children's band, with room under the cars.
      expect(l.laneY).toBeCloseTo(c.cy + c.r, 6);
      expect(l.laneY).toBeGreaterThan(inp.reachTop.child + l.carW);
      expect(l.laneY + l.carW / 2).toBeLessThan(l.height - 40);
      // Its lower half is within adult reach.
      expect(c.cy).toBeGreaterThanOrEqual(inp.reachTop.adult);
      expect(l.carPx).toBeGreaterThanOrEqual(110);
    });

    it(`${name}: controls in the adults' band, big enough, apart, and off the circle`, () => {
      const l = frameLayout(inp);
      const c = l.circle!;
      const min = inp.kind === "wall" ? 200 : 140;
      const cells = l.controls.flatMap((g) =>
        g.cells.filter((_, i) => g.key !== "cars" || i !== 1),
      );
      expect(cells.length).toBeGreaterThan(0);
      for (const cell of cells) {
        expect(cell.width).toBeGreaterThanOrEqual(min);
        expect(cell.height).toBeGreaterThanOrEqual(min);
        expect(cell.y).toBeGreaterThanOrEqual(inp.reachTop.adult - 1);
        expect(cell.y + cell.height).toBeLessThanOrEqual(inp.reachTop.child + 1);
        expect(inside(cell, l)).toBe(true);
        for (const s of inp.seams) {
          expect(Math.max(cell.x - s, s - cell.x - cell.width)).toBeGreaterThanOrEqual(120);
        }
      }
      const plates = l.controls.map((g) => g.plate);
      for (const p of plates) expect(offRoad(c, p), "plate off the road").toBe(true);
      for (let i = 0; i < plates.length; i++) {
        for (let j = i + 1; j < plates.length; j++)
          expect(apart(plates[i]!, plates[j]!)).toBe(true);
      }
      expect(l.controls.some((g) => g.key === "cars")).toBe(!inp.versus);
    });

    it(`${name}: the diagram is beside or above the circle, not on it`, () => {
      const l = frameLayout(inp);
      expect(inside(l.diagram, l)).toBe(true);
      expect(offRoad(l.circle!, l.diagram)).toBe(true);
      expect(l.diagram.width).toBeGreaterThanOrEqual(900);
      expect(l.diagram.height).toBeGreaterThanOrEqual(inp.kind === "panel" ? 300 : 1000);
    });
  }

  it("wall: one large circle at the left, its centre at the top of adult reach", () => {
    const inp = input("wall");
    const l = frameLayout(inp);
    const c = l.circle!;
    expect(c.r).toBeGreaterThan(700);
    expect(c.cy - inp.reachTop.adult).toBeLessThan(1);
    // The top is high on the wall, for watching.
    expect(c.cy - c.r).toBeLessThan(inp.reachTop.adult - 600);
    expect(l.road.x + l.road.width).toBeLessThan(l.diagram.x);
  });

  it("wall: the circle holds enough cars at `many` to jam on its own", () => {
    const L = ringLengthFor(input("wall"));
    const n = startCount(L, SPACING.many);
    expect(n).toBeGreaterThanOrEqual(15);
    // Drawn cars are a little longer than to scale, but stopped at the closest gap the model
    // allows they still don't overlap.
    const l = frameLayout(input("wall"));
    expect(l.path!.pxPerM(L) * (CAR_LENGTH + 0.6)).toBeGreaterThanOrEqual(l.carPx - 0.5);
    let jammed = 0;
    for (const seed of [1, 2, 3, 4]) {
      const ring = createRing({ length: L, count: n, seed, noise: true });
      let secs = 0;
      for (let k = 0; k < 360 * STEP_HZ; k++) {
        stepRing(ring);
        if (k % STEP_HZ === 0 && jams(ring) > 0) secs++;
      }
      if (secs > 0) jammed++;
    }
    expect(jammed).toBeGreaterThanOrEqual(3);
  });

  it("versus wall: slowdown buttons in the children's band, off the circle and the plates", () => {
    const inp = input("wall", { versus: true });
    const l = frameLayout(inp);
    expect(l.slowdowns).toHaveLength(4);
    for (const b of l.slowdowns) {
      expect(b.width).toBeGreaterThanOrEqual(200);
      expect(b.y).toBeGreaterThanOrEqual(inp.reachTop.child);
      expect(inside(b, l)).toBe(true);
      expect(offRoad(l.circle!, b)).toBe(true);
      for (const g of l.controls) expect(apart(b, g.plate)).toBe(true);
    }
    for (let i = 1; i < l.slowdowns.length; i++) {
      expect(apart(l.slowdowns[i - 1]!, l.slowdowns[i]!)).toBe(true);
    }
    const board = l.board!;
    expect(inside(board, l)).toBe(true);
    expect(offRoad(l.circle!, board)).toBe(true);
    expect(board.y + board.height).toBeLessThanOrEqual(l.diagram.y);
  });

  it("pair: keeps the loop across both halves", () => {
    const inp = input("pair");
    const l = frameLayout(inp);
    expect(l.circle).toBeNull();
    expect(l.loop).not.toBeNull();
    const { path, ...rest } = l;
    const { path: p2, ...plain } = frameLayout({ ...inp, road: "straight" });
    expect(rest).toEqual(plain);
    expect(path!.kind).toBe("loop");
    void p2;
  });

  it("panel: the circle is as wide as the panel allows, below the diagram", () => {
    const l = frameLayout(input("panel"));
    const c = l.circle!;
    expect(c.cx).toBeCloseTo(l.width / 2, 6);
    expect(c.r).toBeGreaterThan(350);
    expect(l.diagram.y + l.diagram.height).toBeLessThanOrEqual(l.road.y);
    expect(ringLengthFor(input("panel")) * c.pxPerM).toBeCloseTo(circleLength(c), 6);
  });

  it("screen: the circle above the diagram, which still spans the whole width", () => {
    const inp = input("screen", { bank: { pos: 0, count: 6 }, reachTop: { adult: 0, child: 0 } });
    const l = frameLayout(inp);
    const c = l.circle!;
    expect(l.kind).toBe("screen");
    expect(inside(l.road, l)).toBe(true);
    expect(l.road.y + l.road.height).toBeLessThanOrEqual(l.diagram.y);
    expect(l.diagram).toEqual({ x: 0, y: l.diagram.y, width: l.width, height: l.diagram.height });
    expect(l.diagram.height).toBeGreaterThanOrEqual(l.height * 0.45);
    expect(c.cx).toBeCloseTo(l.width / 2, 6);
    expect(c.r).toBeGreaterThan(700);
    // The bank's ring, 26 cars at `many`, fits round it with room between them.
    const L = 405;
    expect(l.path!.pxPerM(L) * CAR_LENGTH * 26).toBeLessThan(circleLength(c) / 2);
  });

  it("bank stretches stay straight with the circle option", () => {
    for (const kind of ["panel", "pair"] as const) {
      const bank = { pos: 2, count: kind === "panel" ? 10 : 5 };
      const l = frameLayout(input(kind, { bank }));
      expect(l.kind).toBe("stretch");
      expect(l.circle).toBeNull();
      expect(l.path!.kind).toBe("line");
      const { path, ...rest } = l;
      const { path: p2, ...plain } = frameLayout(input(kind, { bank, road: "straight" }));
      expect(rest).toEqual(plain);
      void path;
      void p2;
    }
  });
});

describe("traffic circle path", () => {
  const place = (l: FrameLayout, f: number, L: number): Placement => {
    const out: Placement[] = [];
    expect(l.path!.place(f * L - CAR_LENGTH / 2, L, out)).toBe(1);
    return out[0]!;
  };

  for (const [name, inp] of CASES) {
    it(`${name}: cars go anticlockwise, from the top, along the bottom left to right`, () => {
      const l = frameLayout(inp);
      const c = l.circle!;
      const L = ringLengthFor(inp);
      const top = place(l, 0, L);
      const left = place(l, 0.25, L);
      const bottom = place(l, 0.5, L);
      const right = place(l, 0.75, L);
      expect([top.x, top.y]).toEqual([expect.closeTo(c.cx, 6), expect.closeTo(c.cy - c.r, 6)]);
      expect([left.x, left.y]).toEqual([expect.closeTo(c.cx - c.r, 6), expect.closeTo(c.cy, 6)]);
      expect([bottom.x, bottom.y]).toEqual([
        expect.closeTo(c.cx, 6),
        expect.closeTo(c.cy + c.r, 6),
      ]);
      expect([right.x, right.y]).toEqual([expect.closeTo(c.cx + c.r, 6), expect.closeTo(c.cy, 6)]);
      // Along the bottom, where children reach, cars drive to the right as on a straight road.
      expect(Math.cos(bottom.angle)).toBeCloseTo(1, 6);
      // Every car is on the lane and turned to the tangent, heading anticlockwise on screen.
      for (let f = 0; f < 1; f += 1 / 29) {
        const p = place(l, f, L);
        const rx = p.x - c.cx;
        const ry = p.y - c.cy;
        expect(Math.hypot(rx, ry)).toBeCloseTo(c.r, 6);
        const hx = Math.cos(p.angle);
        const hy = Math.sin(p.angle);
        expect(rx * hx + ry * hy).toBeCloseTo(0, 6);
        // y points down, so anticlockwise on screen is a negative cross product.
        expect(rx * hy - ry * hx).toBeLessThan(0);
      }
      // The ring's metres go once round.
      expect(l.path!.pxPerM(L) * L).toBeCloseTo(circleLength(c), 6);
      const a = place(l, 0.999, L);
      const b = place(l, 1.001, L);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(circleLength(c) * 0.003);
    });
  }
});

describe("traffic touches on the circle", () => {
  const carsAt = (l: FrameLayout, fs: number[], L: number) =>
    fs.map((f, id) => {
      const out: Placement[] = [];
      l.path!.place(f * L - CAR_LENGTH / 2, L, out);
      return { id, ...out[0]! };
    });

  /** A point `along` venue px round the lane from fraction f, `out` px outward from it. */
  const onArc = (c: CircleShape, f: number, along: number, out = 0) => {
    const t = 2 * Math.PI * f - Math.PI + along / c.r;
    return { x: c.cx + (c.r + out) * Math.sin(t), y: c.cy + (c.r + out) * Math.cos(t) };
  };

  for (const [name, inp] of CASES) {
    it(`${name}: a touch snaps to the nearest car along the arc`, () => {
      const l = frameLayout(inp);
      const c = l.circle!;
      const L = ringLengthFor(inp);
      // Cars at the bottom, one behind it with a 160 px gap between bumpers, and one at the top.
      const C = circleLength(c);
      const behind = 0.5 - (l.carPx + 160) / C;
      const cars = carsAt(l, [0.5, behind, 0.05], L);
      const near = (p: { x: number; y: number }) => carNear(cars, p.x, p.y, l.carPx, l.carW, c);
      // On the car, and on the lane a little ahead of and behind its bumpers.
      expect(near(onArc(c, 0.5, 0))).toBe(0);
      expect(near(onArc(c, 0.5, l.carPx / 2 + SNAP_PX - 10))).toBe(0);
      expect(near(onArc(c, 0.5, -(l.carPx / 2 + 40)))).toBe(0);
      // Out on the verge beside it, as a child reaching from below might.
      expect(near(onArc(c, 0.5, 0, l.carW / 2 + 100))).toBe(0);
      // Between two cars, the nearer one round the road.
      const mid = l.carPx / 2 + 80;
      expect(near(onArc(c, behind, mid - 30))).toBe(1);
      expect(near(onArc(c, behind, mid + 30))).toBe(0);
      // Nothing near: the middle of the circle, or far along the lane.
      expect(near({ x: c.cx, y: c.cy })).toBeNull();
      expect(near(onArc(c, 0.5, l.carPx / 2 + SNAP_PX + 20))).toBeNull();
      expect(near(onArc(c, 0.75, 0))).toBeNull();
    });
  }

  it("on a straight road a touch still snaps to the car's body as drawn", () => {
    const cars = [
      { id: 7, x: 500, y: 1000, angle: 0 },
      { id: 8, x: 900, y: 1000, angle: 0 },
    ];
    const near = (x: number, y: number) => carNear(cars, x, y, 120, 60, null);
    expect(near(500, 1000)).toBe(7);
    expect(near(500 + 60 + SNAP_PX - 5, 1000)).toBe(7);
    expect(near(500, 1000 + 30 + SNAP_PX - 5)).toBe(7);
    expect(near(500, 1000 + 30 + SNAP_PX + 5)).toBeNull();
    expect(near(760, 1000)).toBe(8);
    expect(near(200, 1300)).toBeNull();
  });
});

describe("traffic straight road", () => {
  const STRAIGHT: [string, LayoutInput][] = [
    ["lone panel", input("panel", { road: undefined })],
    ["lone pair", input("pair", { road: undefined })],
    ["wall", input("wall", { road: undefined })],
    ["versus wall", input("wall", { road: undefined, versus: true })],
    ["bank panel", input("panel", { road: undefined, bank: { pos: 3, count: 6 } })],
    ["screen", input("screen", { road: undefined, bank: { pos: 0, count: 6 } })],
  ];
  for (const [name, inp] of STRAIGHT) {
    it(`${name}: unchanged, the same as asking for a straight road`, () => {
      const a = frameLayout(inp);
      const b = frameLayout({ ...inp, road: "straight" });
      expect(a.circle).toBeNull();
      expect(a.ground).toBeNull();
      expect(a.path?.kind ?? null).not.toBe("circle");
      const { path: pa, ...ra } = a;
      const { path: pb, ...rb } = b;
      expect(ra).toEqual(rb);
      expect(ringLengthFor(inp)).toBe(ringLengthFor({ ...inp, road: "straight" }));
      void pa;
      void pb;
    });
  }

  it("keeps the numbers it had before the circle", () => {
    const wall = frameLayout(input("wall", { road: undefined }));
    expect(wall.laneY).toBe(1922);
    expect(wall.road).toEqual({ x: 0, y: 1827, width: 5760, height: 190 });
    expect(wall.diagram).toEqual({ x: 0, y: 0, width: 5760, height: 1827 });
    expect(ringLengthFor(input("wall", { road: undefined }))).toBeCloseTo((5760 / 130) * 4.5, 9);
    const panel = frameLayout(input("panel", { road: undefined }));
    expect(panel.kind).toBe("loop");
    expect(panel.loop).toEqual({ xl: 280, xr: 800, yc: 1525, r: 170 });
    const bank = frameLayout(input("panel", { road: undefined, bank: { pos: 3, count: 6 } }));
    expect(bank.laneY).toBe(1488);
    const screen = frameLayout(input("screen", { road: undefined, bank: { pos: 0, count: 6 } }));
    expect(screen.road).toEqual({ x: 0, y: 3474, width: 4000, height: 126 });
  });
});
