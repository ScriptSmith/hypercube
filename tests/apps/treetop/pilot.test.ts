import { describe, expect, it } from "vitest";
import { ADULT, STANDARD } from "../../../src/apps/treetop/config";
import { buildCourse } from "../../../src/apps/treetop/course";
import { createFlight, launch } from "../../../src/apps/treetop/flight";
import { createPilot, SKILLS } from "../../../src/apps/treetop/pilot";
import { createRng } from "../../../src/core/rng";
import { config, fly, rulesOf } from "./helpers";

const RUNS = 40;

const stats = (skill: keyof typeof SKILLS, crash: "tumble" | "out", adult = false) => {
  const cfg = config({ crash });
  const rules = rulesOf(cfg);
  const body = adult ? ADULT : STANDARD;
  let crashes = 0;
  let gates = 0;
  let finishes = 0;
  for (let i = 0; i < RUNS; i++) {
    const course = buildCourse(createRng(`bot-${i}`), "race-1", cfg);
    const f = createFlight();
    launch(f, body, rules, 0);
    fly(f, course, body, rules, createPilot(createRng(`pilot-${i}`), SKILLS[skill]), cfg.race);
    crashes += f.crashes;
    gates += f.gates;
    if (f.fin !== null) finishes++;
  }
  return { crashes: crashes / RUNS, gates: gates / RUNS, finishes };
};

describe("bot pilots", { timeout: 60_000 }, () => {
  it("clear most gates and crash now and then", () => {
    for (const skill of ["attract", "rival"] as const) {
      const s = stats(skill, "tumble");
      expect(s.finishes).toBeGreaterThanOrEqual(RUNS * 0.9);
      expect(s.crashes).toBeGreaterThan(0.2);
      expect(s.crashes).toBeLessThan(3);
    }
  });

  it("make some races under the out rule but not every one", () => {
    const s = stats("attract", "out");
    expect(s.finishes).toBeGreaterThan(0);
    expect(s.finishes).toBeLessThan(RUNS);
    expect(s.gates).toBeGreaterThan(6);
  });

  it("can fly the heavier, faster adult glider", () => {
    const s = stats("steady", "tumble", true);
    expect(s.finishes).toBeGreaterThanOrEqual(RUNS * 0.9);
    expect(s.crashes).toBeLessThan(2);
  });

  it("only flap while flying", () => {
    const pilot = createPilot(createRng("x"), SKILLS.steady);
    const course = buildCourse(createRng("x"), "race-1", config());
    const f = createFlight();
    for (let i = 0; i < 240; i++) expect(pilot.step(f, course, STANDARD, 1 / 120)).toBe(false);
  });
});
