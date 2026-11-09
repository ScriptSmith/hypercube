/**
 * The course: gates (an obstacle above a gap and one below it) along a straight run to the
 * finish. Every frame builds it from the shared seed and the race label, so frames agree on it
 * without sending anything. Each gate draws from its own rng stream, so a gate depends only on
 * the label, its index and the gap centre before it.
 *
 * Gap centres follow a bounded random walk: the step from one gap to the next is never more
 * than a glider can climb (tapping four times a second) or fall in the time between the gates
 * at the fastest any glider goes.
 */
import type { Rng } from "../../core/types";
import {
  CEIL_Y,
  courseLength,
  type FlapConfig,
  FLOOR_Y,
  GATE_W,
  MAX_SPEED_FACTOR,
  MIN_PIECE,
  RADIUS,
  START_Y,
} from "./config";

/** Obstacle art for a gate. */
export const STYLES = ["rock", "gum", "vine"] as const;
export type Style = (typeof STYLES)[number];

export interface Gate {
  i: number;
  /** Left edge, course px from the start line. */
  x: number;
  w: number;
  /** Gap centre and height. */
  c: number;
  h: number;
  style: Style;
  /** 0 to 1, for small variations in the art. */
  look: number;
}

export interface Course {
  label: string;
  /** Distance from the start line to the finish line. */
  length: number;
  gates: readonly Gate[];
  /** Hash of everything that affects play, for checking that frames agree. */
  hash: number;
}

/**
 * Seconds of base-speed flight between one gate's far edge (plus the glider) and the next gate,
 * before jitter. Spacing by free time rather than distance gives every speed the same time to
 * change height between gates.
 */
export const FREE_S = 1.25;
/** The first gate is this many seconds of base-speed flight past the start line. */
export const LEAD_S = 1.7;
/** The last gate ends at least this many seconds of base-speed flight before the finish. */
export const RUN_IN_S = 1.2;
/** Climb rate the walk allows for, course px per second (a little under the four taps a second the tests allow for). */
export const RISE_RATE = 540;

/** Highest and lowest gap centres for a gap height. */
export const centreRange = (h: number): { min: number; max: number } => ({
  min: CEIL_Y + MIN_PIECE + h / 2,
  max: FLOOR_Y - MIN_PIECE - h / 2,
});

/** Largest change of gap centre allowed between gates `spacing` apart (left edge to left edge). */
export const maxStep = (spacing: number, base: number, h: number): number => {
  const free = Math.max(0, spacing - GATE_W - 2 * RADIUS);
  const seconds = free / (base * MAX_SPEED_FACTOR);
  return RISE_RATE * seconds + 0.2 * (h - 2 * RADIUS);
};

const hashInts = (values: readonly number[]): number => {
  let h = 0x811c9dc5;
  for (const v of values) {
    let x = v | 0;
    for (let b = 0; b < 4; b++) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193);
      x >>>= 8;
    }
  }
  return h >>> 0;
};

export const hashGates = (length: number, gates: readonly Gate[]): number =>
  hashInts([
    length,
    gates.length,
    ...gates.flatMap((g) => [g.x, g.w, g.c, g.h, STYLES.indexOf(g.style)]),
  ]);

/**
 * Build the course for `label` ("race-<k>" in a bank, "solo-<epoch>" on a solo panel) from the
 * app's seeded rng. Pure: the same rng seed, label and options always give the same course.
 */
export const buildCourse = (
  rng: Rng,
  label: string,
  cfg: Pick<FlapConfig, "base" | "race" | "gapH">,
): Course => {
  const stream = rng.fork(label);
  const length = courseLength(cfg);
  const h = cfg.gapH;
  const { min, max } = centreRange(h);
  const mid = (min + max) / 2;
  const lastEnd = length - cfg.base * RUN_IN_S;
  const gates: Gate[] = [];
  let x = Math.round(cfg.base * LEAD_S);
  /** Distance from the previous gate's left edge to this one's. */
  let flown = 0;
  let c = Math.min(max, Math.max(min, START_Y));
  let style: Style = STYLES[stream.int(STYLES.length)] ?? "rock";
  for (let i = 0; x + GATE_W <= lastEnd && i < 400; i++) {
    const g = stream.fork(`gate-${i}`);
    const bound = i === 0 ? 160 : maxStep(flown, cfg.base, h);
    // Two uniforms make moderate steps common and big ones rare; the pull keeps off the edges.
    const pull = (c - mid) * 0.3;
    const step = Math.max(-bound, Math.min(bound, (g.next() + g.next() - 1) * bound - pull));
    c = Math.round(Math.min(max, Math.max(min, c + step)));
    if (i > 0 && g.next() < 0.3) style = STYLES[g.int(STYLES.length)] ?? style;
    gates.push({ i, x, w: GATE_W, c, h, style, look: Math.round(g.next() * 1000) / 1000 });
    const spacing = Math.round(GATE_W + 2 * RADIUS + cfg.base * FREE_S * g.range(0.9, 1.2));
    x += spacing;
    flown = spacing;
  }
  return { label, length, gates, hash: hashGates(length, gates) };
};

/** Index of the first gate whose far edge is still ahead of a glider centred at `x`. */
export const nextGateIndex = (course: Course, x: number, from = 0): number => {
  const gates = course.gates;
  let i = Math.max(0, from);
  while (i < gates.length && x - RADIUS > gates[i]!.x + gates[i]!.w) i++;
  return i;
};
