/**
 * Defence targets. Each wave puts a few targets high on the rink. A puck that strikes a target
 * lights it for a while; when every target in the wave is lit at once, the team has cleared
 * the wave and, after a short pause, a bigger one appears. Pure, so it can be tested.
 */
import type { Rng } from "../../core/types";
import type { DefenceSpec } from "./layout";
import type { Obstacle } from "./physics";

export interface Target extends Obstacle {
  /** Clock ms until which it stays lit; lit while greater than now. */
  litUntil: number;
}

export interface Waves {
  /** Waves cleared so far. */
  cleared: number;
  /** The current wave's targets; empty in the pause between waves. */
  targets: Target[];
  /** Clock ms when the next wave appears, or Infinity while one is up. */
  nextAt: number;
  /** Clock ms when the last wave was cleared, for the celebration. */
  clearedAt: number;
  /** Clock ms when the current wave appeared. */
  shownAt: number;
  /**
   * Multiplier on how long targets stay lit. A wave cleared quickly shortens it, a slow one
   * lengthens it, so every rink and every team gets a fair challenge.
   */
  pace: number;
}

/** Pause between a cleared wave and the next. */
export const WAVE_GAP_MS = 1400;
/** Waves cleared faster than this get harder; slower than SLOW_WAVE_MS, easier. */
export const FAST_WAVE_MS = 15_000;
export const SLOW_WAVE_MS = 40_000;
const PACE_MIN = 0.35;
const PACE_MAX = 2;

const zoneArea = (spec: DefenceSpec) =>
  Math.max(0, spec.targets.x1 - spec.targets.x0) * Math.max(0, spec.targets.y1 - spec.targets.y0);

/** Targets in a wave: three, then one more each wave, up to as many as the zone holds well. */
export const targetCount = (wave: number, spec: DefenceSpec): number => {
  const fits = Math.round(zoneArea(spec) / (spec.targetR * spec.targetR * 40));
  return Math.min(3 + wave, Math.max(3, Math.min(7, fits)));
};

/**
 * How long a struck target stays lit: shorter in later waves, so they need quicker teamwork,
 * and longer on big rinks, where pucks take longer to get round.
 */
export const litMs = (wave: number, spec: DefenceSpec, pace = 1): number => {
  const size = Math.min(2.5, Math.max(0.7, Math.sqrt(zoneArea(spec) / 900_000)));
  return Math.max(2600, 5000 - wave * 450) * size * pace;
};

export const createWaves = (): Waves => ({
  cleared: 0,
  targets: [],
  nextAt: 0,
  clearedAt: -Infinity,
  shownAt: 0,
  pace: 1,
});

export const resetWaves = (w: Waves, now: number): void => {
  w.cleared = 0;
  w.targets = [];
  w.nextAt = now;
  w.clearedAt = -Infinity;
  w.pace = 1;
};

/**
 * Up to `n` targets inside the spec's zone, apart from each other, the splitters and the
 * counter. When the zone is too crowded for all of them the wave is a little smaller.
 */
export const placeTargets = (spec: DefenceSpec, n: number, rng: Rng): Target[] => {
  const { targets: zone, targetR: r } = spec;
  const out: Target[] = [];
  const clear = (x: number, y: number) =>
    out.every((t) => Math.hypot(t.x - x, t.y - y) > r * 2.8) &&
    spec.splitters.every((s) => Math.hypot(s.x - x, s.y - y) > s.r + r * 2.5) &&
    spec.keepOut.every((b) => x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r);
  const x0 = zone.x0 + r;
  const x1 = Math.max(x0, zone.x1 - r);
  const y0 = zone.y0 + r;
  const y1 = Math.max(y0, zone.y1 - r);
  for (let i = 0; i < n; i++) {
    let spot: { x: number; y: number } | null = null;
    for (let attempt = 0; attempt < 60 && !spot; attempt++) {
      const x = rng.range(x0, x1);
      const y = rng.range(y0, y1);
      if (clear(x, y)) spot = { x, y };
    }
    // Random tries failed: take the first clear point on a grid, starting at a random column.
    const cols = Math.max(1, Math.floor((y1 - y0) / r));
    const rows = Math.max(1, Math.floor((x1 - x0) / r));
    const start = rng.int(cols);
    for (let c = 0; c < cols && !spot; c++) {
      const y = y0 + (((c + start) % cols) + 0.5) * ((y1 - y0) / cols);
      for (let row = 0; row < rows && !spot; row++) {
        const x = x0 + (row + 0.5) * ((x1 - x0) / rows);
        if (clear(x, y)) spot = { x, y };
      }
    }
    if (!spot) break;
    out.push({ id: i, x: spot.x, y: spot.y, r, litUntil: -Infinity });
  }
  return out;
};

/** Put up the next wave when its pause is over. Returns true when a wave appeared. */
export const stepWaves = (w: Waves, spec: DefenceSpec, now: number, rng: Rng): boolean => {
  if (w.targets.length > 0 || now < w.nextAt) return false;
  w.targets = placeTargets(spec, targetCount(w.cleared, spec), rng);
  w.nextAt = Infinity;
  w.shownAt = now;
  return true;
};

/** Light a struck target. Returns true when that cleared the wave. */
export const hitTarget = (w: Waves, spec: DefenceSpec, id: number, now: number): boolean => {
  const t = w.targets.find((x) => x.id === id);
  if (!t) return false;
  t.litUntil = now + litMs(w.cleared, spec, w.pace);
  if (!w.targets.every((x) => x.litUntil > now)) return false;
  const took = now - w.shownAt;
  if (took < FAST_WAVE_MS) w.pace = Math.max(PACE_MIN, w.pace * 0.8);
  else if (took > SLOW_WAVE_MS) w.pace = Math.min(PACE_MAX, w.pace * 1.25);
  w.cleared++;
  w.clearedAt = now;
  w.targets = [];
  w.nextAt = now + WAVE_GAP_MS;
  return true;
};

/** Move targets with the rink when it is refitted to a new size. */
export const rescaleWaves = (w: Waves, sx: number, sy: number): void => {
  for (const t of w.targets) {
    t.x *= sx;
    t.y *= sy;
  }
};
