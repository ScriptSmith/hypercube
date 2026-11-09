/**
 * Ghost runs for the solo panel. The panel records its own glider's run as at most MAX_SAMPLES
 * positions at a fixed interval, and keeps only the best run on the current course: the fastest
 * finish, or failing that the furthest distance. A new course discards it.
 */
export const MAX_SAMPLES = 900;

export interface Run {
  label: string;
  /** Race ms at the finish, or null. */
  fin: number | null;
  d: number;
  /** Ms between samples. */
  interval: number;
  xs: Float32Array;
  ys: Float32Array;
  n: number;
}

const better = (a: Run, b: Run | null) => {
  if (!b) return true;
  if (a.fin !== null && b.fin !== null) return a.fin < b.fin;
  if (a.fin !== null || b.fin !== null) return a.fin !== null;
  return a.d > b.d;
};

export interface Ghosts {
  /** Begin recording a run on `label` lasting at most `raceMs`. */
  start(label: string, raceMs: number): void;
  /** Record the glider at race ms `t`; samples come at most once per interval. */
  sample(t: number, x: number, y: number): void;
  /** End the recording; it becomes the ghost if it beats the best run on its course. */
  finish(fin: number | null, d: number): void;
  /** Drop the recording in progress (the station changed hands mid-race). */
  abandon(): void;
  best(label: string): Run | null;
}

export const createGhosts = (): Ghosts => {
  let best: Run | null = null;
  let rec: Run | null = null;
  // Two buffers, swapped, so recording never allocates.
  const spare = { xs: new Float32Array(MAX_SAMPLES), ys: new Float32Array(MAX_SAMPLES) };
  const other = { xs: new Float32Array(MAX_SAMPLES), ys: new Float32Array(MAX_SAMPLES) };

  return {
    start(label, raceMs) {
      if (best && best.label !== label) best = null;
      const buf = best && best.xs === spare.xs ? other : spare;
      rec = {
        label,
        fin: null,
        d: 0,
        interval: Math.max(1, Math.ceil(raceMs / MAX_SAMPLES)),
        xs: buf.xs,
        ys: buf.ys,
        n: 0,
      };
    },
    sample(t, x, y) {
      if (!rec || rec.n >= MAX_SAMPLES || t < rec.n * rec.interval) return;
      rec.xs[rec.n] = x;
      rec.ys[rec.n] = y;
      rec.n++;
    },
    finish(fin, d) {
      if (!rec) return;
      rec.fin = fin;
      rec.d = d;
      if (rec.n > 1 && better(rec, best && best.label === rec.label ? best : null)) best = rec;
      rec = null;
    },
    abandon() {
      rec = null;
    },
    best(label) {
      return best && best.label === label ? best : null;
    },
  };
};

/** Where the ghost is at race ms `t`, or its last position after its run ends. */
export const ghostAt = (run: Run, t: number): { x: number; y: number; done: boolean } => {
  if (run.n === 0) return { x: 0, y: 0, done: true };
  const f = Math.max(0, t) / run.interval;
  const i = Math.floor(f);
  if (i >= run.n - 1) return { x: run.xs[run.n - 1]!, y: run.ys[run.n - 1]!, done: true };
  const a = f - i;
  return {
    x: run.xs[i]! + (run.xs[i + 1]! - run.xs[i]!) * a,
    y: run.ys[i]! + (run.ys[i + 1]! - run.ys[i]!) * a,
    done: false,
  };
};
