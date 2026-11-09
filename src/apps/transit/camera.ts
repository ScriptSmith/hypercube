/**
 * Who controls the camera and when. Pure logic on local ms; `map.ts` carries out its commands.
 *
 * - Tour: a slow flight to the next preset view every `tour` seconds (or a fixed view).
 * - Follow: track one vehicle for FOLLOW_MS, then fly back to the tour. Visitors start follows
 *   with route buttons; a screen starts its own now and then.
 * - Look: show a whole line (when none of its vehicles is running) for FOLLOW_MS, then back.
 * - Manual: a visitor dragged or zoomed the map. It stays where they left it until MANUAL_MS after
 *   their last touch, then flies back to the tour.
 * Back-to-back follows and looks count as one stretch, and no stretch may last more than HOG_MS,
 * so nobody can hold the camera with buttons.
 */
import { TOUR, type ViewId } from "./views";

export const FOLLOW_MS = 30_000;
export const HOG_MS = 60_000;
/** A follow starting this soon after the last one ended continues its stretch. */
export const STRETCH_GAP_MS = 20_000;
export const FLY_MS = 9000;
export const RETURN_MS = 4500;
/** A screen follows a random vehicle after this many tour views. */
export const RANDOM_EVERY = 3;
/** A map a visitor moved stays put this long after their last touch. */
export const MANUAL_MS = 30_000;

export type CameraCommand =
  | { kind: "view"; view: ViewId; duration: number }
  | { kind: "follow"; key: number };

export type CameraMode = "tour" | "follow" | "look" | "manual";

export interface DirectorOptions {
  /** Seconds per view. */
  tour: number;
  /** A fixed view, or null to tour. */
  fixed: ViewId | null;
  /** Follow random vehicles now and then (screens). */
  random: boolean;
}

export interface Director {
  /** Advance; returns a command when the camera should change. */
  tick(
    now: number,
    alive: (key: number) => boolean,
    pickRandom: () => number | null,
  ): CameraCommand | null;
  /** Follow a vehicle. False (and no change) when the stretch has run too long. */
  follow(key: number, now: number): boolean;
  /** Hold the camera on something the caller shows (a line). False as for `follow`. */
  look(now: number): boolean;
  /** A visitor moved the map: hold it there (ending any follow) until MANUAL_MS from now. */
  manual(now: number): void;
  /** Back to the tour now. */
  release(now: number): CameraCommand;
  readonly mode: CameraMode;
  readonly view: ViewId;
  readonly following: number | null;
  readonly followUntil: number;
  /** Shorter timings for tests (`debug=1`). */
  setTiming(timing: { follow?: number; tour?: number; manual?: number }, now: number): void;
}

export const createDirector = (opts: DirectorOptions, now: number): Director => {
  let mode: CameraMode = "tour";
  let step = 0;
  let view: ViewId = opts.fixed ?? TOUR[0]!;
  let nextViewAt = now + opts.tour * 1000;
  let following: number | null = null;
  let followUntil = 0;
  let stretchStart = Number.NEGATIVE_INFINITY;
  let lastEnd = Number.NEGATIVE_INFINITY;
  let toursSinceRandom = 0;
  let manualUntil = 0;
  let manualMs = MANUAL_MS;
  let followMs = FOLLOW_MS;
  let tourMs = opts.tour * 1000;

  const hold = (next: "follow" | "look", key: number | null, t: number): boolean => {
    if ((mode === "tour" || mode === "manual") && t - lastEnd > STRETCH_GAP_MS) stretchStart = t;
    if (t - stretchStart >= HOG_MS) return false;
    mode = next;
    following = key;
    followUntil = Math.min(t + followMs, stretchStart + HOG_MS);
    return true;
  };
  const follow = (key: number, t: number) => hold("follow", key, t);

  const back = (t: number): CameraCommand => {
    // Only follows and looks make a stretch; the end of a visitor's own moves doesn't.
    if (mode === "follow" || mode === "look") lastEnd = t;
    mode = "tour";
    following = null;
    nextViewAt = t + tourMs;
    return { kind: "view", view, duration: RETURN_MS };
  };

  return {
    tick(t, alive, pickRandom) {
      if (mode === "follow") {
        if (t >= followUntil || following === null || !alive(following)) return back(t);
        return null;
      }
      if (mode === "look") return t >= followUntil ? back(t) : null;
      if (mode === "manual") return t >= manualUntil ? back(t) : null;
      if (t < nextViewAt) return null;
      nextViewAt = t + tourMs;
      toursSinceRandom++;
      if (opts.random && toursSinceRandom > RANDOM_EVERY) {
        const key = pickRandom();
        if (key !== null && follow(key, t)) {
          toursSinceRandom = 0;
          return { kind: "follow", key };
        }
      }
      if (opts.fixed) return null;
      step = (step + 1) % TOUR.length;
      view = TOUR[step]!;
      return { kind: "view", view, duration: FLY_MS };
    },
    follow,
    look: (t) => hold("look", null, t),
    manual(t) {
      if (mode === "follow" || mode === "look") lastEnd = t;
      mode = "manual";
      following = null;
      manualUntil = t + manualMs;
    },
    release(t) {
      return back(t);
    },
    get mode() {
      return mode;
    },
    get view() {
      return view;
    },
    get following() {
      return following;
    },
    get followUntil() {
      return followUntil;
    },
    setTiming(timing, t) {
      if (timing.follow !== undefined) followMs = timing.follow;
      if (timing.manual !== undefined) manualMs = timing.manual;
      if (timing.tour !== undefined) {
        tourMs = timing.tour;
        nextViewAt = Math.min(nextViewAt, t + tourMs);
      }
    },
  };
};
