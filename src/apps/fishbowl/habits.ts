/**
 * When the fish do their funny things, and on which side of the bowl. Something is nearly
 * always happening somewhere, the three sides take turns, and no habit comes round again too
 * soon. Feeding time comes every few minutes and waits for the bowl to be quiet.
 */
import type { Rng } from "../../core/types";
import { SIDES } from "./bowl";

export type HabitKind = "kiss" | "puff" | "chase" | "loop" | "dart" | "nap" | "feed";

export const HABITS: readonly HabitKind[] = [
  "kiss",
  "puff",
  "chase",
  "loop",
  "dart",
  "nap",
  "feed",
];

export interface Rule {
  weight: number;
  /** Seconds before the same habit may start again. */
  cooldown: number;
}

const RULES: Record<Exclude<HabitKind, "feed">, Rule> = {
  kiss: { weight: 3, cooldown: 25 },
  puff: { weight: 2, cooldown: 45 },
  chase: { weight: 2, cooldown: 35 },
  loop: { weight: 1.6, cooldown: 30 },
  dart: { weight: 1.4, cooldown: 25 },
  nap: { weight: 1.2, cooldown: 150 },
};

/** At most this many habits at once, besides feeding. */
export const MAX_ACTIVE = 2;
/** Seconds between one habit starting and the next, at least and at most. */
export const GAP: readonly [number, number] = [4, 9];
/** Feeding time comes round this often, seconds. */
export const FEED_EVERY: readonly [number, number] = [190, 290];
/** The first feed of a run comes sooner. */
const FIRST_FEED: readonly [number, number] = [70, 130];
/** Feeding waits this long at most for the habits under way to finish. */
export const FEED_WAIT = 25;

export interface SchedulerEnv<K extends string = Exclude<HabitKind, "feed">> {
  /** Habits under way, feeding aside. */
  active: number;
  feeding: boolean;
  /**
   * Whether `kind` can start now, and where: a side when its actors fix where it happens, null
   * when it can happen on any side, or false when it can't start (its actors are busy).
   */
  where(kind: K): number | null | false;
}

export interface Plan<K extends string = Exclude<HabitKind, "feed">> {
  kind: K | "feed";
  side: number;
}

export interface Scheduler<K extends string = Exclude<HabitKind, "feed">> {
  /** What to start at time `t`, if anything. Call `started` once it has. */
  next(t: number, env: SchedulerEnv<K>): Plan<K> | null;
  started(plan: Plan<K>, t: number): void;
  /** The plan couldn't start after all; try again shortly. */
  skipped(t: number): void;
  /** When feeding is next due, or Infinity with feeding off. */
  readonly feedAt: number;
  /** Seconds each side last had a habit start, for tests. */
  readonly served: readonly number[];
}

export interface SchedulerOptions<K extends string> {
  feeding: boolean;
  /** Habits other than feeding, how often each comes, and how soon it may come again. */
  rules?: Record<K, Rule>;
  /** Seconds between habits starting, at least and at most. */
  gap?: readonly [number, number];
  /** At most this many habits at once, besides feeding. */
  maxActive?: number;
  /** How often feeding time comes round, and the first time in a run. */
  feedEvery?: readonly [number, number];
  firstFeed?: readonly [number, number];
}

export const createScheduler = <K extends string = Exclude<HabitKind, "feed">>(
  rng: Rng,
  opts: SchedulerOptions<K>,
): Scheduler<K> => {
  const rules = (opts.rules ?? RULES) as Record<K, Rule>;
  const gap = opts.gap ?? GAP;
  const maxActive = opts.maxActive ?? MAX_ACTIVE;
  const feedEvery = opts.feedEvery ?? FEED_EVERY;
  const first = opts.firstFeed ?? FIRST_FEED;
  let nextAt = rng.range(3, 6);
  let feedAt = opts.feeding ? rng.range(first[0], first[1]) : Infinity;
  const last: Partial<Record<K | "feed", number>> = {};
  // Start with the sides a little apart so the first habits go round.
  const served = Array.from({ length: SIDES }, (_, i) => -i - rng.next());

  const stalest = (): number => {
    let best = 0;
    for (let i = 1; i < SIDES; i++) if (served[i]! < served[best]!) best = i;
    return best;
  };

  return {
    get feedAt() {
      return feedAt;
    },
    served,
    next(t, env) {
      if (env.feeding) return null;
      if (t >= feedAt && (env.active === 0 || t >= feedAt + FEED_WAIT)) {
        return { kind: "feed", side: stalest() };
      }
      // While feeding is due, let the bowl go quiet.
      if (t >= feedAt) return null;
      if (t < nextAt || env.active >= maxActive) return null;
      const oldest = Math.min(...served);
      const options: { kind: K; side: number; w: number }[] = [];
      for (const kind of Object.keys(rules) as K[]) {
        const rule = rules[kind];
        const prev = last[kind];
        if (prev !== undefined && t - prev < rule.cooldown) continue;
        const at = env.where(kind);
        if (at === false) continue;
        const side = at ?? stalest();
        // Favour habits that would happen on a side that has waited longest.
        const wait = t - served[side]!;
        const span = Math.max(1, t - oldest);
        options.push({ kind, side, w: rule.weight * (0.25 + (wait / span) ** 2) });
      }
      if (options.length === 0) {
        nextAt = t + 1;
        return null;
      }
      let pick = rng.next() * options.reduce((s, o) => s + o.w, 0);
      for (const o of options) {
        pick -= o.w;
        if (pick <= 0) return { kind: o.kind, side: o.side };
      }
      const o = options[options.length - 1]!;
      return { kind: o.kind, side: o.side };
    },
    started(plan, t) {
      last[plan.kind] = t;
      served[plan.side] = t;
      if (plan.kind === "feed") {
        feedAt = opts.feeding ? t + rng.range(feedEvery[0], feedEvery[1]) : Infinity;
      }
      nextAt = t + rng.range(gap[0], gap[1]);
    },
    skipped(t) {
      nextAt = t + 1;
    },
  };
};
