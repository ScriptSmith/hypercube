/**
 * When the sand runs. Two times of day: the glass is turned at `start` and the sand runs out at
 * `end`. From one to the other it runs; from `end` to the next `start` the piece rests with all
 * its sand below. Everything is worked out from the instant asked about, so a reload at any
 * moment lands on the same picture.
 */
import type { OptionValues } from "../../core/types";

/** A local calendar, so tests can use a zone with daylight saving. */
export interface Calendar {
  /** The local date an instant falls on. */
  dayOf(ms: number): { year: number; month: number; day: number };
  /** The instant of a local time of day. `day` may run past either end of the month. */
  at(year: number, month: number, day: number, minutes: number): number;
}

/** The display's own time zone. */
export const LOCAL: Calendar = {
  dayOf(ms) {
    const d = new Date(ms);
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
  },
  at: (year, month, day, minutes) =>
    new Date(year, month, day, Math.floor(minutes / 60), minutes % 60, 0, 0).getTime(),
};

/** Minutes after local midnight. */
export interface Schedule {
  start: number;
  end: number;
}

/** How long the glass takes to turn over at the start of a run, ms. */
export const TURN_MS = 6000;
/** With the same start and end time the sand runs nearly all day, and rests this long, ms. */
export const SAME_TIME_REST_MS = 5 * 60_000;
/** A clock change can leave the end before the start; a run is never shorter than this, ms. */
export const SHORTEST_RUN_MS = 60_000;

export interface Phase {
  /** Sand is running, or the glass is turning to start it. */
  running: boolean;
  /** The run in progress, or the last one while resting. */
  startMs: number;
  endMs: number;
  /** When the glass is next turned. */
  nextStartMs: number;
  /** How far through turning over the glass is, 0 to 1; 1 whenever it isn't turning. */
  turn: number;
  /** The fraction of the sand still above the collar, 1 to 0. */
  left: number;
  /** Until the sand runs out, ms; 0 while resting. */
  remainingMs: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const whole = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

export const scheduleOf = (o: OptionValues): Schedule => ({
  start: whole(o.starthour, 0, 23, 9) * 60 + whole(o.startminute, 0, 59, 0),
  end: whole(o.endhour, 0, 23, 17) * 60 + whole(o.endminute, 0, 59, 0),
});

/** The run that starts on the local day `offset` days from `now`'s. */
const runOn = (now: number, offset: number, s: Schedule, cal: Calendar) => {
  const { year, month, day } = cal.dayOf(now);
  const same = s.start === s.end;
  const startMs = cal.at(year, month, day + offset, s.start) + (same ? SAME_TIME_REST_MS : 0);
  const endDay = day + offset + (s.end > s.start ? 0 : 1);
  const endMs = Math.max(cal.at(year, month, endDay, s.end), startMs + SHORTEST_RUN_MS);
  return { startMs, endMs };
};

export const phaseAt = (now: number, s: Schedule, cal: Calendar = LOCAL): Phase => {
  // The latest run that has started. Two days back covers a start pushed late by a clock change.
  let run = runOn(now, -2, s, cal);
  let next = runOn(now, -1, s, cal);
  for (let offset = -1; offset <= 1; offset++) {
    const candidate = runOn(now, offset, s, cal);
    if (candidate.startMs <= now) {
      run = candidate;
      next = runOn(now, offset + 1, s, cal);
    }
  }
  const { startMs, endMs } = run;
  const running = now >= startMs && now < endMs;
  if (!running) {
    return {
      running,
      startMs,
      endMs,
      nextStartMs: next.startMs,
      turn: 1,
      left: 0,
      remainingMs: 0,
    };
  }
  // Nothing falls while the glass turns, so the sand has the rest of the run to get through.
  const flowMs = Math.max(1, endMs - startMs - TURN_MS);
  return {
    running,
    startMs,
    endMs,
    nextStartMs: next.startMs,
    turn: clamp01((now - startMs) / TURN_MS),
    left: clamp01((endMs - now) / flowMs),
    remainingMs: endMs - now,
  };
};

/**
 * The time left, as lettering: hours and minutes, then minutes and seconds inside the last hour,
 * then bare seconds inside the last minute. It counts whole seconds still to come, so it reads 1
 * through the last second and never shows zero.
 */
export const countdownText = (remainingMs: number): string => {
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  if (seconds < 60) return String(seconds);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};

/**
 * The widest text `countdownText` gives in the form it has now, so a ring can keep its layout
 * while the digits change.
 */
export const countdownTemplate = (remainingMs: number): string => {
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  if (seconds < 60) return "88";
  if (seconds < 3600) return "88:88";
  return seconds < 36_000 ? "8 h 88 min" : "88 h 88 min";
};

/** How strongly the lettering shows, 0 to 1. */
export interface Ink {
  /** The rings that carry the time left, or the line that takes its place. */
  time: number;
  message: number;
}

const ramp = (t: number, from: number, to: number): number => {
  const x = clamp01((t - from) / (to - from));
  return x * x * (3 - 2 * x);
};

/**
 * Lettering goes just before the glass turns and comes back once it is upright, and the time
 * left gives way to the closing line over a second or so, so nothing flashes at zero.
 */
export const inkAt = (now: number, p: Phase): Ink => {
  if (p.running) {
    const back = ramp(now - p.startMs, TURN_MS, TURN_MS + 1200);
    return { time: back * ramp(p.remainingMs, 0, 500), message: back };
  }
  const still = ramp(p.nextStartMs - now, 0, 800);
  return { time: still * ramp(now - p.endMs, 300, 1500), message: still };
};

/** A time of day as "17:00", for the admin roster. */
export const clockText = (minutes: number): string =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
