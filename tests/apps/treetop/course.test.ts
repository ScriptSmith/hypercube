import { describe, expect, it } from "vitest";
import {
  ADULT,
  type Body,
  CEIL_Y,
  FLOOR_Y,
  GAPS,
  GATE_W,
  MAX_SPEED_FACTOR,
  MIN_PIECE,
  RADIUS,
  SPEEDS,
  STANDARD,
  START_Y,
} from "../../../src/apps/treetop/config";
import { buildCourse, type Course, LEAD_S, RUN_IN_S } from "../../../src/apps/treetop/course";
import { createFlight, launch } from "../../../src/apps/treetop/flight";
import { createPilot, type Skill } from "../../../src/apps/treetop/pilot";
import { createRng } from "../../../src/core/rng";
import { config, fly, rulesOf } from "./helpers";

/** Room to spare inside a gap: the glider may be anywhere this far either side of its centre. */
const SAFE = 30;
const STEP = 1 / 240;

/** Best height a glider can gain within each time, tapping four times a second. */
const climbTable = (body: Body, seconds: number): Float64Array => {
  const n = Math.ceil(seconds / STEP);
  const out = new Float64Array(n + 1);
  let y = 0;
  let vy = 0;
  let best = 0;
  for (let i = 1; i <= n; i++) {
    if ((i - 1) % 60 === 0) vy = -body.flap;
    vy = Math.min(body.maxFall, vy + body.gravity * STEP);
    y += vy * STEP;
    best = Math.max(best, -y);
    out[i] = best;
  }
  return out;
};

/** Height a glider can lose within each time without flapping, from level flight. */
const fallTable = (body: Body, seconds: number): Float64Array => {
  const n = Math.ceil(seconds / STEP);
  const out = new Float64Array(n + 1);
  let y = 0;
  let vy = 0;
  for (let i = 1; i <= n; i++) {
    vy = Math.min(body.maxFall, vy + body.gravity * STEP);
    y += vy * STEP;
    out[i] = y;
  }
  return out;
};

const at = (table: Float64Array, t: number) =>
  table[Math.min(table.length - 1, Math.max(0, Math.floor(t / STEP)))]!;

/** Every reason this course isn't fair, as text. */
const problems = (
  course: Course,
  base: number,
  h: number,
  bodies: readonly [Float64Array, Float64Array][],
): string[] => {
  const out: string[] = [];
  const slack = h / 2 - RADIUS - SAFE;
  const vmax = base * MAX_SPEED_FACTOR;
  let prevC = START_Y;
  let prevEnd = -RADIUS;
  if (course.gates.length === 0) out.push("no gates");
  for (const g of course.gates) {
    if (g.h !== h || g.w !== GATE_W) out.push(`gate ${g.i} size`);
    if (g.c - h / 2 < CEIL_Y + MIN_PIECE - 1 || g.c + h / 2 > FLOOR_Y - MIN_PIECE + 1)
      out.push(`gate ${g.i} off the edge`);
    const t = (g.x - RADIUS - prevEnd) / vmax;
    if (t <= 0) out.push(`gate ${g.i} overlaps`);
    for (const [climb, fall] of bodies) {
      const up = prevC - g.c - slack;
      const down = g.c - prevC - slack;
      if (up > at(climb, t))
        out.push(`gate ${g.i} needs a climb of ${Math.round(up)} in ${t.toFixed(2)} s`);
      if (down > at(fall, t))
        out.push(`gate ${g.i} needs a drop of ${Math.round(down)} in ${t.toFixed(2)} s`);
    }
    prevC = g.c;
    prevEnd = g.x + g.w + RADIUS;
  }
  const last = course.gates.at(-1);
  if (last && last.x + last.w > course.length - base * RUN_IN_S + 1)
    out.push("last gate too near the line");
  if (course.gates[0] && course.gates[0].x < base * LEAD_S - 1)
    out.push("first gate too near the start");
  return out;
};

/** The sweeps take a few seconds alone, more when the whole suite runs at once. */
const SWEEP = { timeout: 120_000 };

describe("course", () => {
  const tables = [STANDARD, ADULT].map(
    (b) => [climbTable(b, 3), fallTable(b, 3)] as [Float64Array, Float64Array],
  );

  it("is reachable over 10,000 seeds at every gap and speed", SWEEP, () => {
    for (const speed of Object.keys(SPEEDS) as (keyof typeof SPEEDS)[]) {
      for (const gap of Object.keys(GAPS) as (keyof typeof GAPS)[]) {
        const cfg = config({ speed, gap });
        let bad: string[] = [];
        let gates = 0;
        for (let seed = 0; seed < 10_000 && bad.length === 0; seed++) {
          const course = buildCourse(createRng(`seed-${seed}`), "race-7", cfg);
          gates += course.gates.length;
          bad = problems(course, cfg.base, cfg.gapH, tables).map(
            (p) => `${speed} ${gap} seed ${seed}: ${p}`,
          );
        }
        expect(bad).toEqual([]);
        expect(gates / 10_000).toBeGreaterThan(15);
      }
    }
  });

  it("stays reachable at the longest race", SWEEP, () => {
    const cfg = config({ race: 90, speed: "fast", gap: "narrow" });
    for (let seed = 0; seed < 500; seed++) {
      const course = buildCourse(createRng(`long-${seed}`), "race-3", cfg);
      expect(problems(course, cfg.base, cfg.gapH, tables)).toEqual([]);
    }
  });

  it("can be flown clean at the fastest speed a glider reaches", SWEEP, () => {
    const perfect: Skill = { reaction: [0.05, 0.05], error: 0, lapse: 0, jitter: 0 };
    for (const speed of Object.keys(SPEEDS) as (keyof typeof SPEEDS)[]) {
      for (const gap of Object.keys(GAPS) as (keyof typeof GAPS)[]) {
        const cfg = config({ speed, gap, crash: "out" });
        for (let seed = 0; seed < 60; seed++) {
          const course = buildCourse(createRng(`fly-${seed}`), "race-1", cfg);
          const f = createFlight();
          // The out rule's ramp plus the adult pad's speed: the fastest anyone goes.
          launch(f, ADULT, rulesOf(cfg), cfg.race);
          fly(
            f,
            course,
            ADULT,
            rulesOf(cfg),
            createPilot(createRng(`p${seed}`), perfect),
            cfg.race,
            cfg.race,
          );
          expect(f.mode, `${speed} ${gap} seed ${seed} crashed at ${Math.round(f.x)}`).toBe(
            "finished",
          );
        }
      }
    }
  });

  it("is the same on every frame for the same race", () => {
    const cfg = config();
    // Two frames with the same seed, one of which has built other races and drawn from its rng.
    const a = createRng("treetop:main");
    const b = createRng("treetop:main");
    b.next();
    buildCourse(b, "race-41", cfg);
    const one = buildCourse(a, "race-42", cfg);
    const two = buildCourse(b, "race-42", cfg);
    expect(two.hash).toBe(one.hash);
    expect(two.gates).toEqual(one.gates);
    expect(buildCourse(a, "race-43", cfg).hash).not.toBe(one.hash);
    expect(buildCourse(createRng("other"), "race-42", cfg).hash).not.toBe(one.hash);
  });

  it("changes with the options that shape it", () => {
    const rng = createRng("treetop:main");
    const base = buildCourse(rng, "race-1", config());
    expect(buildCourse(rng, "race-1", config({ gap: "wide" })).hash).not.toBe(base.hash);
    expect(buildCourse(rng, "race-1", config({ speed: "fast" })).hash).not.toBe(base.hash);
    expect(buildCourse(rng, "race-1", config({ race: 60 })).length).toBeGreaterThan(base.length);
  });

  it("has a length a clean run covers in about 35 s of a 45 s race", () => {
    const cfg = config();
    expect(buildCourse(createRng("x"), "race-1", cfg).length).toBe(cfg.base * 45);
  });
});
