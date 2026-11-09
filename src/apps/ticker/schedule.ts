/**
 * Which line a ring shows next. Operator messages, when admin has set any, take every other
 * line; curated lines come from shuffled decks so nothing repeats until its whole deck has been
 * used; the time and the date take a turn every few minutes.
 */
import type { Rng } from "../../core/types";
import { dateLine, FACTS, GREETINGS, timeLine } from "./messages";
import type { RingRole } from "./rings";

export type ListMode = "general" | "welcome" | "operator";
export type LineKind = "operator" | "greet" | "fact" | "ball" | "time" | "date";

export interface Line {
  kind: LineKind;
  text: string;
  /** Counts up line by line, for picking colours. */
  n: number;
}

/**
 * A deck that deals every item once in a random order, then reshuffles. A reshuffled deck keeps
 * the half dealt last off its first half, so an item never comes back within half a deck.
 */
export interface Bag {
  next(): string | null;
  readonly size: number;
}

export const createBag = (items: readonly string[], rng: Rng): Bag => {
  let deck: string[] = [];
  let at = 0;
  const recent: string[] = [];
  const gap = Math.floor(items.length / 2);
  return {
    get size() {
      return items.length;
    },
    next() {
      if (items.length === 0) return null;
      if (at >= deck.length) {
        const order = [...items];
        for (let i = order.length - 1; i > 0; i--) {
          const j = rng.int(i + 1);
          [order[i], order[j]] = [order[j]!, order[i]!];
        }
        const fresh = order.filter((x) => !recent.includes(x));
        const head = fresh.slice(0, gap);
        deck = [...head, ...order.filter((x) => !head.includes(x))];
        at = 0;
      }
      const item = deck[at++]!;
      recent.push(item);
      if (recent.length > gap) recent.shift();
      return item;
    },
  };
};

type Curated = "greet" | "fact" | "ball";

/** Curated lines, in turn, for each list and ring. */
const PATTERNS: Record<ListMode, Record<RingRole, readonly Curated[]>> = {
  general: {
    main: ["greet", "fact", "fact", "ball", "greet", "fact", "fact"],
    lower: ["greet", "fact", "ball", "fact", "greet", "fact"],
    pole: ["greet"],
  },
  welcome: { main: ["greet"], lower: ["greet"], pole: ["greet"] },
  operator: { main: [], lower: [], pole: [] },
};

/** Seconds between turns for the time or the date, per ring. */
export const TIME_EVERY_S: Record<RingRole, number> = { main: 150, lower: 200, pole: 120 };

export interface ScheduleOptions {
  list: ListMode;
  role: RingRole;
  /** The operator's messages, already cleaned; empty ones are left out. */
  operator: readonly string[];
  ballFacts: readonly string[];
}

export interface Schedule {
  /** The next line, `atS` seconds into the show, the clock reading `nowMs`. */
  next(atS: number, nowMs: number): Line;
  /** The ball's facts changed (a resize). */
  setBallFacts(facts: readonly string[]): void;
}

export const createSchedule = (opts: ScheduleOptions, rng: Rng): Schedule => {
  const operator = opts.operator.filter((m) => m.length > 0);
  const pattern = PATTERNS[opts.list][opts.role];
  const timeEvery = TIME_EVERY_S[opts.role];
  const timeOn = opts.list !== "welcome";
  const bags: Record<Curated, Bag> = {
    greet: createBag(GREETINGS, rng.fork("greet")),
    fact: createBag(FACTS, rng.fork("fact")),
    ball: createBag(opts.ballFacts, rng.fork("ball")),
  };
  let step = pattern.length > 0 ? rng.int(pattern.length) : 0;
  let op = 0;
  let n = 0;
  let operatorNext = operator.length > 0 && rng.next() < 0.5;
  // The first time comes a little way in, at a different moment on each ring.
  let lastTime = -timeEvery * rng.range(0.4, 0.8);
  let clockTurns = 0;

  const make = (kind: LineKind, text: string): Line => ({ kind, text, n: n++ });

  /** The time, then the date next turn. */
  const clockLine = (atS: number, nowMs: number): Line => {
    lastTime = atS;
    return clockTurns++ % 2 === 0 ? make("time", timeLine(nowMs)) : make("date", dateLine(nowMs));
  };

  const curated = (): Line | null => {
    for (let tries = 0; tries < pattern.length; tries++) {
      const kind = pattern[step % pattern.length]!;
      step++;
      const text = bags[kind].next();
      if (text) return make(kind, text);
    }
    return null;
  };

  return {
    next(atS, nowMs) {
      if (timeOn && atS - lastTime >= timeEvery) return clockLine(atS, nowMs);
      const own = (): Line => {
        const text = operator[op % operator.length]!;
        op++;
        return make("operator", text);
      };
      if (operator.length > 0 && (operatorNext || pattern.length === 0)) {
        operatorNext = false;
        return own();
      }
      operatorNext = true;
      const line = curated();
      if (line) return line;
      if (operator.length > 0) return own();
      // Nothing else to say: the time and the date take turns.
      return clockLine(atS, nowMs);
    },
    setBallFacts(facts) {
      bags.ball = createBag(facts, rng.fork(`ball:${facts.join("|")}`));
    },
  };
};
