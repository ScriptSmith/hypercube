/**
 * The world's long-running rhythm. A drain opens the floor, crumbles pieces and plants into
 * grains and lets everything run out; when it ends the land grows back. The idle reset drains over
 * about 20 s, the hold-to-reset faster. While nobody plays, a fresh drain runs every few minutes
 * so the attract loop never goes stale. In play, the floor lets a little through once the world
 * gets full, so a crowd can't fill the wall.
 */
export type DrainCause = "idle" | "manual" | "cycle";

export interface DrainLevels {
  sink: number;
  crumble: number;
  fade: number;
}

export interface Director {
  readonly draining: boolean;
  readonly cause: DrainCause | null;
  /** 0 to 1.2: the world shows below this height while the land rises back. */
  readonly reveal: number;
  readonly fullness: number;
  startDrain(cause: DrainCause): void;
  /** A person touched during an idle or cycle drain: stop and keep what's left. */
  interrupt(): void;
  setFullness(f: number): void;
  /** Mark the start of an attract period (no drains until it has lasted a while). */
  setAttract(on: boolean, now: number): void;
  /**
   * Advance. Calls `onDrained` once when a drain completes (regrow the world there) and
   * `onCycle` when an attract cycle wants a drain.
   */
  update(dt: number, now: number): void;
  levels(out: DrainLevels): void;
  /** Begin the rising reveal (after a regrow or at start-up). */
  reveal0(): void;
}

export const DRAIN_SECONDS: Record<DrainCause, number> = { idle: 20, manual: 7, cycle: 20 };
/** Attract runs this long between drain cycles. */
export const CYCLE_SECONDS = 6 * 60;
const REVEAL_SECONDS = 2.5;
/** Fullness at which the floor starts to let material through, and where it peaks. */
const SINK_START = 0.3;
const SINK_FULL = 0.55;
const SINK_MAX = 0.18;

export const sinkFor = (fullness: number): number =>
  Math.min(1, Math.max(0, (fullness - SINK_START) / (SINK_FULL - SINK_START))) * SINK_MAX;

/**
 * Drain levels at progress t (0 to 1) of a drain lasting `seconds`. Crumbling runs early, at a
 * rate that crumbles about nine cells in ten whatever the length; the fade at the end clears
 * whatever is left.
 */
export const drainLevels = (t: number, seconds: number, out: DrainLevels): void => {
  out.sink = t < 1 ? Math.min(1, t * 10) * 0.9 : 0;
  out.crumble = t > 0.05 && t < 0.55 ? 0.08 / seconds : 0;
  out.fade = t > 0.7 ? Math.min(1, (t - 0.7) / 0.3) * 0.08 : 0;
};

export const createDirector = (hooks: { onDrained(): void; onCycle(): void }): Director => {
  let cause: DrainCause | null = null;
  let elapsed = 0;
  let reveal = 1.2;
  let fullness = 0;
  let attractSince: number | null = null;

  return {
    get draining() {
      return cause !== null;
    },
    get cause() {
      return cause;
    },
    get reveal() {
      return reveal;
    },
    get fullness() {
      return fullness;
    },

    startDrain(next) {
      // A manual reset during an idle drain restarts it at the manual pace.
      if (cause === next) return;
      cause = next;
      elapsed = 0;
    },

    interrupt() {
      if (cause === "idle" || cause === "cycle") cause = null;
    },

    setFullness(f) {
      fullness = f;
    },

    setAttract(on, now) {
      attractSince = on ? (attractSince ?? now) : null;
    },

    update(dt, now) {
      if (reveal < 1.2) reveal = Math.min(1.2, reveal + (dt * 1.2) / REVEAL_SECONDS);
      if (cause) {
        elapsed += dt;
        if (elapsed >= DRAIN_SECONDS[cause]) {
          cause = null;
          hooks.onDrained();
        }
        return;
      }
      if (attractSince !== null && now - attractSince > CYCLE_SECONDS * 1000) {
        attractSince = now;
        hooks.onCycle();
      }
    },

    levels(out) {
      if (cause) {
        drainLevels(elapsed / DRAIN_SECONDS[cause], DRAIN_SECONDS[cause], out);
      } else {
        out.sink = sinkFor(fullness);
        out.crumble = 0;
        out.fade = 0;
      }
    },

    reveal0() {
      reveal = 0;
    },
  };
};
