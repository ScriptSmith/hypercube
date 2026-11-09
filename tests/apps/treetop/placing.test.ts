import { describe, expect, it } from "vitest";
import { STANDARD } from "../../../src/apps/treetop/config";
import { buildCourse } from "../../../src/apps/treetop/course";
import { createFlight, distanceOf, launch } from "../../../src/apps/treetop/flight";
import { createPilot, SKILLS } from "../../../src/apps/treetop/pilot";
import { placeOf, placings } from "../../../src/apps/treetop/placing";
import { createRng } from "../../../src/core/rng";
import { config, fly, rulesOf } from "./helpers";

describe("placings", { timeout: 60_000 }, () => {
  it("ranks finishers by time, then everyone else by distance", () => {
    const places = placings([
      { lane: 0, d: 9000, fin: null },
      { lane: 1, d: 16_200, fin: 36_500 },
      { lane: 2, d: 12_000, fin: null },
      { lane: 3, d: 16_200, fin: 35_100 },
    ]);
    expect([...places.entries()].sort((a, b) => a[1] - b[1])).toEqual([
      [3, 1],
      [1, 2],
      [2, 3],
      [0, 4],
    ]);
  });

  it("breaks ties by lane so every frame agrees", () => {
    const a = placings([
      { lane: 5, d: 100, fin: null },
      { lane: 2, d: 100, fin: null },
    ]);
    const b = placings([
      { lane: 2, d: 100, fin: null },
      { lane: 5, d: 100, fin: null },
    ]);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
    expect(a.get(2)).toBe(1);
  });

  it("gives a lane's current place among the lanes known", () => {
    const entries = [
      { lane: 0, d: 500, fin: null },
      { lane: 1, d: 800, fin: null },
      { lane: 2, d: 300, fin: 20_000 },
    ];
    expect(placeOf(entries, 0)).toBe(3);
    expect(placeOf(entries, 2)).toBe(1);
    expect(placeOf(entries, 9)).toBe(null);
  });

  it("tumble: a glider that crashed but finished beats one still flying at the end", () => {
    const cfg = config({ crash: "tumble", race: 30 });
    const rules = rulesOf(cfg);
    const course = buildCourse(createRng("treetop:main"), "race-1", cfg);
    const flights = [0, 1, 2, 3].map(() => createFlight());
    const skills = [SKILLS.steady, SKILLS.attract, SKILLS.rival, { ...SKILLS.rival, lapse: 0.5 }];
    const result = flights.map((f, i) => {
      launch(f, STANDARD, rules, 0);
      fly(f, course, STANDARD, rules, createPilot(createRng(`p${i}`), skills[i]!), cfg.race);
      return { lane: i, d: distanceOf(f), fin: f.fin, crashes: f.crashes };
    });
    const places = placings(result);
    const finished = result.filter((r) => r.fin !== null);
    const flying = result.filter((r) => r.fin === null);
    expect(flying.length).toBeGreaterThan(0);
    for (const a of finished)
      for (const b of flying) expect(places.get(a.lane)!).toBeLessThan(places.get(b.lane)!);
    // Nobody is eliminated: every glider is still going at the end or over the line.
    for (const f of flights) expect(["flying", "tumbling", "finished"]).toContain(f.mode);
  });

  it("out: the last glider flying wins, and a late joiner is ranked by distance", () => {
    const cfg = config({ crash: "out" });
    const rules = rulesOf(cfg);
    const course = buildCourse(createRng("treetop:main"), "race-2", cfg);
    const outAt: number[] = [];
    const entries = [0, 1, 2, 3].map((lane) => {
      const f = createFlight();
      launch(f, STANDARD, rules, 0);
      const pilot = createPilot(createRng(`out-${lane}`), { ...SKILLS.rival, lapse: 0.25 });
      const t = fly(f, course, STANDARD, rules, pilot, cfg.race);
      outAt[lane] = f.mode === "out" ? t : Infinity;
      return { lane, d: distanceOf(f), fin: f.fin };
    });
    const places = placings(entries);
    const byOut = [0, 1, 2, 3].sort((a, b) => outAt[b]! - outAt[a]!);
    expect(byOut.map((l) => places.get(l))).toEqual([1, 2, 3, 4]);
    // A glider that joined 20 s in from the start line and is still flying at the end.
    const late = createFlight();
    launch(late, STANDARD, rules, 20);
    fly(
      late,
      course,
      STANDARD,
      rules,
      createPilot(createRng("late"), SKILLS.steady),
      cfg.race - 20,
      20,
    );
    expect(late.mode).not.toBe("waiting");
    const all = [...entries, { lane: 9, d: distanceOf(late), fin: late.fin }];
    const ahead = entries.filter((e) => e.fin !== null || e.d > distanceOf(late)).length;
    expect(placings(all).get(9)).toBe(ahead + 1);
    expect(placeOf(all, 9)).toBe(ahead + 1);
  });
});
