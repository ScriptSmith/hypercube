import { describe, expect, it } from "vitest";
import { ballFacts, FACTS, GREETINGS } from "../../../src/apps/ticker/messages";
import type { RingRole } from "../../../src/apps/ticker/rings";
import {
  createBag,
  createSchedule,
  type Line,
  type ListMode,
  TIME_EVERY_S,
} from "../../../src/apps/ticker/schedule";
import { sphereInfo } from "../../../src/core/sphere";
import { createRng } from "../../../src/core/rng";

const NOW = new Date(2026, 10, 2, 15, 5).getTime();

/** `n` lines, one every `every` seconds. */
const run = (
  list: ListMode,
  role: RingRole,
  operator: string[],
  n: number,
  every = 30,
  seed = "s",
): Line[] => {
  const s = createSchedule(
    { list, role, operator, ballFacts: ballFacts(sphereInfo(), 0.32) },
    createRng(seed),
  );
  return Array.from({ length: n }, (_, i) => s.next(i * every, NOW + i * every * 1000));
};

describe("ticker bag", () => {
  it("deals every item once before any repeats, and none again within half a deck", () => {
    for (const n of [1, 2, 3, 5, 8, 24]) {
      const items = Array.from({ length: n }, (_, i) => `item ${i}`);
      for (const seed of ["1", "2", "3", "4"]) {
        const bag = createBag(items, createRng(seed));
        const dealt = Array.from({ length: 30 * n }, () => bag.next()!);
        for (let i = 0; i + n <= dealt.length; i += n) {
          expect(new Set(dealt.slice(i, i + n)).size).toBe(n);
        }
        const window = Math.floor(n / 2) + 1;
        for (let i = 0; i + window <= dealt.length; i++) {
          expect(new Set(dealt.slice(i, i + window)).size).toBe(window);
        }
      }
    }
    expect(createBag([], createRng("x")).next()).toBeNull();
  });
});

describe("ticker schedule", () => {
  it("shows the operator's messages every other line, more often than any curated line", () => {
    const own = ["Welcome to the open day", "Talks start at 2 pm"];
    const lines = run("general", "main", own, 400);
    const count = (text: string) => lines.filter((l) => l.text === text).length;
    const mine = lines.filter((l) => l.kind === "operator");
    expect(mine.length).toBeGreaterThan(lines.length * 0.35);
    const curated = lines.filter((l) => l.kind !== "operator" && l.kind !== "time");
    const top = Math.max(...curated.map((l) => count(l.text)));
    for (const text of own) expect(count(text)).toBeGreaterThan(top);
    // Never the same operator line twice running when there are two.
    for (let i = 1; i < mine.length; i++) expect(mine[i]!.text).not.toBe(mine[i - 1]!.text);
  });

  it("cycles curated lines without long repeats", () => {
    const lines = run("general", "main", [], 600);
    const facts = lines.filter((l) => l.kind === "fact").map((l) => l.text);
    const window = Math.floor(FACTS.length / 2) + 1;
    for (let i = 0; i + window <= facts.length; i++) {
      expect(new Set(facts.slice(i, i + window)).size).toBe(window);
    }
    const kinds = new Set(lines.map((l) => l.kind));
    expect([...kinds].sort()).toEqual(["ball", "date", "fact", "greet", "time"]);
  });

  it("shows the time now and then, and the date in between", () => {
    for (const role of ["main", "lower", "pole"] as const) {
      const lines = run("general", role, [], 240, 20);
      const clock = lines
        .map((l, i) => ({ l, at: i * 20 }))
        .filter(({ l }) => l.kind === "time" || l.kind === "date");
      expect(clock.length).toBeGreaterThan((0.8 * (240 * 20)) / TIME_EVERY_S[role]);
      for (let i = 1; i < clock.length; i++) {
        expect(clock[i]!.at - clock[i - 1]!.at).toBeGreaterThanOrEqual(TIME_EVERY_S[role]);
        expect(clock[i]!.l.kind).not.toBe(clock[i - 1]!.l.kind);
      }
      expect(clock[0]!.l.text).toMatch(/^The time is \d{1,2}:\d\d (am|pm)$/);
    }
  });

  it("keeps to the chosen list", () => {
    const own = ["Hello from the team"];
    const greet = run("welcome", "main", [], 120);
    expect(new Set(greet.map((l) => l.kind))).toEqual(new Set(["greet"]));
    const greetOwn = run("welcome", "lower", own, 120);
    expect(new Set(greetOwn.map((l) => l.kind))).toEqual(new Set(["greet", "operator"]));

    const mine = run("operator", "main", own, 120);
    expect(new Set(mine.map((l) => l.kind))).toEqual(new Set(["operator", "time", "date"]));
    const clockOnly = run("operator", "main", [], 40);
    expect(new Set(clockOnly.map((l) => l.kind))).toEqual(new Set(["time", "date"]));

    const pole = run("general", "pole", [], 120);
    expect(new Set(pole.map((l) => l.kind))).toEqual(new Set(["greet", "time", "date"]));
  });

  it("starts each ring somewhere different", () => {
    const a = run("general", "main", [], 12, 30, "a").map((l) => l.text);
    const b = run("general", "main", [], 12, 30, "b").map((l) => l.text);
    expect(a).not.toEqual(b);
  });

  it("uses new facts about the ball after a resize", () => {
    const s = createSchedule(
      { list: "general", role: "main", operator: [], ballFacts: ["Old fact"] },
      createRng("r"),
    );
    s.setBallFacts(["New fact"]);
    const lines = Array.from({ length: 80 }, (_, i) => s.next(i * 10, NOW));
    const ball = lines.filter((l) => l.kind === "ball").map((l) => l.text);
    expect(ball.length).toBeGreaterThan(0);
    expect(new Set(ball)).toEqual(new Set(["New fact"]));
  });

  it("numbers lines in order, for colours", () => {
    const lines = run("general", "main", ["x"], 50);
    expect(lines.map((l) => l.n)).toEqual(lines.map((_, i) => i));
  });

  it("has a greeting deck big enough not to repeat often", () => {
    expect(GREETINGS.length).toBeGreaterThanOrEqual(10);
  });
});
