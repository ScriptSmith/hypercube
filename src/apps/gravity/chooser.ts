/**
 * Shot choosing spread over frames: one candidate per `work()` call, so a bot or the ghost
 * thinking about its next shot never holds a frame up for long. Candidates are scored by the
 * caller (with the predictor), and a little aiming error is added at the end, as a person has.
 */
import type { Rng } from "../../core/types";
import type { Shot } from "./aim";

export interface Chooser {
  /** Evaluate one more candidate; returns the chosen shot once done, else null. */
  work(): Shot | null;
  readonly done: boolean;
}

export const createChooser = (opts: {
  spread: number;
  rng: Rng;
  /** Higher is better; null when the shot can't be judged now (it is then skipped). */
  score(s: Shot): number | null;
  tries?: number;
  refine?: number;
  /** Aim error added to the chosen shot, radians and pull share. */
  error?: { angle: number; pull: number };
}): Chooser => {
  const tries = opts.tries ?? 7;
  const refine = opts.refine ?? 4;
  const { spread, rng } = opts;
  let i = 0;
  let best: Shot = { pull: 0.55, angle: (rng.next() - 0.5) * spread };
  let bestScore = -Infinity;
  let result: Shot | null = null;
  return {
    get done() {
      return result !== null;
    },
    work() {
      if (result) return result;
      if (i >= tries + refine) {
        const e = opts.error ?? { angle: 0, pull: 0 };
        result = {
          pull: Math.min(1, Math.max(0.1, best.pull + (rng.next() - 0.5) * 2 * e.pull)),
          angle: Math.max(-spread, Math.min(spread, best.angle + (rng.next() - 0.5) * 2 * e.angle)),
        };
        return result;
      }
      const s: Shot =
        i < tries
          ? { pull: 0.15 + rng.next() * 0.8, angle: (rng.next() * 2 - 1) * spread * 0.95 }
          : {
              pull: Math.min(1, Math.max(0.1, best.pull + (rng.next() - 0.5) * 0.16)),
              angle: Math.max(-spread, Math.min(spread, best.angle + (rng.next() - 0.5) * 0.14)),
            };
      i++;
      const score = opts.score(s);
      if (score !== null && score > bestScore) {
        bestScore = score;
        best = s;
      }
      return null;
    },
  };
};
