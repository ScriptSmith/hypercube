/**
 * The pace of the plant: it rises with a streak of right sorts and falls back after a miss,
 * always between 0 (calm) and 1 (busy). It eases towards its target so belts never lurch.
 */

/** Right sorts in a row for full pace. */
export const STREAK_FULL = 24;
/** Pace units per second it moves towards its target. */
const EASE = 0.12;

export interface Pace {
  readonly value: number;
  readonly streak: number;
  right(): void;
  wrong(): void;
  step(dt: number): void;
  /** Follow someone else's pace (a bank's screen). */
  follow(value: number): void;
  reset(): void;
}

export const createPace = (): Pace => {
  let value = 0;
  let streak = 0;
  let followed: number | null = null;
  const target = () => followed ?? Math.min(1, streak / STREAK_FULL);
  return {
    get value() {
      return value;
    },
    get streak() {
      return streak;
    },
    right() {
      streak = Math.min(STREAK_FULL * 2, streak + 1);
    },
    wrong() {
      streak = Math.max(0, Math.floor(streak / 2) - 2);
    },
    step(dt) {
      const t = target();
      const k = EASE * Math.max(0, dt);
      value = value < t ? Math.min(t, value + k) : Math.max(t, value - k);
    },
    follow(v) {
      followed = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
    },
    reset() {
      streak = 0;
      followed = null;
    },
  };
};
