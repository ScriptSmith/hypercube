/**
 * Match rules for one table: phases, the score and the clock. Times are ms on the shared clock
 * (`ctx.clock.now()`), so two frames in versus agree on when a match starts and ends.
 *
 * The score is kept as two tallies: goals this frame recorded and goals the other frame
 * recorded (versus). Each frame only ever raises its own tally and takes the other's as the
 * larger of what it has and what arrives, so both frames converge on the same score whatever
 * order messages come in.
 */
import type { Side } from "./config";

export type Phase = "attract" | "countdown" | "play" | "over";

export interface MatchState {
  phase: Phase;
  /** Identifies one match across frames; empty in attract. */
  id: string;
  /** When the current phase began. */
  since: number;
  /** When play begins (the end of the countdown) and when it runs out of time. */
  startAt: number;
  endAt: number;
  /** Goals recorded on this frame, by scoring side. */
  mine: [number, number];
  /** Goals recorded on the other frame, by scoring side. */
  theirs: [number, number];
  /** Set when the match is over: the winning side, or -1 for a draw. */
  winner: Side | -1 | null;
}

export const createMatch = (): MatchState => ({
  phase: "attract",
  id: "",
  since: 0,
  startAt: 0,
  endAt: 0,
  mine: [0, 0],
  theirs: [0, 0],
  winner: null,
});

export const scoreOf = (m: MatchState): [number, number] => [
  m.mine[0] + m.theirs[0],
  m.mine[1] + m.theirs[1],
];

export const toAttract = (m: MatchState, now: number): void => {
  m.phase = "attract";
  m.id = "";
  m.since = now;
  m.startAt = 0;
  m.endAt = 0;
  m.mine = [0, 0];
  m.theirs = [0, 0];
  m.winner = null;
};

export const toCountdown = (
  m: MatchState,
  now: number,
  id: string,
  startAt: number,
  matchMs: number,
): void => {
  toAttract(m, now);
  m.phase = "countdown";
  m.id = id;
  m.startAt = startAt;
  m.endAt = startAt + matchMs;
};

export const toPlay = (m: MatchState, now: number): void => {
  if (m.phase !== "countdown") return;
  m.phase = "play";
  m.since = now;
};

export const recordGoal = (m: MatchState, scorer: Side): void => {
  if (m.phase !== "play") return;
  m.mine[scorer]++;
};

/** Take the other frame's tally; tallies only grow, so keep the larger of each. */
export const mergeTheirs = (m: MatchState, theirs: readonly [number, number]): void => {
  m.theirs = [Math.max(m.theirs[0], theirs[0]), Math.max(m.theirs[1], theirs[1])];
};

/** The result if the match should end now: a side reached the target or time ran out. */
export const judge = (m: MatchState, now: number, target: number): Side | -1 | null => {
  if (m.phase !== "play") return null;
  const [a, b] = scoreOf(m);
  if (a >= target || b >= target || now >= m.endAt) return a > b ? 0 : b > a ? 1 : -1;
  return null;
};

export const toOver = (m: MatchState, now: number, winner: Side | -1): void => {
  m.phase = "over";
  m.since = now;
  m.winner = winner;
};

/** Seconds of play left, for the timer. */
export const timeLeft = (m: MatchState, now: number): number =>
  m.phase === "play"
    ? Math.max(0, (m.endAt - now) / 1000)
    : m.phase === "countdown"
      ? (m.endAt - m.startAt) / 1000
      : 0;
