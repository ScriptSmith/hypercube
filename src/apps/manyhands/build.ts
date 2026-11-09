/**
 * One build: its slots and who filled them. A part on its way is "coming" from the moment it is
 * delivered until it lands, so the slot is spoken for and nothing else heads there. Pure apart
 * from mutating the build passed in, so tests drive it with plain numbers for time.
 */
import type { ThemeId } from "./config";
import { type SlotShape, slotsFor, THEMES } from "./themes";

export type Maker = "person" | "bot" | "helper";
export type Phase = "building" | "finishing" | "alive";

export interface BuildSlot extends SlotShape {
  state: "open" | "coming" | "filled";
  maker: Maker | null;
  /** Station colour index for a person's part, else -1. */
  color: number;
  /** Column that made it, -1 for helpers. */
  column: number;
  /** When the part sets off and lands, in the build's ms. */
  departAt: number;
  arriveAt: number;
  /** Where it sets off from, as fractions across and down the frame drawing the build. */
  sx: number;
  sy: number;
}

export interface Build {
  id: number;
  theme: ThemeId;
  slots: BuildSlot[];
  startAt: number;
  endAt: number;
  phase: Phase;
  /** When it came alive, or 0. */
  aliveAt: number;
  /** Every slot filled before the helpers' last stretch. */
  early: boolean;
}

export const newBuild = (
  id: number,
  theme: ThemeId,
  parts: number,
  now: number,
  roundMs: number,
): Build => ({
  id,
  theme,
  slots: slotsFor(theme, parts).map((s) => ({
    ...s,
    state: "open",
    maker: null,
    color: -1,
    column: -1,
    departAt: 0,
    arriveAt: 0,
    sx: 0.5,
    sy: 1,
  })),
  startAt: now,
  endAt: now + roundMs,
  phase: "building",
  aliveAt: 0,
  early: false,
});

/** Open slots per kind. */
export const needOf = (b: Build): number[] => {
  const need: number[] = Array.from({ length: THEMES[b.theme].kinds.length }, () => 0);
  for (const s of b.slots) if (s.state === "open") need[s.kind] = (need[s.kind] ?? 0) + 1;
  return need;
};

/** Slots filled or on their way. */
export const madeCount = (b: Build): number => {
  let n = 0;
  for (const s of b.slots) if (s.state !== "open") n++;
  return n;
};

export const filledCount = (b: Build): number => {
  let n = 0;
  for (const s of b.slots) if (s.state === "filled") n++;
  return n;
};

export const isComplete = (b: Build): boolean => b.slots.every((s) => s.state === "filled");

const lowestOpen = (b: Build, ok: (s: BuildSlot) => boolean): number => {
  let best = -1;
  for (let i = 0; i < b.slots.length; i++) {
    const s = b.slots[i]!;
    if (s.state !== "open" || !ok(s)) continue;
    if (best < 0 || s.order < b.slots[best]!.order) best = i;
  }
  return best;
};

/**
 * The slot a part of `kind` should fill: the lowest open slot of that kind, else the lowest open
 * slot of whichever kind needs the most. -1 when nothing is open.
 */
export const pickSlot = (b: Build, kind: number): number => {
  const same = lowestOpen(b, (s) => s.kind === kind);
  if (same >= 0) return same;
  const need = needOf(b);
  let neediest = -1;
  for (let k = 0; k < need.length; k++) {
    if ((need[k] ?? 0) > 0 && (neediest < 0 || need[k]! > need[neediest]!)) neediest = k;
  }
  return neediest < 0 ? -1 : lowestOpen(b, (s) => s.kind === neediest);
};

/** The slot a helper should fill: kinds no working column is making first, lowest first. */
export const pickHelperSlot = (b: Build, busyKinds: ReadonlySet<number>): number => {
  const free = lowestOpen(b, (s) => !busyKinds.has(s.kind));
  return free >= 0 ? free : lowestOpen(b, () => true);
};

/** Land every part due by `now`. Returns the slots that filled. */
export const settle = (b: Build, now: number, out: number[] = []): number[] => {
  for (let i = 0; i < b.slots.length; i++) {
    const s = b.slots[i]!;
    if (s.state === "coming" && s.arriveAt <= now) {
      s.state = "filled";
      out.push(i);
    }
  }
  return out;
};

/**
 * Orders: the part kind each column makes. A column keeps its order while that kind still has
 * open slots; the others get the kinds that need the most, spread along the row so neighbours
 * tend to differ. `prev` is the last orders, or empty for a new build.
 */
export const assignOrders = (
  prev: readonly number[],
  columns: number,
  need: readonly number[],
): number[] => {
  const n = Math.max(0, Math.floor(columns));
  const kinds = need.length;
  const total = need.reduce((a, b) => a + Math.max(0, b), 0);
  const out: number[] = Array.from({ length: n }, () => -1);
  for (let c = 0; c < n; c++) {
    const k = prev[c] ?? -1;
    if (k >= 0 && k < kinds && (total === 0 || (need[k] ?? 0) > 0)) out[c] = k;
  }
  if (total === 0) {
    for (let c = 0; c < n; c++) if (out[c]! < 0) out[c] = 0;
    return out;
  }
  const used: number[] = Array.from({ length: kinds }, () => 0);
  for (let c = 0; c < n; c++) {
    const k = out[c]!;
    if (k < 0) {
      // Columns to the left so far, in proportion to need, against what they already make.
      let best = -1;
      let bestScore = -Infinity;
      for (let j = 0; j < kinds; j++) {
        if ((need[j] ?? 0) <= 0) continue;
        const score = (need[j]! / total) * (c + 1) - used[j]! - (out[c - 1] === j ? 0.25 : 0);
        if (score > bestScore) {
          best = j;
          bestScore = score;
        }
      }
      out[c] = best;
      if (best >= 0) used[best]!++;
    } else {
      used[k]!++;
    }
  }
  return out;
};
