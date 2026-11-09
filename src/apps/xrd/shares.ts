/**
 * Which chapters each card shows. Pure.
 *
 * On a bank the chapters are fixed by position, so the bank reads as one poster: the eleven
 * split in order into contiguous runs as even as possible, any extra doubling up from the start.
 * Six panels, or the six halves of three pairs, take two chapters each and the last just one,
 * so `spectrum` and `interference` share the first; five panels take three, then two each. A
 * solo pair is the same split over its two halves:
 * chapters 1 to 6 on the left, 7 to 11 on the right. More slots than chapters start again.
 */
import { CHAPTER_IDS, type ChapterId, WALL_SETS } from "./ids";
import type { WallSet } from "./config";
import type { FrameKind } from "../../core/types";

export const MAX_SLOTS = 64;

/** Chapters for each of `slots` slots, left to right. */
export const shares = (slots: number): ChapterId[][] => {
  const n = Math.max(1, Math.min(MAX_SLOTS, Math.round(slots)));
  const total = CHAPTER_IDS.length;
  if (n >= total) return Array.from({ length: n }, (_, i) => [CHAPTER_IDS[i % total]!]);
  const base = Math.floor(total / n);
  const extra = total % n;
  const out: ChapterId[][] = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const len = base + (i < extra ? 1 : 0);
    out.push(CHAPTER_IDS.slice(at, at + len) as ChapterId[]);
    at += len;
  }
  return out;
};

/** Cards a touch frame of this kind holds side by side. */
export const cardsPer = (kind: FrameKind, wallCards = 6): number =>
  kind === "pair" ? 2 : kind === "wall" ? wallCards : 1;

/** The slot of a card in a bank: frames left to right, a pair's halves in turn. */
export const slotOf = (kind: FrameKind, pos: number, card: number): number =>
  kind === "pair" ? pos * 2 + card : pos;

export const slotsIn = (kind: FrameKind, count: number): number =>
  Math.max(1, count) * (kind === "pair" ? 2 : 1);

/** Each card's chapters on a frame, by setup. */
export const frameChapters = (opts: {
  kind: Exclude<FrameKind, "screen">;
  bank: boolean;
  pos: number;
  count: number;
  set: WallSet;
}): ChapterId[][] => {
  const { kind } = opts;
  if (kind === "wall") return WALL_SETS[opts.set].map((id) => [id]);
  if (opts.bank) {
    const pos = Math.max(0, opts.pos);
    const count = Math.max(opts.count, pos + 1);
    const all = shares(slotsIn(kind, count));
    return Array.from({ length: cardsPer(kind) }, (_, c) => all[slotOf(kind, pos, c)] ?? []);
  }
  if (kind === "pair") return shares(2);
  return [[...CHAPTER_IDS]];
};
