/**
 * A bank's puzzles, one per touch frame, built in order from the left: each frame's puzzle starts
 * from the light the frame before it sends on when solved. Every frame (and the screen) builds
 * the same chain from the room's seed, the round and the bank's size, so each knows where light
 * should cross its edges without asking.
 */
import type { FrameKind } from "../../core/types";
import { displayFor, reachFor } from "../../core/venue";
import { BANK_PLAIN, BANK_RAMP, type BankSpec, defaultEntry, generate, handOn } from "./generate";
import { type BenchLayout, frameLayout } from "./layout";
import type { LevelId, Puzzle } from "./puzzle";

export const bankRamp = (colour: boolean): readonly LevelId[] => (colour ? BANK_RAMP : BANK_PLAIN);

/** The bench every touch frame of a bank of `kind` frames uses. */
export const bankBench = (
  kind: FrameKind,
  span: number,
  venue?: { width: number; height: number },
): BenchLayout => {
  const d = displayFor(kind, span);
  const v = venue ?? { width: d.width, height: d.height };
  return frameLayout(kind, v, reachFor(d), { span, bank: true }).benches[0]!;
};

export interface ChainSpec {
  seed: string | number;
  bench: BenchLayout;
  serial: number;
  level: LevelId;
  colour: boolean;
  count: number;
}

const cache = new Map<string, Puzzle[]>();
const CACHE_MAX = 6;

/** Puzzles for frames 0 to `upTo` of the bank. */
export const bankChain = (c: ChainSpec, upTo: number): Puzzle[] => {
  const L = c.bench;
  const key = `${c.seed}:${L.kind}:${L.box.width}x${L.box.height}:${c.serial}:${c.level}:${c.colour}:${c.count}`;
  let have = cache.get(key) ?? [];
  const last = Math.min(upTo, c.count - 1);
  if (have.length <= last) {
    have = [...have];
    for (let pos = have.length; pos <= last; pos++) {
      const prev = have[pos - 1];
      let entry = prev ? handOn(prev.exits, L.box.width) : null;
      if (prev && (!entry || entry.length === 0)) entry = defaultEntry(L);
      const bank: BankSpec = { entry: pos === 0 ? null : entry, last: pos === c.count - 1 };
      have.push(
        generate({
          bench: L,
          level: c.level,
          seed: `optics:${c.seed}:bank:${c.serial}:${c.level}:${pos}`,
          colour: c.colour,
          bank,
        }),
      );
    }
    cache.delete(key);
    cache.set(key, have);
    while (cache.size > CACHE_MAX) {
      const first = cache.keys().next().value;
      if (first === undefined) break;
      cache.delete(first);
    }
  }
  return have.slice(0, last + 1);
};
