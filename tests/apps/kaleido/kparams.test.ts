import { describe, expect, it } from "vitest";
import {
  C_SPEED,
  cFromHand,
  createFollower,
  drift,
  handTargets,
  type KParams,
  MIRROR_FADE_S,
  MIRROR_HOLD_S,
  mirrorsFromHand,
  rotFromHand,
  zoomFromHand,
  ZOOM_MAX,
  ZOOM_MIN,
} from "../../../src/apps/kaleido/kparams";

/** Escape-time test: is c in the Mandelbrot set (to `n` iterations)? */
const inSet = (cx: number, cy: number, n = 300) => {
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    [x, y] = [x * x - y * y + cx, 2 * x * y + cy];
    if (x * x + y * y > 4) return false;
  }
  return true;
};

describe("kaleidoscope parameters from hands", () => {
  it("spread c along a band around the main cardioid's edge, inside low and outside high", () => {
    let inside = 0;
    let outside = 0;
    for (let i = 0; i <= 20; i++) {
      const x = i / 20;
      const low = cFromHand(x, 0);
      const high = cFromHand(x, 1);
      if (inSet(low.cx, low.cy)) inside++;
      if (!inSet(high.cx, high.cy)) outside++;
      // Every c stays near the set, where Julia sets have detail.
      expect(Math.hypot(low.cx, low.cy)).toBeLessThan(1.1);
      expect(Math.hypot(high.cx, high.cy)).toBeLessThan(1.1);
    }
    expect(inside).toBeGreaterThanOrEqual(19);
    expect(outside).toBeGreaterThanOrEqual(10);
  });

  it("move c steadily as a hand slides, with no jumps", () => {
    let prev = cFromHand(0, 0.5);
    for (let i = 1; i <= 200; i++) {
      const c = cFromHand(i / 200, 0.5);
      expect(Math.hypot(c.cx - prev.cx, c.cy - prev.cy)).toBeLessThan(0.02);
      prev = c;
    }
  });

  it("turn and zoom with the second hand and choose mirrors with the third", () => {
    expect(rotFromHand(0.5)).toBeCloseTo(0);
    expect(rotFromHand(0)).toBeCloseTo(-Math.PI);
    expect(zoomFromHand(0)).toBeCloseTo(ZOOM_MIN);
    expect(zoomFromHand(1)).toBeCloseTo(ZOOM_MAX);
    expect([0.1, 0.5, 0.9].map(mirrorsFromHand)).toEqual([6, 8, 12]);
    expect(mirrorsFromHand(-1)).toBe(6);
    expect(mirrorsFromHand(2)).toBe(12);
  });

  it("give each role to hands in the order they touched", () => {
    const base = drift(0, 6);
    expect(handTargets([], base)).toEqual(base);
    const one = handTargets([{ x: 0.2, b: 0.3, since: 50 }], base);
    expect(one.cx).toBeCloseTo(cFromHand(0.2, 0.3).cx);
    expect(one.rot).toBe(base.rot);
    const three = handTargets(
      [
        { x: 0.95, b: 0.9, since: 300 },
        { x: 0.2, b: 0.3, since: 50 },
        { x: 0.6, b: 1, since: 100 },
      ],
      base,
    );
    expect(three.cx).toBeCloseTo(cFromHand(0.2, 0.3).cx);
    expect(three.rot).toBeCloseTo(rotFromHand(0.6));
    expect(three.zoom).toBeCloseTo(zoomFromHand(1));
    expect(three.mirrors).toBe(12);
  });

  it("drift slowly along a smooth path with nobody touching", () => {
    let prev = drift(0, 6);
    for (let t = 1 / 60; t < 600; t += 1 / 60) {
      const p = drift(t, 6);
      expect(Math.hypot(p.cx - prev.cx, p.cy - prev.cy)).toBeLessThan(0.002);
      expect(
        Math.abs(Math.atan2(Math.sin(p.rot - prev.rot), Math.cos(p.rot - prev.rot))),
      ).toBeLessThan(0.002);
      expect(Math.abs(Math.log(p.zoom / prev.zoom))).toBeLessThan(0.002);
      expect(p.mirrors).toBe(6);
      prev = p;
    }
  });
});

describe("follower", () => {
  const start: KParams = { cx: -0.7, cy: 0.2, rot: 0, zoom: 1, mirrors: 6 };

  it("eases towards a jump and caps how fast c moves, so the picture never flashes", () => {
    const f = createFollower(start);
    const target = { ...start, cx: 0.3, cy: -0.5, rot: 3, zoom: 2 };
    let prev = { ...f.now };
    for (let i = 0; i < 600; i++) {
      const p = f.step(1 / 60, target);
      expect(Math.hypot(p.cx - prev.cx, p.cy - prev.cy)).toBeLessThanOrEqual(C_SPEED / 60 + 1e-9);
      expect(Math.abs(p.rot - prev.rot)).toBeLessThan(0.08);
      prev = { ...p };
    }
    expect(f.now.rot).toBeCloseTo(3, 2);
    expect(f.now.zoom).toBeCloseTo(2, 2);
    for (let i = 0; i < 1200; i++) f.step(1 / 60, target);
    expect(f.now.cx).toBeCloseTo(0.3, 2);
  });

  it("turns the short way round", () => {
    const f = createFollower({ ...start, rot: 3 });
    f.step(0.1, { ...start, rot: -3 });
    expect(f.now.rot).toBeGreaterThan(3);
  });

  it("crossfades a change of mirrors and allows one every few seconds at most", () => {
    const f = createFollower(start);
    const changes: number[] = [];
    let mirrors = 6;
    for (let i = 0; i < 60 * 20; i++) {
      // A child sliding a finger back and forth across the thirds.
      const want = [6, 8, 12][Math.floor(i / 7) % 3]!;
      f.step(1 / 60, { ...start, mirrors: want });
      if (f.now.mirrors !== mirrors) {
        changes.push(i / 60);
        mirrors = f.now.mirrors;
        expect(f.fade).toBe(0);
      }
    }
    expect(changes.length).toBeGreaterThan(2);
    for (let i = 1; i < changes.length; i++) {
      expect(changes[i]! - changes[i - 1]!).toBeGreaterThanOrEqual(
        Math.max(MIRROR_HOLD_S, MIRROR_FADE_S) - 0.02,
      );
    }
  });

  it("jumps to a screen's parameters when told to", () => {
    const f = createFollower(start);
    f.set({ ...start, mirrors: 12, cx: 0.1 });
    expect(f.now.mirrors).toBe(12);
    expect(f.fade).toBe(1);
    expect(f.fromMirrors).toBe(12);
  });
});
