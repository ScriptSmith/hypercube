/**
 * The race cadence on the shared clock. Race `k` counts down from `k * period`, races for up to
 * the race length, then shows results until race `k + 1` counts down. Frames whose clocks agree
 * run the same races at the same moments without any messages. The clock never runs backwards,
 * but it can jump forward after a hub change; callers treat a jump into a later race, or past
 * this race's end, as the end of the race.
 */
import { COUNTDOWN_MS, type FlapConfig, periodMs, RESULTS_MS } from "./config";

export type Phase = "countdown" | "racing" | "results";

export interface RaceTime {
  k: number;
  phase: Phase;
  /** Clock ms of this race's countdown, its start, the end of racing and the next countdown. */
  at: number;
  start: number;
  end: number;
  next: number;
  /** Ms since the start (negative during the countdown). */
  t: number;
}

/** How long the solo panel keeps one course, so its ghost has something to race on. */
export const SOLO_COURSE_MS = 10 * 60_000;

export const raceAt = (now: number, cfg: Pick<FlapConfig, "race">): RaceTime => {
  const period = periodMs(cfg);
  const k = Math.floor(now / period);
  const at = k * period;
  const start = at + COUNTDOWN_MS;
  const end = start + cfg.race * 1000;
  const next = at + period;
  const phase: Phase = now < start ? "countdown" : now < end ? "racing" : "results";
  return { k, phase, at, start, end, next, t: now - start };
};

/** The course label for a race: per race in a bank, per ten minutes on a solo panel. */
export const courseLabel = (race: RaceTime, solo: boolean): string =>
  solo ? `solo-${Math.floor(race.at / SOLO_COURSE_MS)}` : `race-${race.k}`;

/** Seconds of countdown left, rounded up (5, 4, 3, 2, 1), or 0 outside the countdown. */
export const countdownLeft = (race: RaceTime, now: number): number =>
  race.phase === "countdown" ? Math.max(1, Math.ceil((race.start - now) / 1000)) : 0;

export { COUNTDOWN_MS, RESULTS_MS };
