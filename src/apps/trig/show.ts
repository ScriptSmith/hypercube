/**
 * What a frame shows: the walk-through or the whole picture, which step, and its caption.
 * Pure.
 *
 * - `explore`: the walk-through plays until someone touches; then everything shows. It plays
 *   again after idle. While it shows, Back and Next step through it as in `steps`. "Show me"
 *   starts the steps from the first, as in `steps`, until Next goes past the last step or they
 *   have all played; then everything shows again.
 * - `steps`: the steps are the game. Nobody there, they advance by themselves; Back, Next or a
 *   touch on the circle hold them for the visitor.
 *
 * On a bank the show runs from the shared clock, so every frame and the screen are on the
 * same step; "Show me" starts at the first step.
 */
import type { Variant } from "./config";
import { ALL_PARTS, lineAt, partsAt, type Parts, type StepDef, type StepId, walkAt } from "./walk";

export type Base = "clock" | number;

export interface Shown {
  /** Playing by itself (the walk-through, or the steps advancing). */
  auto: boolean;
  /** Back, Next and the step dots show: always in `steps`, and in `explore` unless everything does. */
  stepping: boolean;
  /** Index into the steps, or null for the whole picture. */
  step: number | null;
  id: StepId | null;
  /** Seconds into the step and its share. */
  t: number;
  u: number;
  line: number;
  /** The step's caption, or null where the frame writes its own. */
  caption: string | null;
  parts: Parts;
}

export interface Show {
  readonly variant: Variant;
  readonly steps: readonly StepDef[];
  readonly auto: boolean;
  /** Start playing by itself from `base`. */
  play(base: Base): void;
  /** "Show me" in `explore`: the steps from the first, advancing by themselves as in `steps`. */
  guide(t: number): void;
  /** Someone took over: the walk-through shows everything, the steps hold their step. */
  hold(t: number, clockMs: number): void;
  next(t: number, clockMs: number): void;
  back(t: number, clockMs: number): void;
  at(t: number, clockMs: number): Shown;
}

const stepsLength = (steps: readonly StepDef[]) => steps.reduce((n, s) => n + s.secs, 0);

/** Where the steps (without the whole-picture rest) are `secs` in. */
const cycleAt = (steps: readonly StepDef[], secs: number) => {
  const len = stepsLength(steps);
  let t = ((secs % len) + len) % len;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (t < s.secs) return { step: i, t };
    t -= s.secs;
  }
  return { step: steps.length - 1, t: 0 };
};

const EVERYTHING: Shown = {
  auto: false,
  stepping: false,
  step: null,
  id: null,
  t: 0,
  u: 0,
  line: 0,
  caption: null,
  parts: ALL_PARTS,
};

export const createShow = (variant: Variant, steps: readonly StepDef[], base: Base): Show => {
  let auto = true;
  let from: Base = base;
  /** Playing or holding the steps, as `steps` always does (`explore`: after Show me, Back or Next). */
  let guided = variant === "steps";
  /** `explore` showing everything, nothing playing. */
  let free = false;
  let step = 0;
  let stepStart = 0;

  const secsFrom = (b: Base, t: number, clockMs: number) =>
    (b === "clock" ? clockMs : t - b) / 1000;

  const showEverything = () => {
    auto = false;
    guided = false;
    free = true;
  };

  /** `explore`'s guided steps end once they have all played. */
  const settle = (t: number, clockMs: number) => {
    if (
      variant === "explore" &&
      guided &&
      auto &&
      secsFrom(from, t, clockMs) >= stepsLength(steps)
    ) {
      showEverything();
    }
  };

  const current = (t: number, clockMs: number) => {
    // A held step's animations loop.
    if (!auto) return { step, t: ((t - stepStart) / 1000) % steps[step]!.secs };
    if (variant === "steps") return cycleAt(steps, secsFrom(from, t, clockMs));
    const w = walkAt(steps, secsFrom(from, t, clockMs));
    return { step: w.step, t: w.t };
  };

  const go = (d: number, t: number, clockMs: number) => {
    settle(t, clockMs);
    if (free) return;
    const to = current(t, clockMs).step + d;
    // Past the last step (or on from the walk-through's whole picture), `explore` shows everything.
    if (variant === "explore" && to >= steps.length) {
      showEverything();
      return;
    }
    auto = false;
    guided = true;
    step = Math.max(0, Math.min(steps.length - 1, to));
    stepStart = t;
  };

  return {
    variant,
    steps,
    get auto() {
      return auto;
    },
    play(b) {
      auto = true;
      from = b;
      guided = variant === "steps";
      free = false;
    },
    guide(t) {
      auto = true;
      from = t;
      guided = true;
      free = false;
    },
    hold(t, clockMs) {
      settle(t, clockMs);
      if (!auto) return;
      if (guided) go(0, t, clockMs);
      else showEverything();
    },
    next(t, clockMs) {
      go(1, t, clockMs);
    },
    back(t, clockMs) {
      go(-1, t, clockMs);
    },
    at(t, clockMs) {
      settle(t, clockMs);
      if (free) return EVERYTHING;
      const c = current(t, clockMs);
      if (c.step >= steps.length) return { ...EVERYTHING, auto, stepping: true, t: c.t };
      const def = steps[c.step]!;
      const line = lineAt(def, c.t);
      return {
        auto,
        stepping: true,
        step: c.step,
        id: def.id,
        t: c.t,
        u: Math.min(1, c.t / def.secs),
        line,
        caption: def.lines[line] ?? null,
        parts: partsAt(steps, c.step),
      };
    },
  };
};
