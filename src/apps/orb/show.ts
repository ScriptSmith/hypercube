/**
 * The show: smoke all the time, and now and then a vision that clears in the middle of the orb,
 * holds a while, and sinks back into the mist. Visions are planned one ahead from a seeded
 * stream, so a page shows the same visions for the same seed. Times are seconds since mount and
 * only go forwards. Nothing here draws, so tests can check it.
 */
import type { Rng } from "../../core/types";

export type SceneId = "ship" | "peaks" | "forest" | "city" | "desert" | "whale" | "lighthouse";
export const SCENES: readonly SceneId[] = [
  "ship",
  "peaks",
  "forest",
  "city",
  "desert",
  "whale",
  "lighthouse",
];

export type Pace = "often" | "rarely";

/** Seconds from one vision starting to the next one starting. */
export const SPACING: Record<Pace, readonly [number, number]> = {
  often: [40, 90],
  rarely: [120, 240],
};
/** Seconds the smoke takes to part, and to close over the vision again. */
export const OPEN_S = 5;
export const CLOSE_S = 6;
/** Seconds a vision holds clear. */
export const HOLD_S: readonly [number, number] = [10, 20];
/** At least this long with smoke alone between two visions. */
export const MIN_GAP_S = 15;
/** The first vision starts this soon after the page loads, so a preview or thumbnail shows one. */
export const FIRST_AT_S = 1;

export interface Vision {
  /** Counts up from 0 for each vision the page plans. */
  index: number;
  scene: SceneId;
  /** When the smoke starts to part. */
  start: number;
  open: number;
  hold: number;
  close: number;
  /** When the smoke has closed again. */
  end: number;
  /** In [0, 1), for small differences between showings of the same scene. */
  seed: number;
}

/** How far through its opening and closing a vision is at `t`: 0 shut, 1 clear. Linear. */
export const openness = (v: Vision, t: number): number => {
  const a = t - v.start;
  if (a <= 0 || t >= v.end) return 0;
  if (a < v.open) return a / v.open;
  const c = a - v.open - v.hold;
  if (c <= 0) return 1;
  return Math.max(0, 1 - c / v.close);
};

const smooth = (e0: number, e1: number, x: number): number => {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
};

/**
 * How far the smoke has parted. It leads the vision on the way in and closes last on the way
 * out, so the scene always seems to lie behind the mist.
 */
export const parting = (open: number): number => smooth(0, 0.75, open);

/** How clearly the vision shows. */
export const reveal = (open: number): number => smooth(0.25, 1, open);

export interface Show {
  /** The vision playing at `t` (from the start of its parting to the end of its closing), or null. */
  at(t: number): Vision | null;
  /** The next vision to start after `t`. */
  next(t: number): Vision;
  /**
   * Start a vision at `t` if none is playing: `scene`, or the one due next. Returns it, or
   * null when one is already playing.
   */
  force(t: number, scene?: SceneId): Vision | null;
  /** Visions held in memory, for tests. */
  readonly kept: number;
}

const shuffled = <T>(rng: Rng, items: readonly T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

export const createShow = (rng: Rng, pace: Pace): Show => {
  // Every scene once in a shuffled round, and a new round never starts with the one just shown.
  let bag: SceneId[] = [];
  let last: SceneId | null = null;
  let index = 0;

  const draw = (): SceneId => {
    if (bag.length === 0) {
      bag = shuffled(rng, SCENES);
      if (bag[0] === last && bag.length > 1) {
        const j = 1 + rng.int(bag.length - 1);
        [bag[0], bag[j]] = [bag[j]!, bag[0]!];
      }
    }
    const scene = bag.shift()!;
    last = scene;
    return scene;
  };

  const make = (start: number, scene: SceneId, at = index++): Vision => {
    const hold = rng.range(HOLD_S[0], HOLD_S[1]);
    return {
      index: at,
      scene,
      start,
      open: OPEN_S,
      hold,
      close: CLOSE_S,
      end: start + OPEN_S + hold + CLOSE_S,
      seed: rng.next(),
    };
  };

  // The vision playing or just played, and the next one; never more.
  const plan: Vision[] = [make(FIRST_AT_S, draw())];

  const after = (prev: Vision): number => {
    const gap = rng.range(SPACING[pace][0], SPACING[pace][1]);
    return Math.max(prev.start + gap, prev.end + MIN_GAP_S);
  };

  const ensure = (t: number) => {
    while (plan[plan.length - 1]!.start <= t) {
      const prev = plan[plan.length - 1]!;
      plan.push(make(after(prev), draw()));
      if (plan.length > 2) plan.shift();
    }
  };

  const at = (t: number): Vision | null => {
    ensure(t);
    for (const v of plan) if (t >= v.start && t < v.end) return v;
    return null;
  };

  return {
    at,
    next(t) {
      ensure(t);
      return plan[plan.length - 1]!;
    },
    force(t, scene) {
      if (at(t)) return null;
      const due = plan.pop()!;
      const chosen = scene ?? due.scene;
      if (chosen !== due.scene) {
        // The scene it replaces comes next instead, and the chosen one isn't shown again this round.
        bag = [due.scene, ...bag.filter((s) => s !== chosen)];
      }
      last = chosen;
      const v = make(t, chosen, due.index);
      plan.push(v);
      ensure(t);
      return v;
    },
    get kept() {
      return plan.length;
    },
  };
};
