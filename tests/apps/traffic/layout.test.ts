import { describe, expect, it } from "vitest";
import { CAR_PX } from "../../../src/apps/traffic/config";
import {
  frameLayout,
  type LayoutInput,
  loopLength,
  loopPoint,
  type Placement,
  ringLengthFor,
} from "../../../src/apps/traffic/layout";
import { CAR_LENGTH } from "../../../src/apps/traffic/model";
import type { FrameKind } from "../../../src/core/types";
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
    ...opts,
  };
};

const CASES: [string, LayoutInput][] = [
  ["lone panel", input("panel")],
  ["lone pair", input("pair")],
  ["wall", input("wall")],
  ["versus wall", input("wall", { versus: true })],
  ["bank panel", input("panel", { bank: { pos: 3, count: 6 } })],
  ["bank pair", input("pair", { bank: { pos: 1, count: 3 } })],
];

describe("traffic layout", () => {
  for (const [name, inp] of CASES) {
    it(`${name}: controls in the adults' band, big enough, clear of seams and of each other`, () => {
      const l = frameLayout(inp);
      const min = inp.kind === "wall" ? 200 : 140;
      const cells = l.controls.flatMap((g) =>
        g.cells.filter((_, i) => g.key !== "cars" || i !== 1),
      );
      expect(cells.length).toBeGreaterThan(0);
      for (const c of cells) {
        expect(c.width).toBeGreaterThanOrEqual(min);
        expect(c.height).toBeGreaterThanOrEqual(min);
        expect(c.y).toBeGreaterThanOrEqual(inp.reachTop.adult - 1);
        expect(c.y + c.height).toBeLessThanOrEqual(inp.reachTop.child + 1);
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x + c.width).toBeLessThanOrEqual(l.width);
        for (const s of inp.seams) {
          expect(Math.max(c.x - s, s - c.x - c.width)).toBeGreaterThanOrEqual(120);
        }
      }
      const plates = l.controls.map((g) => g.plate);
      for (let i = 0; i < plates.length; i++) {
        for (let j = i + 1; j < plates.length; j++) {
          const a = plates[i]!;
          const b = plates[j]!;
          const apart =
            a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y;
          expect(apart, `${l.controls[i]!.key} and ${l.controls[j]!.key}`).toBe(true);
        }
      }
      // Versus walls have no cars buttons (both rings keep the same cars).
      expect(l.controls.some((g) => g.key === "cars")).toBe(!inp.versus);
    });

    it(`${name}: the road is in the children's band, the diagram above it`, () => {
      const l = frameLayout(inp);
      expect(l.laneY).toBeGreaterThan(inp.reachTop.child);
      expect(l.laneY).toBeLessThan(l.height - 60);
      expect(l.diagram.y + l.diagram.height).toBeLessThanOrEqual(l.road.y + 1);
      expect(l.diagram.height).toBeGreaterThan(l.height * 0.25);
      expect(l.carPx).toBeGreaterThanOrEqual(110);
    });
  }

  it("a bank frame shows its share of the ring, joining its neighbours exactly", () => {
    const L = 243;
    const a = frameLayout(input("panel", { bank: { pos: 3, count: 6 } }));
    const b = frameLayout(input("panel", { bank: { pos: 4, count: 6 } }));
    const pa: Placement[] = [];
    const pb: Placement[] = [];
    // A car whose middle is on the edge between frames 3 and 4.
    const x = (4 * L) / 6 - CAR_LENGTH / 2;
    expect(a.path!.place(x, L, pa)).toBe(1);
    expect(b.path!.place(x, L, pb)).toBe(1);
    expect(pa[0]!.x).toBeCloseTo(1080);
    expect(pb[0]!.x).toBeCloseTo(0);
    expect(a.path!.pxPerM(L) * CAR_LENGTH).toBeCloseTo(CAR_PX, 0);
    // The last frame runs on into the first.
    const last = frameLayout(input("panel", { bank: { pos: 5, count: 6 } }));
    const first = frameLayout(input("panel", { bank: { pos: 0, count: 6 } }));
    const pl: Placement[] = [];
    const pf: Placement[] = [];
    last.path!.place(L - CAR_LENGTH / 2, L, pl);
    first.path!.place(L - CAR_LENGTH / 2, L, pf);
    expect(pl[0]!.x).toBeCloseTo(1080);
    expect(pf[0]!.x).toBeCloseTo(0);
  });

  it("a wall shows a car leaving the right edge coming back on the left", () => {
    const l = frameLayout(input("wall"));
    const L = ringLengthFor(input("wall"));
    const p: Placement[] = [];
    expect(l.path!.place(L - CAR_LENGTH / 2, L, p)).toBe(2);
    expect(p.map((q) => Math.round(q.x)).sort((x, y) => x - y)).toEqual([0, 5760]);
  });

  it("the loop is one closed path, the same length as the ring", () => {
    const inp = input("panel");
    const l = frameLayout(inp);
    const shape = l.loop!;
    const P = loopLength(shape);
    const pt = { x: 0, y: 0, angle: 0 };
    let prev = loopPoint(shape, 0, { x: 0, y: 0, angle: 0 });
    let total = 0;
    for (let s = 1; s <= P; s += 1) {
      loopPoint(shape, s, pt);
      total += Math.hypot(pt.x - prev.x, pt.y - prev.y);
      prev = { ...pt };
    }
    expect(total).toBeCloseTo(P, -1);
    expect(Math.hypot(prev.x - shape.xl, prev.y - (shape.yc + shape.r))).toBeLessThan(2);
    expect(ringLengthFor(inp) * (CAR_PX / CAR_LENGTH)).toBeCloseTo(P, 3);
    // Inside the frame, below the controls.
    expect(shape.xl - shape.r - 60).toBeGreaterThanOrEqual(0);
    expect(shape.xr + shape.r + 60).toBeLessThanOrEqual(l.width);
    expect(shape.yc + shape.r + 60).toBeLessThanOrEqual(l.height);
  });
});
