import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Bench, createBench } from "../../../src/apps/optics/bench";
import { createHand, turnDelta } from "../../../src/apps/optics/bots";
import { bankBench, bankChain, bankRamp } from "../../../src/apps/optics/chain";
import { generate } from "../../../src/apps/optics/generate";
import { frameLayout } from "../../../src/apps/optics/layout";
import { type Puzzle, RAMP, entrySources } from "../../../src/apps/optics/puzzle";
import { createRng, hashSeed } from "../../../src/core/rng";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import type { FrameKind } from "../../../src/core/types";

beforeEach(() => {
  vi.useFakeTimers();
  // The bot hand schedules its gestures on window timers.
  (globalThis as { window?: unknown }).window ??= globalThis;
});
afterEach(() => {
  vi.useRealTimers();
});

/** Injected touches go straight to the bench, as the touch frame routes them. */
const play = async (bench: Bench, puzzle: Puzzle, opts: { wrong: number; seed: string }) => {
  let next = 1;
  let t = 0;
  vi.setSystemTime(0);
  const fingers = new Map<number, { x: number; y: number }>();
  const input = {
    inject: {
      down: (x: number, y: number) => {
        const id = next++;
        fingers.set(id, { x, y });
        bench.down(id, x, y, true);
        return id;
      },
      move: (id: number, x: number, y: number) => {
        fingers.set(id, { x, y });
        bench.move(id, x, y);
      },
      up: (id: number) => {
        const f = fingers.get(id) ?? { x: 0, y: 0 };
        fingers.delete(id);
        bench.up(id, f.x, f.y);
      },
    },
  };
  bench.load(puzzle);
  if (puzzle.entry.length > 0) bench.setExtra(entrySources(puzzle, true));
  const hand = createHand({
    input,
    rng: createRng(opts.seed),
    bench: () => bench,
    unit: () => 1,
    rest: [0.4, 0.8],
    wrong: opts.wrong,
    pace: 1,
  });
  // Up to five minutes of play.
  for (let step = 0; step < 3000 && !bench.solved; step++) {
    hand.update(0.1, true);
    await vi.advanceTimersByTimeAsync(100);
    t += 100;
  }
  hand.dispose();
  return { solved: bench.solved, ms: t };
};

const benchFor = (kind: FrameKind, benches = 1) =>
  frameLayout(kind, VENUE_SIZE[kind], DEFAULT_REACH[kind], { benches }).benches[0]!;

describe("bots", () => {
  it("finds the shortest turn, allowing for symmetry", () => {
    expect(turnDelta("mirror", 0, 3)).toBe(3);
    expect(turnDelta("mirror", 0, 21)).toBe(-3);
    expect(turnDelta("splitter", 0, 13)).toBe(1);
    expect(turnDelta("prism", 1, 9)).toBe(0);
  });

  for (const [kind, benches] of [
    ["panel", 1],
    ["pair", 1],
    ["kiosk", 1],
    ["wall", 3],
  ] as const) {
    it(`solve every level on a ${kind} by touch alone`, { timeout: 120_000 }, async () => {
      const bench = benchFor(kind, benches);
      for (const level of RAMP) {
        for (let n = 0; n < 4; n++) {
          const p = generate({
            bench,
            level,
            seed: `bot:${kind}:${level}:${n}`,
            colour: true,
            bank: null,
          });
          const b = createBench({
            layout: bench,
            sandbox: false,
            colour: true,
            now: () => Date.now(),
          });
          const r = await play(b, p, { wrong: 0.18, seed: `${level}:${n}` });
          expect(r.solved, `${kind} ${level} #${n}`).toBe(true);
        }
      }
    });
  }

  for (const kind of ["panel", "pair"] as const) {
    it(`solve every bank level on a ${kind} by touch alone`, { timeout: 120_000 }, async () => {
      const count = kind === "pair" ? 5 : 10;
      const bench = bankBench(kind, kind === "pair" ? 2 : 1);
      for (const level of bankRamp(true)) {
        for (let serial = 0; serial < 2; serial++) {
          const chain = bankChain(
            { seed: "bots", bench, serial, level, colour: true, count },
            count - 1,
          );
          for (const [pos, p] of chain.entries()) {
            const b = createBench({
              layout: bench,
              sandbox: false,
              colour: true,
              now: () => Date.now(),
            });
            const r = await play(b, p, { wrong: 0, seed: `${level}:${serial}:${pos}` });
            expect(r.solved, `${kind} ${level} s${serial} pos ${pos}`).toBe(true);
          }
        }
      }
    });
  }

  it("turns a crowded corner piece by its ring without picking up a piece in the tray", async () => {
    // The round a bank soak stuck on: the third panel's mirror sat in the bottom corner,
    // where the clearest point on its ring was over a filter waiting in the children's tray.
    const bench = bankBench("panel", 1);
    const chain = bankChain(
      { seed: hashSeed("soak"), bench, serial: 10, level: "filter", colour: true, count: 6 },
      2,
    );
    const b = createBench({ layout: bench, sandbox: false, colour: true, now: () => Date.now() });
    const r = await play(b, chain[2]!, { wrong: 0, seed: "corner" });
    expect(r.solved).toBe(true);
  });
});
