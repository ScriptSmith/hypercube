/**
 * Ghost tracks: a run's pose sampled at a fixed rate into a preallocated buffer, so a crew's
 * ghosts never grow however long a run lasts. Pure.
 */
import { GHOST_HZ, GHOST_MAX_S } from "./config";

/** Samples one track can hold: 90 s at 15 Hz. */
export const GHOST_CAP = GHOST_HZ * GHOST_MAX_S;
const STRIDE = 4;

/** Engine flags stored with each sample, for drawing the ghost's flames. */
export const FLAG = {
  left: 1,
  right: 2,
  main: 4,
  turnLeft: 8,
  turnRight: 16,
} as const;

export interface GhostTrack {
  readonly data: Float32Array;
  /** Samples recorded. */
  n: number;
  /** How the run ended: 0 still running or bumped, else the landing's stars. */
  stars: number;
}

export interface Pose {
  x: number;
  y: number;
  a: number;
  flags: number;
}

export const createTrack = (): GhostTrack => ({
  data: new Float32Array(GHOST_CAP * STRIDE),
  n: 0,
  stars: 0,
});

export const clearTrack = (t: GhostTrack): void => {
  t.n = 0;
  t.stars = 0;
};

export const copyTrack = (from: GhostTrack, to: GhostTrack): void => {
  to.data.set(from.data.subarray(0, from.n * STRIDE));
  to.n = from.n;
  to.stars = from.stars;
};

/**
 * Record the pose at run time `t` (seconds) if a sample is due. Returns false once the track is
 * full; later poses are dropped.
 */
export const record = (
  track: GhostTrack,
  t: number,
  x: number,
  y: number,
  a: number,
  flags: number,
): boolean => {
  if (track.n >= GHOST_CAP) return false;
  if (t < track.n / GHOST_HZ) return true;
  const i = track.n * STRIDE;
  track.data[i] = x;
  track.data[i + 1] = y;
  track.data[i + 2] = a;
  track.data[i + 3] = flags;
  track.n++;
  return true;
};

/**
 * The pose at run time `t`, interpolated between samples, or the last pose once the track has
 * ended. Returns false for an empty track.
 */
export const poseAt = (track: GhostTrack, t: number, out: Pose): boolean => {
  if (track.n === 0) return false;
  const f = Math.max(0, t * GHOST_HZ);
  const i = Math.min(track.n - 1, Math.floor(f));
  const j = Math.min(track.n - 1, i + 1);
  const k = j > i ? f - i : 0;
  const d = track.data;
  const a = i * STRIDE;
  const b = j * STRIDE;
  out.x = d[a]! + (d[b]! - d[a]!) * k;
  out.y = d[a + 1]! + (d[b + 1]! - d[a + 1]!) * k;
  out.a = d[a + 2]! + (d[b + 2]! - d[a + 2]!) * k;
  out.flags = d[a + 3]!;
  return true;
};

/** Seconds of run the track covers. */
export const trackSeconds = (track: GhostTrack): number => track.n / GHOST_HZ;
