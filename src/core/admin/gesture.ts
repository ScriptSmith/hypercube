/**
 * The unlock gesture: five taps in the bottom-left corner within TAP_WINDOW_MS, then a sixth
 * touch there, starting within NEXT_GAP_MS of the fifth tap, held for HOLD_MS. Taps elsewhere
 * are ignored rather than counted against it, because other people may be playing on the
 * same frame. Pure, so it can be driven by real pointer events or by tests.
 */
export const CORNER_VENUE_PX = 220;
export const TAPS = 5;
export const TAP_WINDOW_MS = 3000;
export const HOLD_MS = 2000;
/** Longest press that still counts as a tap. */
export const MAX_TAP_MS = 600;
/** Longest pause between the fifth tap and the start of the hold. */
export const NEXT_GAP_MS = 1000;

export interface UnlockGesture {
  /** A touch started; `inCorner` says whether it is inside the corner square. */
  down(id: number, t: number, inCorner: boolean): void;
  /** A touch ended normally. */
  up(id: number, t: number): void;
  /** A touch was cancelled or slid out of the corner. */
  cancel(id: number): void;
  /** When the current hold will be long enough, or null when nothing is being held. */
  deadline(): number | null;
  /** True once the hold has lasted HOLD_MS at time `t`; the gesture then starts over. */
  check(t: number): boolean;
  reset(): void;
}

export const inCorner = (
  x: number,
  y: number,
  frame: { height: number; unit: number },
): boolean => {
  const size = CORNER_VENUE_PX * frame.unit;
  return x >= 0 && x <= size && y <= frame.height && y >= frame.height - size;
};

export const createUnlockGesture = (): UnlockGesture => {
  /** Corner touches now down, by pointer id, with their start times. */
  const down = new Map<number, number>();
  /** Completed corner taps, oldest first: start and end times. */
  let taps: { start: number; end: number }[] = [];
  let hold: { id: number; since: number } | null = null;

  const reset = () => {
    down.clear();
    taps = [];
    hold = null;
  };

  const readyToHold = (t: number): boolean => {
    if (taps.length < TAPS) return false;
    const first = taps[taps.length - TAPS];
    const last = taps[taps.length - 1];
    if (!first || !last) return false;
    return last.end - first.start <= TAP_WINDOW_MS && t - last.end <= NEXT_GAP_MS;
  };

  return {
    down(id, t, corner) {
      if (!corner) return;
      // A lift the page never saw must not leave its touch here for days.
      for (const [other, start] of down) if (t - start > TAP_WINDOW_MS) down.delete(other);
      if (hold) {
        // A second finger in the corner while holding spoils it.
        reset();
        return;
      }
      if (readyToHold(t)) {
        hold = { id, since: t };
        return;
      }
      down.set(id, t);
    },
    up(id, t) {
      if (hold?.id === id) {
        reset();
        return;
      }
      const start = down.get(id);
      if (start === undefined) return;
      down.delete(id);
      if (t - start > MAX_TAP_MS) {
        taps = [];
        return;
      }
      taps.push({ start, end: t });
      // Keep only taps that could still be part of a run of five.
      taps = taps.filter((tap) => t - tap.start <= TAP_WINDOW_MS).slice(-TAPS);
    },
    cancel(id) {
      if (hold?.id === id) reset();
      down.delete(id);
    },
    deadline: () => (hold ? hold.since + HOLD_MS : null),
    check(t) {
      if (!hold || t - hold.since < HOLD_MS) return false;
      reset();
      return true;
    },
    reset,
  };
};
