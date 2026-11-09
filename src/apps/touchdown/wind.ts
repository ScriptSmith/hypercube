/** Seeded wind: a steady breeze plus slow gusts, as a function of run time. Pure. */
import type { Rng } from "../../core/types";
import type { WindKind } from "./config";

export type WindFn = (t: number) => number;

export const CALM: WindFn = () => 0;

/** Horizontal wind speed in venue px per second at run time `t`; `q` is the speed scale. */
export const windFor = (kind: WindKind, rng: Rng, q: number): WindFn => {
  if (kind === "calm") return CALM;
  const sign = rng.next() < 0.5 ? -1 : 1;
  const p1 = rng.range(0, Math.PI * 2);
  const p2 = rng.range(0, Math.PI * 2);
  const p3 = rng.range(0, Math.PI * 2);
  if (kind === "breezy") {
    const base = sign * rng.range(7, 12) * q;
    const gust = 4 * q;
    return (t) => base + gust * (0.6 * Math.sin(0.31 * t + p1) + 0.4 * Math.sin(0.83 * t + p2));
  }
  const base = sign * rng.range(10, 15) * q;
  const gust = 12 * q;
  return (t) =>
    base +
    gust *
      (0.5 * Math.sin(0.23 * t + p1) +
        0.3 * Math.sin(0.61 * t + p2) +
        0.2 * Math.sin(1.37 * t + p3));
};
