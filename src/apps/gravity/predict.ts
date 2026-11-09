/**
 * The ribbon: where a body would go if it were let go now. It copies the universe (the massive
 * bodies, not the particles, which pull on nothing), throws the body into the copy with the same
 * `launch` the real release uses, and runs the same `step`, so while nothing else is thrown the
 * body follows the ribbon step for step, through a world where every star and planet moves.
 */
import {
  bodyEnergy,
  type Body,
  cloneUniverse,
  type Event,
  launch,
  type Launch,
  step,
  type Universe,
} from "./physics";
import type { Box } from "./physics";

export type Stop = "end" | "merge" | "star" | "hole" | "shred" | "shatter" | "gone";

export interface Prediction {
  /** Centres, x and y in turn, one per `every` steps; `n` points are filled. */
  pts: Float32Array;
  n: number;
  stop: Stop;
  /** Where it stopped (or the last point). */
  x: number;
  y: number;
  /** Steps it flew. */
  steps: number;
}

export const createPrediction = (steps: number, every = 3): Prediction => ({
  pts: new Float32Array((Math.ceil(steps / every) + 3) * 2),
  n: 0,
  stop: "end",
  x: 0,
  y: 0,
  steps: 0,
});

/** How the body with this id stopped in these events, if it did. */
export const stopOf = (
  events: readonly Event[],
  id: number,
): { stop: Stop; x: number; y: number } | null => {
  for (const e of events) {
    switch (e.type) {
      case "merge":
        if (e.gone === id) return { stop: "merge", x: e.x, y: e.y };
        break;
      case "swallow":
        if (e.gone === id) return { stop: e.by, x: e.x, y: e.y };
        break;
      case "shred":
        if (e.gone === id) return { stop: "shred", x: e.x, y: e.y };
        break;
      case "shatter":
        if (e.gone.includes(id)) return { stop: "shatter", x: e.x, y: e.y };
        break;
      case "gone":
        if (e.id === id) return { stop: "gone", x: e.x, y: e.y };
        break;
      default:
        break;
    }
  }
  return null;
};

/** Records a path into a Prediction, one point per `every` steps. */
export const recorder = (out: Prediction, every: number) => {
  const cap = out.pts.length >> 1;
  out.n = 0;
  out.stop = "end";
  out.steps = 0;
  let count = 0;
  const put = (x: number, y: number) => {
    out.x = x;
    out.y = y;
    if (out.n >= cap) return;
    out.pts[out.n * 2] = x;
    out.pts[out.n * 2 + 1] = y;
    out.n++;
  };
  return {
    put,
    /** One more step at (x, y): recorded every `every` steps. */
    tick(x: number, y: number) {
      count++;
      out.steps = count;
      if (count % every === 0) put(x, y);
      else {
        out.x = x;
        out.y = y;
      }
    },
    end(stop: Stop, x: number, y: number) {
      out.stop = stop;
      put(x, y);
    },
  };
};

export interface PredictOptions {
  steps: number;
  every?: number;
}

/** Fill `out` with the path of a body thrown now. `u` is not changed. */
export const predict = (
  u: Universe,
  l: Launch,
  opts: PredictOptions,
  out: Prediction = createPrediction(opts.steps, opts.every),
): Prediction => {
  const every = Math.max(1, opts.every ?? 3);
  const w = cloneUniverse(u);
  const b = launch(w, l);
  const rec = recorder(out, every);
  rec.put(b.x, b.y);
  for (let i = 0; i < opts.steps; i++) {
    step(w);
    const s = w.events.length > 0 ? stopOf(w.events, b.id) : null;
    w.events.length = 0;
    if (s) {
      rec.end(s.stop, s.x, s.y);
      return out;
    }
    rec.tick(b.x, b.y);
  }
  return out;
};

const inside = (v: Box, b: Body) => b.x >= v.x0 && b.x <= v.x1 && b.y >= v.y0 && b.y <= v.y1;

/** Whether the body with this id hit anything in these events (as the larger or the smaller). */
const hitAnything = (events: readonly Event[], id: number) =>
  events.some(
    (e) =>
      (e.type === "merge" && (e.into === id || e.gone === id)) ||
      (e.type === "swallow" && e.into === id),
  );

/**
 * How good a throw looks for the ghost and bots: time spent in view, more if it is still bound
 * at the end, less if it hits something and much less if it falls into a star or a black hole.
 * Good throws make orbits and leave a scene as it was.
 */
export const scoreLaunch = (u: Universe, l: Launch, steps: number, view: Box): number => {
  const w = cloneUniverse(u);
  const b = launch(w, l);
  let seen = 0;
  for (let i = 0; i < steps; i++) {
    step(w);
    const s = w.events.length > 0 ? stopOf(w.events, b.id) : null;
    const hit = !s && w.events.length > 0 && hitAnything(w.events, b.id);
    w.events.length = 0;
    if (hit) return seen * 0.6 - steps * 0.2;
    if (s) {
      if (s.stop === "star" || s.stop === "hole") return seen - steps;
      if (s.stop === "merge") return seen * 0.6 - steps * 0.2;
      return seen - steps * 0.6;
    }
    if (inside(view, b)) seen++;
  }
  return seen + (bodyEnergy(w, b) < 0 ? steps * 0.5 : -steps * 0.3);
};
