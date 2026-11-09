import { describe, expect, it } from "vitest";
import {
  bankKeyCount,
  type Box,
  computeLayout,
  controlBoxes,
  glidePoint,
  glideT,
  type Layout,
  type LayoutInput,
  mapRect,
  minKeyFor,
  minStripFor,
  plateAt,
  plateRect,
  type Rect,
  SEAM_CLEAR,
  screenWide,
} from "../../../src/apps/chladni/layout";
import { bankKeyMode, bankKeysOf, modesFor } from "../../../src/apps/chladni/modes";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import type { FrameKind } from "../../../src/core/types";

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const ALL = { glide: true, stretch: true, damping: true, puck: true };

const input = (kind: FrameKind, over: Partial<LayoutInput> = {}): LayoutInput => ({
  kind,
  mode: kind === "screen" ? "screen" : "solo",
  venue: VENUE_SIZE[kind],
  reach: DEFAULT_REACH[kind],
  shape: "square",
  keys: 6,
  plates: 1,
  controls: ALL,
  modeCount: modesFor("square").length,
  span: kind === "pair" ? 2 : 1,
  pos: 0,
  count: 1,
  ...over,
});

const SOLO: FrameKind[] = ["panel", "pair", "wall", "kiosk"];

const CONTROL_SETS = [
  ALL,
  { glide: false, stretch: true, damping: true, puck: true },
  { glide: true, stretch: false, damping: false, puck: false },
  { glide: true, stretch: false, damping: true, puck: true },
];

const cases = (): [string, Layout, LayoutInput][] => {
  const out: [string, Layout, LayoutInput][] = [];
  for (const kind of SOLO) {
    for (let keys = 4; keys <= 10; keys++) {
      for (const plates of kind === "wall" ? [1, 2] : [1]) {
        for (const [ci, controls] of CONTROL_SETS.entries()) {
          for (const shape of ["square", "round"] as const) {
            const i = input(kind, { keys, plates, controls, shape });
            out.push([
              `${kind} ${shape} ${keys} keys ${plates} plates controls ${ci}`,
              computeLayout(i),
              i,
            ]);
          }
        }
      }
    }
  }
  for (const kind of ["panel", "pair"] as FrameKind[]) {
    for (const count of [1, 3, 5, 10]) {
      for (let pos = 0; pos < count; pos++) {
        for (const [ci, controls] of CONTROL_SETS.entries()) {
          const i = input(kind, { mode: "keyboard", count, pos, controls });
          out.push([`${kind} keyboard ${pos} of ${count} controls ${ci}`, computeLayout(i), i]);
        }
      }
    }
  }
  return out;
};

const rectBox = (r: Rect): Box => ({
  x: r.cx - r.width / 2,
  y: r.cy - r.height / 2,
  width: r.width,
  height: r.height,
});

const STRETCHES = [0, 0.1, 0.3, 0.5, 0.766, 0.8, 1];

describe("layouts", () => {
  it("keep every control inside the frame and apart from each other and the plates", () => {
    for (const [name, l] of cases()) {
      const boxes = controlBoxes(l);
      for (const b of boxes) {
        expect(b.x, name).toBeGreaterThanOrEqual(0);
        expect(b.y, name).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, name).toBeLessThanOrEqual(l.venue.width);
        expect(b.y + b.height, name).toBeLessThanOrEqual(l.venue.height);
        for (const p of l.plates) {
          for (const st of STRETCHES) {
            const plate = rectBox(plateRect(p, st));
            expect(overlaps(b, plate), `${name}: control on a plate at stretch ${st}`).toBe(false);
          }
        }
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(overlaps(boxes[i]!, boxes[j]!), `${name}: ${i} and ${j}`).toBe(false);
        }
      }
    }
  });

  it("keep every plate inside the frame at every stretch, and the square where it was", () => {
    for (const [name, l] of cases()) {
      for (const p of l.plates) {
        const sq = plateRect(p, 0);
        expect(sq).toEqual({ cx: p.cx, cy: p.cy, width: p.size, height: p.size });
        let prev = sq;
        for (let st = 0; st <= 1.0001; st += 0.02) {
          const r = plateRect(p, st);
          const b = rectBox(r);
          expect(b.x, name).toBeGreaterThanOrEqual(-0.5);
          expect(b.y, name).toBeGreaterThanOrEqual(-0.5);
          expect(b.x + b.width, name).toBeLessThanOrEqual(l.venue.width + 0.5);
          expect(b.y + b.height, name).toBeLessThanOrEqual(l.venue.height + 0.5);
          const long = Math.max(r.width, r.height) / Math.min(r.width, r.height);
          expect(long, name).toBeCloseTo(1 + st, 6);
          // It grows smoothly: no jump from one step to the next.
          expect(Math.abs(r.width - prev.width), name).toBeLessThan(0.05 * prev.width);
          expect(Math.abs(r.cy - prev.cy), name).toBeLessThan(0.05 * prev.height);
          prev = r;
        }
        // Stretched, it still uses a good share of the room the square had.
        const full = plateRect(p, 1);
        expect(full.width * full.height, name).toBeGreaterThan(0.45 * p.size * p.size);
      }
    }
  });

  it("lay the long side whichever way uses the frame best", () => {
    expect(computeLayout(input("panel")).plates[0]!.wide).toBe(true);
    expect(computeLayout(input("pair")).plates[0]!.wide).toBe(true);
    expect(computeLayout(input("kiosk")).plates[0]!.wide).toBe(true);
    expect(computeLayout(input("screen")).plates[0]!.wide).toBe(true);
    expect(screenWide(VENUE_SIZE.screen)).toBe(true);
    expect(computeLayout(input("wall")).plates[0]!.wide).toBe(true);
    // Two plates side by side on the wall stand on end.
    for (const p of computeLayout(input("wall", { plates: 2 })).plates) expect(p.wide).toBe(false);
    // The wall's one plate rises clear of its side controls and spreads over them.
    const wall = computeLayout(input("wall"));
    const full = plateRect(wall.plates[0]!, 1);
    expect(full.width).toBeGreaterThan(wall.plates[0]!.size);
  });

  it("give every frame its sliders and a way to move the drive point, within reach", () => {
    for (const [name, l, i] of cases()) {
      const want = [
        ...(i.controls.stretch && i.shape === "square" ? ["stretch"] : []),
        ...(i.controls.damping ? ["damping"] : []),
      ];
      for (let p = 0; p < Math.max(1, l.plates.length); p++) {
        const knobs = new Set(l.sliders.filter((s) => s.plate === p).map((s) => s.knob));
        expect([...knobs].sort(), name).toEqual([...want].sort());
      }
      const min = minStripFor(i.kind);
      for (const s of l.sliders) {
        expect(Math.min(s.box.width, s.box.height), name).toBeGreaterThanOrEqual(120);
        if (s.knob === "stretch") {
          expect(Math.max(s.box.width, s.box.height), name).toBeGreaterThanOrEqual(min);
        } else {
          expect(Math.max(s.box.width, s.box.height), name).toBeGreaterThanOrEqual(300);
        }
        expect(s.box.y, name).toBeGreaterThanOrEqual(l.reach.adult - 1);
        // Above the keys of its plate.
        for (const k of l.keys) {
          if (k.box.x < s.box.x + s.box.width && s.box.x < k.box.x + k.box.width) {
            expect(s.box.y + s.box.height, name).toBeLessThanOrEqual(k.box.y);
          }
        }
      }
      // The drive point: the plate itself where it is in reach, otherwise a map.
      if (i.controls.puck) {
        if (i.mode === "keyboard" || i.kind === "wall") {
          expect(l.maps.length, name).toBeGreaterThan(0);
          for (const p of l.plates.keys())
            expect(
              l.maps.some((m) => m.plate === p),
              name,
            ).toBe(true);
        } else {
          expect(l.maps, name).toHaveLength(0);
          for (const p of l.plates)
            expect(p.cy - p.size / 2, name).toBeGreaterThanOrEqual(l.reach.adult - 1);
        }
      }
      for (const m of l.maps) {
        expect(m.touch, name).toBe(i.controls.puck);
        expect(Math.min(m.box.width, m.box.height), name).toBeGreaterThanOrEqual(120);
        expect(m.box.y, name).toBeGreaterThanOrEqual(l.reach.adult - 1);
        // The whole map is the target; even a fully stretched plate on it stays easy to see, and
        // a puck at its rim stays on the map.
        for (const wide of [true, false]) {
          const r = mapRect(m.box, 1, wide);
          expect(Math.min(r.width, r.height), name).toBeGreaterThanOrEqual(100);
          const sq = mapRect(m.box, 0, wide);
          expect(sq.cy + sq.height / 2 + 0.1 * m.box.height, name).toBeLessThanOrEqual(
            m.box.y + m.box.height,
          );
        }
      }
    }
  });

  it("make keys big enough and put them in the child band", () => {
    for (const [name, l, i] of cases()) {
      const min = i.mode === "keyboard" ? 400 : minKeyFor(i.kind);
      for (const k of l.keys) {
        expect(Math.min(k.box.width, k.box.height), name).toBeGreaterThanOrEqual(min);
        expect(k.box.y, name).toBeGreaterThanOrEqual(l.reach.child - 1);
      }
    }
  });

  it("put each glide above its keys, long enough, in reach", () => {
    for (const [name, l, i] of cases()) {
      if (!i.controls.glide) {
        expect(l.glides, name).toHaveLength(0);
        continue;
      }
      expect(l.glides.length, name).toBeGreaterThan(0);
      for (const g of l.glides) {
        const length = g.vertical ? g.box.height : g.box.width;
        expect(length, name).toBeGreaterThanOrEqual(600);
        expect(Math.min(g.box.width, g.box.height), name).toBeGreaterThanOrEqual(120);
        expect(g.box.y, name).toBeGreaterThanOrEqual(l.reach.adult - 1);
        if (!g.vertical) {
          const keys = l.keys.filter(
            (k) =>
              k.plate === g.plate &&
              k.box.x < g.box.x + g.box.width &&
              g.box.x < k.box.x + k.box.width,
          );
          for (const k of keys) expect(g.box.y + g.box.height, name).toBeLessThanOrEqual(k.box.y);
        }
        // Notes at its marks are the keys beside it, ascending.
        for (let n = 1; n < g.notes.length; n++)
          expect(g.notes[n]!, name).toBeGreaterThanOrEqual(g.notes[n - 1]!);
      }
    }
  });

  it("put the wall's glides, sliders and maps in the adult band above the child band", () => {
    for (const [name, l, i] of cases()) {
      if (i.kind !== "wall") continue;
      for (const b of [...l.glides, ...l.sliders, ...l.maps].map((c) => c.box)) {
        expect(b.y + b.height, name).toBeLessThanOrEqual(l.reach.child + 1);
        expect(b.y, name).toBeGreaterThanOrEqual(l.reach.adult - 1);
      }
    }
  });

  it("leave the wall's top-right corner of the reach band free for the Home control", () => {
    for (const plates of [1, 2]) {
      const l = computeLayout(input("wall", { plates }));
      const home = { x: l.venue.width - 160 - 28, y: l.reach.adult + 4, width: 160, height: 160 };
      for (const b of controlBoxes(l)) expect(overlaps(b, home)).toBe(false);
    }
  });

  it("keep controls clear of a pair's seam, one group to each side", () => {
    for (const [name, l, i] of cases()) {
      if (i.kind !== "pair") continue;
      const seam = l.venue.width / 2;
      for (const b of controlBoxes(l)) {
        expect(b.x + b.width <= seam - SEAM_CLEAR || b.x >= seam + SEAM_CLEAR, name).toBe(true);
      }
      expect(
        l.keys.some((k) => k.box.x < seam),
        name,
      ).toBe(true);
      expect(
        l.keys.some((k) => k.box.x > seam),
        name,
      ).toBe(true);
    }
  });

  it("order keys by note: low notes left, and the lower row first", () => {
    for (const [name, l] of cases()) {
      for (let p = 0; p < Math.max(1, l.plates.length); p++) {
        const keys = l.keys.filter((k) => k.plate === p);
        for (const a of keys) {
          for (const b of keys) {
            if (a.mode >= b.mode) continue;
            // A lower note is never right of a higher one in the same row, nor above it in the
            // same column.
            const sameRow = Math.abs(a.box.y - b.box.y) < 1;
            const sameCol = Math.abs(a.box.x - b.box.x) < 1;
            if (sameRow) expect(a.box.x, name).toBeLessThan(b.box.x);
            if (sameCol) expect(a.box.y, name).toBeGreaterThan(b.box.y);
          }
        }
      }
    }
  });

  it("give the wall two plates, each with its own keys, when asked", () => {
    const l = computeLayout(input("wall", { plates: 2 }));
    expect(l.plates).toHaveLength(2);
    expect(l.keys.filter((k) => k.plate === 0)).toHaveLength(6);
    expect(l.keys.filter((k) => k.plate === 1)).toHaveLength(6);
    expect(l.plates[0]!.size).toBeGreaterThan(VENUE_SIZE.wall.height * 0.6);
  });

  it("make the plates large: most of a panel's width, the wall's height", () => {
    expect(computeLayout(input("panel")).plates[0]!.size).toBeGreaterThanOrEqual(860);
    expect(computeLayout(input("wall")).plates[0]!.size).toBeGreaterThan(
      VENUE_SIZE.wall.height * 0.9,
    );
    expect(computeLayout(input("pair")).plates[0]!.size).toBeGreaterThan(1100);
    expect(computeLayout(input("kiosk")).plates[0]!.size).toBeGreaterThan(800);
    expect(computeLayout(input("screen")).plates[0]!.size).toBeGreaterThan(
      VENUE_SIZE.screen.height * 0.9,
    );
    // Without the sliders the panel's plate takes their room back.
    const bare = { glide: true, stretch: false, damping: false, puck: true };
    expect(computeLayout(input("panel", { controls: bare })).plates[0]!.size).toBeGreaterThan(
      computeLayout(input("panel")).plates[0]!.size + 100,
    );
  });
});

describe("the bank keyboard", () => {
  it("gives each frame its own keys, two per panel, in order along the bank", () => {
    const modeCount = modesFor("square").length;
    for (const [kind, span] of [
      ["panel", 1],
      ["pair", 2],
    ] as const) {
      for (const count of [1, 2, 5, 10]) {
        const total = bankKeyCount(count, span);
        const seen: number[] = [];
        for (let pos = 0; pos < count; pos++) {
          const l = computeLayout(input(kind, { mode: "keyboard", count, pos, span }));
          expect(l.keys.map((k) => k.bank)).toEqual(bankKeysOf(pos, span));
          for (const k of l.keys) expect(k.mode).toBe(bankKeyMode(k.bank!, total, modeCount));
          // Left to right within the frame.
          for (let i = 1; i < l.keys.length; i++)
            expect(l.keys[i]!.box.x).toBeGreaterThan(l.keys[i - 1]!.box.x);
          seen.push(...l.keys.map((k) => k.bank!));
          expect(l.glides).toHaveLength(span);
        }
        expect(seen).toEqual(Array.from({ length: total }, (_, i) => i));
      }
    }
  });

  it("plays the plate's modes in order, repeating the top ones when keys outnumber modes", () => {
    expect(Array.from({ length: 8 }, (_, k) => bankKeyMode(k, 8, 16))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    const twenty = Array.from({ length: 20 }, (_, k) => bankKeyMode(k, 20, 16));
    expect(twenty.slice(0, 16)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(twenty.slice(16)).toEqual([12, 13, 14, 15]);
    expect(Array.from({ length: 20 }, (_, k) => bankKeyMode(k, 20, 14)).slice(14)).toEqual([
      8, 9, 10, 11, 12, 13,
    ]);
  });

  it("lets each glide strip reach towards the neighbouring frames' notes", () => {
    const l = computeLayout(input("panel", { mode: "keyboard", count: 5, pos: 2 }));
    const g = l.glides[0]!;
    expect(g.notes).toEqual([4, 5]);
    expect(g.below).toBe(3);
    expect(g.above).toBe(6);
    const first = computeLayout(input("panel", { mode: "keyboard", count: 5, pos: 0 })).glides[0]!;
    expect(first.below).toBeNull();
    const last = computeLayout(input("panel", { mode: "keyboard", count: 5, pos: 4 })).glides[0]!;
    expect(last.above).toBeNull();
  });

  it("shows a map of the screen's plate above each panel's controls, clear of the seam", () => {
    for (const kind of ["panel", "pair"] as FrameKind[]) {
      const l = computeLayout(input(kind, { mode: "keyboard", count: 5, pos: 1 }));
      expect(l.maps).toHaveLength(kind === "pair" ? 2 : 1);
      for (const m of l.maps) expect(m.box.width).toBeGreaterThan(800);
      expect(l.plates).toHaveLength(0);
      // The keyboard keeps its stretch slider at least 600 long.
      for (const s of l.sliders.filter((x) => x.knob === "stretch")) {
        expect(s.box.width).toBeGreaterThanOrEqual(600);
      }
    }
  });
});

describe("hit testing", () => {
  it("finds plate coordinates", () => {
    const l = computeLayout(input("panel"));
    const p = l.plates[0]!;
    expect(plateAt(l, false, p.cx, p.cy)).toEqual({ plate: 0, u: 0, v: 0 });
    // Stretched, a point off the square but on the rectangle is on the plate.
    const r = plateRect(p, 1);
    const edge = plateAt(l, false, r.cx + r.width * 0.49, r.cy, () => 1)!;
    expect(edge.u).toBeCloseTo(0.98, 6);
    expect(plateAt(l, false, r.cx, r.cy + r.height * 0.6, () => 1)).toBeNull();
    const corner = plateAt(l, false, p.cx + p.size * 0.49, p.cy - p.size * 0.49)!;
    expect(corner.u).toBeCloseTo(0.98, 6);
    expect(corner.v).toBeCloseTo(-0.98, 6);
    expect(plateAt(l, true, p.cx + p.size * 0.49, p.cy - p.size * 0.49)).toBeNull();
    expect(plateAt(l, false, p.cx, p.cy + p.size)).toBeNull();
  });

  it("maps glide positions both ways", () => {
    for (const kind of ["panel", "kiosk"] as FrameKind[]) {
      const g = computeLayout(input(kind)).glides[0]!;
      for (const t of [0, 0.25, 0.5, 0.9, 1]) {
        const p = glidePoint(g, t);
        expect(glideT(g, p.x, p.y)).toBeCloseTo(t, 9);
      }
    }
  });
});
