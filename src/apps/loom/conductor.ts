/**
 * The loom's rules, run by whichever frame is in charge: the screen above a bank, a solo
 * frame, or a bank frame standing in while the screen is gone. Pure apart from its rng.
 *
 * `match`: a target shape is shown; harmonics nobody is setting (auto) ease to it by
 * themselves after a short pause, so the shape always completes. When every harmonic has been
 * right for a second the loom weaves a band of cloth from the shape, rests, and the next target
 * comes in. Rounds nobody took part in (attract) ease more slowly and rest longer, so targets
 * cycle about every twenty seconds.
 *
 * `free`: no target. Harmonics nobody is setting fade slowly to nothing while anyone plays; with
 * nobody playing they drift through shapes on their own. Every 30 s of play weaves a band from
 * whatever shape the sum is.
 */
import type { Rng } from "../../core/types";
import { createCloth, type Cloth } from "./cloth";
import { MAX_H, TAU, type Variant } from "./config";
import {
  matchStats,
  nextTarget,
  phaseDelta,
  type Target,
  targetFor,
  targetsFor,
  type Term,
  wrapPhase,
} from "./series";

export type Mode = "play" | "weave" | "rest";

/** After a new target appears, auto harmonics wait this long before easing to it. */
export const INTRO_S = 1.2;
/** Every harmonic right for this long makes a match. */
export const HOLD_S = 1.0;
/** The weave after a match, and the rest after it (longer when nobody took part). */
export const WEAVE_S = 3.0;
export const REST_S = 1.0;
export const ATTRACT_REST_S = 7.0;
/** In `free`, this much play weaves a band. */
export const FREE_WEAVE_S = 30;
/** In `free`, the drifting shape changes this often while nobody plays. */
export const DRIFT_S = 11;
/** Slider units per second an untouched `free` harmonic fades by while others play. */
export const FADE_RATE = 0.05;

/** Auto easing: proportional, with top speeds, halved in attract. */
const GAIN = 2.2;
const AMP_RATE = 0.3;
const PHASE_RATE = 1.6;

export interface Conductor {
  readonly variant: Variant;
  readonly n: number;
  /** The current value of every harmonic, k = 1 to n. */
  readonly values: readonly Term[];
  readonly live: readonly boolean[];
  /** Per harmonic: right for the current target (always false in `free`). */
  readonly ok: readonly boolean[];
  readonly round: number;
  readonly mode: Mode;
  /** Seconds in the current mode. */
  readonly modeT: number;
  /** Target index (TARGET_DEFS), or -1 in `free`. */
  readonly targetIndex: number;
  target(): Target | null;
  /** 0 to 1. */
  readonly fill: number;
  /** Someone set a harmonic during this round. */
  readonly people: boolean;
  readonly cloth: Cloth;
  readonly matches: number;
  /** Matches made with someone taking part. */
  readonly peopleMatches: number;
  /** A harmonic someone is setting: take its values as given. */
  setLive(i: number, amp: number, phase: number): void;
  /** A harmonic nobody is setting any more. */
  setAuto(i: number): void;
  step(dt: number): void;
  /** Skip to the next target (admin). */
  next(): void;
  resize(n: number): void;
  /** Carry on from another conductor's state (a frame taking over from the screen). */
  adopt(s: { round: number; target: number; values: readonly Term[] }): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Move `from` towards `to` proportionally, at most `rate * dt`. */
const approach = (from: number, to: number, rate: number, dt: number) => {
  const d = to - from;
  const step = clamp(d * GAIN * dt, -rate * dt, rate * dt);
  return Math.abs(d) <= Math.abs(step) ? to : from + step;
};

export const easeTerm = (t: Term, goal: Term, dt: number, slow: boolean): Term => {
  const k = slow ? 0.5 : 1;
  const amp = approach(t.amp, goal.amp, AMP_RATE * k, dt);
  // A harmonic with almost no amplitude has no phase worth turning to.
  if (goal.amp < 1e-6) return { amp, phase: t.phase };
  // Half a turn away, always go forwards, so a follower working from rounded values turns the
  // same way as the conductor.
  const d0 = phaseDelta(t.phase, goal.phase);
  const d = d0 < -Math.PI + 0.05 ? d0 + TAU : d0;
  const turned = approach(0, d, PHASE_RATE * k, dt);
  return { amp, phase: wrapPhase(t.phase + turned) };
};

export const createConductor = (o: { n: number; variant: Variant; rng: Rng }): Conductor => {
  let n = clamp(Math.round(o.n), 1, MAX_H);
  const variant = o.variant;
  const rng = o.rng;
  let values: Term[] = Array.from({ length: n }, () => ({ amp: 0, phase: 0 }));
  let live: boolean[] = values.map(() => false);
  let ok: boolean[] = values.map(() => false);
  let round = 0;
  let mode: Mode = "play";
  let modeT = 0;
  let targetIndex = variant === "match" ? (targetsFor(n)[0] ?? 0) : -1;
  let fill = 0;
  let hold = 0;
  let people = false;
  let matches = 0;
  let peopleMatches = 0;
  let playT = 0;
  let driftT = DRIFT_S;
  let drift: Term[] = values.map(() => ({ amp: 0, phase: 0 }));
  const cloth = createCloth();

  const target = () => (targetIndex >= 0 ? targetFor(targetIndex, n) : null);

  const newDrift = () => {
    const list = targetsFor(n);
    const t = list.length > 0 ? targetFor(rng.pick(list), n) : null;
    // A known shape, turned to a random start and a little off, so the drift never repeats.
    const shift = rng.range(0, TAU);
    drift = Array.from({ length: n }, (_, i) => {
      const base = t?.terms[i] ?? { amp: 0, phase: 0 };
      const amp = clamp(base.amp + (base.amp > 0 ? rng.range(-0.15, 0.1) : 0), 0, 1);
      return { amp, phase: wrapPhase(base.phase + shift * (i + 1)) };
    });
  };

  const weave = () => {
    const shape = target();
    cloth.add({
      values,
      title: shape?.title ?? null,
      people,
    });
  };

  const startRound = () => {
    round = (round + 1) % 65536;
    if (variant === "match") targetIndex = nextTarget(targetIndex, n);
    mode = "play";
    modeT = 0;
    hold = 0;
    people = live.some(Boolean);
  };

  const stepMatch = (dt: number) => {
    const t = target();
    if (!t) return;
    const slow = !people;
    const easing = mode !== "play" || modeT >= INTRO_S;
    for (let i = 0; i < n; i++) {
      if (live[i] || !easing) continue;
      values[i] = easeTerm(values[i]!, t.terms[i]!, dt, slow);
    }
    const stats = matchStats(values, t);
    ok = stats.ok;
    fill = stats.fill;
    if (mode === "play") {
      hold = stats.all ? hold + dt : Math.max(0, hold - 2 * dt);
      if (hold >= HOLD_S) {
        matches++;
        if (people) peopleMatches++;
        weave();
        mode = "weave";
        modeT = 0;
      }
    } else if (mode === "weave" && modeT >= WEAVE_S) {
      mode = "rest";
      modeT = 0;
    } else if (mode === "rest" && modeT >= (people ? REST_S : ATTRACT_REST_S)) {
      startRound();
    }
  };

  const stepFree = (dt: number) => {
    const anyLive = live.some(Boolean);
    if (anyLive) {
      for (let i = 0; i < n; i++) {
        if (live[i]) continue;
        const v = values[i]!;
        values[i] = { amp: Math.max(0, v.amp - FADE_RATE * dt), phase: v.phase };
      }
      if (values.some((v, i) => live[i] && v.amp > 0.05)) playT += dt;
    } else {
      driftT += dt;
      if (driftT >= DRIFT_S) {
        driftT = 0;
        newDrift();
      }
      for (let i = 0; i < n; i++) values[i] = easeTerm(values[i]!, drift[i]!, dt, true);
    }
    ok = values.map(() => false);
    fill = 0;
    if (mode === "play" && playT >= FREE_WEAVE_S) {
      playT = 0;
      people = true;
      weave();
      matches++;
      peopleMatches++;
      mode = "weave";
      modeT = 0;
    } else if (mode !== "play" && modeT >= WEAVE_S) {
      mode = "play";
      modeT = 0;
      people = anyLive;
    }
  };

  return {
    variant,
    get n() {
      return n;
    },
    get values() {
      return values;
    },
    get live() {
      return live;
    },
    get ok() {
      return ok;
    },
    get round() {
      return round;
    },
    get mode() {
      return mode;
    },
    get modeT() {
      return modeT;
    },
    get targetIndex() {
      return targetIndex;
    },
    target,
    get fill() {
      return fill;
    },
    get people() {
      return people;
    },
    cloth,
    get matches() {
      return matches;
    },
    get peopleMatches() {
      return peopleMatches;
    },
    setLive(i, amp, phase) {
      if (!Number.isInteger(i) || i < 0 || i >= n) return;
      values[i] = { amp: clamp(amp, 0, 1), phase: wrapPhase(phase) };
      live[i] = true;
      people = true;
      if (variant === "free") driftT = DRIFT_S;
    },
    setAuto(i) {
      if (!Number.isInteger(i) || i < 0 || i >= n) return;
      live[i] = false;
    },
    step(dt) {
      modeT += dt;
      if (variant === "match") stepMatch(dt);
      else stepFree(dt);
    },
    next() {
      if (variant !== "match") return;
      startRound();
    },
    resize(m) {
      const next = clamp(Math.round(m), 1, MAX_H);
      if (next === n) return;
      n = next;
      values = Array.from({ length: n }, (_, i) => values[i] ?? { amp: 0, phase: 0 });
      live = Array.from({ length: n }, (_, i) => live[i] ?? false);
      ok = values.map(() => false);
      drift = Array.from({ length: n }, (_, i) => drift[i] ?? { amp: 0, phase: 0 });
      if (variant === "match" && !targetFor(targetIndex, n)) {
        targetIndex = targetsFor(n)[0] ?? 0;
        mode = "play";
        modeT = 0;
        hold = 0;
      }
    },
    adopt(s) {
      round = s.round % 65536;
      if (variant === "match" && targetFor(s.target, n)) targetIndex = s.target;
      for (let i = 0; i < n; i++) {
        const v = s.values[i];
        if (v && !live[i]) values[i] = { amp: clamp(v.amp, 0, 1), phase: wrapPhase(v.phase) };
      }
      mode = "play";
      modeT = INTRO_S;
      hold = 0;
    },
  };
};
