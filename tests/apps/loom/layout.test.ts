import { describe, expect, it } from "vitest";
import {
  type Circle,
  controlAt,
  type Layout,
  MIN_DIAL,
  MIN_HANDLE,
  MIN_TARGET,
  perFrame,
  SEAM_SHARE,
  sliderValue,
  sliderY,
  type StrandSpec,
} from "../../../src/apps/loom/layout";
import type { FrameKind, Rect } from "../../../src/core/types";
import { layoutInput, layoutOf } from "./helpers";

interface Case {
  name: string;
  kind: FrameKind;
  layout: Layout;
  childTop: number;
  adultTop: number;
  strands: number;
}

const cases: Case[] = [
  ...(["panel", "pair", "kiosk"] as const).map((kind) => ({
    name: `solo ${kind}`,
    kind,
    layout: layoutOf(kind),
    childTop: layoutInput(kind).reachTop.child,
    adultTop: layoutInput(kind).reachTop.adult,
    strands: kind === "panel" ? 5 : 6,
  })),
  ...[6, 8, 10].map((n) => ({
    name: `wall of ${n}`,
    kind: "wall" as const,
    layout: layoutOf("wall", { harmonics: n }),
    childTop: layoutInput("wall").reachTop.child,
    adultTop: layoutInput("wall").reachTop.adult,
    strands: n,
  })),
  ...(["panel", "pair"] as const).map((kind) => ({
    name: `bank ${kind}`,
    kind,
    layout: layoutOf(kind, { bank: true, firstK: 5 }),
    childTop: layoutInput(kind).reachTop.child,
    adultTop: layoutInput(kind).reachTop.adult,
    strands: kind === "panel" ? 1 : 2,
  })),
];

const handle = (s: StrandSpec, amp: number): Rect => ({
  x: s.slider.x - s.slider.w / 2,
  y: sliderY(s.slider, amp) - s.slider.h / 2,
  width: s.slider.w,
  height: s.slider.h,
});

const track = (s: StrandSpec): Rect => ({
  x: s.slider.x - s.slider.w / 2,
  y: s.slider.y1 - s.slider.h / 2,
  width: s.slider.w,
  height: s.slider.y0 - s.slider.y1 + s.slider.h,
});

const circleBox = (c: Circle): Rect => ({
  x: c.x - c.r,
  y: c.y - c.r,
  width: 2 * c.r,
  height: 2 * c.r,
});

const overlap = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height + gap &&
  b.y < a.y + a.height + gap;

const circlesOverlap = (a: Circle, b: Circle, gap = 0) =>
  Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + gap;

const insideFrame = (r: Rect, l: Layout) =>
  r.x >= -1e-6 &&
  r.y >= -1e-6 &&
  r.x + r.width <= l.width + 1e-6 &&
  r.y + r.height <= l.height + 1e-6;

describe("loom layout", () => {
  for (const c of cases) {
    const l = c.layout;
    it(`keeps every control on the frame, big enough and apart: ${c.name}`, () => {
      expect(l.strands).toHaveLength(c.strands);
      const resets = [l.reset, ...l.strands.map((s) => s.reset)].filter((r): r is Circle => !!r);
      expect(resets.length).toBeGreaterThanOrEqual(1);
      for (const s of l.strands) {
        expect(2 * s.dial.r).toBeGreaterThanOrEqual(
          c.kind === "panel" || c.kind === "pair" ? MIN_DIAL : MIN_TARGET,
        );
        expect(s.slider.w).toBeGreaterThanOrEqual(MIN_HANDLE);
        expect(s.slider.h).toBeGreaterThanOrEqual(MIN_HANDLE);
        expect(s.slider.y0 - s.slider.y1).toBeGreaterThan(150);
        expect(insideFrame(circleBox(s.dial), l), `${c.name} dial ${s.k}`).toBe(true);
        expect(insideFrame(track(s), l), `${c.name} slider ${s.k}`).toBe(true);
      }
      for (const r of resets) {
        expect(2 * r.r).toBeGreaterThanOrEqual(MIN_TARGET);
        expect(insideFrame(circleBox(r), l)).toBe(true);
      }
      // Nothing overlaps: dials, slider tracks and resets.
      for (const s of l.strands) {
        for (const t of l.strands) {
          if (t !== s)
            expect(circlesOverlap(s.dial, t.dial, 8), `${c.name} dials ${s.k} ${t.k}`).toBe(false);
          expect(
            overlap(track(s), circleBox(t.dial), 8),
            `${c.name} slider ${s.k} dial ${t.k}`,
          ).toBe(false);
          if (t !== s) expect(overlap(track(s), track(t), 8)).toBe(false);
        }
        for (const r of resets) {
          expect(circlesOverlap(r, s.dial, 8), `${c.name} reset by dial ${s.k}`).toBe(false);
          expect(overlap(circleBox(r), track(s), 8), `${c.name} reset by slider ${s.k}`).toBe(
            false,
          );
        }
      }
    });

    it(`puts each slider in the children's band, lowest, and its dial above it within reach: ${c.name}`, () => {
      for (const s of l.strands) {
        // The whole travel of the handle is in the children's band.
        expect(handle(s, 1).y, `${c.name} slider ${s.k}`).toBeGreaterThanOrEqual(c.childTop - 1e-6);
        expect(handle(s, 0).y + s.slider.h).toBeLessThanOrEqual(l.height);
        // The dial is above the slider, inside adult reach.
        expect(s.dial.y + s.dial.r).toBeLessThan(handle(s, 1).y);
        expect(s.dial.y - s.dial.r).toBeGreaterThanOrEqual(c.adultTop - 1e-6);
      }
      // Nothing of anyone's controls is lower than the sliders' tops... the sliders are the lowest.
      const lowestDial = Math.max(...l.strands.map((s) => s.dial.y + s.dial.r));
      const highestSlider = Math.min(...l.strands.map((s) => handle(s, 1).y));
      expect(lowestDial).toBeLessThan(highestSlider);
    });

    it(`keeps the picture above the controls and the threads' columns in order: ${c.name}`, () => {
      const top = Math.min(...l.strands.map((s) => s.dial.y - s.dial.r));
      expect(l.picture.y + l.picture.height).toBeLessThanOrEqual(l.heddle);
      expect(l.heddle).toBeLessThan(top);
      if (l.cloth) expect(l.cloth.y + l.cloth.height).toBeLessThanOrEqual(l.picture.y);
      const xs = l.strands.map((s) => s.col.x);
      expect([...xs].sort((a, b) => a - b)).toEqual(xs);
      // Harmonic numbers run left to right.
      const ks = l.strands.map((s) => s.k);
      expect(ks).toEqual(ks.map((_, i) => ks[0]! + i));
    });
  }

  it("keeps a pair's controls a fifth of its width from the seam, never mirrored across it", () => {
    for (const bank of [false, true]) {
      const l = layoutOf("pair", { bank });
      const seam = l.width / 2;
      const margin = l.width * SEAM_SHARE;
      const boxes = l.strands.flatMap((s) => [
        { s, r: circleBox(s.dial) },
        { s, r: track(s) },
        ...(s.reset ? [{ s, r: circleBox(s.reset) }] : []),
      ]);
      if (l.reset) boxes.push({ s: l.strands[0]!, r: circleBox(l.reset) });
      for (const { r } of boxes) {
        const left = r.x + r.width <= seam;
        if (left) expect(seam - (r.x + r.width)).toBeGreaterThanOrEqual(margin - 1e-6);
        else expect(r.x - seam).toBeGreaterThanOrEqual(margin - 1e-6);
      }
      // A control's mirror image across the seam is never another control at the same height.
      const dials = l.strands.map((s) => s.dial);
      for (const a of dials) {
        for (const b of dials) {
          if (a.x >= seam || b.x <= seam) continue;
          const mirrored = Math.abs(a.x - (2 * seam - b.x)) < 30 && Math.abs(a.y - b.y) < 60;
          expect(
            mirrored,
            `${bank ? "bank" : "solo"} dials at ${a.x},${a.y} and ${b.x},${b.y}`,
          ).toBe(false);
        }
      }
      const sliders = l.strands.map((s) => s.slider);
      for (const a of sliders) {
        for (const b of sliders) {
          if (a.x >= seam || b.x <= seam) continue;
          const mirrored = Math.abs(a.x - (2 * seam - b.x)) < 30 && Math.abs(a.y1 - b.y1) < 30;
          expect(mirrored).toBe(false);
        }
      }
    }
  });

  it("gives a bank frame its harmonics from its place, and a column per panel", () => {
    const panel = layoutOf("panel", { bank: true, firstK: 4 });
    expect(panel.strands.map((s) => s.k)).toEqual([4]);
    expect(panel.strands[0]!.col).toEqual({ x: 540, w: 1080 });
    const pair = layoutOf("pair", { bank: true, firstK: 7 });
    expect(pair.strands.map((s) => s.k)).toEqual([7, 8]);
    expect(pair.strands.map((s) => s.col)).toEqual([
      { x: 540, w: 1080 },
      { x: 1620, w: 1080 },
    ]);
    expect(perFrame("panel")).toBe(1);
    expect(perFrame("pair")).toBe(2);
    // However wide a bank frame is, its columns split it evenly, as the screen splits the bank.
    const wide = layoutOf("pair", { bank: true, width: 3600 });
    expect(wide.strands.map((s) => s.col)).toEqual([
      { x: 900, w: 1800 },
      { x: 2700, w: 1800 },
    ]);
  });

  it("centres a design on a wider frame and keeps it to the bottom edge", () => {
    const base = layoutOf("panel", { bank: true });
    const wide = layoutOf("panel", { bank: true, width: 1480, height: 2120 });
    const s0 = base.strands[0]!;
    const s1 = wide.strands[0]!;
    expect(s1.col.x - s0.col.x).toBeCloseTo(200, 9);
    expect(s1.slider.y0 - s0.slider.y0).toBeCloseTo(200, 9);
    expect(wide.picture.width).toBeCloseTo(base.picture.width + 400, 9);
  });

  it("maps a finger on a slider to an amplitude anywhere along it, and finds the control under it", () => {
    const l = layoutOf("panel", { bank: true });
    const s = l.strands[0]!;
    expect(sliderValue(s.slider, s.slider.y0)).toBe(0);
    expect(sliderValue(s.slider, s.slider.y1)).toBe(1);
    expect(sliderValue(s.slider, (s.slider.y0 + s.slider.y1) / 2)).toBeCloseTo(0.5, 9);
    expect(sliderValue(s.slider, s.slider.y0 + 100)).toBe(0);
    expect(sliderY(s.slider, 0.25)).toBeCloseTo(
      s.slider.y0 + (s.slider.y1 - s.slider.y0) * 0.25,
      9,
    );
    expect(controlAt(l, s.slider.x, sliderY(s.slider, 0.3))).toEqual({ type: "slider", strand: 0 });
    expect(controlAt(l, s.dial.x + s.dial.r * 0.8, s.dial.y)).toEqual({ type: "dial", strand: 0 });
    expect(controlAt(l, 20, 20)).toBeNull();
  });
});
