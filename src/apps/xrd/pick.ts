/**
 * Which chapter the screen's big picture follows, from what it hears of its bank. Pure.
 */
import type { Heard } from "./link";

/** A person's touch keeps the big picture on its chapter this long after release. */
export const HOLD_MS = 15_000;
/** Once the big picture picks a chapter it keeps it at least this long, ms. */
export const MIN_SHOW_MS = 8000;
/** A slot touched within this long, or held, is being touched now, ms. */
export const BUSY_MS = 2500;

export interface Picker {
  /** Which heard slot the big picture follows now, or null for the screen's own run. */
  pick(heard: ReadonlyMap<number, Heard>, t: number): Heard | null;
}

/**
 * The big picture's choice of slot: people beat bots, then the slot touched longest without a
 * break, then the latest touch; a pick stays at least MIN_SHOW_MS, so several visitors (or bots)
 * on a bank don't flick it from chapter to chapter, unless a person takes over from a bot.
 */
export const createPicker = (): Picker => {
  /** When each slot's current run of touching began. */
  const runs = new Map<number, number>();
  let chosen: { slot: number; at: number; person: boolean } | null = null;
  const eligible = (h: Heard, t: number) =>
    Number.isFinite(h.touchedAt) && t - h.touchedAt <= HOLD_MS * 2;
  const busy = (h: Heard, t: number) => h.card.d === 1 || t - h.touchedAt <= BUSY_MS;
  const person = (h: Heard, t: number) => h.card.h === 1 && t - h.touchedAt < HOLD_MS;
  return {
    pick(heard, t) {
      for (const slot of runs.keys()) {
        const h = heard.get(slot);
        if (!h || !busy(h, t)) runs.delete(slot);
      }
      for (const h of heard.values()) if (busy(h, t) && !runs.has(h.card.s)) runs.set(h.card.s, t);
      const score = (h: Heard) => {
        const run = runs.get(h.card.s);
        return (
          (person(h, t) ? 4e15 : 0) +
          (run !== undefined ? 2e15 + (t - run) * 1000 : 0) +
          h.touchedAt
        );
      };
      let best: Heard | null = null;
      for (const h of heard.values()) {
        if (!eligible(h, t)) continue;
        if (!best || score(h) > score(best)) best = h;
      }
      const cur = chosen ? heard.get(chosen.slot) : undefined;
      if (chosen && cur && eligible(cur, t) && t - chosen.at < MIN_SHOW_MS) {
        const takeover = best && best !== cur && person(best, t) && !chosen.person;
        if (!takeover) return cur;
      }
      if (!best) {
        chosen = null;
        return null;
      }
      if (!chosen || chosen.slot !== best.card.s)
        chosen = { slot: best.card.s, at: t, person: person(best, t) };
      else chosen.person = person(best, t);
      return best;
    },
  };
};
