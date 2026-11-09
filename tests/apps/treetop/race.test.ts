import { describe, expect, it } from "vitest";
import { COUNTDOWN_MS, periodMs, RESULTS_MS } from "../../../src/apps/treetop/config";
import { countdownLeft, courseLabel, raceAt, SOLO_COURSE_MS } from "../../../src/apps/treetop/race";

describe("race cadence", () => {
  const cfg = { race: 45 };
  const P = periodMs(cfg);

  it("counts down, races and shows results on a fixed period of the shared clock", () => {
    expect(P).toBe(COUNTDOWN_MS + 45_000 + RESULTS_MS);
    const k = 1000;
    expect(raceAt(k * P, cfg)).toMatchObject({ k, phase: "countdown", t: -COUNTDOWN_MS });
    expect(raceAt(k * P + COUNTDOWN_MS - 1, cfg).phase).toBe("countdown");
    expect(raceAt(k * P + COUNTDOWN_MS, cfg)).toMatchObject({ k, phase: "racing", t: 0 });
    expect(raceAt(k * P + COUNTDOWN_MS + 45_000, cfg).phase).toBe("results");
    expect(raceAt((k + 1) * P - 1, cfg)).toMatchObject({ k, phase: "results" });
    expect(raceAt((k + 1) * P, cfg)).toMatchObject({ k: k + 1, phase: "countdown" });
  });

  it("gives every frame the same race at the same clock time", () => {
    const now = 1_792_271_525_123;
    expect(raceAt(now, cfg)).toEqual(raceAt(now, { race: 45 }));
    expect(raceAt(now, { race: 60 }).start).not.toBe(raceAt(now, cfg).start);
  });

  it("counts 5, 4, 3, 2, 1", () => {
    const at = 77 * P;
    const r = raceAt(at, cfg);
    const seen = [0, 999, 1000, 2500, 4000, 4999].map((ms) => countdownLeft(r, at + ms));
    expect(seen).toEqual([5, 5, 4, 3, 1, 1]);
    expect(countdownLeft(raceAt(at + COUNTDOWN_MS, cfg), at + COUNTDOWN_MS)).toBe(0);
  });

  it("keeps the solo course for ten minutes and a bank course for one race", () => {
    const a = raceAt(SOLO_COURSE_MS * 300, cfg);
    const b = raceAt(SOLO_COURSE_MS * 300 + P * 3, cfg);
    expect(courseLabel(a, false)).not.toBe(courseLabel(b, false));
    const sameTen = raceAt(Math.ceil((SOLO_COURSE_MS * 300) / P) * P, cfg);
    const later = raceAt(sameTen.at + P, cfg);
    expect(courseLabel(sameTen, true)).toBe(courseLabel(later, true));
    expect(courseLabel(raceAt(sameTen.at + SOLO_COURSE_MS + P, cfg), true)).not.toBe(
      courseLabel(sameTen, true),
    );
  });
});
