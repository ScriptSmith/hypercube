import { describe, expect, it } from "vitest";
import { CLOCK, makeCracks } from "../../../src/apps/hatch/cracks";
import {
  brightness,
  candleMix,
  chickPose,
  crackClock,
  dayOf,
  dryness,
  eggOrientation,
  hatchState,
  pipHole,
  tilt,
} from "../../../src/apps/hatch/motion";
import {
  createShow,
  type EggPlan,
  findStage,
  type ShowOptions,
} from "../../../src/apps/hatch/show";
import { createRng } from "../../../src/core/rng";
import { apply3, DEG } from "../../../src/core/sphere";

const OPTS: ShowOptions = { variant: "hatch", pace: "normal", shell: "mixed", viewTop: 40 * DEG };

const second = (opts = OPTS): EggPlan => {
  const show = createShow(createRng("m"), opts);
  const first = show.egg(0);
  return show.egg(first.duration + 1);
};

describe("the egg's movement", () => {
  it("rocks only a few degrees, and more as the stirring goes on", () => {
    const e = second();
    const stir = findStage(e, "stir")!;
    let early = 0;
    let late = 0;
    let most = 0;
    for (let t = 0; t < e.duration; t += 0.05) {
      const [x, z] = tilt(e, t);
      const a = Math.hypot(x, z);
      most = Math.max(most, a);
      const f = (t - stir.start) / (stir.end - stir.start);
      if (f >= 0 && f < 0.3) early = Math.max(early, a);
      if (f >= 0.7 && f < 1) late = Math.max(late, a);
    }
    expect(most).toBeLessThan(6 * DEG);
    expect(late).toBeGreaterThan(early);
  });

  it("keeps the egg's orientation a rotation", () => {
    const e = second();
    for (let t = 0; t < e.duration; t += 7.3) {
      const m = eggOrientation(e, t);
      const v = apply3(m, [0.3, 0.8, -0.52]);
      expect(Math.hypot(...v)).toBeCloseTo(Math.hypot(0.3, 0.8, -0.52), 9);
    }
  });
});

describe("the crack clock", () => {
  it("never runs backwards and reaches each kind of crack in its stage", () => {
    const e = second();
    let last = -1;
    for (let t = 0; t < e.duration; t += 0.1) {
      const c = crackClock(e, t);
      expect(c).toBeGreaterThanOrEqual(last - 1e-12);
      last = c;
    }
    const at = (id: Parameters<typeof findStage>[1]) => findStage(e, id)!;
    expect(crackClock(e, at("stir").end - 0.01)).toBe(0);
    expect(crackClock(e, at("pip").end - 0.01)).toBeCloseTo(CLOCK.star[1], 6);
    expect(crackClock(e, at("zip").end - 0.01)).toBeCloseTo(CLOCK.zip[1], 6);
    expect(crackClock(e, at("hatch").end - 0.01)).toBeCloseTo(CLOCK.lower[1], 6);
  });

  it("opens the pip hole only from its tap, then lets it grow to full size", () => {
    const e = second();
    expect(pipHole(e, e.taps[e.holeTap]! - 0.01)).toBe(0);
    expect(pipHole(e, e.taps[e.holeTap]! + 0.3)).toBeGreaterThan(0);
    expect(pipHole(e, findStage(e, "pip")!.end)).toBeCloseTo(1, 6);
  });
});

describe("the hatch", () => {
  it("lifts the cap away and lets every lower piece fall and go before the stage ends", () => {
    const e = second();
    const net = makeCracks(createRng("h"), e);
    const hatch = findStage(e, "hatch")!;
    const before = hatchState(e, net, hatch.start);
    expect(before.moving).toBe(false);
    const end = hatchState(e, net, hatch.end - 0.01);
    expect(end.cap.alpha).toBeLessThan(0.01);
    for (const p of end.pieces) expect(p.alpha).toBeLessThan(0.05);
    // The cup goes last.
    const mid = hatchState(e, net, (hatch.start + hatch.end) / 2);
    expect(mid.pieces[mid.pieces.length - 1]!.alpha).toBe(1);
    expect(Math.min(...mid.pieces.map((p) => p.alpha))).toBeLessThan(1);
  });

  it("turns a falling piece downwards", () => {
    const e = second();
    const net = makeCracks(createRng("h"), e);
    const hatch = findStage(e, "hatch")!;
    const s = hatchState(e, net, hatch.start + 0.7 * (hatch.end - hatch.start));
    const p = s.pieces[0]!;
    // The inverse takes the room back to the piece; its middle came from higher up.
    const seen = apply3(p.inverse, p.centre);
    expect(seen[1]).toBeGreaterThan(p.centre[1]);
  });
});

describe("the chick", () => {
  it("dries from wet to fluffy over the dry stage, never going back", () => {
    const e = second();
    const dry = findStage(e, "dry")!;
    expect(dryness(e, dry.start)).toBe(0);
    expect(dryness(e, dry.end)).toBeCloseTo(1, 6);
    const mid = dryness(e, (dry.start + dry.end) / 2);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    let last = 0;
    for (let t = dry.start; t <= dry.end; t += 0.25) {
      const d = dryness(e, t);
      expect(d).toBeGreaterThanOrEqual(last - 1e-12);
      last = d;
    }
  });

  it("blinks, cheeps and dozes, and turns round so its face visits every side", () => {
    const e = second();
    const net = makeCracks(createRng("h"), e);
    const chick = findStage(e, "chick")!;
    let closed = 0;
    let open = 0;
    let beak = 0;
    const facing: number[] = [];
    for (let t = chick.start; t < chick.end; t += 0.05) {
      const p = chickPose(e, net, t);
      if (p.lids > 0.9) closed++;
      if (p.lids < 0.1) open++;
      beak = Math.max(beak, p.beak);
      // Face direction in the room: the inverse's transpose applied to +z.
      const m = p.inverse;
      facing.push(Math.atan2(m[6], m[8]));
    }
    expect(closed).toBeGreaterThan(20);
    expect(open).toBeGreaterThan(closed);
    expect(beak).toBeGreaterThan(0.9);
    const sectors = new Set(facing.map((a) => Math.floor(((a + Math.PI) / (2 * Math.PI)) * 6)));
    expect(sectors.size).toBe(6);
  });
});

describe("fades and the candling day", () => {
  it("fades each egg in and its chick out, never to black", () => {
    const e = second();
    expect(brightness(e, 0)).toBeLessThan(0.1);
    expect(brightness(e, 0)).toBeGreaterThan(0);
    expect(brightness(e, 10)).toBeCloseTo(1, 6);
    expect(brightness(e, e.duration)).toBeLessThan(0.1);
  });

  it("counts candling days at the planned pace, then brings the light up", () => {
    const e = second({ ...OPTS, variant: "candling" });
    const candle = findStage(e, "candle")!;
    expect(dayOf(e, 0)).toBe(1);
    expect(dayOf(e, 3.5 * e.secondsPerDay)).toBeCloseTo(4.5, 9);
    expect(Math.floor(dayOf(e, candle.end - 0.01))).toBe(21);
    expect(candleMix(e, candle.end - 1)).toBe(1);
    expect(candleMix(e, candle.end + 5)).toBe(0);
    const plain = second();
    expect(candleMix(plain, 10)).toBe(0);
  });
});
