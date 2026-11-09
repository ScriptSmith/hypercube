import type { ElementId } from "./elements";
import type { Choice, PlaceKind } from "./swatches";

/**
 * Hand memory. Pointer ids die when a finger lifts, so "the last element this finger touched"
 * is remembered by place: a finger landing in the world binds to the nearest memory on its side
 * of the world (or starts one), and the memory follows it as it pours, so neighbours keep
 * pouring different things.
 *
 * A swatch tap is a pick for its side of the world. The next touch on that side takes it: an
 * element relabels that touch's memory, a piece or tool gets placed where the touch lifts. A
 * memory outlives a new pick only if it has been used since (someone is still pouring there);
 * otherwise a touch there takes the side's current pick. So one person who taps Remove and then
 * touches three things removes all three, while a neighbour who keeps pouring keeps their sand. (An
 * earlier version stored the pick in a memory at the swatch, and the next touch bound to the
 * nearer memory it had been pouring from, so a tap seemed to do nothing.)
 *
 * Each memory also holds the pour budget, so lifting and touching again doesn't reset it, and
 * five fingers of one hand share one budget.
 */
export interface HandOptions {
  /** A finger binds to a memory within this distance (venue px). */
  radius: number;
  /** Memories unused for this long are forgotten. */
  ttlMs: number;
  /** At most this many memories; the least recently used goes first. */
  max: number;
  /** An element pick waits this long for a touch. */
  pickMs: number;
  /** A piece or tool pick waits this long for the touch that places it. */
  placeMs: number;
  /** Seconds of full-rate pouring a fresh hand has in hand. */
  burst: number;
  /** Budget regained per second, so also the sustained fraction of full rate per hand. */
  refill: number;
  /** What a finger pours when nothing has been picked on its side. */
  fallback: ElementId;
  /** Side of the world for a position: normally the palette nearest to it. */
  side(x: number, y: number): number;
}

export interface Hand {
  readonly id: number;
  x: number;
  y: number;
  side: number;
  element: ElementId;
  usedAt: number;
  /** Seconds of full-rate pouring left. */
  budget: number;
  budgetAt: number;
}

export interface Binding {
  hand: Hand;
  /** A piece or tool picked on this side, to be placed where this touch lifts. */
  place: PlaceKind | null;
}

export interface Hands {
  readonly list: readonly Hand[];
  /** A swatch was touched on `side`: the next touch on that side takes the choice. */
  pick(side: number, choice: Choice, now: number): void;
  /** The pick still waiting on `side`, if any. */
  pending(side: number, now: number): Choice | null;
  /** The element this side last picked (what the palette shows as selected). */
  current(side: number): ElementId;
  /** A finger landed in the world at (x, y): its memory, and any pick it takes. */
  bind(x: number, y: number, now: number): Binding;
  /** The hand was used at (x, y): its memory moves there. */
  follow(hand: Hand, x: number, y: number, now: number): void;
  /**
   * Spend `dt` seconds of pouring from the hand's budget. Returns the fraction of full rate
   * allowed. With k fingers on one hand the budget settles where they share `refill` between
   * them, so the hand's sustained output is the same however many fingers it uses.
   */
  spend(hand: Hand, dt: number, now: number): number;
  clear(): void;
}

/** Most sides a frame has (palettes on a wall or pair). */
const MAX_SIDES = 4;

export const createHands = (opts: HandOptions): Hands => {
  let list: Hand[] = [];
  let nextId = 1;
  const picks: ({ choice: Choice; until: number } | null)[] = Array.from(
    { length: MAX_SIDES },
    () => null,
  );
  const currents: ElementId[] = Array.from({ length: MAX_SIDES }, () => opts.fallback);
  const pickedAt: number[] = Array.from({ length: MAX_SIDES }, () => -Infinity);
  const sideOf = (x: number, y: number) => Math.min(MAX_SIDES - 1, Math.max(0, opts.side(x, y)));

  const refill = (h: Hand, now: number) => {
    const dt = Math.max(0, (now - h.budgetAt) / 1000);
    h.budget = Math.min(opts.burst, h.budget + dt * opts.refill);
    h.budgetAt = now;
  };

  const prune = (now: number) => {
    list = list.filter((h) => now - h.usedAt < opts.ttlMs);
  };

  const add = (x: number, y: number, side: number, element: ElementId, now: number): Hand => {
    const h: Hand = {
      id: nextId++,
      x,
      y,
      side,
      element,
      usedAt: now,
      budget: opts.burst,
      budgetAt: now,
    };
    list.push(h);
    while (list.length > opts.max) {
      let oldest = 0;
      for (let i = 1; i < list.length; i++) {
        if ((list[i]?.usedAt ?? 0) < (list[oldest]?.usedAt ?? 0)) oldest = i;
      }
      list.splice(oldest, 1);
    }
    return h;
  };

  const nearest = (x: number, y: number, side: number, fresh: boolean): Hand | null => {
    let best: Hand | null = null;
    let bestD = opts.radius;
    for (const h of list) {
      if (h.side !== side || (fresh && h.usedAt < (pickedAt[side] ?? -Infinity))) continue;
      const d = Math.hypot(h.x - x, h.y - y);
      if (d <= bestD) {
        best = h;
        bestD = d;
      }
    }
    return best;
  };

  const pending = (side: number, now: number): Choice | null => {
    const p = picks[side];
    if (!p) return null;
    if (p.until <= now) {
      picks[side] = null;
      return null;
    }
    return p.choice;
  };

  return {
    get list() {
      return list;
    },

    pick(side, choice, now) {
      const s = Math.min(MAX_SIDES - 1, Math.max(0, side));
      picks[s] = { choice, until: now + (choice.type === "element" ? opts.pickMs : opts.placeMs) };
      if (choice.type === "element") {
        currents[s] = choice.element;
        pickedAt[s] = now;
      }
    },

    pending: (side, now) => pending(Math.min(MAX_SIDES - 1, Math.max(0, side)), now),

    current: (side) => currents[Math.min(MAX_SIDES - 1, Math.max(0, side))] ?? opts.fallback,

    bind(x, y, now) {
      prune(now);
      const side = sideOf(x, y);
      const current = currents[side] ?? opts.fallback;
      // A spot used since the last pick keeps its element. A quiet one takes the current pick but
      // keeps its pour budget, so tapping a swatch never refills it.
      let hand = nearest(x, y, side, true);
      if (!hand) {
        hand = nearest(x, y, side, false);
        if (hand) hand.element = current;
      }
      hand ??= add(x, y, side, current, now);
      hand.usedAt = now;
      const choice = pending(side, now);
      picks[side] = null;
      if (choice?.type === "element") hand.element = choice.element;
      return { hand, place: choice?.type === "place" ? choice.place : null };
    },

    follow(hand, x, y, now) {
      hand.x = x;
      hand.y = y;
      hand.usedAt = now;
    },

    spend(hand, dt, now) {
      refill(hand, now);
      const fraction = Math.min(1, Math.max(0, hand.budget));
      hand.budget = Math.max(0, hand.budget - fraction * dt);
      return fraction;
    },

    clear() {
      list = [];
      picks.fill(null);
      pickedAt.fill(-Infinity);
      currents.fill(opts.fallback);
    },
  };
};

/** Base pour rate per finger in venue px² per second; elements scale it by `pour.rate`. */
export const BASE_POUR_AREA = 13_000;

/**
 * Chance per tick that an empty cell under a pouring finger fills, given the stroke it
 * covers this tick (in cells) and the cells it should add this tick.
 */
export const fillChance = (cellsWanted: number, strokeArea: number): number =>
  strokeArea <= 0 ? 0 : Math.min(1, Math.max(0, cellsWanted / strokeArea));

/** Area in cells of a capsule (a disc swept along a segment). */
export const capsuleArea = (length: number, radius: number): number =>
  Math.PI * radius * radius + 2 * radius * length;
