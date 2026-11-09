import type { Clock } from "../types";
import { report } from "./util";

/** Recent ping samples kept; at 2 s per ping this is about half a minute. */
const WINDOW = 16;
/** The estimate is the median offset of this many lowest-RTT samples in the window. */
const BEST = 4;
const MIN_SAMPLES = 3;
/** Corrections larger than this are applied at once; smaller ones are slewed. */
const STEP_MS = 200;
/** While slewing the clock runs at most 5 % fast or slow. */
const SLEW = 0.05;
/** onSync fires when the estimate moves at least this far. */
const NOTIFY_MS = 2;

export interface SyncClock extends Clock {
  /** Local monotonic time, the base the offset applies to. */
  local(): number;
  /** Current estimate of hub time minus local time. */
  offset(): number;
  /** One NTP-style measurement against the hub. */
  sample(offset: number, rtt: number): void;
  /** A new hub: forget its predecessor's samples, but keep running on the old offset until new
   * samples arrive, so the timeline carries over when the new hub was synced to the old one. */
  restart(): void;
  /** This frame is the hub now, so its clock is the room's reference. */
  anchor(): void;
  dispose(): void;
}

const median = (sorted: readonly number[]): number => {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

/**
 * NTP-style clock against the hub. `now()` never goes backwards: small corrections are slewed,
 * large forward ones jump, and large backward ones hold the clock still until local time
 * catches up.
 */
export const createSyncClock = (local: () => number): SyncClock => {
  let samples: { offset: number; rtt: number }[] = [];
  let target = 0;
  let applied = 0;
  let adjustedAt = local();
  let last = -Infinity;
  let synced = false;
  let notified = 0;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const cb of listeners) {
      try {
        cb();
      } catch (err) {
        report(err);
      }
    }
  };

  const settle = (t: number) => {
    const diff = target - applied;
    if (diff !== 0) {
      const allowed = Math.max(0, t - adjustedAt) * SLEW;
      applied = Math.abs(diff) <= allowed ? target : applied + Math.sign(diff) * allowed;
    }
    adjustedAt = t;
  };

  const retarget = (estimate: number) => {
    settle(local());
    target = estimate;
    if (!synced || Math.abs(target - applied) > STEP_MS) applied = target;
    const first = !synced;
    synced = true;
    if (first || Math.abs(target - notified) >= NOTIFY_MS) {
      notified = target;
      emit();
    }
  };

  return {
    now() {
      const t = local();
      settle(t);
      const v = t + applied;
      if (v > last) last = v;
      return last;
    },
    get synced() {
      return synced;
    },
    onSync(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    local,
    offset: () => target,
    sample(offset, rtt) {
      samples.push({ offset, rtt });
      if (samples.length > WINDOW) samples.shift();
      if (samples.length < MIN_SAMPLES) return;
      const best = [...samples]
        .sort((a, b) => a.rtt - b.rtt)
        .slice(0, BEST)
        .map((s) => s.offset)
        .sort((a, b) => a - b);
      retarget(median(best));
    },
    restart() {
      samples = [];
    },
    anchor() {
      samples = [];
      if (synced) return;
      synced = true;
      notified = target;
      emit();
    },
    dispose() {
      listeners.clear();
      samples = [];
    },
  };
};
