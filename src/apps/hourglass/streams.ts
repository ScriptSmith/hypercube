/**
 * The fine streams of sand that run down the inside of the glass below the collar, and the small
 * mounds where they land. Everything is a function of the time asked about, so the picture is the
 * same after a reload and a test can look at any moment.
 */
import { type Phase, TURN_MS } from "./time";

export const STREAMS = 5;

/** In the last minute the streams stop one by one, this long apart, seconds. */
export const STOP_GAP_S = 60 / STREAMS;
/** A stream thins over this long before it stops, seconds. */
const THIN_S = 9;
/** How fast the sand runs down the glass, radians of arc a second. */
export const RUN_SPEED = 0.45;
/** The last stream's tail is followed down the glass for this long after the run, seconds. */
const TAIL_S = 5;
/** The mounds take this long to settle flat once the sand stops, seconds. */
export const SETTLE_S = 8;
/** Arc that means "all the way down". */
const FAR = 10;

interface Habit {
  /** Longitude it leaves the collar at, radians: unevenly spaced round the ball. */
  home: number;
  /** Periods of its two slow sways, seconds, and their phases. */
  sway: readonly [number, number];
  phase: readonly [number, number];
  /** Its place in the order they stop: 0 is the last to stop. */
  rank: number;
  /** How long its mound takes to build before it slips, seconds. */
  slip: number;
}

const HABITS: readonly Habit[] = [
  { home: 0.35, sway: [97, 37], phase: [0.4, 2.1], rank: 2, slip: 17 },
  { home: 1.52, sway: [131, 41], phase: [3.3, 0.7], rank: 0, slip: 23 },
  { home: 2.95, sway: [113, 29], phase: [1.9, 4.4], rank: 4, slip: 13 },
  { home: 4.2, sway: [149, 47], phase: [5.2, 1.3], rank: 1, slip: 29 },
  { home: 5.45, sway: [103, 43], phase: [2.6, 3.8], rank: 3, slip: 19 },
];

export interface Stream {
  /** Longitude where it leaves the collar, radians. */
  lon: number;
  /** How full it runs, 0 to 1. A stopped stream is 0. */
  strength: number;
  /** It is drawn from `tail` to `head`, arc below the collar's edge in radians. */
  head: number;
  tail: number;
  /** Its mound on the heap: height as a share of full, and how far it has slumped (0 to 1). */
  mound: number;
  slump: number;
}

const TAU = Math.PI * 2;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t: number): number => t * t * (3 - 2 * t);

/** Seconds before the end of the run at which stream `i` stops. */
export const stopsBefore = (i: number): number => HABITS[i]!.rank * STOP_GAP_S;

export const streamsAt = (now: number, phase: Phase): Stream[] => {
  const sinceEnd = (now - phase.endMs) / 1000;
  // At rest the mounds lie as the run left them.
  const frozen = !phase.running;
  const at = (frozen ? phase.endMs : now) / 1000;
  const sinceFlow = (now - phase.startMs - TURN_MS) / 1000;
  const remaining = -sinceEnd;
  const flowing = phase.running ? phase.turn >= 1 : sinceEnd < TAIL_S;
  return HABITS.map((h, i) => {
    const lon =
      h.home +
      0.11 * Math.sin((TAU * at) / h.sway[0] + h.phase[0]) +
      0.05 * Math.sin((TAU * at) / h.sway[1] + h.phase[1]);
    // A mound builds until it is too steep, then slips and spreads.
    const cycle = at / h.slip + h.phase[1];
    const p = cycle - Math.floor(cycle);
    const slump = p < 0.05 ? ease(p / 0.05) : 1 - (p - 0.05) / 0.95;
    // Once the sand stops, the mounds settle into a level heap, so nothing is left to jump
    // when the glass next turns.
    const settled = frozen ? ease(clamp01(sinceEnd / SETTLE_S)) : phase.turn < 1 ? 1 : 0;
    const mound = (1 - 0.45 * slump) * (1 - settled);
    if (!flowing) return { lon, strength: 0, head: 0, tail: 0, mound, slump };
    const stop = stopsBefore(i);
    const strength = ease(clamp01((remaining - stop) / THIN_S));
    const tail = Math.max(0, stop - remaining) * RUN_SPEED;
    // They start a moment apart, the last to stop first.
    const head = phase.running ? Math.max(0, sinceFlow - h.rank * 0.3) * RUN_SPEED : FAR;
    return { lon, strength, head: Math.min(FAR, head), tail, mound, slump };
  });
};

/** How many streams are still fed from above. */
export const flowingCount = (streams: readonly Stream[]): number =>
  streams.filter((s) => s.strength > 0).length;
