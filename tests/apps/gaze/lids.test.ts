import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/core/rng";
import {
  blinkShape,
  createLids,
  gazeBlinkChance,
  LIDS,
  marginPlane,
} from "../../../src/apps/gaze/lids";
import type { MoodName } from "../../../src/apps/gaze/motion";

const DEG = Math.PI / 180;
const STEP = 1 / 60;
const mood = (m: MoodName): Record<MoodName, number> => ({
  watchful: 0,
  nervous: 0,
  curious: 0,
  drowsy: 0,
  [m]: 1,
});

describe("gaze lids", () => {
  it("blink from open to shut and back in about a third of a second", () => {
    const b = { t: 0, close: LIDS.close, hold: LIDS.hold, open: LIDS.open, depth: 1 };
    expect(blinkShape(b, 0)).toBe(0);
    expect(blinkShape(b, LIDS.close)).toBeCloseTo(1, 6);
    expect(blinkShape(b, LIDS.close + LIDS.hold / 2)).toBe(1);
    expect(blinkShape(b, LIDS.close + LIDS.hold + LIDS.open)).toBe(0);
    // Closing is quicker than opening.
    expect(blinkShape(b, LIDS.close / 2)).toBeLessThan(
      blinkShape(b, LIDS.close + LIDS.hold + LIDS.open / 2) + 0.5,
    );
    const total = LIDS.close + LIDS.hold + LIDS.open;
    expect(total).toBeGreaterThan(0.28);
    expect(total).toBeLessThan(0.4);
  });

  it("blinks about as often as people do, more when nervous, never too close together", () => {
    const rate = (m: MoodName) => {
      const lids = createLids(createRng(`rate-${m}`));
      let last = -1;
      let shortest = Infinity;
      let t = 0;
      for (let i = 0; i < 20 * 60 * 60; i++) {
        t += STEP;
        const before = lids.blinks;
        lids.step(STEP, 0, mood(m));
        if (lids.blinks > before) {
          if (last >= 0) shortest = Math.min(shortest, t - last);
          last = t;
        }
      }
      return { perMinute: lids.blinks / 20, shortest };
    };
    const watchful = rate("watchful");
    expect(watchful.perMinute).toBeGreaterThan(13);
    expect(watchful.perMinute).toBeLessThan(21);
    expect(watchful.shortest).toBeGreaterThanOrEqual(LIDS.minGap - STEP);
    expect(rate("nervous").perMinute).toBeGreaterThan(watchful.perMinute + 4);
    expect(rate("drowsy").perMinute).toBeLessThan(watchful.perMinute - 3);
  }, 30_000);

  it("blinks with big gaze shifts more often than small ones", () => {
    expect(gazeBlinkChance(10)).toBeLessThan(0.02);
    expect(gazeBlinkChance(40)).toBeCloseTo(LIDS.gazeMax / 2, 2);
    expect(gazeBlinkChance(70)).toBeGreaterThan(LIDS.gazeMax * 0.95);
    let last = 0;
    for (let a = 0; a <= 90; a += 5) {
      expect(gazeBlinkChance(a)).toBeGreaterThanOrEqual(last);
      last = gazeBlinkChance(a);
    }
  });

  it("shuts at once and squints a moment when the eye is touched", () => {
    const lids = createLids(createRng("reflex"));
    for (let i = 0; i < 60; i++) lids.step(STEP, 0, mood("watchful"));
    const open = lids.upper - lids.lower;
    lids.reflex();
    let shutAt = -1;
    for (let i = 1; i <= 30; i++) {
      lids.step(STEP, 0, mood("watchful"));
      if (shutAt < 0 && lids.shut > 0.99) shutAt = i * STEP;
    }
    expect(shutAt).toBeGreaterThan(0);
    expect(shutAt).toBeLessThan(0.08);
    // Open again, but narrower for a while.
    for (let i = 0; i < 20; i++) lids.step(STEP, 0, mood("watchful"));
    expect(lids.shut).toBe(0);
    expect(lids.upper - lids.lower).toBeLessThan(open - 4 * DEG);
    for (let i = 0; i < 120; i++) lids.step(STEP, 0, mood("watchful"));
    expect(lids.upper - lids.lower).toBeCloseTo(open, 2);
    expect(lids.reflexes).toBe(1);
  });

  it("follow the eye up and down, the upper lid most, and never cross", () => {
    const lids = createLids(createRng("follow"));
    const at = (e: number) => {
      for (let i = 0; i < 30; i++) lids.step(STEP, e, mood("watchful"));
      return { upper: lids.upper, lower: lids.lower };
    };
    const level = at(0);
    const down = at(-30 * DEG);
    expect(level.upper - down.upper).toBeCloseTo(30 * DEG * LIDS.upperDown, 2);
    expect(level.lower - down.lower).toBeCloseTo(30 * DEG * LIDS.lowerDown, 2);
    const up = at(25 * DEG);
    expect(up.upper).toBeGreaterThan(level.upper);
    const lids2 = createLids(createRng("never"));
    for (let i = 0; i < 10 * 60 * 60; i++) {
      lids2.step(STEP, Math.sin(i * 0.003) * 0.9, mood(i % 7200 < 3600 ? "drowsy" : "nervous"));
      if (i % 97 === 0) lids2.reflex();
      expect(lids2.upper).toBeGreaterThanOrEqual(lids2.lower);
    }
  });

  it("close all the way in a full blink, the upper lid coming down to a barely risen lower", () => {
    for (const e of [-20, 0, 25]) {
      const lids = createLids(createRng(`close-${e}`));
      for (let i = 0; i < 60; i++) lids.step(STEP, e * DEG, mood("watchful"));
      const open = { upper: lids.upper, lower: lids.lower };
      lids.blink();
      let closed = false;
      for (let i = 0; i < 30; i++) {
        lids.step(STEP, e * DEG, mood("watchful"));
        if (lids.shut === 1) {
          closed = true;
          expect(lids.upper - lids.lower).toBeCloseTo(0, 9);
          // The lower lid rises only a little of the way.
          expect(lids.lower - open.lower).toBeLessThan(0.15 * (open.upper - open.lower));
        }
      }
      expect(closed).toBe(true);
    }
  });

  it("puts each margin's plane through its elevation straight out in front", () => {
    const c = [0, 2.6, 0] as const;
    const r = 2;
    for (const a of [-27, 0, 20]) {
      const [nx, ny, nz, w] = marginPlane(c, r, a * DEG);
      const front = [0, c[1] + r * Math.sin(a * DEG), r * Math.cos(a * DEG)];
      expect(nx * front[0]! + ny * front[1]! + nz * front[2]! + w).toBeCloseTo(0, 9);
      // The top of the ball is above it.
      expect(ny * (c[1] + r) + w).toBeGreaterThan(0);
    }
  });

  it("grow heavy when content, the lower lid raised, and blink slowly", () => {
    const run = (relax: number) => {
      const lids = createLids(createRng("content"));
      let shutFor = 0;
      let longest = 0;
      let opening = 0;
      let n = 0;
      for (let i = 0; i < 120 * 60; i++) {
        lids.step(STEP, 20 * DEG, mood("watchful"), relax);
        if (lids.shut > 0.9) shutFor += STEP;
        else {
          longest = Math.max(longest, shutFor);
          shutFor = 0;
        }
        if (lids.shut === 0) {
          opening += lids.upper - lids.lower;
          n++;
        }
      }
      return { lids, longest, opening: opening / n };
    };
    const awake = run(0);
    const content = run(1);
    expect(content.lids.upper).toBeLessThan(awake.lids.upper - 15 * DEG);
    expect(content.lids.lower).toBeGreaterThan(awake.lids.lower + 10 * DEG);
    expect(content.opening).toBeLessThan(awake.opening * 0.6);
    expect(content.opening).toBeGreaterThanOrEqual(LIDS.gap - 1e-9);
    // A slow blink holds the lids shut a good while; an ordinary one barely does.
    expect(content.longest).toBeGreaterThan(0.3);
    expect(awake.longest).toBeLessThan(0.15);
    expect(content.lids.blinks).toBeLessThan(awake.lids.blinks);
  });

  it("blink slowly as contentment settles", () => {
    const lids = createLids(createRng("settle"));
    for (let i = 0; i < 60; i++) lids.step(STEP, 0, mood("watchful"));
    const before = lids.blinks;
    let shut = 0;
    for (let i = 0; i < 90; i++) {
      lids.step(STEP, 0, mood("watchful"), Math.min(1, i / 60));
      shut = Math.max(shut, lids.shut);
    }
    expect(lids.blinks).toBeGreaterThan(before);
    expect(shut).toBe(1);
  });
});
