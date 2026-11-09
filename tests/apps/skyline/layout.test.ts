import { describe, expect, it } from "vitest";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import { BH } from "../../../src/apps/skyline/config";
import {
  APEX,
  defaultLiftShare,
  type Layout,
  type LayoutInput,
  layoutFor,
  MIN_BUTTON,
  MIN_PAD,
  MIN_TARGET,
  MIN_WALL_BUTTON,
  SEAM_SHARE,
  type ScreenColumn,
  screenLayout,
} from "../../../src/apps/skyline/layout";
import type { Rect } from "../../../src/core/types";

/** The default wall, with the tops of adult and child reach on it. */
const WALL = {
  width: VENUE_SIZE.wall.width,
  height: VENUE_SIZE.wall.height,
  reachTop: {
    adult: VENUE_SIZE.wall.height * (1 - DEFAULT_REACH.wall.adult),
    child: VENUE_SIZE.wall.height * (1 - DEFAULT_REACH.wall.child),
  },
};
const SCREEN = VENUE_SIZE.screen;

const KINDS: Omit<LayoutInput, "cranes" | "variant">[] = [
  { kind: "panel", width: 1080, height: 1920, reachTop: { adult: 0, child: 1056 }, seams: [] },
  { kind: "pair", width: 2160, height: 1920, reachTop: { adult: 0, child: 1056 }, seams: [1080] },
  { kind: "wall", ...WALL, seams: [] },
  { kind: "kiosk", width: 1920, height: 1080, reachTop: { adult: 0, child: 0 }, seams: [] },
];

const every = (): { name: string; inp: LayoutInput; l: Layout }[] => {
  const out = [];
  for (const k of KINDS) {
    for (const variant of ["build", "tall"] as const) {
      for (const cranes of k.kind === "wall" ? [2, 3] : [3]) {
        const inp = { ...k, cranes, variant };
        out.push({ name: `${k.kind} ${variant} ${cranes}`, inp, l: layoutFor(inp) });
      }
    }
  }
  return out;
};

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const circleRect = (c: { x: number; y: number; r: number }): Rect => ({
  x: c.x - c.r,
  y: c.y - c.r,
  width: 2 * c.r,
  height: 2 * c.r,
});
const inside = (r: Rect, w: number, h: number) =>
  r.x >= 0 && r.y >= 0 && r.x + r.width <= w + 1e-6 && r.y + r.height <= h + 1e-6;

describe("skyline layout", () => {
  it("keeps every control on the frame, big enough, and clear of the others", () => {
    for (const { name, l } of every()) {
      const all: Rect[] = [];
      for (const c of l.cranes) {
        const controls = [c.pad, circleRect(c.release), ...c.buttons.map((b) => b.rect)];
        for (const r of controls) {
          expect(inside(r, l.width, l.height), `${name}: ${JSON.stringify(r)}`).toBe(true);
          expect(Math.min(r.width, r.height), name).toBeGreaterThanOrEqual(MIN_TARGET);
          expect(r.y, `${name}: below the ground`).toBeGreaterThanOrEqual(l.ground);
        }
        const min = l.kind === "wall" ? MIN_WALL_BUTTON : MIN_BUTTON;
        for (const b of c.buttons) expect(b.rect.width, name).toBeGreaterThanOrEqual(min);
        if (l.kind === "panel" || l.kind === "pair" || l.kind === "wall") {
          expect(c.pad.width, name).toBeGreaterThanOrEqual(MIN_PAD.width);
          expect(c.pad.height, name).toBeGreaterThanOrEqual(MIN_PAD.height);
        }
        // The lift shaft runs clear of every control.
        const shaft = {
          x: c.lift.x - c.lift.width / 2,
          y: c.lift.top,
          width: c.lift.width,
          height: c.lift.bottom - c.lift.top,
        };
        for (const r of controls) expect(overlaps(shaft, r), `${name}: lift`).toBe(false);
        if (l.kind === "wall") {
          for (const r of controls) {
            expect(r.x, name).toBeGreaterThanOrEqual(c.lane.x);
            expect(r.x + r.width, name).toBeLessThanOrEqual(c.lane.x + c.lane.width);
          }
        }
        all.push(...controls);
      }
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++)
          expect(overlaps(all[i]!, all[j]!), `${name} ${i} ${j}`).toBe(false);
      }
    }
  });

  it("puts the children's buttons lowest, in their reach", () => {
    for (const { name, inp, l } of every()) {
      for (const c of l.cranes) {
        const top = Math.min(...c.buttons.map((b) => b.rect.y));
        // A kiosk is in everyone's reach: its controls share one row along the bottom.
        if (l.kind !== "kiosk") {
          expect(top, name).toBeGreaterThan(c.pad.y + c.pad.height - 1);
          expect(top, name).toBeGreaterThan(c.release.y + c.release.r - 1);
        }
        for (const b of c.buttons)
          expect(b.rect.y + b.rect.height / 2, name).toBeGreaterThan(inp.reachTop.child);
      }
    }
  });

  it("keeps a pair's controls a fifth of the width from the seam, a crane to each half", () => {
    for (const { name, l } of every().filter((e) => e.l.kind === "pair")) {
      expect(l.cranes).toHaveLength(2);
      const seam = 1080;
      const margin = SEAM_SHARE * l.width;
      l.cranes.forEach((c, i) => {
        for (const r of [c.pad, circleRect(c.release), ...c.buttons.map((b) => b.rect)]) {
          if (i === 0) expect(r.x + r.width, name).toBeLessThanOrEqual(seam - margin);
          else expect(r.x, name).toBeGreaterThanOrEqual(seam + margin);
        }
        // Masts at the outer edges.
        const mast = c.scene.ox + c.world.mastX * c.scene.s;
        expect(i === 0 ? mast < seam / 2 : mast > seam * 1.5, name).toBe(true);
      });
    }
  });

  it("lays out each world sensibly: lots apart, the yard by the lift, all in the trolley's reach", () => {
    for (const { name, l, inp } of every()) {
      for (const c of l.cranes) {
        const w = c.world;
        const yardL = Math.min(...w.yard) - 0.5;
        const yardR = Math.max(...w.yard) + 0.5;
        for (const lot of w.lots) {
          const half = inp.variant === "tall" ? 1 : lot.cols / 2;
          expect(lot.x - half, name).toBeGreaterThanOrEqual(w.tMin - 1);
          expect(lot.x + half, name).toBeLessThanOrEqual(w.tMax + 1);
          expect(
            lot.x + half <= yardL + 0.05 || lot.x - half >= yardR - 0.05,
            `${name}: lot in the yard`,
          ).toBe(true);
        }
        for (let i = 1; i < w.lots.length; i++) {
          const a = w.lots[i - 1]!;
          const b = w.lots[i]!;
          expect(Math.abs(a.x - b.x), name).toBeGreaterThanOrEqual((a.cols + b.cols) / 2);
        }
        for (const y of w.yard) {
          expect(y, name).toBeGreaterThanOrEqual(w.tMin - 0.01);
          expect(y, name).toBeLessThanOrEqual(w.tMax + 0.01);
        }
        expect(
          Math.abs(w.liftX - (Math.min(...w.yard) + Math.max(...w.yard)) / 2),
          name,
        ).toBeLessThan(w.yard.length * 1.2);
        // Buildings and hook room under the jib, and the jib's head in the lane.
        expect(w.maxRows * BH + 2.5, name).toBeLessThanOrEqual(w.jibY);
        expect(w.jibY + APEX, name).toBeLessThanOrEqual(w.height + 1e-6);
        if (inp.variant === "build") expect(w.maxRows, name).toBeGreaterThanOrEqual(4);
        // The world fills the lane exactly.
        expect(w.right * c.scene.s, name).toBeCloseTo(c.lane.width, 6);
      }
    }
  });

  it("lines the screen's lanes up over the frames below, with the lifts where frames say", () => {
    for (const n of [6, 3]) {
      const pair = n === 3;
      const cols: ScreenColumn[] = [];
      for (let p = 0; p < n; p++) {
        for (let c = 0; c < (pair ? 2 : 1); c++) {
          cols.push({
            pos: p,
            crane: c,
            from: (p + c / (pair ? 2 : 1)) / n,
            width: 1 / (n * (pair ? 2 : 1)),
            liftAt: defaultLiftShare(pair ? "pair" : "panel", c),
            mast: (c === 1 ? "right" : "left") as "left" | "right",
          });
        }
      }
      const s = screenLayout(SCREEN.width, SCREEN.height, cols, "build");
      expect(s.cranes).toHaveLength(6);
      s.cranes.forEach((c, i) => {
        const col = cols[i]!;
        expect(c.lane.x).toBeCloseTo(col.from * SCREEN.width, 6);
        // The lift is where the frame's lift leaves its top edge.
        expect(Math.abs(c.lift.x - (c.lane.x + (col.liftAt ?? 0) * c.lane.width))).toBeLessThan(
          0.5,
        );
        expect(c.world.maxRows).toBe(6);
        // Cranes stand tall on the big screen.
        expect(c.world.jibY * c.scene.s).toBeGreaterThan(SCREEN.height * 0.4);
      });
    }
    // The default lift share is where the frame's own layout puts it.
    const panel = layoutFor({ ...KINDS[0]!, cranes: 1, variant: "build" }).cranes[0]!;
    expect(defaultLiftShare("panel", 0)).toBeCloseTo(panel.lift.x / 1080, 9);
    const pair = layoutFor({ ...KINDS[1]!, cranes: 1, variant: "build" }).cranes[1]!;
    expect(defaultLiftShare("pair", 1)).toBeCloseTo((pair.lift.x - 1080) / 1080, 9);
  });
});
