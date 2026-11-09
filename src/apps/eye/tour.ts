/**
 * The attract tour, as a pure function of time. Each condition gets a cycle of three beats:
 *
 * - A: the condition comes on. Its slider slides from a typical eye to the condition (the eye
 *   lengthens for short sight, ages for ageing focus, the cataract clouds over), or the eye
 *   looks near, and the card shows the condition's caption.
 * - B: its correction goes on (glasses, a contact lens, reading glasses, a new lens, a hard
 *   lens) and the card shows the correction's caption; with no correction, More shows the
 *   next line, or the condition's toggle flips.
 * - C: a part that matters to the condition lights up with its caption.
 *
 * A frame on its own runs through every condition from the typical eye. In a bank the tour
 * runs on the shared clock and each frame starts from its own condition, so an untouched bank
 * is a gallery; conditions pass one frame to the left each cycle, the hand-over rippling from
 * left to right.
 */
import type { ConditionId, PartId } from "./captions";
import {
  BANK_START,
  CONDITION_ORDER,
  type Correction,
  correctionsFor,
  defaultState,
  type EyeState,
  togglesFor,
} from "./model";
import type { ButtonId, SliderId } from "./layout";

export type HandTarget =
  | { kind: "slider"; id: SliderId; value: number }
  | { kind: "button"; id: ButtonId }
  | { kind: "tile"; condition: ConditionId }
  | { kind: "more" }
  | { kind: "part"; part: PartId };

export interface TourFrame {
  state: EyeState;
  part: PartId | null;
  /** The caption card's page. */
  page: number;
  /** Where the ghost hand is and how far into its press (0 to 1), or null. */
  hand: { target: HandTarget; press: number } | null;
  /** The eye's slow turn, degrees of azimuth. */
  spin: number;
  /** Which condition cycle this is, to tell beats apart. */
  cycle: number;
}

/** Seconds per condition, and when beats B and C start. */
export const CYCLE_S = 36;
export const BEAT_B = 12;
export const BEAT_C = 22;
/** In a bank, each frame hands its condition on this long after the frame to its left. */
export const BANK_STAGGER_S = 1.5;

const smooth = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** The part each condition shows in beat C. */
export const PART_FOR: Record<ConditionId, PartId> = {
  typical: "fovea",
  myopia: "retina",
  hyperopia: "retina",
  astigmatism: "cornea",
  presbyopia: "lens",
  cataract: "lens",
  glaucoma: "disc",
  amd: "macula",
  diabetic: "retina",
  keratoconus: "cornea",
  cvd: "photoreceptors",
};

/** The slider beat A slides, if any. */
const SLIDE: Partial<Record<ConditionId, SliderId>> = {
  myopia: "length",
  hyperopia: "length",
  presbyopia: "age",
  astigmatism: "strength",
  cataract: "strength",
  glaucoma: "strength",
  amd: "strength",
  diabetic: "strength",
  keratoconus: "strength",
  cvd: "strength",
};

/** A hand pressing between `at` and `at + 0.8` s, showing from a second before. */
const press = (t: number, at: number): number | null =>
  t < at - 1 || t > at + 1.2 ? null : t < at ? 0 : Math.min(1, (t - at) / 0.8);

/** One condition's cycle at `t` seconds into it. */
export const cycleAt = (
  condition: ConditionId,
  t: number,
  light: number,
  cycle: number,
): TourFrame => {
  const target = defaultState(condition, light);
  const typical = defaultState("typical", light);
  const state: EyeState = { ...target };
  let part: PartId | null = null;
  let page = 0;
  let hand: TourFrame["hand"] = null;
  const slide = SLIDE[condition];
  const k = smooth((t - 1.5) / 4);
  if (slide === "length") state.length = lerp(typical.length, target.length, k);
  else if (slide === "age") state.age = lerp(typical.age, target.age, k);
  else if (slide === "strength") state.strength = lerp(0, target.strength, k);
  if (slide && t >= 0.5 && t <= 6.5) {
    const v = slide === "length" ? state.length : slide === "age" ? state.age : state.strength;
    hand = { target: { kind: "slider", id: slide, value: v }, press: t < 1.5 ? 0 : 1 };
  }
  // Looking near or far is part of the story for some conditions.
  if (condition === "typical") {
    state.looking = t >= 5 && t < 13 ? "near" : "far";
    const p = press(t, 5) ?? press(t, 13);
    if (p !== null) hand = { target: { kind: "button", id: t < 9 ? "near" : "far" }, press: p };
  } else if (target.looking === "near") {
    state.looking = t >= 7 ? "near" : "far";
    const p = press(t, 7);
    if (p !== null && !hand) hand = { target: { kind: "button", id: "near" }, press: p };
  }
  const fixes = correctionsFor(condition);
  const toggles = togglesFor(condition);
  if (t >= BEAT_B && t < BEAT_C) {
    if (fixes.length > 0) {
      state.correction = fixes[0] as Correction;
      const p = press(t, BEAT_B);
      if (p !== null) hand = { target: { kind: "button", id: "corrA" }, press: p };
    } else if (toggles) {
      state.toggle = 1;
      const p = press(t, BEAT_B);
      if (p !== null) hand = { target: { kind: "button", id: "corrB" }, press: p };
    } else {
      page = 1;
      const p = press(t, BEAT_B);
      if (p !== null) hand = { target: { kind: "more" }, press: p };
    }
  }
  if (t >= BEAT_C) {
    part = PART_FOR[condition];
    const p = press(t, BEAT_C);
    if (p !== null) hand = { target: { kind: "part", part }, press: p };
    if (condition === "typical") state.looking = "near";
  }
  return { state, part, page, hand, spin: 0, cycle };
};

const spinAt = (t: number) => 14 * Math.sin((2 * Math.PI * t) / 40);

/** A frame on its own: every condition in turn, from the typical eye. */
export const soloTour = (t: number, light: number): TourFrame => {
  const s = Math.max(0, t);
  const n = Math.floor(s / CYCLE_S);
  const condition = CONDITION_ORDER[n % CONDITION_ORDER.length]!;
  const f = cycleAt(condition, s - n * CYCLE_S, light, n);
  // A new condition's tile is tapped as its cycle starts.
  const p = press(s - n * CYCLE_S, 0.2);
  if (p !== null && n > 0 && !f.hand) f.hand = { target: { kind: "tile", condition }, press: p };
  f.spin = spinAt(s);
  return f;
};

/** The condition a bank frame shows on the tour at shared-clock time `t` seconds. */
export const bankCondition = (
  t: number,
  pos: number,
): { condition: ConditionId; n: number; at: number } => {
  const start = Math.max(0, pos);
  const local = t - start * BANK_STAGGER_S;
  const n = Math.floor(local / CYCLE_S);
  const i = (((start + n) % BANK_START.length) + BANK_START.length) % BANK_START.length;
  return { condition: BANK_START[i]!, n, at: local - n * CYCLE_S };
};

/** A bank frame: its own condition first, then the next along, on the shared clock. */
export const bankTour = (t: number, pos: number, light: number): TourFrame => {
  const { condition, n, at } = bankCondition(t, pos);
  const f = cycleAt(condition, at, light, n);
  f.spin = spinAt(t + pos * 4);
  return f;
};
