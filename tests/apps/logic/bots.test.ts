import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BotMode, createBenchBot } from "../../../src/apps/logic/bots";
import {
  ALL_GATES,
  BASIC_GATES,
  KINDS,
  LIMITS,
  type PieceKind,
  pieceCount,
  validate,
} from "../../../src/apps/logic/circuit";
import { createRng } from "../../../src/core/rng";
import type { Input } from "../../../src/core/types";
import { benchOf, type TestBench } from "./helpers";

const UNIT = 0.5;

/** Injected touches go straight to the bench, as the runtime's input would deliver them. */
const wire = (t: TestBench) => {
  let next = 1_000_000;
  const input = {
    inject: {
      down(x: number, y: number) {
        const id = next++;
        t.bench.down(id, x / UNIT, y / UNIT, false);
        return id;
      },
      move(id: number, x: number, y: number) {
        t.bench.move(id, x / UNIT, y / UNIT);
      },
      up(id: number) {
        const g = t.bench.gestures.get(id);
        const at = g && "x" in g ? { x: g.x, y: g.y } : { x: 0, y: 0 };
        t.bench.up(id, at.x, at.y);
      },
    },
  } as unknown as Input;
  return input;
};

const run = async (
  t: TestBench,
  mode: BotMode,
  minutes: number,
  gates: readonly PieceKind[],
  set: "basic" | "all",
  each?: () => void,
) => {
  const bot = createBenchBot({
    input: wire(t),
    rng: createRng(`bot:${mode}`),
    mode,
    bench: () => t.bench,
    unit: () => UNIT,
    gates,
    recipe: () => t.bench.card?.solutions[set] ?? null,
  });
  const step = 1000 / 30;
  for (let ms = 0; ms < minutes * 60_000; ms += step) {
    bot.update(step / 1000, true);
    t.clock.t += step;
    t.bench.update(step);
    await vi.advanceTimersByTimeAsync(step);
    each?.();
  }
  bot.dispose();
  return bot;
};

describe("logic bots", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { window?: unknown }).window ??= globalThis;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("build, rewire and swap through touches, keeping within the limits", async () => {
    const t = benchOf("pair");
    const seen = new Set<string>();
    let versions = 0;
    let last = t.bench.circuit.version;
    await run(t, "bot", 6, ALL_GATES, "all", () => {
      const c = t.bench.circuit;
      if (c.version !== last) {
        versions++;
        last = c.version;
        for (const p of c.pieces) seen.add(p.kind);
        expect(validate(c)).toEqual([]);
        expect(pieceCount(c)).toBeLessThanOrEqual(LIMITS.pieces);
        expect(c.wires.length).toBeLessThanOrEqual(LIMITS.wires);
      }
    });
    expect(versions).toBeGreaterThan(40);
    // Over a few minutes they bring out most kinds of piece.
    expect(seen.size).toBeGreaterThanOrEqual(7);
    const c = t.bench.circuit;
    expect(c.pieces.filter((p) => KINDS[p.kind].group === "source").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(c.pieces.filter((p) => KINDS[p.kind].group === "sink").length).toBeGreaterThanOrEqual(1);
    expect(t.bench.gestures.size).toBe(0);
  });

  it("as the attract ghost mostly flip switches and leave the bench's pieces alone", async () => {
    const t = benchOf("wall");
    const kinds = () =>
      t.bench.circuit.pieces
        .map((p) => p.kind)
        .sort()
        .join();
    const before = kinds();
    let flips = 0;
    const a = t.bench.circuit.pieces.find((p) => p.kind === "switch")!;
    let was = a.on;
    await run(t, "attract", 3, ALL_GATES, "all", () => {
      if (a.on !== was) {
        flips++;
        was = a.on;
      }
    });
    expect(kinds()).toBe(before);
    expect(flips).toBeGreaterThan(5);
    expect(t.bench.lastHuman).toBe(Number.NEGATIVE_INFINITY);
  });

  for (const [set, gates] of [
    ["all", ALL_GATES],
    ["basic", BASIC_GATES],
  ] as const) {
    it(`work through the goal cards with ${set} gates by touch alone`, async () => {
      const t = benchOf("kiosk", "goals", gates);
      await run(t, "attract", 8, gates, set);
      expect(t.bench.solved).toBeGreaterThanOrEqual(5);
      // Bots and the ghost never count as visitors' successes.
      expect(t.bench.completed).toBe(0);
      expect(validate(t.bench.circuit)).toEqual([]);
    });
  }
});
