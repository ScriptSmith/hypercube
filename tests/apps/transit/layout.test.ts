import { describe, expect, it, vi } from "vitest";
import { VENUE_SIZE } from "../../../src/core/frame";
import { createBots, FIRST_MS, QUIET_MS } from "../../../src/apps/transit/bots";
import { mercX, mercY } from "../../../src/apps/transit/geo";
import { sketchPath } from "../../../src/apps/transit/icons";
import { type Box, layoutFor, openArea, ZOOMS } from "../../../src/apps/transit/layout";
import { FEATURED, MODES } from "../../../src/apps/transit/routes";
import { cameraFor, latOfMercY, VIEWS, zoomForSpan } from "../../../src/apps/transit/views";
import type { Input, Rng } from "../../../src/core/types";

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Box, w: number, h: number) =>
  a.x >= 0 && a.y >= 0 && a.x + a.w <= w && a.y + a.h <= h;

describe("layout", () => {
  it("puts the wall's mode buttons in the child band and route buttons in the adult band", () => {
    const { width, height } = VENUE_SIZE.wall;
    const reach = { adult: height * (1 - 0.45), child: height * (1 - 0.25) };
    const l = layoutFor({ kind: "wall", width, height, reachTop: reach });
    expect(l.panels).toHaveLength(2);
    expect(l.modes).toHaveLength(MODES.length * 2);
    expect(l.lines).toHaveLength(FEATURED.length * 2);
    for (const m of l.modes) {
      expect(m.box.h).toBeGreaterThanOrEqual(160);
      expect(m.box.y).toBeGreaterThanOrEqual(reach.child);
      expect(inside(m.box, width, height)).toBe(true);
    }
    for (const b of l.lines) {
      expect(b.box.h).toBeGreaterThanOrEqual(160);
      expect(b.box.y).toBeGreaterThanOrEqual(reach.adult);
      expect(b.box.y + b.box.h).toBeLessThanOrEqual(reach.child);
    }
    // Zoom buttons: a column per console, on the side facing the middle, in reach, and the
    // zooms themselves within a child's reach.
    expect(l.zooms.map((z) => z.action)).toEqual([...ZOOMS, ...ZOOMS]);
    for (const [i, z] of l.zooms.entries()) {
      const panel = l.panels[Math.floor(i / ZOOMS.length)]!;
      expect(z.box.w).toBeGreaterThanOrEqual(160);
      expect(z.box.h).toBeGreaterThanOrEqual(160);
      expect(z.box.y).toBeGreaterThanOrEqual(reach.adult);
      if (z.action !== "reset") expect(z.box.y).toBeGreaterThanOrEqual(reach.child);
      expect(overlap(z.box, panel)).toBe(true);
      expect(z.box.x).toBeGreaterThanOrEqual(panel.x);
      expect(z.box.x + z.box.w).toBeLessThanOrEqual(panel.x + panel.w);
    }
    const left = l.zooms[0]!.box;
    const right = l.zooms[ZOOMS.length]!.box;
    expect(left.x).toBeGreaterThan(l.lines[0]!.box.x);
    expect(right.x).toBeLessThan(l.lines[FEATURED.length]!.box.x);
    const all = [...l.modes, ...l.lines, ...l.zooms].map((x) => x.box);
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(overlap(all[i]!, all[j]!)).toBe(false);
    // Open map between the consoles, for tapping vehicles and dragging the map.
    const [a, b] = l.panels;
    expect(b!.x - (a!.x + a!.w)).toBeGreaterThan(width * 0.4);
    expect(l.tapTop).toBe(reach.adult);
    // Drags start anywhere on the wall, out of reach too.
    expect(l.dragTop).toBe(0);
    expect(openArea(l)).toEqual({
      x: a!.x + a!.w,
      y: reach.adult,
      w: b!.x - (a!.x + a!.w),
      h: height - reach.adult,
    });
  });

  it("fits one console and its zoom column on a narrower wall", () => {
    const width = 3200;
    const height = 1200;
    const reach = { adult: height * 0.5, child: height * 0.75 };
    const l = layoutFor({ kind: "wall", width, height, reachTop: reach });
    expect(l.panels).toHaveLength(1);
    expect(l.zooms).toHaveLength(ZOOMS.length);
    for (const x of [...l.panels, ...l.zooms.map((z) => z.box)]) {
      expect(inside(x, width, height)).toBe(true);
    }
    const open = openArea(l)!;
    expect(open.x).toBe(l.panels[0]!.x + l.panels[0]!.w);
    expect(open.x + open.w).toBe(width);
  });

  it("lays a kiosk out as a map above a strip of buttons at least 120 px", () => {
    const { width, height } = VENUE_SIZE.kiosk;
    const l = layoutFor({ kind: "kiosk", width, height, reachTop: { adult: 0, child: 0 } });
    expect(l.map.h + l.panels[0]!.h).toBe(height);
    expect(l.modes).toHaveLength(3);
    expect(l.lines).toHaveLength(FEATURED.length);
    const all = [...l.modes, ...l.lines].map((x) => x.box);
    for (const box of all) {
      expect(Math.min(box.w, box.h)).toBeGreaterThanOrEqual(120);
      expect(box.y).toBeGreaterThanOrEqual(l.map.h);
      expect(inside(box, width, height)).toBe(true);
    }
    // Zoom buttons on the map's right edge, clear of the Home control's corner (top right,
    // 120 px plus a 28 px margin) and of the attribution at the bottom.
    expect(l.zooms.map((z) => z.action)).toEqual(ZOOMS);
    for (const z of l.zooms) {
      expect(Math.min(z.box.w, z.box.h)).toBeGreaterThanOrEqual(120);
      expect(z.box.y).toBeGreaterThan(28 + 120);
      expect(z.box.y + z.box.h).toBeLessThan(l.map.h - 60);
      expect(z.box.x + z.box.w).toBeLessThanOrEqual(width);
      all.push(z.box);
    }
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(overlap(all[i]!, all[j]!)).toBe(false);
    expect(l.tapTop).toBe(0);
    expect(l.dragTop).toBe(0);
    // The tour keeps its views clear of the zoom buttons.
    expect(l.pad.right).toBeGreaterThan(width - l.zooms[0]!.box.x);
    expect(openArea(l)).toEqual({ x: 0, y: 0, w: l.zooms[0]!.box.x, h: l.map.h });
  });

  it("gives a screen the map alone, with no taps", () => {
    const { width, height } = VENUE_SIZE.screen;
    const l = layoutFor({
      kind: "screen",
      width,
      height,
      reachTop: { adult: height, child: height },
    });
    expect(l.modes).toHaveLength(0);
    expect(l.lines).toHaveLength(0);
    expect(l.zooms).toHaveLength(0);
    expect(l.tapTop).toBe(height);
    expect(l.dragTop).toBe(height);
    expect(openArea(l)).toBeNull();
    expect(l.map).toEqual({ x: 0, y: 0, w: width, h: height });
  });
});

describe("views", () => {
  it("centres a view's box in the padded viewport, between fitting and filling it", () => {
    const b = VIEWS.city;
    const cam = cameraFor(b, 1000, 1000, { top: 0, right: 0, bottom: 0, left: 0 });
    expect(cam.lon).toBeCloseTo((b.west + b.east) / 2, 6);
    expect(mercY(cam.lat)).toBeCloseTo((mercY(b.north) + mercY(b.south)) / 2, 9);
    const scale = 512 * 2 ** cam.zoom;
    const w = (mercX(b.east) - mercX(b.west)) * scale;
    const h = (mercY(b.south) - mercY(b.north)) * scale;
    expect(Math.max(w, h)).toBeGreaterThanOrEqual(1000);
    expect(Math.min(w, h)).toBeLessThanOrEqual(1000 * 1.6);
    // Bottom padding moves the box up: the camera centre moves south.
    const padded = cameraFor(b, 1000, 1000, { top: 0, right: 0, bottom: 200, left: 0 });
    expect(padded.lat).toBeLessThan(cam.lat);
  });

  it("converts mercator back to latitude", () => {
    for (const lat of [-27.47, 0, 45]) expect(latOfMercY(mercY(lat))).toBeCloseTo(lat, 9);
  });

  it("finds the zoom showing a ground span", () => {
    const z = zoomForSpan(1000, 500, 0);
    const mPerPx = 40_075_016.686 / (512 * 2 ** z);
    expect(mPerPx * 500).toBeCloseTo(1000, 3);
  });
});

describe("line sketches", () => {
  it("fit the box with the padding and keep north up", () => {
    const d = sketchPath([Float32Array.from([0, 0, 100, 0, 100, 400])], 200, 100, 10);
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeCloseTo(10);
    expect(Math.max(...ys)).toBeCloseTo(90);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...xs)).toBeLessThanOrEqual(190);
    // The northern end (y 400) is at the top.
    expect(ys[ys.length - 1]).toBeCloseTo(10);
    expect(sketchPath([], 10, 10, 1)).toBe("");
  });
});

describe("bots", () => {
  const setup = (humanAt = Number.NEGATIVE_INFINITY, rolls = [0.1, 0.5, 0.9]) => {
    const taps: [number, number][] = [];
    const moves: [number, number][] = [];
    const ups: number[] = [];
    const input = {
      inject: {
        down: (x: number, y: number) => {
          taps.push([x, y]);
          return taps.length;
        },
        move: (_id: number, x: number, y: number) => {
          moves.push([x, y]);
        },
        up: (id: number) => {
          ups.push(id);
        },
      },
    } as unknown as Input;
    let i = 0;
    const rng = {
      next: () => rolls[i++ % rolls.length]!,
      range: (a: number) => a,
      pick: <T>(items: readonly T[]) => items[0]!,
    } as unknown as Rng;
    const bots = createBots({
      input,
      rng,
      buttons: () => [
        { kind: "mode", id: "bus", x: 1, y: 1 },
        { kind: "line", id: "60", x: 2, y: 2 },
      ],
      vehicles: () => [{ kind: "vehicle", id: "5", x: 3, y: 3 }],
      open: () => ({ x: 100, y: 200, w: 1000, h: 400 }),
      humanAt: () => humanAt,
      start: 0,
    });
    return { bots, taps, moves, ups };
  };

  it("press a mode, a line and a vehicle in turn, from FIRST_MS, every 20 s or more", () => {
    const { bots, taps } = setup();
    bots.tick(FIRST_MS - 1);
    expect(taps).toHaveLength(0);
    bots.tick(FIRST_MS);
    bots.tick(FIRST_MS + 19_999);
    bots.tick(FIRST_MS + 20_000);
    bots.tick(FIRST_MS + 40_000);
    expect(taps).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    bots.dispose();
  });

  it("now and then drag across the open map, one drag at a time", async () => {
    vi.useFakeTimers();
    try {
      const { bots, taps, moves, ups } = setup(Number.NEGATIVE_INFINITY, [0.8]);
      bots.tick(FIRST_MS);
      expect(bots.drags).toBe(1);
      expect(taps).toHaveLength(1);
      const [x0, y0] = taps[0]!;
      expect(x0).toBeGreaterThanOrEqual(100);
      expect(y0).toBeGreaterThanOrEqual(200);
      // Busy dragging: the next turn passes.
      bots.tick(FIRST_MS + 20_000);
      expect(bots.drags).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(moves.length).toBeGreaterThan(5);
      for (const [x, y] of moves) {
        expect(x).toBeGreaterThanOrEqual(100);
        expect(x).toBeLessThanOrEqual(1100);
        expect(y).toBeGreaterThanOrEqual(200);
        expect(y).toBeLessThanOrEqual(600);
      }
      expect(ups).toEqual([1]);
      bots.tick(FIRST_MS + 40_000);
      expect(bots.drags).toBe(2);
      bots.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hold off while a person is using the frame", () => {
    const { bots, taps } = setup(FIRST_MS - 1000);
    bots.tick(FIRST_MS);
    expect(taps).toHaveLength(0);
    bots.tick(FIRST_MS + 30_000);
    expect(FIRST_MS + 30_000 - (FIRST_MS - 1000)).toBeGreaterThan(QUIET_MS);
    expect(taps).toHaveLength(1);
  });
});
