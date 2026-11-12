import { describe, expect, it } from "vitest";
import {
  AIM_ROUND,
  AIM_UNDER,
  BOW_EVERY,
  CHIN_LIFT,
  createShow,
  easeTurn,
  floorTilt,
  OPENING_HOLD,
  OVERSHOOT,
  PACES,
  type Pace,
  REACH,
  type Show,
  type ShowOptions,
  SIDES,
  sideOf,
  snapDown,
  snapUp,
  type Stage,
  SWEEP_EVERY,
  sweepTurn,
} from "../../../src/apps/salute/show";
import { createRng } from "../../../src/core/rng";
import { DEG, sphereInfo, wrapLon } from "../../../src/core/sphere";
import { DEFAULT_VENUE } from "../../../src/core/venue";

const HZ = 60;
const TAU = Math.PI * 2;
const BALL = sphereInfo(DEFAULT_VENUE.sphere);

const make = (seed: string, o: Partial<ShowOptions> = {}): Show =>
  createShow(createRng(seed), {
    pace: "formal",
    hold: false,
    sphere: BALL,
    gallery: false,
    ...o,
  });

const run = (show: Show, seconds: number, each?: (show: Show) => void) => {
  const n = Math.round(seconds * HZ);
  for (let i = 0; i < n; i++) {
    show.step(1 / HZ);
    each?.(show);
  }
};

/** Step until the show is in `stage`, for at most `limit` seconds. */
const until = (show: Show, stage: Stage, kind?: string, limit = 900) => {
  for (let i = 0; i < limit * HZ; i++) {
    show.step(1 / HZ);
    if (show.stage === stage && (kind === undefined || show.kind === kind)) return;
  }
  throw new Error(`never reached ${stage} ${kind ?? ""}`);
};

describe("the show's easings", () => {
  it("turn the head with no jolt at either end", () => {
    expect(easeTurn(0)).toBe(0);
    expect(easeTurn(1)).toBe(1);
    expect(easeTurn(0.5)).toBeCloseTo(0.5, 12);
    expect(easeTurn(0.01)).toBeLessThan(1e-4);
    let last = 0;
    for (let u = 0; u <= 1; u += 0.01) {
      expect(easeTurn(u)).toBeGreaterThanOrEqual(last);
      last = easeTurn(u);
    }
  });

  it("snap the hand up fast, a little past the brow and back onto it", () => {
    expect(snapUp(0)).toBe(0);
    expect(snapUp(1)).toBe(1);
    // Most of the way in the first third of the time.
    expect(snapUp(1 / 3)).toBeGreaterThan(0.85);
    let peak = 0;
    for (let u = 0; u <= 1; u += 0.001) peak = Math.max(peak, snapUp(u));
    expect(peak - 1).toBeCloseTo(OVERSHOOT, 3);
    expect(snapDown(0)).toBe(1);
    expect(snapDown(1)).toBe(0);
    // It gathers speed: less than half the way down at half time.
    expect(snapDown(0.5)).toBeGreaterThan(0.6);
  });

  it("carry a full turn at a steady rate between an eased start and stop", () => {
    expect(sweepTurn(0)).toBe(0);
    expect(sweepTurn(1)).toBeCloseTo(1, 12);
    expect(sweepTurn(0.5)).toBeCloseTo(0.5, 12);
    let fastest = 0;
    for (let u = 0.001; u <= 1; u += 0.001) {
      const rate = (sweepTurn(u) - sweepTurn(u - 0.001)) / 0.001;
      expect(rate).toBeGreaterThanOrEqual(0);
      fastest = Math.max(fastest, rate);
    }
    expect(fastest).toBeLessThan(1.12);
  });
});

describe("the tilt towards people on the floor", () => {
  it("points the face at the eyes of someone standing off from the ball", () => {
    const tilt = floorTilt(BALL, 8);
    expect(tilt).toBeCloseTo(-Math.atan2(BALL.centreY - 1.6, 8), 12);
    // Nearer people need a steeper tilt, within limits.
    expect(floorTilt(BALL, 5)).toBeLessThan(tilt);
    expect(floorTilt(BALL, 0.5) / DEG).toBeCloseTo(-38, 9);
    expect(floorTilt(BALL, 500) / DEG).toBeCloseTo(-8, 9);
  });
});

describe("the salute show", () => {
  it("gives the same show for the same seed and a different one for another", () => {
    const a = make("one");
    const b = make("one");
    const c = make("two");
    let differs = false;
    run(a, 300, () => {
      b.step(1 / HZ);
      c.step(1 / HZ);
      expect(b.pose).toEqual(a.pose);
      if (Math.abs(c.pose.bearing - a.pose.bearing) > 0.2) differs = true;
    });
    expect(differs).toBe(true);
  });

  it("opens facing bearing 0 with a long salute, for a preview", () => {
    const show = make("open");
    expect(show.pose.raise).toBe(0);
    run(show, 1.2);
    expect(show.stage).toBe("hold");
    expect(show.pose.bearing).toBe(0);
    expect(show.pose.raise).toBe(1);
    run(show, OPENING_HOLD - 0.5);
    expect(show.stage).toBe("hold");
    expect(show.pose.raise).toBe(1);
    run(show, 2);
    expect(show.stage).not.toBe("hold");
  });

  it("goes through each stop in order: turn, settle, raise, hold, lower, relax", () => {
    const order: Stage[] = ["turn", "settle", "raise", "hold", "lower", "relax"];
    const show = make("order");
    let last = show.stage;
    let changes = 0;
    run(show, 1800, () => {
      if (show.stage === last) return;
      expect(order.indexOf(show.stage)).toBe((order.indexOf(last) + 1) % order.length);
      last = show.stage;
      changes++;
    });
    expect(changes).toBeGreaterThan(900);
  });

  it("keeps the hand out of sight except in a salute, which it snaps up to and holds still", () => {
    const show = make("hand");
    let raiseStart = 0;
    let lowest = 0;
    let highest = 0;
    let longestSnap = 0;
    // Steps on which the hand was somewhere it shouldn't be for the stage.
    let astray = 0;
    run(show, 1800, () => {
      const { raise } = show.pose;
      lowest = Math.min(lowest, raise);
      highest = Math.max(highest, raise);
      if (show.stage === "hold" && raise !== 1) astray++;
      const away = show.stage === "turn" || show.stage === "settle" || show.stage === "relax";
      if (away && raise !== 0) astray++;
      if (show.stage === "settle") raiseStart = show.time;
      if (show.stage === "raise") longestSnap = Math.max(longestSnap, show.time - raiseStart);
    });
    expect(lowest).toBe(0);
    expect(highest).toBeGreaterThan(1);
    expect(highest).toBeLessThanOrEqual(1 + OVERSHOOT + 1e-6);
    expect(astray).toBe(0);
    // Up within the snap's time.
    expect(longestSnap).toBeLessThanOrEqual(PACES.formal.raise + 2 / HZ);
  });

  it("sets its face for the salute and relaxes after it", () => {
    const show = make("face");
    until(show, "hold", "floor");
    run(show, 1);
    expect(show.pose.brow).toBeGreaterThan(0.95);
    expect(show.pose.smile).toBeLessThan(0.05);
    const lifted = show.pose.pitch;
    until(show, "relax");
    run(show, 0.8);
    expect(show.pose.smile).toBeGreaterThan(0.9);
    expect(show.pose.brow).toBeLessThan(0.6);
    // The chin came down again.
    expect(lifted - show.pose.pitch).toBeCloseTo(CHIN_LIFT, 2);
    until(show, "turn");
    run(show, 1);
    expect(show.pose.smile).toBeLessThan(0.6);
  });

  it("tilts down towards people on the floor and aims the hand's side at them", () => {
    const show = make("tilt");
    let stops = 0;
    let was: Stage = show.stage;
    run(show, 1200, () => {
      if (show.stage === "hold" && was !== "hold" && show.kind === "floor") {
        stops++;
        expect(show.pose.pitch / DEG).toBeLessThan(-8);
        expect(show.pose.pitch / DEG).toBeGreaterThan(-39);
        expect(show.pose.aimX).toBeCloseTo(AIM_ROUND[0], 9);
        expect(show.pose.aimY).toBeCloseTo(AIM_ROUND[1], 9);
      }
      was = show.stage;
    });
    expect(stops).toBeGreaterThan(60);
    expect(show.stats.across).toBe(0);
  });

  it("faces every side of the room within about a minute", { timeout: 30_000 }, () => {
    // The formal pace does; the relaxed one takes about half as long again.
    for (const [pace, limit] of [
      ["formal", 75],
      ["relaxed", 110],
    ] as [Pace, number][]) {
      const show = make(`round ${pace}`, { pace });
      // People stand all round. A salute is for everyone within its reach of where it faces,
      // and each person is at most half a side from the middle of theirs.
      const near = REACH + TAU / SIDES / 2;
      const people = Array.from({ length: 24 }, (_, i) => -Math.PI + (i * TAU) / 24);
      const seen = people.map(() => 0);
      let worst = 0;
      run(show, 6 * 3600, () => {
        if (show.stage !== "hold" || show.kind === "under") return;
        people.forEach((at, i) => {
          if (Math.abs(wrapLon(show.pose.bearing - at)) > near) return;
          worst = Math.max(worst, show.time - seen[i]!);
          seen[i] = show.time;
        });
      });
      expect(worst, pace).toBeLessThan(limit);
      expect(Math.max(...show.waits()), pace).toBeLessThan(limit);
    }
  });

  it("varies its bearings, never a fixed loop", () => {
    const show = make("variety");
    const sides: number[] = [];
    const bearings = new Set<number>();
    let was: Stage = show.stage;
    run(show, 3600, () => {
      if (show.stage === "hold" && was !== "hold" && show.kind !== "under") {
        sides.push(sideOf(show.pose.bearing));
        bearings.add(Math.round(show.pose.bearing / DEG));
      }
      was = show.stage;
    });
    expect(new Set(sides).size).toBe(SIDES);
    expect(bearings.size).toBeGreaterThan(100);
    // No short cycle: the order of sides doesn't repeat with any period up to 12 stops.
    for (let period = 1; period <= 12; period++) {
      const repeats = sides.every((s, i) => i < period || s === sides[i - period]);
      expect(repeats, `period ${period}`).toBe(false);
    }
  });

  it("bows right down to the people underneath now and then", () => {
    const show = make("bow");
    let bows = 0;
    let stopsBetween = 0;
    let was: Stage = show.stage;
    run(show, 3600, () => {
      if (show.stage === "hold" && was !== "hold") {
        if (show.kind === "under") {
          bows++;
          // After the opening stop, bows come every few stops.
          if (bows > 1) {
            expect(stopsBetween).toBeGreaterThanOrEqual(BOW_EVERY[0]);
            expect(stopsBetween).toBeLessThanOrEqual(BOW_EVERY[1] + 1);
          }
          stopsBetween = 0;
        } else stopsBetween++;
      }
      if (show.stage === "hold" && show.kind === "under" && was === "hold") {
        // Straight down but for the chin's small lift, the hand's side turned to the people.
        expect(show.pose.pitch / DEG).toBeLessThan(-88);
        expect(show.pose.pitch / DEG).toBeGreaterThan(-90.01);
        expect(show.pose.aimX).toBeCloseTo(AIM_UNDER[0], 9);
        expect(show.pose.aimY).toBeCloseTo(AIM_UNDER[1], 9);
        expect(show.pose.raise).toBe(1);
      }
      was = show.stage;
    });
    expect(bows).toBe(show.stats.bows);
    expect(bows).toBeGreaterThan(40);
  });

  it("keeps the salute up through a slow full turn now and then", () => {
    const show = make("sweep");
    until(show, "hold", "sweep", 1800);
    const start = show.pose.bearing;
    let turned = 0;
    let last = start;
    let fastest = 0;
    const began = show.time;
    while (show.stage === "hold") {
      show.step(1 / HZ);
      const step = wrapLon(show.pose.bearing - last);
      turned += step;
      fastest = Math.max(fastest, Math.abs(step) * HZ);
      last = show.pose.bearing;
      if (show.stage === "hold") expect(show.pose.raise).toBe(1);
    }
    expect(Math.abs(turned)).toBeCloseTo(TAU, 3);
    expect(wrapLon(show.pose.bearing - start)).toBeCloseTo(0, 3);
    expect(show.time - began).toBeCloseTo(PACES.formal.sweep, 0);
    // Slow: well under a turn in ten seconds.
    expect(fastest).toBeLessThan(TAU / 10);
    expect(show.stats.sweeps).toBe(1);
    expect(Math.max(...show.waits())).toBeLessThan(1);
    run(show, 3600);
    const perSweep = show.stats.stops / show.stats.sweeps;
    expect(perSweep).toBeGreaterThan(SWEEP_EVERY[0]);
    expect(perSweep).toBeLessThan(SWEEP_EVERY[1] + 4);
  });

  it("looks straight across only where there is a gallery", () => {
    const show = make("gallery", { gallery: true });
    let was: Stage = show.stage;
    let across = 0;
    run(show, 1800, () => {
      if (show.stage === "hold" && was !== "hold" && show.kind === "across") {
        across++;
        expect(Math.abs(show.pose.pitch) / DEG).toBeLessThan(9);
      }
      was = show.stage;
    });
    expect(across).toBe(show.stats.across);
    expect(across).toBeGreaterThan(20);
    expect(across).toBeLessThan(show.stats.stops * 0.5);
  });

  it("moves smoothly: no jump in where it faces, and blinks stay out of the snaps", () => {
    const show = make("smooth", { gallery: true });
    let before = { ...show.pose };
    const minutes = 20;
    let fastestRound = 0;
    let fastestTilt = 0;
    let mostRoll = 0;
    let outOfRange = 0;
    let shutInSnap = 0;
    run(show, minutes * 60, () => {
      const p = show.pose;
      fastestRound = Math.max(fastestRound, Math.abs(wrapLon(p.bearing - before.bearing)) * HZ);
      fastestTilt = Math.max(fastestTilt, Math.abs(p.pitch - before.pitch) * HZ);
      mostRoll = Math.max(mostRoll, Math.abs(p.roll));
      for (const v of [p.brow, p.smile, p.blinkLeft, p.blinkRight, p.glisten]) {
        if (!(v >= 0 && v <= 1)) outOfRange++;
      }
      if (!(Math.abs(p.glanceX) <= 1 && Math.abs(p.glanceY) <= 1)) outOfRange++;
      const snapping = show.stage === "raise" || show.stage === "lower";
      if (snapping && (p.blinkLeft > 0 || p.blinkRight > 0)) shutInSnap++;
      before = { ...p };
    });
    // Under a turn in 2.5 s round, and under 90° a second in tilt.
    expect(fastestRound).toBeLessThan(TAU / 2.5);
    expect(fastestRound).toBeGreaterThan(0.5);
    expect(fastestTilt).toBeLessThan(Math.PI / 2);
    expect(mostRoll).toBeLessThan(5 * DEG);
    expect(outOfRange).toBe(0);
    // Both eyes are open through the hand's snaps.
    expect(shutInSnap).toBe(0);
    // People blink every few seconds; a wink is one eye, now and then.
    const perMinute = show.stats.blinks / minutes;
    expect(perMinute).toBeGreaterThan(10);
    expect(perMinute).toBeLessThan(40);
    expect(show.stats.winks).toBeGreaterThan(5);
    expect(show.stats.winks).toBeLessThan(show.stats.stops * 0.4);
    expect(show.stats.glances).toBeGreaterThan(show.stats.stops * 0.4);
  });

  it("winks with the eye away from the hand", () => {
    const show = make("wink");
    let winked = false;
    let alone = 0;
    run(show, 1800, () => {
      const p = show.pose;
      if (p.blinkLeft > 0.99 && p.blinkRight === 0) winked = true;
      if (p.blinkRight > 0 && p.blinkLeft !== p.blinkRight) alone++;
    });
    // The eye beside the hand never shuts alone.
    expect(alone).toBe(0);
    expect(winked).toBe(true);
  });

  it("makes the eyes glisten in a long hold and not in a short one", () => {
    const show = make("glisten");
    until(show, "hold", "floor");
    run(show, 1.5);
    expect(show.pose.glisten).toBeLessThan(0.05);
    until(show, "hold", "sweep", 1800);
    run(show, 8);
    expect(show.pose.glisten).toBeGreaterThan(0.9);
  });

  it("is slower when relaxed", () => {
    const formal = make("pace");
    const relaxed = make("pace", { pace: "relaxed" });
    run(formal, 3600);
    run(relaxed, 3600);
    expect(formal.stats.salutes).toBeGreaterThan(330);
    expect(relaxed.stats.salutes).toBeLessThan(formal.stats.salutes * 0.85);
    expect(relaxed.stats.salutes).toBeGreaterThan(200);
    // The pace can change while it runs.
    const before = formal.stats.salutes;
    formal.setPace("relaxed");
    run(formal, 3600);
    expect(formal.stats.salutes - before).toBeLessThan(before * 0.85);
  });

  it("takes a cue for the next stop", () => {
    const show = make("cue");
    until(show, "hold");
    show.cue("under");
    until(show, "relax");
    until(show, "hold");
    expect(show.kind).toBe("under");
    show.cue("floor", 100 * DEG);
    until(show, "relax");
    until(show, "hold");
    expect(show.kind).toBe("floor");
    expect(show.pose.bearing / DEG).toBeCloseTo(100, 6);
    show.cue("sweep", -20 * DEG);
    until(show, "relax");
    until(show, "hold");
    expect(show.kind).toBe("sweep");
  });

  it("holds the salute for good when asked, turning slowly round and round", () => {
    const show = make("parade", { hold: true });
    run(show, 2);
    expect(show.stage).toBe("hold");
    expect(show.kind).toBe("parade");
    let turned = 0;
    let last = show.pose.bearing;
    const from = show.time;
    let dropped = 0;
    let steepest = 0;
    let shallowest = -Math.PI;
    run(show, 600, () => {
      if (show.stage !== "hold" || show.pose.raise !== 1) dropped++;
      turned += wrapLon(show.pose.bearing - last);
      last = show.pose.bearing;
      steepest = Math.min(steepest, show.pose.pitch);
      shallowest = Math.max(shallowest, show.pose.pitch);
    });
    expect(dropped).toBe(0);
    // Tilted towards the floor all the way round, more for people near and less for people far.
    expect(steepest / DEG).toBeGreaterThan(-40);
    expect(shallowest / DEG).toBeLessThan(-5);
    expect(shallowest - steepest).toBeGreaterThan(5 * DEG);
    const turns = Math.abs(turned) / TAU;
    const expected = (show.time - from) / PACES.formal.parade;
    expect(turns).toBeGreaterThan(expected * 0.95);
    expect(turns).toBeLessThanOrEqual(expected);
    expect(show.pose.glisten).toBeGreaterThan(0.9);
    expect(show.stats.blinks).toBeGreaterThan(60);
    expect(show.stats.salutes).toBe(1);
  });

  it("takes up the held salute mid-show and goes back to the show after it", () => {
    const show = make("switch");
    until(show, "turn");
    show.setHold(true);
    run(show, 20);
    expect(show.stage).toBe("hold");
    expect(show.kind).toBe("parade");
    const salutes = show.stats.salutes;
    run(show, 120);
    expect(show.stats.salutes).toBe(salutes);
    expect(show.pose.raise).toBe(1);
    show.setHold(false);
    run(show, 3);
    expect(show.stage).not.toBe("hold");
    run(show, 120);
    expect(show.stats.salutes).toBeGreaterThan(salutes + 8);

    // Asked for during a relaxed moment, the hand goes straight back up where it faces.
    const again = make("switch again");
    until(again, "relax");
    const facing = again.pose.bearing;
    again.setHold(true);
    until(again, "hold");
    expect(again.kind).toBe("parade");
    expect(Math.abs(wrapLon(again.pose.bearing - facing))).toBeLessThan(1 * DEG);
  });

  it("follows the ball it is on", () => {
    // A big ball hung low: people are nearly level with it, so the tilt is slight.
    const low = sphereInfo({ ...DEFAULT_VENUE.sphere, diameterM: 6, bottomM: 0.5 });
    const show = make("ball");
    show.setSphere(low, false);
    run(show, 60);
    let was: Stage = show.stage;
    let checked = 0;
    run(show, 600, () => {
      if (show.stage === "hold" && was !== "hold" && show.kind === "floor") {
        expect(show.pose.pitch / DEG).toBeGreaterThan(-15);
        checked++;
      }
      was = show.stage;
    });
    expect(checked).toBeGreaterThan(10);
  });

  it("stays in bounds over a week", { timeout: 60_000 }, () => {
    const show = make("week", { gallery: true });
    // Ten steps a second keeps the test quick; a week is still six million of them.
    const n = 7 * 24 * 3600 * 10;
    for (let i = 0; i < n; i++) show.step(0.1);
    const p = show.pose;
    for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true);
    expect(Math.abs(p.bearing)).toBeLessThanOrEqual(Math.PI);
    expect(show.stats.salutes).toBeGreaterThan(50_000);
    expect(show.stats.bows).toBeGreaterThan(5_000);
    expect(show.stats.sweeps).toBeGreaterThan(2_000);
    expect(show.waits()).toHaveLength(SIDES);
    expect(Math.max(...show.waits())).toBeLessThan(90);
  });
});
