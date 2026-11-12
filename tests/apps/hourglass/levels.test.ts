import { describe, expect, it } from "vitest";
import {
  CHAMBER,
  COLLAR,
  COLLAR_LAT,
  EMPTY,
  levelsAt,
  lowerLevel,
  lowerVolume,
  rollLevel,
  sandVolume,
  startLatitude,
  upperLevel,
  upperVolume,
} from "../../../src/apps/hourglass/levels";
import { createRng } from "../../../src/core/rng";
import { DEG, sphereInfo } from "../../../src/core/sphere";

const BALL = (4 / 3) * Math.PI;
const VOLUME = sandVolume(45 * DEG);

describe("hourglass levels", () => {
  it("measures the chambers as slices of the ball", () => {
    expect(upperVolume(1)).toBeCloseTo(CHAMBER, 12);
    expect(lowerVolume(-COLLAR)).toBeCloseTo(CHAMBER, 12);
    // The two chambers and the slab behind the collar make the whole ball.
    const slab = Math.PI * (2 * COLLAR - (2 * COLLAR ** 3) / 3);
    expect(2 * CHAMBER + slab).toBeCloseTo(BALL, 12);
    expect(upperVolume(COLLAR)).toBe(0);
    expect(lowerVolume(-1)).toBe(0);
    // A level inside the collar counts as its edge.
    expect(upperVolume(0)).toBe(0);
    expect(lowerVolume(0)).toBeCloseTo(CHAMBER, 12);
    expect(COLLAR).toBeCloseTo(Math.sin(COLLAR_LAT), 12);
  });

  it("finds the level for a volume, in both chambers", () => {
    for (const h of [COLLAR + 0.01, 0.3, 0.6, 0.9, 0.999]) {
      expect(upperLevel(upperVolume(h))).toBeCloseTo(h, 9);
      expect(lowerLevel(lowerVolume(-h))).toBeCloseTo(-h, 9);
    }
    expect(upperLevel(0)).toBeCloseTo(COLLAR, 9);
    expect(lowerLevel(0)).toBeCloseTo(-1, 9);
    // More than a chamber holds leaves it full.
    expect(upperLevel(CHAMBER * 2)).toBeCloseTo(1, 9);
    expect(lowerLevel(CHAMBER * 2)).toBeCloseTo(-COLLAR, 9);
  });

  it("starts a run with the sand a little above what people see, never past its range", () => {
    const usual = startLatitude(sphereInfo());
    expect(usual).toBeGreaterThan(sphereInfo().view.top);
    expect(usual).toBeLessThanOrEqual(60 * DEG);
    expect(startLatitude(sphereInfo(undefined, { view: { top: 10, bottom: -90 } }))).toBeCloseTo(
      30 * DEG,
      9,
    );
    expect(startLatitude(sphereInfo(undefined, { view: { top: 85, bottom: -90 } }))).toBeCloseTo(
      60 * DEG,
      9,
    );
    // The lower chamber has room for it all.
    expect(sandVolume(60 * DEG)).toBeLessThan(CHAMBER);
  });

  it("keeps all the sand: what has left the top is at the bottom", () => {
    let lastUpper = 2;
    let lastLower = -2;
    for (let i = 0; i <= 100; i++) {
      const left = 1 - i / 100;
      const { upper, lower, roll } = levelsAt(VOLUME, left, 1, true);
      expect(roll).toBe(0);
      const above = upper === EMPTY ? 0 : upperVolume(upper);
      const below = lower === EMPTY ? 0 : lowerVolume(lower);
      expect(above).toBeCloseTo(VOLUME * left, 8);
      expect(above + below).toBeCloseTo(VOLUME, 8);
      // One sinks as the other rises.
      if (upper !== EMPTY) {
        expect(upper).toBeLessThan(lastUpper);
        lastUpper = upper;
      }
      if (lower !== EMPTY) {
        expect(lower).toBeGreaterThan(lastLower);
        lastLower = lower;
      }
    }
  });

  it("starts full above and ends with everything below the collar", () => {
    const full = levelsAt(VOLUME, 1, 1, true);
    expect(full.upper).toBeCloseTo(Math.sin(45 * DEG), 9);
    expect(full.lower).toBe(EMPTY);
    const spent = levelsAt(VOLUME, 0, 1, true);
    expect(spent.upper).toBe(EMPTY);
    expect(spent.lower).toBeLessThan(-COLLAR);
    expect(spent.lower).toBeGreaterThan(-0.4);
    const resting = levelsAt(VOLUME, 0, 1, false);
    expect(resting).toEqual({ upper: EMPTY, lower: spent.lower, roll: 0 });
    // The upper edge is in the middle of its travel well before half the sand has gone.
    const half = levelsAt(VOLUME, 0.5, 1, true);
    expect(half.upper).toBeLessThan((Math.sin(45 * DEG) + COLLAR) / 2);
  });

  it("rolls the glass over with the sand level in the room and none lost", () => {
    expect(rollLevel(VOLUME, 0)).toBeCloseTo(lowerLevel(VOLUME), 9);
    expect(rollLevel(VOLUME, Math.PI)).toBeCloseTo(upperLevel(VOLUME), 9);
    // On its side, half a chamber of sand comes up to the middle.
    expect(rollLevel(CHAMBER / 2, Math.PI / 2)).toBeCloseTo(0, 3);
    // No jump where the rolled sum hands over to the upright formula.
    expect(rollLevel(VOLUME, 0.001)).toBeCloseTo(lowerLevel(VOLUME), 2);
    expect(rollLevel(VOLUME, Math.PI - 0.001)).toBeCloseTo(upperLevel(VOLUME), 2);
    // Count random points of the ball that are in the rolled chamber and under the level.
    const rng = createRng("hourglass-roll");
    for (const angle of [0.4, 1.1, Math.PI / 2, 2.3, 2.9]) {
      const level = rollLevel(VOLUME, angle);
      const ax = Math.sin(angle);
      const ay = -Math.cos(angle);
      let inside = 0;
      const tries = 200_000;
      for (let i = 0; i < tries; i++) {
        const x = rng.range(-1, 1);
        const y = rng.range(-1, 1);
        const z = rng.range(-1, 1);
        if (x * x + y * y + z * z < 1 && ax * x + ay * y > COLLAR && y < level) inside++;
      }
      expect((inside / tries) * 8).toBeCloseTo(VOLUME, 1);
    }
  });

  it("turns from upside down to upright with the sand in the chamber that ends on top", () => {
    const begun = levelsAt(VOLUME, 1, 0, true);
    expect(begun.roll).toBeCloseTo(Math.PI, 9);
    expect(begun.lower).toBe(EMPTY);
    // Upside down, the chamber above the collar is underneath: the picture at rest.
    expect(begun.upper).toBeCloseTo(levelsAt(VOLUME, 0, 1, false).lower, 9);
    let lastRoll = 4;
    let lastLevel = begun.upper;
    for (let i = 1; i < 60; i++) {
      const { upper, lower, roll } = levelsAt(VOLUME, 1, i / 60, true);
      expect(lower).toBe(EMPTY);
      expect(roll).toBeLessThan(lastRoll);
      expect(roll).toBeGreaterThan(0);
      // The level never leaps from one frame to the next.
      expect(Math.abs(upper - lastLevel)).toBeLessThan(0.08);
      lastRoll = roll;
      lastLevel = upper;
    }
    const upright = levelsAt(VOLUME, 1, 1, true);
    expect(upright.roll).toBe(0);
    expect(upright.upper).toBeCloseTo(lastLevel, 2);
  });
});
