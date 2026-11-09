/**
 * Which question is up, from the shared clock alone, so every frame of a bank changes together
 * without messages: the period index is `floor(clock / rotate)` and the question is that index
 * within the chosen set. Admin's "next" adds a skip that lasts until the period ends.
 *
 * The two-question variant has two slots: 0 is the picture question for children (low buttons)
 * and 1 the question for adults (high buttons). They never show the same question at once.
 */
import { type Config, REVEAL_MS } from "./config";
import {
  type Question,
  questionById,
  QUESTIONS,
  questionsInSet,
  suitsAdults,
  suitsChildren,
} from "./questions";

export interface Skip {
  /** The period the skips apply to. */
  k: number;
  n: number;
}

export interface Slot {
  /** Period index. */
  k: number;
  /** Clock ms the period started and ends. */
  start: number;
  end: number;
  /** Within the reveal before a change. False for a fixed question. */
  reveal: boolean;
  /** Whether this slot can reveal at `end`: false while a question is fixed. */
  revealable: boolean;
  /** One question, or the children's and the adults' question. */
  questions: Question[];
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** The question a config keeps showing, if any. An incomplete custom question isn't one. */
const fixedOf = (cfg: Config): Question | undefined =>
  cfg.question === "custom"
    ? (cfg.custom ?? undefined)
    : cfg.question === "rotate"
      ? undefined
      : questionById(cfg.question);

const listFor = (cfg: Config, keep: (q: Question) => boolean): Question[] => {
  const inSet = questionsInSet(cfg.set).filter(keep);
  return inSet.length > 0 ? inSet : QUESTIONS.filter(keep);
};

export const skipsFor = (k: number, skip: Skip | null): number =>
  skip && skip.k === k ? Math.max(0, skip.n) : 0;

export const slotAt = (clock: number, cfg: Config, skip: Skip | null = null): Slot => {
  const period = cfg.rotateMs;
  const k = Math.floor(clock / period);
  const start = k * period;
  const end = start + period;
  const n = skipsFor(k, skip);
  const fixed = fixedOf(cfg);
  const reveal = !fixed && end - clock <= REVEAL_MS;
  const revealable = !fixed;
  const at = k + n;

  if (cfg.variant === "one") {
    if (fixed) return { k, start, end, reveal: false, revealable, questions: [fixed] };
    const list = listFor(cfg, () => true);
    return { k, start, end, reveal, revealable, questions: [list[mod(at, list.length)]!] };
  }

  const kids = listFor(cfg, suitsChildren);
  const grown = listFor(cfg, suitsAdults);
  let child: Question;
  let adult: Question;
  if (fixed && suitsChildren(fixed)) {
    child = fixed;
    adult = pickOther(grown, at + 1, child);
  } else if (fixed) {
    adult = fixed;
    child = pickOther(kids, at, adult);
  } else {
    child = kids[mod(at, kids.length)]!;
    adult = pickOther(grown, at + 1, child);
  }
  return { k, start, end, reveal: reveal && !fixed, revealable, questions: [child, adult] };
};

/** The question at `i` in `list`, or the next one along that isn't `not`. */
const pickOther = (list: Question[], i: number, not: Question): Question => {
  for (let step = 0; step < list.length; step++) {
    const q = list[mod(i + step, list.length)]!;
    if (q.id !== not.id) return q;
  }
  // Only possible with a one-question list that matches; show it anyway.
  return list[mod(i, list.length)]!;
};

/** Every question a config can show, for preloading yesterday's totals. */
export const questionsFor = (cfg: Config): Question[] => {
  const fixed = fixedOf(cfg);
  if (cfg.variant === "one") return fixed ? [fixed] : listFor(cfg, () => true);
  const all = new Map<string, Question>();
  for (const q of [...listFor(cfg, suitsChildren), ...listFor(cfg, suitsAdults)]) all.set(q.id, q);
  if (fixed) all.set(fixed.id, fixed);
  return [...all.values()];
};
