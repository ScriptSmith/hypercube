/**
 * Attract schedules. Pure functions of time, so frames that share a clock agree without
 * messages.
 *
 * - The relay (a bank, and the wall's columns): each chapter's demo plays in turn along the
 *   poster, TURN_MS each, a pulse of light running along the beam to the chapter whose turn it
 *   is; on a bank the screen's own run follows the last chapter.
 * - The tour (a solo panel, pair half or kiosk): each of the card's chapters in turn, its demo
 *   and then REST_MS at rest; with one chapter, that chapter again and again.
 */
import { REST_MS, SCREEN_RUN_MS, TURN_MS } from "./config";

export interface Turn {
  /** Index into the relay's chapters, or -1 during the screen's run. */
  index: number;
  /** ms into this turn. */
  at: number;
  /** Counts turns since the clock's zero, so each is played once. */
  serial: number;
}

/** The relay's turn at time `t` (ms) for `n` chapters, with or without the screen's run. */
export const relayTurn = (t: number, n: number, screenRun: boolean): Turn => {
  const turns = Math.max(1, n);
  const cycle = turns * TURN_MS + (screenRun ? SCREEN_RUN_MS : 0);
  const k = Math.floor(t / cycle);
  const into = t - k * cycle;
  const i = Math.floor(into / TURN_MS);
  if (i >= turns) return { index: -1, at: into - turns * TURN_MS, serial: k * (turns + 1) + turns };
  return { index: i, at: into - i * TURN_MS, serial: k * (turns + 1) + i };
};

/** How long the beam's pulse takes to reach the chapter whose turn begins, ms. */
export const PULSE_MS = 1800;

/**
 * The pulse's place along the poster, as a fraction from its left end, travelling from the
 * previous turn's chapter to this one's at the start of each turn; null when it isn't running.
 * `centres` are the fractions of each chapter's card centre.
 */
export const pulseAt = (
  turn: Turn,
  centres: readonly number[],
): { f: number; strength: number } | null => {
  if (turn.index < 0 || turn.at > PULSE_MS) return null;
  const to = centres[turn.index] ?? 0;
  const from = turn.index > 0 ? (centres[turn.index - 1] ?? 0) : 0;
  const s = turn.at / PULSE_MS;
  const ease = s * s * (3 - 2 * s);
  return { f: from + (to - from) * ease, strength: Math.sin(Math.PI * Math.min(1, s * 1.1)) };
};

export interface TourStop {
  /** Index into the card's chapters. */
  index: number;
  phase: "demo" | "rest";
  at: number;
  serial: number;
}

/**
 * Where a solo card's tour is `t` ms after it began. Every stop gives its demo `demoMs` and then
 * rests for REST_MS.
 */
export const tourAt = (t: number, n: number, demoMs = TURN_MS): TourStop => {
  const stops = Math.max(1, n);
  const per = demoMs + REST_MS;
  const k = Math.floor(Math.max(0, t) / per);
  const into = Math.max(0, t) - k * per;
  return {
    index: k % stops,
    phase: into < demoMs ? "demo" : "rest",
    at: into < demoMs ? into : into - demoMs,
    serial: k,
  };
};
