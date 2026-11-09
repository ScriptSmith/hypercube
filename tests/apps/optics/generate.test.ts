import { describe, expect, it } from "vitest";
import { bankBench, bankChain, bankRamp } from "../../../src/apps/optics/chain";
import { generate, handOn } from "../../../src/apps/optics/generate";
import { frameLayout } from "../../../src/apps/optics/layout";
import { sameTurn } from "../../../src/apps/optics/pieces";
import { type Puzzle, RAMP, allLit, tracePlaces } from "../../../src/apps/optics/puzzle";
import { EDGE_RIGHT, EDGE_TOP, glowOf } from "../../../src/apps/optics/trace";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import type { FrameKind } from "../../../src/core/types";

const SOLO: { name: string; kind: FrameKind; benches: number }[] = [
  { name: "panel", kind: "panel", benches: 1 },
  { name: "pair", kind: "pair", benches: 1 },
  { name: "kiosk", kind: "kiosk", benches: 1 },
  { name: "wall x1", kind: "wall", benches: 1 },
  { name: "wall x2", kind: "wall", benches: 2 },
  { name: "wall x3", kind: "wall", benches: 3 },
];

const benchOf = (kind: FrameKind, benches: number) =>
  frameLayout(kind, VENUE_SIZE[kind], DEFAULT_REACH[kind], { benches }).benches[0]!;

/** Every crystal glows from the solution; none before a piece is placed; not all at the start. */
const checkPuzzle = (bench: ReturnType<typeof benchOf>, p: Puzzle, label: string) => {
  expect(p.crystals.length, `${label}: crystals`).toBeGreaterThan(0);
  const sol = tracePlaces(bench, p, p.solution);
  expect(allLit(p, sol), `${label}: solution lights every crystal`).toBe(true);
  expect(sol.truncated, `${label}: solution trace within limits`).toBe(false);
  p.pieces.forEach((_, i) =>
    expect(sol.hits[i], `${label}: piece ${i} is used`).toBeGreaterThan(0),
  );
  p.pieces.forEach((_, i) => {
    const without = p.solution.map((x, k) => (k === i ? { ...x, socket: null } : x));
    expect(allLit(p, tracePlaces(bench, p, without)), `${label}: piece ${i} is needed`).toBe(false);
  });
  const start = tracePlaces(bench, p, p.start);
  expect(allLit(p, start), `${label}: not solved when scrambled`).toBe(false);
  const empty = tracePlaces(
    bench,
    p,
    p.pieces.map(() => ({ socket: null, turn: 0 })),
  );
  p.crystals.forEach((c, i) =>
    expect(glowOf(c, empty.real[i] ?? 0, 0), `${label}: crystal ${i} dark with no pieces`).toBe(0),
  );
  // Pieces sit in the bench's sockets, a piece per socket, at most the limit per half.
  const used = p.solution.map((s) => s.socket);
  expect(new Set(used).size).toBe(used.length);
  for (const s of used) expect(s !== null && bench.sockets[s] !== undefined).toBe(true);
  for (let h = 0; h < bench.halves; h++) {
    expect(used.filter((s) => bench.sockets[s!]!.half === h).length).toBeLessThanOrEqual(
      bench.limit,
    );
  }
  // A piece left in its solution socket at the start is turned to a different detent.
  p.start.forEach((s, i) => {
    if (s.socket !== null && s.socket === p.solution[i]!.socket) {
      expect(sameTurn(p.pieces[i]!.kind, s.turn, p.solution[i]!.turn)).toBe(false);
    }
  });
};

describe("solo puzzles", () => {
  for (const size of SOLO) {
    for (const level of RAMP) {
      it(`${size.name} ${level}: solvable by its solution, never solved at the start`, () => {
        const bench = benchOf(size.kind, size.benches);
        let fallbacks = 0;
        for (let n = 0; n < 12; n++) {
          const p = generate({
            bench,
            level,
            seed: `t:${size.name}:${level}:${n}`,
            colour: true,
            bank: null,
          });
          checkPuzzle(bench, p, `${size.name} ${level} #${n}`);
          if (p.fallback) fallbacks++;
          else expect(p.level).toBe(level);
        }
        expect(fallbacks, "falls back to an easier level only rarely").toBeLessThanOrEqual(2);
      });
    }
  }

  it("is deterministic from its seed", () => {
    const bench = benchOf("panel", 1);
    for (const level of RAMP) {
      const a = generate({ bench, level, seed: "same", colour: true, bank: null });
      const b = generate({ bench, level, seed: "same", colour: true, bank: null });
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
    const c = generate({ bench, level: "m2", seed: "other", colour: true, bank: null });
    const a = generate({ bench, level: "m2", seed: "same", colour: true, bank: null });
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it("keeps to white light without colour", () => {
    const bench = benchOf("wall", 2);
    for (const level of RAMP) {
      for (let n = 0; n < 6; n++) {
        const p = generate({ bench, level, seed: `plain:${n}`, colour: false, bank: null });
        expect(p.pieces.some((x) => x.kind === "prism" || x.kind === "filter")).toBe(false);
        expect(p.crystals.every((c) => c.band === "w")).toBe(true);
        expect(p.lamps.every((l) => l.kind !== "laser")).toBe(true);
      }
    }
  });

  it("puts children's pieces in the child band more often than not", () => {
    const bench = benchOf("panel", 1);
    let child = 0;
    let all = 0;
    for (let n = 0; n < 30; n++) {
      const p = generate({ bench, level: "m2", seed: `band:${n}`, colour: true, bank: null });
      for (const s of p.solution) {
        all++;
        if (bench.sockets[s.socket!]!.child) child++;
      }
    }
    expect(child / all).toBeGreaterThan(0.5);
  });

  it("lights a crystal high on the wall in most wall puzzles", () => {
    const bench = benchOf("wall", 3);
    let high = 0;
    for (let n = 0; n < 20; n++) {
      const p = generate({ bench, level: "m1", seed: `high:${n}`, colour: true, bank: null });
      if (p.crystals.some((c) => c.y < bench.reachTop)) high++;
    }
    expect(high).toBeGreaterThanOrEqual(14);
  });

  it("needs a lens to focus the wide lamp onto the small crystal", () => {
    const bench = benchOf("panel", 1);
    for (let n = 0; n < 8; n++) {
      const p = generate({ bench, level: "lens", seed: `lens:${n}`, colour: true, bank: null });
      if (p.fallback) continue;
      expect(p.lamps[0]!.kind).toBe("wide");
      expect(p.pieces.map((x) => x.kind)).toEqual(["convex"]);
      expect(p.crystals.some((c) => c.small)).toBe(true);
    }
  });
});

describe("bank chains", () => {
  for (const kind of ["panel", "pair"] as const) {
    const count = kind === "pair" ? 5 : 10;
    for (const level of bankRamp(true)) {
      it(`${kind} x${count} ${level}: each frame continues the light of the one before`, () => {
        const bench = bankBench(kind, kind === "pair" ? 2 : 1);
        let fallbacks = 0;
        for (let serial = 0; serial < 3; serial++) {
          const chain = bankChain(
            { seed: "chain", bench, serial, level, colour: true, count },
            count - 1,
          );
          expect(chain.length).toBe(count);
          chain.forEach((p, pos) => {
            const label = `${kind} ${level} s${serial} pos ${pos}`;
            checkPuzzle(bench, p, label);
            if (p.fallback) fallbacks++;
            const sol = tracePlaces(bench, p, p.solution);
            // Light goes up to the screen, and on to the next frame.
            expect(
              sol.exits.some((e) => e.edge === EDGE_TOP && !e.guide),
              `${label}: up`,
            ).toBe(true);
            if (pos < count - 1) {
              expect(p.exits.length, `${label}: on`).toBeGreaterThan(0);
              const next = chain[pos + 1]!;
              if (!next.fallback) expect(next.entry).toEqual(handOn(p.exits, bench.box.width));
            }
            expect(
              pos === 0 ? p.lamps.length : p.entry.length,
              `${label}: light in`,
            ).toBeGreaterThan(0);
            // Unsolved, nothing runs on into the next frame.
            const empty = tracePlaces(
              bench,
              p,
              p.pieces.map(() => ({ socket: null, turn: 0 })),
            );
            expect(
              empty.exits.filter((e) => e.edge === EDGE_RIGHT && !e.guide).length,
              `${label}: unsolved light stays in`,
            ).toBe(0);
          });
        }
        // Narrow panels have little room for a branch: prisms and filters there often fall back.
        const share = level === "prism" ? 0.9 : level === "filter" ? 0.65 : 0.25;
        expect(fallbacks, `${kind} ${level}: fallbacks`).toBeLessThanOrEqual(count * 3 * share);
      });
    }
  }

  it("is the same chain whichever frame builds it", () => {
    const bench = bankBench("panel", 1);
    const spec = { seed: 7, bench, serial: 4, level: "m2" as const, colour: true, count: 6 };
    const full = bankChain(spec, 5);
    const part = bankChain({ ...spec }, 3);
    expect(JSON.stringify(part)).toBe(JSON.stringify(full.slice(0, 4)));
  });
});
