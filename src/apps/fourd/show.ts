/**
 * The attract show: a loop every stage of a frame plays in step, so a wall's ladder tells the
 * analogy three times at once. Pure: a pose for any time since the show began.
 *
 * Each loop: push the shape through facet first; turn it corner first and push it back; turn it
 * facet first again and park the cut in the middle; turn it a whole way round in the first dial's
 * plane (through w, on a 4D stage, which turns the shadow inside out and back); then a pause.
 * A ghost hand works the control each step uses. While nobody uses any stage of the frame, each
 * loop moves on to the next shape family.
 */
import type { Dim, Family } from "./shapes";

export const SHOW_S = 36;

export type Ghost =
  | { kind: "lever"; t: number }
  | { kind: "dial"; index: number; angle: number }
  | { kind: "orient"; k: number }
  | null;

export interface ShowPose {
  loop: number;
  /** Seconds into this loop. */
  at: number;
  lever: number;
  /** 0 at rest (facet first) to 1 corner first, along the least turn between them. */
  corner: number;
  /** Radians turned in the first dial's plane, after the rest. */
  turn: number;
  caption: string | null;
  ghost: Ghost;
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
const span = (t: number, a: number, b: number) => smooth((t - a) / (b - a));

const T = {
  sweep0: 1.5,
  sweep1: 8.5,
  press1: 9.0,
  turn0: 9.6,
  turn1: 11.1,
  back0: 11.1,
  back1: 18.1,
  press2: 18.3,
  home0: 18.7,
  home1: 20.2,
  spin0: 20.6,
  spin1: 32.2,
} as const;

const intro = (dim: Dim): string =>
  dim === 4
    ? "We see only a slice of a 4D shape"
    : dim === 3
      ? "A flat world sees only a slice"
      : "A line world sees only a slice";

const ballLine = (dim: Dim): string =>
  dim === 4
    ? "Every slice of a 4D ball is a ball"
    : dim === 3
      ? "Every slice of a ball is a circle"
      : "Every slice of a circle is a line";

export const captionFor = (dim: Dim, family: Family, at: number): string | null => {
  if (at < T.press1) return intro(dim);
  if (at < T.press2) return family === "ball" ? ballLine(dim) : "Corner first";
  if (at < T.spin0) return null;
  if (at < T.spin1 + 0.4) return dim === 4 ? "Turn it through w" : "Turn it";
  return "Your turn";
};

/** The pose `seconds` after the show began. */
export const showAt = (seconds: number, dim: Dim, family: Family): ShowPose => {
  const s = Math.max(0, seconds);
  const loop = Math.floor(s / SHOW_S);
  const at = s - loop * SHOW_S;
  let lever = -1;
  let corner = 0;
  let turn = 0;
  let ghost: Ghost = null;
  if (at < T.sweep0) {
    lever = -1;
  } else if (at < T.sweep1) {
    lever = -1 + 2 * span(at, T.sweep0, T.sweep1);
    ghost = { kind: "lever", t: lever };
  } else if (at < T.back0) {
    lever = 1;
    corner = span(at, T.turn0, T.turn1);
    if (at >= T.press1 - 0.3 && at < T.turn0 + 0.4) ghost = { kind: "orient", k: 0 };
  } else if (at < T.back1) {
    corner = 1;
    lever = 1 - 2 * span(at, T.back0, T.back1);
    ghost = { kind: "lever", t: lever };
  } else if (at < T.spin0) {
    const h = span(at, T.home0, T.home1);
    corner = 1 - h;
    lever = -1 + h;
    if (at >= T.press2 - 0.2 && at < T.home0 + 0.5) ghost = { kind: "orient", k: dim - 1 };
  } else {
    lever = 0;
    turn = span(at, T.spin0, T.spin1) * Math.PI * 2;
    if (at < T.spin1 + 0.3) ghost = { kind: "dial", index: 0, angle: turn };
  }
  return { loop, at, lever, corner, turn, caption: captionFor(dim, family, at), ghost };
};
