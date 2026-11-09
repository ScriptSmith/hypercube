import type { OptionValues } from "../../core/types";
import { customFromOptions, customQuestion } from "./custom";
import { type Question, questionById, type SetId, SETS } from "./questions";

export type Variant = "one" | "two";

export interface Config {
  variant: Variant;
  set: SetId;
  /** "rotate", "custom", or the id of a curated question to keep showing. */
  question: string;
  /** The operator's own question when `question` is "custom" and it is complete. */
  custom: Question | null;
  /** Why the custom question can't be shown, when it can't. */
  customWhy: string | null;
  /** Milliseconds each question stays up. */
  rotateMs: number;
  yesterday: boolean;
}

export const readConfig = (variant: string, o: OptionValues): Config => {
  const rotate = typeof o.rotate === "number" && Number.isFinite(o.rotate) ? o.rotate : 5;
  const set = SETS.find((s) => s.id === o.set)?.id ?? "everyday";
  const question =
    o.question === "custom" || (typeof o.question === "string" && questionById(o.question))
      ? (o.question as string)
      : "rotate";
  const own = question === "custom" ? customFromOptions(o) : null;
  return {
    variant: variant === "two" ? "two" : "one",
    set,
    question,
    custom: own?.def ? customQuestion(own.def) : null,
    customWhy: own?.why ?? null,
    rotateMs: Math.round(Math.min(30, Math.max(2, rotate))) * 60_000,
    yesterday: o.yesterday !== false,
  };
};

/** The last seconds of a question: the tubes glow and the leader bounces. */
export const REVEAL_MS = 6000;
/** Balls drain out of the old question's tubes. */
export const DRAIN_MS = 1100;
/** The packed part of a column fills in this long when a question starts. */
export const POUR_MS = 1300;

/** Rate limits per button, without knowing who is who. */
export const LIMIT = {
  /** A button refuses every touch for this long after it takes a ball. */
  buttonMs: 1000,
} as const;

/** Live physics bodies per frame. */
export const MAX_LIVE = 400;
/** Votes kept while the room is unreachable. */
export const MAX_QUEUE = 200;
/** A bank frame that hasn't heard its screen for this long draws its own tubes. */
export const SCREEN_GRACE_MS = 3000;
/** Screens announce themselves this often. */
export const BEACON_MS = 1000;
/** Totals go out on change at most this often, and at least every TOTALS_EVERY_MS. */
export const TOTALS_MIN_MS = 500;
export const TOTALS_EVERY_MS = 5000;
/** Days of totals kept in storage, today included. */
export const KEEP_DAYS = 7;
/** Bots step back for this long after a person touches the frame. */
export const BOT_YIELD_MS = 15_000;
