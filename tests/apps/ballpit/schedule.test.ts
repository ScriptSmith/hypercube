import { describe, expect, it } from "vitest";
import { readConfig, REVEAL_MS } from "../../../src/apps/ballpit/config";
import { CHILD_MAX_ANSWERS, questionsInSet } from "../../../src/apps/ballpit/questions";
import { questionsFor, slotAt } from "../../../src/apps/ballpit/schedule";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 18, 2, 0);

describe("question schedule", () => {
  it("gives every frame the same question for the same clock", () => {
    const cfg = readConfig("one", { set: "animals", rotate: 5 });
    // Two frames whose clocks agree (as the room's shared clock makes them) at many moments.
    for (let t = T0; t < T0 + 3 * 60 * MIN; t += 37_000) {
      const a = slotAt(t, cfg);
      const b = slotAt(t, readConfig("one", { set: "animals", rotate: 5 }));
      expect(a.questions.map((q) => q.id)).toEqual(b.questions.map((q) => q.id));
      expect(a.k).toBe(b.k);
    }
  });

  it("changes question every period, in order through the set", () => {
    const cfg = readConfig("one", { set: "science", rotate: 3 });
    const list = questionsInSet("science");
    const seen: string[] = [];
    const k0 = Math.floor(T0 / (3 * MIN));
    for (let i = 0; i < list.length; i++) {
      const s = slotAt((k0 + i) * 3 * MIN + 1000, cfg);
      expect(s.start).toBe((k0 + i) * 3 * MIN);
      expect(s.end - s.start).toBe(3 * MIN);
      seen.push(s.questions[0]!.id);
    }
    expect(new Set(seen).size).toBe(list.length);
  });

  it("reveals in the last seconds before a change, not for a fixed question", () => {
    const cfg = readConfig("one", { rotate: 5 });
    const k = Math.floor(T0 / (5 * MIN));
    const end = (k + 1) * 5 * MIN;
    expect(slotAt(end - REVEAL_MS - 1, cfg).reveal).toBe(false);
    expect(slotAt(end - REVEAL_MS + 1, cfg).reveal).toBe(true);
    const fixed = readConfig("one", { question: "float" });
    expect(slotAt(end - 1, fixed).reveal).toBe(false);
    expect(slotAt(end - 1, fixed).questions[0]!.id).toBe("float");
    expect(slotAt(end + 5 * MIN, fixed).questions[0]!.id).toBe("float");
  });

  it("moves on to the next question when admin skips, until the period ends", () => {
    const cfg = readConfig("one", { rotate: 5 });
    const t = T0 + 1000;
    const s = slotAt(t, cfg);
    const next = slotAt(t + 5 * MIN, cfg);
    const skipped = slotAt(t, cfg, { k: s.k, n: 1 });
    expect(skipped.questions[0]!.id).toBe(next.questions[0]!.id);
    // A skip for an older period does nothing.
    expect(slotAt(t + 5 * MIN, cfg, { k: s.k, n: 1 }).questions[0]!.id).toBe(next.questions[0]!.id);
  });

  it("shows two different questions in the two-question variant, the low one fit for children", () => {
    for (const set of ["everyday", "animals", "science"]) {
      const cfg = readConfig("two", { set, rotate: 2 });
      for (let i = 0; i < 40; i++) {
        const s = slotAt(T0 + i * 2 * MIN, cfg);
        const [kid, adult] = s.questions;
        expect(kid!.id).not.toBe(adult!.id);
        expect(kid!.audience).not.toBe("adults");
        expect(kid!.answers.length).toBeLessThanOrEqual(CHILD_MAX_ANSWERS);
        expect(adult!.audience).not.toBe("children");
      }
    }
  });

  it("puts a fixed question in the slot that suits it", () => {
    const kid = slotAt(T0, readConfig("two", { question: "pet" }));
    expect(kid.questions[0]!.id).toBe("pet");
    expect(kid.questions[1]!.id).not.toBe("pet");
    const adult = slotAt(T0, readConfig("two", { question: "travel" }));
    expect(adult.questions[1]!.id).toBe("travel");
  });

  it("lists what a config can show", () => {
    expect(questionsFor(readConfig("one", { set: "animals" })).length).toBe(
      questionsInSet("animals").length,
    );
    expect(questionsFor(readConfig("one", { question: "rainbow" })).map((q) => q.id)).toEqual([
      "rainbow",
    ]);
  });

  it("reads options defensively", () => {
    const c = readConfig("weird", { set: "nope", question: "nope", rotate: 999, yesterday: "x" });
    expect(c).toEqual({
      variant: "one",
      set: "everyday",
      question: "rotate",
      custom: null,
      customWhy: null,
      rotateMs: 30 * MIN,
      yesterday: true,
    });
    expect(readConfig("two", { rotate: 0, yesterday: false }).rotateMs).toBe(2 * MIN);
  });
});
