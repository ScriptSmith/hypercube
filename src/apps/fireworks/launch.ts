/**
 * A launch as it crosses from a touch frame to the screen above. The frame sends where its tube's
 * mouth is (as a fraction across the frame and a depth below its top), the angle and the shell's
 * speed and gravity; both sides rebuild the same path in sky units from that, so the shell the
 * frame draws climbing and the one the screen draws are one and the same.
 */
import { type Ballistic, positionAt, timeToHeight } from "./path";
import type { Recipe } from "./recipe";
import type { Sky } from "./sky";
import type { LaunchMsg } from "./wire";

export interface LaunchInput {
  pad: number;
  pads: number;
  pos: number;
  /** Frame size, venue px. */
  fw: number;
  fh: number;
  /** Tube mouth in the frame's venue px (y down). */
  mouth: { x: number; y: number };
  angle: number;
  sky: Pick<Sky, "v" | "g">;
  recipe: Recipe;
  seed: number;
  /** Launch time on the shared clock. */
  t: number;
}

export const launchMessage = (i: LaunchInput): LaunchMsg => ({
  p: i.pad,
  n: i.pads,
  pos: i.pos,
  fw: i.fw,
  fh: i.fh,
  u: i.mouth.x / i.fw,
  d: i.mouth.y,
  a: i.angle,
  v: i.sky.v,
  g: i.sky.g,
  c: i.recipe.color,
  s: i.recipe.shape,
  z: i.recipe.size,
  k: i.seed,
  t: i.t,
});

/** The shell's path in sky units, for a bank whose left edge is at `xo`. */
export const pathOf = (m: LaunchMsg, xo: number): Ballistic => ({
  x: xo + (m.pos + m.u) * m.fw,
  y: -m.d,
  vx: m.v * Math.sin(m.a),
  vy: m.v * Math.cos(m.a),
  g: m.g,
  k: 0,
});

/**
 * When (seconds after launch) the shell passes the top of its frame into the screen, and where
 * across the frame, for the echo glow. Null time if it never gets there.
 */
export const exitOf = (m: LaunchMsg, xo: number): { t: number | null; u: number } => {
  const path = pathOf(m, xo);
  const t = timeToHeight(path, 0);
  if (t === null) return { t, u: m.u };
  const x0 = xo + m.pos * m.fw;
  return { t, u: (positionAt(path, t).x - x0) / m.fw };
};
