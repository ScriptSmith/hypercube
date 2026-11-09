import { describe, expect, it } from "vitest";
import {
  aimBand,
  createShow,
  type Cycle,
  meanCycle,
  SEEN_WITHIN,
  seats,
  type ShowOptions,
  STAGE_IDS,
  THREE_LAT,
  WINDOW_RADIUS,
} from "../../../src/apps/answerball/show";
import { ANSWERS } from "../../../src/apps/answerball/answers";
import { createRng } from "../../../src/core/rng";
import { DEG, sphereInfo, wrapLon } from "../../../src/core/sphere";

const VIEW = sphereInfo().view;
const CALM: ShowOptions = { windows: 1, pace: "calm", prompt: true, view: VIEW };
const LIVELY: ShowOptions = { ...CALM, pace: "lively" };

const cycles = (opts: ShowOptions, seconds: number, seed = "t", lane = 0): Cycle[] => {
  const show = createShow(createRng(seed), opts);
  const out: Cycle[] = [];
  let t = 0;
  while (t < seconds) {
    const c = show.cycle(lane, t);
    out.push({ ...c, stages: c.stages.map((s) => ({ ...s })) });
    t = c.start + c.duration + 1e-6;
  }
  return out;
};

const bearing = (c: Cycle) => wrapLon(c.to.yaw);
/** When the window arrives and the answer is coming. */
const arrives = (c: Cycle) => c.start + c.stages[0]!.end;

describe("the show's plan", () => {
  it("runs its stages in order, each answer taking about 15 to 20 s", () => {
    for (const [opts, lo, hi] of [
      [CALM, 14.5, 23.5],
      [LIVELY, 9, 15],
    ] as const) {
      const cs = cycles(opts, 3600);
      for (const c of cs.slice(1)) {
        expect(c.stages.map((s) => s.id)).toEqual(STAGE_IDS);
        expect(c.duration).toBeGreaterThan(lo);
        expect(c.duration).toBeLessThan(hi);
        const hold = c.stages[4]!;
        expect(hold.end - hold.start).toBeGreaterThanOrEqual(opts.pace === "calm" ? 6 : 3.5);
      }
      for (let i = 1; i < cs.length; i++) {
        expect(cs[i]!.start).toBeCloseTo(cs[i - 1]!.start + cs[i - 1]!.duration, 9);
      }
      const mean = cs.reduce((s, c) => s + c.duration, 0) / cs.length;
      expect(mean).toBeGreaterThan(opts.pace === "calm" ? 16.5 : 10);
      expect(mean).toBeLessThan(opts.pace === "calm" ? 19 : 12);
    }
  });

  it("starts already facing someone at the side, mid-answer, with nothing to turn", () => {
    const [first] = cycles(CALM, 1);
    expect(first!.start).toBeLessThan(0);
    expect(arrives(first!)).toBeCloseTo(0, 9);
    expect(first!.from).toEqual(first!.to);
    expect(first!.down).toBe(false);
    expect(first!.to.pitch / DEG).toBeCloseTo(-20, 6);
    expect(bearing(first!)).toBeCloseTo(0, 9);
  });

  it("keeps every window inside the band people see", () => {
    for (const seed of ["a", "b"]) {
      for (const c of cycles(CALM, 3600, seed)) {
        if (c.down) {
          expect(c.to.pitch).toBeCloseTo(-Math.PI / 2, 9);
          continue;
        }
        expect(c.to.pitch + WINDOW_RADIUS).toBeLessThanOrEqual(VIEW.top);
        expect(c.to.pitch).toBeGreaterThanOrEqual(-35 * DEG - 1e-9);
        expect(c.to.pitch).toBeLessThanOrEqual(0);
      }
    }
    // A sphere seen less well keeps its windows lower, and one whose bottom nobody sees never
    // looks straight down.
    const low = { top: 20 * DEG, bottom: -60 * DEG };
    const band = aimBand(low);
    expect(band.down).toBe(false);
    for (const c of cycles({ ...CALM, view: low }, 1800)) {
      expect(c.down).toBe(false);
      expect(c.to.pitch + WINDOW_RADIUS).toBeLessThanOrEqual(low.top + 1e-9);
      expect(c.to.pitch - WINDOW_RADIUS).toBeGreaterThanOrEqual(low.bottom - 1e-9);
    }
  });

  it("looks straight down about one answer in three, never twice running", () => {
    for (const seed of ["a", "b", "c"]) {
      const cs = cycles(CALM, 3 * 3600, seed);
      const share = cs.filter((c) => c.down).length / cs.length;
      expect(share).toBeGreaterThan(0.25);
      expect(share).toBeLessThan(0.36);
      for (let i = 1; i < cs.length; i++) expect(cs[i]!.down && cs[i - 1]!.down).toBe(false);
    }
  });

  it("turns at least a quarter turn round between side answers", () => {
    for (const seed of ["a", "b", "c"]) {
      const sides = cycles(CALM, 3600, seed).filter((c) => !c.down);
      for (let i = 1; i < sides.length; i++) {
        expect(
          Math.abs(wrapLon(bearing(sides[i]!) - bearing(sides[i - 1]!))),
        ).toBeGreaterThanOrEqual(90 * DEG);
      }
    }
  });

  it("faces every side of the room within about two minutes", () => {
    for (const [opts, limit] of [
      [CALM, 140],
      [LIVELY, 90],
    ] as const) {
      for (const seed of ["a", "b", "c", "d"]) {
        const sides = cycles(opts, 3600, seed).filter((c) => !c.down);
        for (let b = -180; b < 180; b += 5) {
          let last = 0;
          let worst = 0;
          for (const c of sides) {
            if (Math.abs(wrapLon(bearing(c) - b * DEG)) > SEEN_WITHIN) continue;
            worst = Math.max(worst, arrives(c) - last);
            last = arrives(c);
          }
          expect(worst, `bearing ${b}, seed ${seed}`).toBeLessThan(limit);
          expect(3600 - last, `bearing ${b}, seed ${seed}`).toBeLessThan(limit + 25);
        }
      }
    }
  });

  it("never gives the same answer twice running, and gives every answer often", () => {
    const cs = cycles(CALM, 4 * 3600);
    for (let i = 1; i < cs.length; i++) expect(cs[i]!.answer).not.toBe(cs[i - 1]!.answer);
    for (let i = 0; i + 40 <= cs.length; i += 7) {
      const seen = new Set(cs.slice(i, i + 40).map((c) => c.answer));
      expect(seen.size).toBe(ANSWERS.length);
    }
  });

  it("varies: a long shake every few minutes, timings that differ", () => {
    const cs = cycles(CALM, 3 * 3600);
    const longs = cs.filter((c) => c.long);
    expect(longs.length).toBeGreaterThan(25);
    for (let i = 1; i < longs.length; i++) {
      const gap = longs[i]!.start - longs[i - 1]!.start;
      expect(gap).toBeGreaterThan(170);
      expect(gap).toBeLessThan(390);
    }
    for (const c of longs) {
      const shake = c.stages[2]!;
      const rise = c.stages[3]!;
      expect(shake.end - shake.start).toBeGreaterThan(2);
      expect(rise.end - rise.start).toBeGreaterThan(3.9);
      expect(c.rocks).toBeGreaterThanOrEqual(5);
    }
    const holds = new Set(cs.map((c) => Math.round((c.stages[4]!.end - c.stages[4]!.start) * 10)));
    expect(holds.size).toBeGreaterThan(10);
    for (const c of cs) {
      expect(c.amplitude).toBeLessThanOrEqual(7 * DEG + 1e-9);
      expect(c.rocks).toBeGreaterThanOrEqual(2);
    }
  });

  it("is the same show for the same seed, and a different one for another", () => {
    const a = cycles(CALM, 1200, "same").map((c) => [c.answer, c.to.pitch, c.to.yaw, c.duration]);
    const b = cycles(CALM, 1200, "same").map((c) => [c.answer, c.to.pitch, c.to.yaw, c.duration]);
    const c = cycles(CALM, 1200, "other").map((c) => [c.answer, c.to.pitch, c.to.yaw, c.duration]);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it("leaves out the prompt when it is off, keeping a short beat", () => {
    for (const c of cycles({ ...CALM, prompt: false }, 600).slice(1)) {
      const p = c.stages[1]!;
      expect(p.end - p.start).toBeLessThan(0.9);
    }
  });

  it("gives an answer on demand without jumping", () => {
    const show = createShow(createRng("demand"), CALM);
    // Mid-hold: the die sinks quickly, then the ball shakes where it faces.
    const c = show.cycle(0, 0);
    const holdAt = c.start + c.stages[4]!.start + 1;
    show.cycle(0, holdAt);
    show.shakeNow(0, holdAt);
    const now = show.cycle(0, holdAt);
    expect(now).toBe(c);
    const sinkEnd = c.start + c.duration;
    expect(sinkEnd - holdAt).toBeLessThan(1);
    const next = show.cycle(0, sinkEnd + 0.01);
    expect(next.to).toEqual(next.from);
    expect(next.stages[0]!.end).toBe(0);
    expect(next.stages[1]!.end).toBe(0);
    // Mid-turn: the turn finishes, and the shake follows at once.
    const t2 = next.start + next.duration + 0.5;
    const turning = show.cycle(0, t2);
    show.shakeNow(0, t2);
    expect(turning.stages[2]!.start).toBeCloseTo(turning.stages[0]!.end, 9);
  });

  it("runs three windows a third of a cycle apart, without turning them", () => {
    const opts: ShowOptions = { ...CALM, windows: 3 };
    const starts: number[] = [];
    for (let lane = 0; lane < 3; lane++) {
      const cs = cycles(opts, 1800, "three", lane);
      for (const c of cs) {
        expect(c.lane).toBe(lane);
        expect(c.down).toBe(false);
        expect(c.to.pitch).toBe(THREE_LAT);
        expect(c.from).toEqual(c.to);
      }
      starts.push(cs[0]!.start);
    }
    expect(starts[1]! - starts[0]!).toBeLessThan(-4);
    expect(starts[2]! - starts[1]!).toBeLessThan(-4);
  });

  it("puts six windows round the ball, alternately above and below the middle", () => {
    const six = seats(6, VIEW);
    expect(six.length).toBe(6);
    six.forEach((s, i) => {
      expect(s.yaw / DEG).toBeCloseTo(i * 60, 9);
      expect(s.row).toBe(i % 2);
      if (i % 2 === 0) expect(s.pitch / DEG).toBeCloseTo(-25, 9);
      // The high row is 15° up where the band allows, its window 4° inside the band's top.
      else expect(s.pitch / DEG).toBeCloseTo(Math.min(15, VIEW.top / DEG - 24), 9);
      expect(s.pitch + WINDOW_RADIUS).toBeLessThanOrEqual(VIEW.top);
    });
    // A ball seen less well squeezes the rows together inside its band.
    const low = { top: 30 * DEG, bottom: -50 * DEG };
    for (const s of seats(6, low)) {
      expect(s.pitch + WINDOW_RADIUS).toBeLessThanOrEqual(low.top);
      expect(s.pitch - WINDOW_RADIUS).toBeGreaterThanOrEqual(low.bottom);
    }
    const [under, high] = seats(6, low);
    expect(high!.pitch).toBeGreaterThan(under!.pitch);
    // A seventh window straight underneath answers with the high row, unless nobody sees the
    // bottom of the ball.
    const seven = seats(6, VIEW, true);
    expect(seven.length).toBe(7);
    expect(seven[6]!.pitch).toBeCloseTo(-Math.PI / 2, 9);
    expect(seven[6]!.row).toBe(1);
    expect(seats(6, low, true).length).toBe(6);
    expect(seats(3, VIEW, true).length).toBe(3);
  });

  it("runs six windows and the one underneath as two rows, each in step, half a cycle apart", () => {
    for (const pace of ["calm", "lively"] as const) {
      const opts: ShowOptions = { ...CALM, pace, windows: 6, under: true };
      const lanes = [0, 1, 2, 3, 4, 5, 6].map((lane) => cycles(opts, 3600, "six", lane));
      const half = meanCycle(pace, true) / 2;
      for (let lane = 0; lane < 7; lane++) {
        const rowOf = lane === 6 ? 1 : lane % 2;
        const row = lanes[rowOf]!;
        const cs = lanes[lane]!;
        expect(cs.length).toBe(row.length);
        cs.forEach((c, k) => {
          expect(c.down).toBe(lane === 6);
          expect(c.from).toEqual(c.to);
          expect(c.start).toBeCloseTo(row[k]!.start, 9);
          expect(c.stages).toEqual(row[k]!.stages);
          expect(c.long).toBe(row[k]!.long);
          // The high row runs the low row's plan half a cycle ahead.
          const low = lanes[0]!.find((x) => x.index === c.index);
          if (low) {
            expect(c.start).toBeCloseTo(low.start - rowOf * half, 9);
            expect(c.stages).toEqual(low.stages);
          }
        });
      }
      expect(lanes[0]!.filter((c) => c.long).length).toBeGreaterThan(5);
      // The low row's first answers arrive as the show begins.
      const first = lanes[0]![0]!;
      expect(first.start + first.stages[4]!.start).toBeCloseTo(0, 9);
    }
  });

  it("never shows the same answer in two windows at once", () => {
    const show = createShow(createRng("six-answers"), { ...CALM, windows: 6, under: true });
    const last: number[] = [-1, -1, -1, -1, -1, -1, -1];
    const counts: number[][] = last.map(() => ANSWERS.map(() => 0));
    for (let t = 0; t < 2 * 3600; t += 0.25) {
      const showing: number[] = [];
      for (let lane = 0; lane < 7; lane++) {
        const c = show.cycle(lane, t);
        const stage = show.stageAt(c, t - c.start).id;
        if (c.answer !== last[lane]) {
          if (last[lane]! >= 0) expect(c.answer).not.toBe(last[lane]);
          last[lane] = c.answer;
          counts[lane]![c.answer]!++;
        }
        if (stage === "rise" || stage === "hold" || stage === "sink") showing.push(c.answer);
      }
      expect(new Set(showing).size, `at ${t}`).toBe(showing.length);
    }
    // Every window gives every answer now and then.
    for (const n of counts) for (const k of n) expect(k).toBeGreaterThan(3);
  });

  it("forgets cycles once they are past, so it runs for weeks", () => {
    const show = createShow(createRng("weeks"), CALM);
    const week = 7 * 24 * 3600;
    const c = show.cycle(0, week);
    expect(c.index).toBeGreaterThan(30000);
    expect(show.previous(c)).not.toBeNull();
    // Only a handful are kept.
    let kept = 0;
    let p: Cycle | null = c;
    while (p) {
      kept++;
      p = show.previous(p);
    }
    expect(kept).toBeLessThan(8);
  });
});
