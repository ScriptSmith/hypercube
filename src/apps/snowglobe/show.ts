/**
 * The show: the globe is shaken every minute or two, and every three or four shakes the scene
 * inside changes while the blizzard is thickest. Everything comes from a seeded stream, so a page
 * plays the same show for the same seed. Times are seconds from the page's start. Nothing here
 * draws, so tests can check it.
 */
import type { Rng } from "../../core/types";

export const SCENES = ["cabin", "lighthouse", "square", "carousel", "snowman", "hut"] as const;
export type SceneId = (typeof SCENES)[number];
export type Mood = "day" | "dusk" | "night";

/** The times of day each scene comes in. */
export const MOODS: Record<SceneId, readonly Mood[]> = {
  cabin: ["dusk", "night"],
  lighthouse: ["night", "dusk"],
  square: ["dusk", "night"],
  carousel: ["night", "dusk"],
  snowman: ["day", "dusk"],
  hut: ["day", "dusk"],
};

export type ShakeSetting = "often" | "rarely";
/** Seconds between shakes. */
export const SHAKE_GAP: Record<ShakeSetting, readonly [number, number]> = {
  often: [60, 120],
  rarely: [180, 300],
};
/** The first shake after the page loads, so anyone opening it sees one soon. */
export const FIRST_SHAKE: readonly [number, number] = [25, 45];
/** A scene (or a fixed scene's time of day) lasts this many shakes. */
export const RUN_SHAKES: readonly [number, number] = [3, 4];
/** Seconds after a jolt when the snow is thickest, and a new scene comes in unseen. */
export const SWAP_AFTER = 1.5;
/** Shakes kept from before now, for the show's state. */
const KEEP_PAST = 2;
/** Shakes planned ahead. */
const PLAN_AHEAD = 3;

export interface Look {
  scene: SceneId;
  mood: Mood;
}

export interface Shake extends Look {
  index: number;
  at: number;
  /** About 1; a change of scene always gets a full shake, so the blizzard hides it. */
  strength: number;
  /** Direction of the jolt round the globe, radians. */
  dir: number;
  /** Which way the swirl goes round. */
  spin: 1 | -1;
  /** The scene and time of day before this shake's swap moment. */
  from: Look;
  /** Whether the scene or its time of day changes at this shake. */
  swap: boolean;
}

export interface ShowOptions {
  /** `changes`, or one scene that stays. */
  scene: SceneId | "changes";
  shake: ShakeSetting;
}

export interface Show {
  /** The scene and time of day in the globe at time `t`. */
  lookAt(t: number): Look;
  /** The latest shake at or before `t`, if any. */
  last(t: number): Shake | null;
  /** The first shake after `t`. */
  next(t: number): Shake;
  /** Shake at `t` instead of waiting; with `scene`, change to it in the blizzard. */
  shakeNow(t: number, scene?: SceneId): Shake;
  /** Shakes held in memory. */
  readonly held: number;
}

const between = (rng: Rng, [lo, hi]: readonly [number, number]): number => rng.range(lo, hi);

export const createShow = (rng: Rng, opts: ShowOptions): Show => {
  const fixed = opts.scene === "changes" ? null : opts.scene;
  // Scenes come from a shuffled bag, so all six show before any comes back.
  let bag: SceneId[] = [];
  const refill = (not: SceneId) => {
    bag = SCENES.filter((s) => s !== not);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [bag[i], bag[j]] = [bag[j]!, bag[i]!];
    }
  };
  const draw = (not: SceneId): SceneId => {
    if (fixed) return fixed;
    if (!bag.some((s) => s !== not)) refill(not);
    const i = bag.findIndex((s) => s !== not);
    return bag.splice(i, 1)[0]!;
  };
  const lastMood = new Map<SceneId, Mood>();
  const moodFor = (scene: SceneId, not?: Mood): Mood => {
    const options = MOODS[scene];
    const avoid = not ?? lastMood.get(scene);
    const pool = options.length > 1 ? options.filter((m) => m !== avoid) : options;
    const m = rng.pick(pool);
    lastMood.set(scene, m);
    return m;
  };

  const startScene = fixed ?? rng.pick(SCENES);
  const start: Look = { scene: startScene, mood: moodFor(startScene) };
  if (!fixed) refill(startScene);
  let current: Look = start;
  let left = Math.round(between(rng, RUN_SHAKES));
  const firstLeft = left;
  let index = 0;
  const shakes: Shake[] = [];
  /** Shakes left in the run after each planned shake, to plan again from any of them. */
  const leftAfter = new Map<Shake, number>();

  const plan = (at: number): Shake => {
    left--;
    const from = current;
    if (left <= 0) {
      const scene = draw(current.scene);
      const mood = scene === current.scene ? moodFor(scene, current.mood) : moodFor(scene);
      current = { scene, mood };
      left = Math.round(between(rng, RUN_SHAKES));
    }
    const swap = current.scene !== from.scene || current.mood !== from.mood;
    const shake: Shake = {
      index: index++,
      at,
      strength: swap ? rng.range(1, 1.15) : rng.range(0.75, 1.15),
      dir: rng.range(0, Math.PI * 2),
      spin: rng.next() < 0.5 ? 1 : -1,
      scene: current.scene,
      mood: current.mood,
      from,
      swap,
    };
    shakes.push(shake);
    leftAfter.set(shake, left);
    return shake;
  };

  const extend = (t: number) => {
    if (shakes.length === 0) plan(between(rng, FIRST_SHAKE));
    let ahead = 0;
    for (const s of shakes) if (s.at > t) ahead++;
    while (ahead < PLAN_AHEAD) {
      plan(shakes[shakes.length - 1]!.at + between(rng, SHAKE_GAP[opts.shake]));
      ahead++;
    }
    let past = 0;
    for (const s of shakes) if (s.at <= t) past++;
    if (past > KEEP_PAST) {
      for (const s of shakes.splice(0, past - KEEP_PAST)) leftAfter.delete(s);
    }
  };

  const last = (t: number): Shake | null => {
    extend(t);
    let found: Shake | null = null;
    for (const s of shakes) if (s.at <= t) found = s;
    return found;
  };

  return {
    lookAt(t) {
      const s = last(t);
      if (!s) return shakes[0]?.from ?? start;
      const look = t >= s.at + SWAP_AFTER ? s : s.from;
      return { scene: look.scene, mood: look.mood };
    },
    last,
    next(t) {
      extend(t);
      return shakes.find((s) => s.at > t)!;
    },
    shakeNow(t, scene) {
      extend(t);
      // Drop the planned shakes and plan again from this one.
      const keep = shakes.filter((s) => s.at < t);
      for (const s of shakes) if (s.at >= t) leftAfter.delete(s);
      const before = keep[keep.length - 1];
      shakes.length = 0;
      shakes.push(...keep);
      index = (before?.index ?? -1) + 1;
      current = before ? { scene: before.scene, mood: before.mood } : start;
      left = before ? (leftAfter.get(before) ?? left) : firstLeft;
      if (scene && !fixed && scene !== current.scene) {
        left = 0;
        bag = [scene, ...bag.filter((s) => s !== scene)];
      }
      const shake = plan(t);
      extend(t);
      return shake;
    },
    get held() {
      return shakes.length;
    },
  };
};
