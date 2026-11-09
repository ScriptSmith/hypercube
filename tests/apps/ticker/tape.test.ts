import { describe, expect, it } from "vitest";
import { createRingModel, type RingModel } from "../../../src/apps/ticker/ring";
import { createSchedule } from "../../../src/apps/ticker/schedule";
import { type Crawl, createTape, headAt, printerX, ringX } from "../../../src/apps/ticker/tape";
import { createRng } from "../../../src/core/rng";

const PITCH = 14;
const W = PITCH * 347;
const CRAWL: Crawl = { width: W, speed: 125, drift: W / 480, x0: 4000 };
const NOW = new Date(2026, 10, 2, 9, 30).getTime();

const model = (operator: string[] = [], crawl = CRAWL): RingModel =>
  createRingModel({
    crawl,
    pitch: PITCH,
    lookahead: 32 * PITCH,
    schedule: createSchedule(
      { list: "general", role: "main", operator, ballFacts: ["A fact about the ball"] },
      createRng("tape"),
    ),
    measure: (line) => line.text.length * 60 + 70,
    starWidth: 250,
    now: () => NOW,
  });

/** Signed distance from a to b round a ring of width w, in (-w/2, w/2]. */
const round = (a: number, b: number, w: number) => {
  const d = (((b - a) % w) + w) % w;
  return d > w / 2 ? d - w : d;
};

describe("ticker tape", () => {
  it("lays items end to end on whole pitches", () => {
    const tape = createTape<string>(-W, PITCH);
    for (const w of [1, 13, 14, 15, 500, 1234.5]) tape.append(w, "x");
    for (let i = 0; i < tape.items.length; i++) {
      const it = tape.items[i]!;
      expect(Math.abs(it.width / PITCH - Math.round(it.width / PITCH))).toBeLessThan(1e-9);
      expect(Math.abs(it.start / PITCH - Math.round(it.start / PITCH))).toBeLessThan(1e-9);
      if (i > 0) expect(it.start).toBe(tape.items[i - 1]!.start + tape.items[i - 1]!.width);
    }
    tape.dropBefore(tape.items[2]!.start + 1);
    expect(tape.items.map((x) => x.width)).toEqual([14, 28, 504, 1246]);
  });

  it("moves every word right to left at the crawl speed, smoothly across the seam", () => {
    const dt = 1 / 60;
    for (let i = 0; i < 4000; i++) {
      const t = i * dt;
      for (const s of [-W, -1000, 0, 777]) {
        const step = round(ringX(CRAWL, t, s), ringX(CRAWL, t + dt, s), W);
        expect(step).toBeCloseTo(-CRAWL.speed * dt, 6);
      }
      const p = round(printerX(CRAWL, t), printerX(CRAWL, t + dt), W);
      expect(p).toBeCloseTo(CRAWL.drift * dt, 6);
    }
  });

  it("starts full and keeps the whole ring covered, with no gaps", () => {
    const m = model();
    let t = 0;
    const rng = createRng("steps");
    for (let i = 0; i < 6000; i++) {
      t += i % 500 === 0 ? 37 : rng.range(0, 0.25);
      m.advance(t);
      const shown = m.shown();
      const head = m.head();
      expect(shown[0]!.item.start).toBeLessThanOrEqual(head - W);
      const last = shown[shown.length - 1]!.item;
      expect(last.start + last.width).toBeGreaterThanOrEqual(head);
      for (let k = 1; k < shown.length; k++) {
        const a = shown[k - 1]!.item;
        expect(shown[k]!.item.start).toBe(a.start + a.width);
      }
      // Unwrapped positions run from one turn behind the printer up to it.
      expect(shown[0]!.x).toBeLessThanOrEqual(m.printer() - W + 1e-6);
      expect(shown[shown.length - 1]!.x).toBeLessThan(m.printer());
    }
  });

  it("keeps a word in place from frame to frame until the printer takes it", () => {
    const m = model(["Operator line"]);
    const dt = 1 / 60;
    let before = new Map(m.shown().map((s) => [s.item.id, s.x]));
    for (let i = 1; i < 60 * 120; i++) {
      m.advance(i * dt);
      const now = new Map(m.shown().map((s) => [s.item.id, s.x]));
      for (const [id, x] of now) {
        const was = before.get(id);
        if (was === undefined) continue;
        expect(round(was, x, W)).toBeCloseTo(-CRAWL.speed * dt, 6);
      }
      before = now;
    }
  });

  it("prints a line once and lets it go for good once it comes round", () => {
    const m = model();
    const seen = new Set<number>();
    const gone = new Set<number>();
    for (let i = 0; i < 60 * 300; i++) {
      m.advance(i / 60);
      const ids = new Set(m.shown().map((s) => s.item.id));
      for (const id of seen) if (!ids.has(id)) gone.add(id);
      for (const id of ids) {
        expect(gone.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(gone.size).toBeGreaterThan(10);
  });

  it("holds a bounded tape however long it runs", () => {
    const m = model(["x".repeat(120)]);
    let most = 0;
    for (let day = 0; day < 3; day++) {
      for (let s = 0; s < 86_400; s += 30) {
        m.advance(day * 86_400 + s);
        most = Math.max(most, m.tape.items.length);
      }
    }
    expect(most).toBeLessThan(40);
    expect(m.printed).toBeGreaterThan(5000);
    // After three days the head is still exact enough to keep items on whole pitches.
    const it = m.tape.items[m.tape.items.length - 1]!;
    expect(Math.abs(it.start / PITCH - Math.round(it.start / PITCH))).toBeLessThan(1e-6);
  });

  it("feeds the schedule show time, so a ring rebuilt late keeps the clock lines coming", () => {
    const schedule = createSchedule(
      { list: "operator", role: "main", operator: ["Mine"], ballFacts: [] },
      createRng("late"),
    );
    const first = createRingModel({
      crawl: CRAWL,
      pitch: PITCH,
      lookahead: 32 * PITCH,
      schedule,
      measure: () => 2000,
      starWidth: 250,
      now: () => NOW,
    });
    for (let s = 0; s <= 5000; s += 5) first.advance(s);
    const again = createRingModel({
      crawl: CRAWL,
      pitch: PITCH,
      lookahead: 32 * PITCH,
      schedule,
      measure: () => 2000,
      starWidth: 250,
      now: () => NOW,
      startS: 5000,
    });
    const kinds = new Set<string>();
    for (let s = 0; s <= 900; s += 5) {
      again.advance(s);
      for (const l of again.recent()) kinds.add(l.kind);
    }
    expect(kinds.has("time") || kinds.has("date")).toBe(true);
  });

  it("puts the head where the crawl says", () => {
    expect(headAt(CRAWL, 10)).toBeCloseTo((CRAWL.speed + CRAWL.drift) * 10);
    expect(printerX(CRAWL, 0)).toBe(CRAWL.x0);
  });
});
