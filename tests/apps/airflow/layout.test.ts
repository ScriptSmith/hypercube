import { describe, expect, it } from "vitest";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import type { FrameKind } from "../../../src/core/types";
import { DISC_UNITS, KINDS } from "../../../src/apps/airflow/config";
import {
  apply,
  type Box,
  clampHandle,
  computeLayout,
  homeOf,
  knobAt,
  type Layout,
  SEAM_MARGIN,
  shapeAt,
  sliderBox,
  sliderPoint,
  sizeButtonsAt,
  sliderValue,
  type Sting,
  travelAt,
  travelOf,
} from "../../../src/apps/airflow/layout";
import { place, SHAPE_IDS, SHAPES } from "../../../src/apps/airflow/shapes";

const TOUCH = 120;

const make = (
  kind: FrameKind,
  extra: Partial<{ shapes: number; hands: boolean; coarse: number; span: number }> = {},
) =>
  computeLayout({
    kind,
    venue: VENUE_SIZE[kind],
    reach: DEFAULT_REACH[kind],
    shapes: extra.shapes ?? 3,
    coarse: extra.coarse ?? 1,
    span: extra.span ?? 2,
    hands: extra.hands ?? false,
  });

const CASES: [string, Layout][] = [
  ["wall 1", make("wall", { shapes: 1 })],
  ["wall 2", make("wall", { shapes: 2 })],
  ["wall 3", make("wall", { shapes: 3 })],
  ["wall 4", make("wall", { shapes: 4 })],
  ["kiosk", make("kiosk")],
  ["panel", make("panel")],
  ["pair", make("pair")],
  [
    "pair of three",
    computeLayout({
      kind: "pair",
      venue: { width: 3240, height: 1920 },
      reach: DEFAULT_REACH.pair,
      shapes: 3,
      coarse: 1,
      span: 3,
      hands: false,
    }),
  ],
  ["wall hands", make("wall", { hands: true })],
  ["panel coarse", make("panel", { coarse: 4 })],
  ["kiosk coarse", make("kiosk", { coarse: 4 })],
];

/** The handle's travel: its corners and points between, `n` steps each way. */
const sweep = (s: Sting, n = 8): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      out.push([
        s.travel.x0 + ((s.travel.x1 - s.travel.x0) * i) / n,
        s.travel.y0 + ((s.travel.y1 - s.travel.y0) * j) / n,
      ]);
    }
  }
  return out;
};

const square = (x: number, y: number, size: number): Box => ({
  x: x - size / 2,
  y: y - size / 2,
  width: size,
  height: size,
});

/** The controls that ride on a sting with its handle at (hx, hy). */
const riding = (s: Sting, hx: number, hy: number): { what: string; box: Box }[] => {
  const k = knobAt(s, hx, hy);
  const b = sizeButtonsAt(s, hx, hy);
  return [
    { what: `handle ${s.index}`, box: square(hx, hy, s.handle) },
    { what: `knob ${s.index}`, box: square(k.x, k.y, s.knob) },
    { what: `smaller ${s.index}`, box: b.smaller },
    { what: `bigger ${s.index}`, box: b.bigger },
  ];
};

/** Every control as a box, with what it is. */
const controls = (l: Layout): { what: string; box: Box }[] => {
  const out: { what: string; box: Box }[] = [];
  const sq = (x: number, y: number, size: number): Box => ({
    x: x - size / 2,
    y: y - size / 2,
    width: size,
    height: size,
  });
  for (const z of l.zones) {
    for (const v of z.views) out.push({ what: `view ${v.view}`, box: v.box });
    if (z.slider) {
      out.push({
        what: "slider gentle",
        box: sq(z.slider.from.x, z.slider.from.y, z.slider.thumb),
      });
      out.push({ what: "slider strong", box: sq(z.slider.to.x, z.slider.to.y, z.slider.thumb) });
    }
  }
  for (const s of l.stings) {
    for (const [hx, hy] of [
      [s.travel.x0, s.travel.y0],
      [s.travel.x1, s.travel.y0],
      [s.travel.x0, s.travel.y1],
      [s.travel.x1, s.travel.y1],
    ] as const) {
      out.push(...riding(s, hx, hy));
    }
    s.tiles.forEach((t, i) => out.push({ what: `tile ${s.index}.${i}`, box: t }));
  }
  return out;
};

const isRiding = (what: string) => /^(handle|knob|smaller|bigger) /.test(what);

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("airflow layout", () => {
  it.each(CASES)("%s: every control is big enough and inside the frame", (_, l) => {
    for (const c of controls(l)) {
      expect(Math.min(c.box.width, c.box.height), c.what).toBeGreaterThanOrEqual(TOUCH);
      expect(c.box.x, c.what).toBeGreaterThanOrEqual(0);
      expect(c.box.y, c.what).toBeGreaterThanOrEqual(0);
      expect(c.box.x + c.box.width, c.what).toBeLessThanOrEqual(l.venue.width);
      expect(c.box.y + c.box.height, c.what).toBeLessThanOrEqual(l.venue.height);
    }
  });

  it.each(CASES)("%s: nothing a visitor touches is within 120 px of a seam", (_, l) => {
    for (const seam of l.seams) {
      for (const c of controls(l)) {
        const gap = Math.max(c.box.x - seam, seam - (c.box.x + c.box.width));
        expect(gap, c.what).toBeGreaterThanOrEqual(SEAM_MARGIN);
      }
    }
  });

  it.each(CASES)(
    "%s: tiles, sliders and view buttons stay clear of a sting's handle, knob and size buttons",
    (_, l) => {
      const fixed = controls(l).filter((c) => !isRiding(c.what));
      for (const s of l.stings) {
        for (const [hx, hy] of sweep(s)) {
          const mine = riding(s, hx, hy);
          for (let a = 0; a < mine.length; a++) {
            for (let b = a + 1; b < mine.length; b++) {
              expect(
                overlaps(mine[a]!.box, mine[b]!.box),
                `${mine[a]!.what} on ${mine[b]!.what}`,
              ).toBe(false);
            }
            for (const c of fixed) {
              expect(overlaps(mine[a]!.box, c.box), `${mine[a]!.what} over ${c.what}`).toBe(false);
            }
          }
        }
      }
    },
  );

  it.each(CASES)("%s: one sting's controls never meet another's, wherever both are", (_, l) => {
    for (const a of l.stings) {
      for (const b of l.stings) {
        if (b.index <= a.index) continue;
        for (const [ax, ay] of sweep(a, 4)) {
          for (const [bx, by] of sweep(b, 4)) {
            for (const ca of riding(a, ax, ay)) {
              for (const cb of riding(b, bx, by)) {
                expect(overlaps(ca.box, cb.box), `${ca.what} on ${cb.what}`).toBe(false);
              }
            }
          }
        }
      }
    }
  });

  it.each(CASES)(
    "%s: at every size, every shape at any angle stays in its lane or chimney wherever its handle can go",
    (_, l) => {
      for (const s of l.stings) {
        const r = s.region;
        // The region is inside the tunnel, and a chimney's keeps clear of its seam's wall.
        const zone = l.zones[s.zone]!.rect;
        expect(r.x0).toBeGreaterThanOrEqual(zone.x);
        expect(r.x1).toBeLessThanOrEqual(zone.x + zone.width);
        if (l.seams.length > 0) {
          for (const seam of l.seams) {
            expect(Math.min(Math.abs(r.x0 - seam), Math.abs(r.x1 - seam))).toBeGreaterThan(
              l.tunnel.cell * 1.5,
            );
          }
        }
        for (const k of s.scales) {
          for (const id of SHAPE_IDS) {
            const t = travelOf(s, id, k);
            const where = `${id} at ${k}`;
            // Inside the usual range, and with room left to move.
            expect(t.x0, where).toBeGreaterThanOrEqual(s.travel.x0);
            expect(t.x1, where).toBeLessThanOrEqual(s.travel.x1);
            expect(t.y0, where).toBeGreaterThanOrEqual(s.travel.y0);
            expect(t.y1, where).toBeLessThanOrEqual(s.travel.y1);
            expect(t.x1 - t.x0, where).toBeGreaterThanOrEqual(s.handle / 2 - 1e-6);
            expect(t.y1 - t.y0, where).toBeGreaterThanOrEqual(s.handle / 2 - 1e-6);
            let x0 = Number.POSITIVE_INFINITY;
            let x1 = Number.NEGATIVE_INFINITY;
            let y0 = Number.POSITIVE_INFINITY;
            let y1 = Number.NEGATIVE_INFINITY;
            for (const [hx, hy] of [
              [t.x0, t.y0],
              [t.x1, t.y0],
              [t.x0, t.y1],
              [t.x1, t.y1],
            ] as const) {
              const p = shapeAt(s, hx, hy);
              for (let angle = 0; angle < 360; angle += 15) {
                for (const pt of SHAPES[id].outline) {
                  const [x, y] = place(pt, p.x, p.y, angle, s.size * k);
                  x0 = Math.min(x0, x);
                  x1 = Math.max(x1, x);
                  y0 = Math.min(y0, y);
                  y1 = Math.max(y1, y);
                }
              }
            }
            expect(x0, where).toBeGreaterThanOrEqual(r.x0 - 0.01);
            expect(x1, where).toBeLessThanOrEqual(r.x1 + 0.01);
            expect(y0, where).toBeGreaterThanOrEqual(r.y0 - 0.01);
            expect(y1, where).toBeLessThanOrEqual(r.y1 + 0.01);
          }
        }
      }
    },
  );

  it.each(CASES)("%s: neighbouring lanes never overlap, so neither do their shapes", (_, l) => {
    for (let i = 1; i < l.stings.length; i++) {
      const a = l.stings[i - 1]!;
      const b = l.stings[i]!;
      if (a.zone !== b.zone) continue;
      expect(a.region.x1).toBeLessThanOrEqual(b.region.x0 + 1e-9);
    }
  });

  it.each(CASES)(
    "%s: at the usual size the handle has its whole range, less a little at a lane's edge",
    (_, l) => {
      for (const s of l.stings) {
        expect(travelAt(s, 1, 0)).toEqual(s.travel);
        for (const id of SHAPE_IDS) {
          const t = travelOf(s, id, 1);
          // Only a lane boundary takes any, for the shapes that reach furthest.
          const most = id === "building" ? 30 : 8;
          expect(t.x0 - s.travel.x0, id).toBeLessThanOrEqual(most);
          expect(s.travel.x1 - t.x1, id).toBeLessThanOrEqual(most);
          expect(t.y0).toBe(s.travel.y0);
          expect(t.y1).toBe(s.travel.y1);
        }
      }
    },
  );

  it("gives the handles the ranges they had before shapes could change size", () => {
    const wall = make("wall", { shapes: 3 }).stings[0]!.travel;
    expect([wall.x0, wall.x1, wall.y1]).toEqual([1130, 2320, 1980]);
    expect(wall.y0).toBeCloseTo(1666, 1);
    const kiosk = make("kiosk").stings[0]!.travel;
    expect([kiosk.x0, kiosk.x1, kiosk.y1]).toEqual([755, 1105, 990]);
    expect(kiosk.y0).toBeCloseTo(669.6, 1);
    expect(make("panel").stings[0]!.travel).toEqual({ x0: 420, x1: 880, y0: 1320, y1: 1780 });
  });

  it("lets shapes grow to three times on the wall and twice elsewhere, less where lanes are narrow", () => {
    for (const kind of ["wall", "kiosk", "panel", "pair"] as const) {
      const steps = KINDS[kind].sizes;
      expect(steps).toContain(1);
      for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeGreaterThan(steps[i - 1]!);
      // Each tap changes the size by under 40 %.
      for (let i = 1; i < steps.length; i++) expect(steps[i]! / steps[i - 1]!).toBeLessThan(1.4);
      // The smallest disc is still six cells across on the coarsest grid.
      const coarse = make(kind, { coarse: 4 });
      expect(
        ((DISC_UNITS / 100) * KINDS[kind].shape * steps[0]!) / coarse.tunnel.cell,
      ).toBeGreaterThan(6);
    }
    expect(Math.max(...KINDS.wall.sizes)).toBe(3);
    for (const kind of ["kiosk", "panel", "pair"] as const)
      expect(Math.max(...KINDS[kind].sizes)).toBe(2);
    const top = (l: Layout) => l.stings.map((s) => Math.max(...s.scales));
    for (const shapes of [1, 2, 3])
      expect(top(make("wall", { shapes }))).toEqual(Array(shapes).fill(3));
    // Four lanes on the wall: the first lane has the desk's room beside it, the rest stop lower.
    expect(top(make("wall", { shapes: 4 }))).toEqual([3, 2, 2, 2]);
    expect(top(make("kiosk"))).toEqual([2, 2]);
    expect(top(make("panel"))).toEqual([2]);
    expect(top(make("pair"))).toEqual([2, 2]);
    // Every lane's steps run from the smallest up, with none skipped.
    for (const [, l] of CASES) {
      for (const s of l.stings) {
        expect(s.scales).toEqual(KINDS[l.kind].sizes.slice(0, s.scales.length));
        expect(s.scales).toContain(1);
      }
    }
  });

  it("puts the wall's handles and tiles in the child band, its knobs and desk in the adult band", () => {
    for (const shapes of [1, 2, 3, 4]) {
      const l = make("wall", { shapes });
      expect(l.stings).toHaveLength(shapes);
      for (const s of l.stings) {
        expect(s.travel.y0 - s.handle / 2).toBeGreaterThanOrEqual(l.childTop);
        for (const t of s.tiles) expect(t.y).toBeGreaterThanOrEqual(l.childTop);
        const k = knobAt(s, s.travel.x0, s.travel.y0);
        expect(k.y - s.knob / 2).toBeGreaterThanOrEqual(l.adultTop);
        expect(k.y + s.knob / 2).toBeLessThanOrEqual(l.childTop + 1);
        // The size buttons stack beside the knob, on its upstream side, in the adult band too.
        for (const [hx, hy] of sweep(s, 2)) {
          const b = sizeButtonsAt(s, hx, hy);
          for (const box of [b.smaller, b.bigger]) {
            expect(box.y).toBeGreaterThanOrEqual(l.adultTop);
            expect(box.y + box.height).toBeLessThanOrEqual(l.childTop);
            expect(box.width).toBeGreaterThan(TOUCH);
            expect(box.x + box.width).toBeLessThan(hx - s.knob / 2);
          }
          expect(b.bigger.y + b.bigger.height).toBeLessThan(b.smaller.y);
        }
        // The shape reaches well above anyone's reach: into the upper wall's stream.
        expect(s.shapeY[0]).toBeLessThan(l.adultTop * 0.4);
      }
      for (const c of controls(l).filter(
        (c) => c.what.startsWith("view") || c.what.startsWith("slider"),
      )) {
        expect(c.box.y, c.what).toBeGreaterThanOrEqual(l.adultTop);
      }
    }
  });

  it("puts an updraft's handle in the child band", () => {
    for (const l of [make("panel"), make("pair")]) {
      for (const s of l.stings) {
        expect(s.travel.y0 - s.handle / 2).toBeGreaterThanOrEqual(l.childTop);
        for (const t of s.tiles) expect(t.y + t.height / 2).toBeGreaterThanOrEqual(l.childTop);
      }
    }
  });

  it("stacks a panel's size buttons on the rod above the knob, and the kiosk's above its tiles", () => {
    for (const l of [make("panel"), make("pair")]) {
      for (const s of l.stings) {
        for (const [hx, hy] of sweep(s, 2)) {
          const k = knobAt(s, hx, hy);
          const b = sizeButtonsAt(s, hx, hy);
          expect(b.smaller.y + b.smaller.height).toBeLessThan(k.y - s.knob / 2);
          expect(b.bigger.y + b.bigger.height).toBeLessThan(b.smaller.y);
          expect(b.smaller.x + b.smaller.width / 2).toBeCloseTo(hx, 6);
        }
      }
    }
    for (const s of make("kiosk").stings) {
      const b = sizeButtonsAt(s, s.travel.x0, s.travel.y0);
      // They stay put, whatever the handle does.
      expect(sizeButtonsAt(s, s.travel.x1, s.travel.y1)).toEqual(b);
      const top = s.tiles[0]!;
      expect(b.smaller.x).toBeCloseTo(top.x, 6);
      expect(b.smaller.y + b.smaller.height).toBeLessThan(top.y);
      expect(b.bigger.y + b.bigger.height).toBeLessThan(b.smaller.y);
    }
  });

  it("gives each kind its stings and zones", () => {
    expect(make("kiosk").stings).toHaveLength(2);
    expect(make("panel").stings).toHaveLength(1);
    expect(make("pair").stings).toHaveLength(2);
    expect(make("pair").zones).toHaveLength(2);
    expect(make("wall", { hands: true }).stings).toHaveLength(0);
    const screen = make("screen");
    expect(screen.stings).toHaveLength(0);
    expect(controls(screen)).toHaveLength(0);
    expect(screen.tunnel.flow).toBe("up");
    expect(make("wall").tunnel.flow).toBe("right");
  });

  it("splits a pair's lattice into two updrafts with a wall at the seam", () => {
    const l = make("pair");
    const [a, b] = l.zones;
    expect(a!.rows[0]).toBeGreaterThanOrEqual(b!.rows[1]);
    expect(b!.rows[0]).toBe(0);
    expect(a!.rows[1]).toBe(l.tunnel.height);
    expect(l.walls).toHaveLength(1);
    const [, y0, x1, y1] = l.walls[0]!;
    expect(x1).toBe(l.tunnel.width);
    expect(y0).toBeLessThanOrEqual(b!.rows[1]);
    expect(y1).toBeGreaterThanOrEqual(a!.rows[0]);
    // The seam's venue x maps onto that wall.
    const [, gy] = apply(l.tunnel.toGrid, l.seams[0]!, 500);
    expect(gy).toBeGreaterThanOrEqual(y0);
    expect(gy).toBeLessThanOrEqual(y1);
    // A panel between two others has a solid console in the middle of the lattice.
    const three = CASES.find(([n]) => n === "pair of three")![1];
    expect(three.walls).toHaveLength(2);
  });

  it.each(CASES)("%s: maps venue to lattice and back, right-handed as drawn", (_, l) => {
    const t = l.tunnel;
    for (const [x, y] of [
      [t.rect.x + 10, t.rect.y + 20],
      [t.rect.x + t.rect.width / 2, t.rect.y + t.rect.height / 3],
    ] as const) {
      const [gx, gy] = apply(t.toGrid, x, y);
      const [vx, vy] = apply(t.toVenue, gx, gy);
      expect(vx).toBeCloseTo(x, 6);
      expect(vy).toBeCloseTo(y, 6);
    }
    // The inlet edge is lattice column 0 and the visible tunnel ends at `visible`.
    expect(t.width).toBeGreaterThan(t.visible);
    // Lattice x then y turn anticlockwise as drawn (y down): down x across = -1.
    expect(t.down[0] * t.across[1] - t.down[1] * t.across[0]).toBe(-1);
  });

  it("keeps the lattice coarser at low resolution", () => {
    const fine = make("wall");
    const coarse = make("wall", { coarse: 4 });
    expect(coarse.tunnel.height).toBeLessThan(fine.tunnel.height / 3);
    expect(coarse.tunnel.cell).toBeGreaterThan(fine.tunnel.cell * 3.5);
  });

  it("maps slider touches to wind and handles to their travel", () => {
    const z = make("panel").zones[0]!;
    const s = z.slider!;
    expect(sliderValue(s, s.from.x, s.from.y)).toBe(0);
    expect(sliderValue(s, s.to.x, s.to.y)).toBe(1);
    const mid = sliderPoint(s, 0.25);
    expect(sliderValue(s, mid.x + 40, mid.y)).toBeCloseTo(0.25, 6);
    expect(sliderValue(s, s.to.x, s.to.y - 500)).toBe(1);
    const box = sliderBox(s);
    expect(box.height).toBeGreaterThan(Math.abs(s.to.y - s.from.y));
    const sting = make("panel").stings[0]!;
    const h = clampHandle(sting, -1000, Number.NaN);
    expect(h.x).toBe(sting.travel.x0);
    expect(h.y).toBe(sting.travel.y0);
    const home = homeOf(sting);
    expect(home.x).toBeGreaterThan(sting.travel.x0);
    expect(home.x).toBeLessThan(sting.travel.x1);
  });
});
