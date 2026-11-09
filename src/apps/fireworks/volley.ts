/**
 * Volleys: launches from different pads close together in time. Three or more within the window
 * make a volley, at least half the pads on a side make a cascade, and two or more on each side
 * of a corner make a corner volley. Times are release times on the shared clock, so the order
 * messages arrive in doesn't matter.
 */
import { VOLLEY_WINDOW_MS } from "./config";

export interface Launch {
  t: number;
  /** Pad identity, unique within a side: frame id and pad index. */
  key: string;
  /** Shell id on this screen, to mark it. */
  shell: number;
}

export interface VolleyTracker {
  /** Record a launch and return the launches (one per pad, latest each) within the window. */
  add(l: Launch): Launch[];
  /** Launches within the window ending at `t`. */
  around(t: number): Launch[];
  clear(): void;
}

export const createVolleyTracker = (windowMs = VOLLEY_WINDOW_MS, cap = 64): VolleyTracker => {
  let recent: Launch[] = [];
  const within = (t: number): Launch[] => {
    const byPad = new Map<string, Launch>();
    for (const l of recent) {
      if (Math.abs(l.t - t) > windowMs) continue;
      const prev = byPad.get(l.key);
      if (!prev || l.t > prev.t) byPad.set(l.key, l);
    }
    return [...byPad.values()];
  };
  return {
    add(l) {
      recent.push(l);
      // Launches more than two windows old can't join anything new.
      const newest = recent.reduce((m, r) => Math.max(m, r.t), -Infinity);
      recent = recent.filter((r) => newest - r.t <= windowMs * 2);
      if (recent.length > cap) recent = recent.slice(recent.length - cap);
      return within(l.t);
    },
    around: within,
    clear() {
      recent = [];
    },
  };
};

/** Pads needed on one side for a cascade along the top: half of them, and never fewer than 2. */
export const cascadeNeeds = (padsOnSide: number): number =>
  Math.max(2, Math.ceil(Math.max(1, padsOnSide) / 2));

export const VOLLEY_MIN = 3;
export const CORNER_MIN = 2;
/** After a cascade or a corner volley, the next one waits at least this long. */
export const EFFECT_COOLDOWN_MS = 6000;
