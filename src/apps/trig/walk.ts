/**
 * The walk-through: seven steps that build the picture one part at a time, each with a few
 * short captions shown in turn. It is the attract show in `explore` and the game in `steps`.
 * Pure.
 */
import type { Fn } from "./config";

export type StepId = "circle" | "triangle" | "squares" | "tan" | "arc" | "waves" | "signs";

export interface StepDef {
  id: StepId;
  /** Captions, shown in turn; each a few words. */
  lines: readonly string[];
  /** Seconds the step lasts in the show. */
  secs: number;
}

export const STEPS: readonly StepDef[] = [
  { id: "circle", lines: ["A circle with radius 1", "The point turns by the angle θ"], secs: 8 },
  { id: "triangle", lines: ["Its height is sin θ", "Its width is cos θ"], secs: 10 },
  { id: "squares", lines: ["The squares add up", "sin²θ + cos²θ = 1"], secs: 9 },
  {
    id: "tan",
    lines: ["Make the radius longer", "Where it meets the line: tan θ", "tan θ = sin θ ÷ cos θ"],
    secs: 12,
  },
  { id: "arc", lines: ["The arc is θ long", "One turn is 2π"], secs: 10 },
  {
    id: "waves",
    lines: [
      "Unroll the height: the sine wave",
      "Unroll the width: the cosine wave",
      "tan breaks at 90° and 270°",
    ],
    secs: 14,
  },
  {
    id: "signs",
    lines: ["Below the middle, sin θ is negative", "Left of the middle, cos θ is negative"],
    secs: 10,
  },
];

/** After the last step the whole picture turns for this long before the show starts again. */
export const FULL_SECS = 14;

/** The steps a setup shows: without tan, its step and its caption go. */
export const stepsFor = (tan: boolean): StepDef[] =>
  STEPS.filter((s) => tan || s.id !== "tan").map((s) =>
    tan || s.id !== "waves" ? s : { ...s, lines: s.lines.filter((l) => !l.startsWith("tan")) },
  );

export const showLength = (steps: readonly StepDef[]): number =>
  steps.reduce((n, s) => n + s.secs, 0) + FULL_SECS;

export interface WalkAt {
  /** Index into the steps, or steps.length for the whole picture. */
  step: number;
  /** Seconds into the step. */
  t: number;
  /** Share of the step gone. */
  u: number;
  /** Which caption is showing. */
  line: number;
}

/** Where the show is `secs` after it started (it loops). */
export const walkAt = (steps: readonly StepDef[], secs: number): WalkAt => {
  const len = showLength(steps);
  let t = ((secs % len) + len) % len;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (t < s.secs) {
      return { step: i, t, u: t / s.secs, line: lineAt(s, t) };
    }
    t -= s.secs;
  }
  return { step: steps.length, t, u: t / FULL_SECS, line: 0 };
};

/** The caption showing `t` seconds into a step: each gets an equal share, then they cycle. */
export const lineAt = (s: StepDef, t: number): number => {
  const share = s.secs / s.lines.length;
  return Math.floor(Math.max(0, t) / share) % s.lines.length;
};

/** What the picture shows. */
export interface Parts {
  triangle: boolean;
  squares: boolean;
  tan: boolean;
  arc: boolean;
  /** Radian marks round the circle and along the axis. */
  radians: boolean;
  graphs: boolean;
  signs: boolean;
  /** The step's new part, drawn brighter, or null. */
  focus: StepId | null;
}

export const ALL_PARTS: Parts = {
  triangle: true,
  squares: false,
  tan: true,
  arc: true,
  radians: false,
  graphs: true,
  signs: true,
  focus: null,
};

/** What is shown at a step: everything before it, and its own part. */
export const partsAt = (steps: readonly StepDef[], step: number): Parts => {
  if (step >= steps.length) return ALL_PARTS;
  const id = steps[step]!.id;
  const upto = (x: StepId) => {
    const i = steps.findIndex((s) => s.id === x);
    return i >= 0 && i <= step;
  };
  return {
    triangle: upto("triangle"),
    squares: id === "squares",
    tan: upto("tan"),
    arc: upto("arc"),
    radians: id === "arc",
    graphs: upto("waves"),
    signs: upto("signs"),
    focus: id,
  };
};

/** Functions a step's readout shows. */
export const fnsAt = (parts: Parts): Fn[] => {
  const out: Fn[] = [];
  if (parts.triangle) out.push("sin", "cos");
  if (parts.tan) out.push("tan");
  return out;
};
