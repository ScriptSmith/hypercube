import { describe, expect, it } from "vitest";
import { MAX_PEOPLE } from "../../../src/apps/gaze/crowd";
import { angle, bearing, elevation, fromAngles } from "../../../src/apps/gaze/geom";
import {
  fixationLength,
  LOOK_LIMITS,
  MOODS,
  type MotionEvent,
} from "../../../src/apps/gaze/motion";
import {
  FIXATION,
  MAIN_SEQUENCE,
  MICRO,
  PURSUIT,
  SPLIT_ABOVE,
  UNDERSHOOT,
} from "../../../src/apps/gaze/physiology";
import { saccadeDuration } from "../../../src/apps/gaze/saccade";
import { createRng } from "../../../src/core/rng";
import { DEG, type Vec3 } from "../../../src/core/sphere";
import { rig, STEP } from "./helpers";

type Saccade = Extract<MotionEvent, { kind: "saccade" }>;
type Fixation = Extract<MotionEvent, { kind: "fixation" }>;

/** One long run, measured once for the tests that only watch. */
const watching = (upper: boolean) => {
  const { motion, run } = rig("watch", "furtive", upper);
  const out = {
    low: 0,
    high: -1,
    up: 0,
    band: 0,
    steep: 0,
    level: 0,
    n: 0,
    thirds: [0, 0, 0],
    trace: [] as Vec3[],
    pupilLow: 99,
    pupilHigh: 0,
    people: 0,
  };
  let second = 0;
  run(45 * 60, () => {
    const g = motion.gaze;
    const e = elevation(g);
    out.low = Math.min(out.low, e);
    out.high = Math.max(out.high, e);
    if (e > 0) out.up++;
    if (e <= -15 * DEG && e >= -75 * DEG) out.band++;
    if (e < -75 * DEG) out.steep++;
    if (Math.abs(e) <= 6 * DEG) out.level++;
    out.n++;
    const b = bearing(g) + Math.PI;
    out.thirds[Math.min(2, Math.floor(b / ((2 * Math.PI) / 3)))]!++;
    if (motion.time >= second) {
      out.trace.push(g);
      second++;
    }
    out.pupilLow = Math.min(out.pupilLow, motion.pupil);
    out.pupilHigh = Math.max(out.pupilHigh, motion.pupil);
    out.people = Math.max(out.people, motion.crowd.people.length);
  });
  return out;
};
const watch = watching(true);

describe("where it looks", () => {
  it("keeps within its limits: anywhere below, rarely up", () => {
    expect(watch.low).toBeGreaterThanOrEqual(LOOK_LIMITS.low - 1e-9);
    expect(watch.high).toBeLessThanOrEqual(LOOK_LIMITS.high + 1.5 * DEG);
    expect(watch.up / watch.n).toBeLessThan(0.1);
  });

  it("looks down at the floor most, across at the gallery often, now and then straight down", () => {
    expect(watch.band / watch.n).toBeGreaterThan(0.4);
    expect(watch.level / watch.n).toBeGreaterThan(0.2);
    expect(watch.level / watch.n).toBeLessThan(watch.band / watch.n);
    expect(watch.steep / watch.n).toBeGreaterThan(0.01);
  });

  // Another 45 minutes of the show, which takes a few seconds when the suite runs in parallel.
  it("looks mostly 15 to 75 degrees down with nobody on a gallery", { timeout: 30_000 }, () => {
    const floor = watching(false);
    expect(floor.band / floor.n).toBeGreaterThan(0.5);
    expect(floor.level / floor.n).toBeLessThan(0.1);
    expect(floor.steep / floor.n).toBeGreaterThan(0.01);
  });

  it("looks round every side", () => {
    for (const t of watch.thirds) expect(t / watch.n).toBeGreaterThan(0.12);
  });

  it("runs the same from the same seed, and differently from another", () => {
    const a = rig("same");
    const b = rig("same");
    const c = rig("other");
    a.run(120);
    b.run(120);
    c.run(120);
    expect(angle(a.motion.gaze, b.motion.gaze)).toBe(0);
    expect(angle(a.motion.gaze, c.motion.gaze)).toBeGreaterThan(0);
  });

  it("never settles into a loop", () => {
    // No ten-minute stretch of the gaze, sampled each second, repeats an earlier one.
    const trace = watch.trace;
    const window = 600;
    for (let lag = 30; lag < trace.length - window; lag += 30) {
      let far = 0;
      for (let i = 0; i < window; i++) {
        if (angle(trace[i]!, trace[i + lag]!) > 3 * DEG) far++;
      }
      expect(far / window).toBeGreaterThan(0.3);
    }
  });

  // An hour and a half of the show, which takes a few seconds when the suite runs in parallel.
  it("drifts between moods over minutes", { timeout: 30_000 }, () => {
    const { motion, run } = rig("moods");
    const seen = new Set<string>();
    let changes = 0;
    let last = motion.mood;
    run(90 * 60, () => {
      seen.add(motion.mood);
      if (motion.mood !== last) changes++;
      last = motion.mood;
    });
    expect(seen.size).toBe(MOODS.length);
    // Moods last a minute or more each.
    expect(changes).toBeLessThan(90);
    expect(changes).toBeGreaterThan(10);
  });
});

describe("saccades", () => {
  it("follow the main sequence", () => {
    const { events, run } = rig("main");
    run(10 * 60);
    const sacs = events.filter((e): e is Saccade => e.kind === "saccade");
    expect(sacs.length).toBeGreaterThan(500);
    for (const s of sacs) {
      // Moods change speed by at most a quarter either way.
      const fast = saccadeDuration(s.amp, 1.1);
      const slow = saccadeDuration(s.amp, 0.75);
      expect(s.duration).toBeGreaterThanOrEqual(fast - 1e-9);
      expect(s.duration).toBeLessThanOrEqual(slow + 1e-9);
      expect(s.peak).toBeLessThan(MAIN_SEQUENCE.vmax * 1.2);
    }
  });

  it("are mostly a few degrees, with a long tail", () => {
    const { events, run } = rig("sizes");
    run(20 * 60);
    const amps = events
      .filter(
        (e): e is Saccade =>
          e.kind === "saccade" && !e.micro && !e.corrective && !e.part && !e.refix,
      )
      .map((s) => s.amp)
      .sort((a, b) => a - b);
    const median = amps[amps.length >> 1]!;
    expect(median).toBeGreaterThan(3);
    expect(median).toBeLessThan(15);
    expect(amps[Math.floor(amps.length * 0.95)]!).toBeGreaterThan(25);
  });

  it("are never larger than a split step", () => {
    const { events, run } = rig("split");
    run(20 * 60);
    const sacs = events.filter((e): e is Saccade => e.kind === "saccade");
    for (const s of sacs) expect(s.amp).toBeLessThanOrEqual(SPLIT_ABOVE + 0.5);
    expect(sacs.some((s) => s.part)).toBe(true);
  });

  it("move the eye no faster than the main sequence allows", () => {
    const { motion, run } = rig("speed");
    let last = motion.gaze;
    let fastest = 0;
    run(5 * 60, () => {
      const g = motion.gaze;
      fastest = Math.max(fastest, angle(last, g) / DEG / STEP);
      last = g;
    });
    // Mean speed over one step, which can't exceed peak speed (plus the glissade's wobble).
    expect(fastest).toBeLessThan(MAIN_SEQUENCE.vmax * 1.15);
    expect(fastest).toBeGreaterThan(150);
  });

  it("fall short on big moves and correct after a short pause", () => {
    const { motion, events, run } = rig("correct");
    const times: { t: number; e: MotionEvent }[] = [];
    let idx = 0;
    run(10 * 60, () => {
      while (idx < events.length) times.push({ t: motion.time, e: events[idx++]! });
    });
    let corrections = 0;
    const ratios: number[] = [];
    for (let i = 0; i < times.length; i++) {
      const e = times[i]!.e;
      if (e.kind !== "saccade" || !e.corrective) continue;
      // The saccade it corrects is the last big one before it.
      let j = i - 1;
      while (j >= 0 && (times[j]!.e.kind !== "saccade" || (times[j]!.e as Saccade).micro)) j--;
      const before = times[j]!;
      const s = before.e as Saccade;
      if (s.amp < UNDERSHOOT.from) continue;
      const gap = times[i]!.t - before.t - s.duration;
      expect(gap).toBeGreaterThanOrEqual(UNDERSHOOT.latencyMin - 2 * STEP);
      expect(gap).toBeLessThanOrEqual(UNDERSHOOT.latencyMax + 4 * STEP);
      ratios.push(e.amp / s.amp);
      corrections++;
    }
    expect(corrections).toBeGreaterThan(20);
    ratios.sort((a, b) => a - b);
    // Small, though someone walking past can make one larger.
    expect(ratios[Math.floor(ratios.length / 2)]!).toBeLessThan(0.2);
    expect(ratios[Math.floor(ratios.length * 0.9)]!).toBeLessThan(0.4);
  });
});

describe("fixations", () => {
  it("are gamma distributed as in free viewing", () => {
    // Shape 4 and scale 70 ms: mean 280 ms, median 257 ms.
    const rng = createRng("gamma");
    const xs = Array.from({ length: 20000 }, () => fixationLength(rng)).sort((a, b) => a - b);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    // The 150 ms floor between saccades lifts the mean a little.
    expect(mean).toBeGreaterThan(0.28);
    expect(mean).toBeLessThan(0.295);
    expect(xs[xs.length >> 1]!).toBeCloseTo(0.257, 2);
    expect(xs[0]!).toBeGreaterThanOrEqual(FIXATION.min);
    expect(xs[xs.length - 1]!).toBeLessThanOrEqual(FIXATION.max);
  });

  it("last a plausible time, with short ones common and none held long", () => {
    const { motion, events, run } = rig("fix");
    run(30 * 60);
    const fixes = events.filter((e): e is Fixation => e.kind === "fixation");
    const durs = fixes.map((f) => f.dur).sort((a, b) => a - b);
    // A fixation is never longer than the longest stretched one, or a moment of following.
    const longest = Math.max(FIXATION.max * FIXATION.stretch, PURSUIT.maxTime) + FIXATION.min;
    for (const d of durs) {
      expect(d).toBeGreaterThanOrEqual(Math.min(FIXATION.min, 0.08) - 1e-9);
      expect(d).toBeLessThanOrEqual(longest);
    }
    const median = durs[Math.floor(durs.length / 2)]!;
    expect(median).toBeGreaterThan(0.1);
    expect(median).toBeLessThan(1);
    // Long looks happen, a few a minute, as runs of fixations.
    expect(motion.stats.stares).toBeGreaterThan(30);
    expect(motion.stats.stares).toBeLessThan(30 * 20);
    const stares = fixes.filter((f) => f.stare);
    expect(stares.length).toBeGreaterThan(motion.stats.stares * 3);
  });

  it("make a long look a run of small saccades over the person's face and body", () => {
    const { motion, events, run } = rig("dwell");
    run(20 * 60);
    const refix = events.filter((e): e is Saccade => e.kind === "saccade" && e.refix);
    expect(refix.length).toBeGreaterThan(motion.stats.stares * 2);
    const amps = refix.map((s) => s.amp).sort((a, b) => a - b);
    // Mostly across a face, a degree or two; now and then down to the body.
    expect(amps[amps.length >> 1]!).toBeLessThan(2.5);
    expect(amps[Math.floor(amps.length * 0.97)]!).toBeGreaterThan(4);
  });

  it("never glides slowly, and follows someone only briefly", () => {
    const { motion, run } = rig("glide");
    const recent: { g: Vec3; still: boolean }[] = [];
    let worst = 0;
    let following = 0;
    let longestFollow = 0;
    let since = 0;
    let longestStill = 0;
    let lastSaccades = 0;
    run(30 * 60, () => {
      const act = motion.activity;
      recent.push({ g: motion.gaze, still: act === "fixation" });
      if (recent.length > 16) recent.shift();
      if (recent.length === 16 && recent.every((r) => r.still)) {
        worst = Math.max(worst, angle(recent[0]!.g, recent[15]!.g));
      }
      following = act === "pursuit" ? following + STEP : 0;
      longestFollow = Math.max(longestFollow, following);
      const big = motion.stats.saccades - motion.stats.micro;
      since = big !== lastSaccades || act === "pursuit" ? 0 : since + STEP;
      lastSaccades = big;
      longestStill = Math.max(longestStill, since);
    });
    // Drift only between saccades: well under a degree a second.
    expect(worst / DEG / (15 * STEP)).toBeLessThan(1);
    expect(motion.stats.pursuits).toBeGreaterThan(5);
    expect(longestFollow).toBeLessThanOrEqual(PURSUIT.maxTime + STEP);
    // It never sits still for long.
    expect(longestStill).toBeLessThan(5);
  });

  it("notices newcomers and checks back on people it looked away from", () => {
    const { motion, run } = rig("notice");
    run(20 * 60);
    expect(motion.stats.notices).toBeGreaterThan(5);
    expect(motion.stats.checks).toBeGreaterThan(5);
  });

  it("have microsaccades of under a degree at about the published rate", () => {
    const { motion, events, run } = rig("micro");
    let fixating = 0;
    run(10 * 60, () => {
      if (motion.activity !== "saccade") fixating += STEP;
    });
    const micro = events.filter((e): e is Saccade => e.kind === "saccade" && e.micro);
    const rate = micro.length / fixating;
    expect(rate).toBeGreaterThan(MICRO.rate * 0.4);
    expect(rate).toBeLessThan(MICRO.rate * 1.6);
    for (const m of micro) expect(m.amp).toBeLessThanOrEqual(MICRO.max + 0.05);
  });

  it("can hold a look on request and then carry on", () => {
    const { motion, run } = rig("hold");
    const at = fromAngles(-60 * DEG, 1);
    motion.hold(at, 2);
    run(1);
    expect(angle(motion.gaze, at)).toBeLessThan(1.5 * DEG);
    expect(motion.staring).toBe(true);
    run(5);
    expect(motion.stats.saccades).toBeGreaterThan(2);
  });
});

describe("pupil and room", () => {
  it("keeps the pupil within its range, and moving", () => {
    expect(watch.pupilLow).toBeGreaterThanOrEqual(2);
    expect(watch.pupilHigh).toBeLessThanOrEqual(8);
    expect(watch.pupilHigh - watch.pupilLow).toBeGreaterThan(0.8);
  });

  it("keeps its crowd bounded", () => {
    expect(watch.people).toBeLessThanOrEqual(MAX_PEOPLE);
    expect(watch.people).toBeGreaterThan(2);
  });
});
