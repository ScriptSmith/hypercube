import type { LandingConfig } from "./config";

const KEY = "hc:landing";

/** The last configuration, or null. Storage can be missing or blocked, so every call is guarded. */
export const loadSaved = (): Record<string, unknown> | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * Saves the configuration, including the room and admin key so tomorrow's URLs match today's.
 * The PIN and the signalling secret are kept apart from it, in `../credentials`.
 */
export const save = (cfg: LandingConfig): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    // Private mode or a full quota: the panel still works, it just won't remember.
  }
};
