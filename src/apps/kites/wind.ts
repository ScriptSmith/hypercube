/**
 * The wind: a pure function of the room's seed, the shared clock and the position along the bank
 * (or the wall, or a lone frame's sky), so every frame computes the same breeze and the same gusts
 * without messages. Positions are fractions `f` across the bank (0 left, 1 right) and heights `h`
 * in sky heights; time is seconds on the shared clock. The result is signed (positive blows to the
 * right) in wind units, where 1 is a breezy day's mean.
 *
 * - The direction drifts on two slow waves and now and then swings over to the other side, taking
 *   about a minute to do so (live wind keeps the direction it was given).
 * - Gusts are bumps that travel downwind across the bank at a steady speed, so one reaches a
 *   panel's kites before the next. Each slot of `every` seconds may hold one, decided by a hash of
 *   the seed and the slot, which is all a frame needs to find the gusts alive at any moment.
 * - Lulls, a little turbulence and more wind higher up make the kites bob.
 */

export interface WindParams {
  /** Mean speed in wind units. */
  mean: number;
  /** Gust strength as a fraction of the mean. */
  gust: number;
  /** Seconds per gust slot, and the chance a slot holds a gust. */
  every: number;
  chance: number;
  /** Turbulence as a fraction of the mean. */
  turb: number;
  /** Fixed direction (+1 or -1) for live wind; 0 lets the synthetic direction drift and swing. */
  dir: number;
}

export type SyntheticWind = "gentle" | "breezy" | "gusty";

export const WIND_PRESETS: Record<SyntheticWind, WindParams> = {
  gentle: { mean: 0.65, gust: 0.35, every: 9, chance: 0.55, turb: 0.06, dir: 0 },
  breezy: { mean: 1, gust: 0.5, every: 6, chance: 0.7, turb: 0.09, dir: 0 },
  gusty: { mean: 1.3, gust: 0.85, every: 3.5, chance: 0.85, turb: 0.15, dir: 0 },
};

/** Bank widths a second that gusts, rings and clouds travel at, per unit of mean wind. */
export const TRAVEL = 0.12;
/** A commanded gust (admin): its start on the shared clock and the way it blows. */
export interface CommandGust {
  t0: number;
  dir: number;
}
const MAX_COMMANDED = 4;
const COMMAND_WIDTH = 0.2;

export interface WindField {
  readonly seed: number;
  params: WindParams;
  /** Commanded gusts, newest last. */
  commanded: CommandGust[];
  /** Phases of the slow waves, from the seed. */
  readonly phase: readonly number[];
}

/** 32-bit integer hash of two numbers. */
export const mix = (a: number, b: number): number => {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
};

/** Uniform in [0, 1) from a hash and a lane. */
export const unit = (h: number, lane: number): number => mix(h, lane + 1) / 4294967296;

export const createWindField = (seed: number, params: WindParams): WindField => ({
  seed: seed >>> 0,
  params,
  commanded: [],
  phase: Array.from({ length: 8 }, (_, i) => unit(seed >>> 0, 100 + i) * Math.PI * 2),
});

const TAU = Math.PI * 2;
/** Periods, in seconds, of the two waves that steer the direction. */
const DIR_P1 = 540;
const DIR_P2 = 211;

/** The wind's direction at shared time `t` (s): -1 to 1, near ±1 except while it swings over. */
export const windDir = (w: WindField, t: number): number => {
  if (w.params.dir !== 0) return Math.sign(w.params.dir);
  const p = w.phase;
  const s = Math.sin((TAU * t) / DIR_P1 + p[0]!) + 0.45 * Math.sin((TAU * t) / DIR_P2 + p[1]!);
  return Math.tanh(3.5 * (s + 0.2));
};

/** Steady part of the speed (no gusts), positive. */
const steady = (w: WindField, t: number): number => {
  const p = w.phase;
  return (
    w.params.mean *
    (1 + 0.16 * Math.sin((TAU * t) / 47 + p[2]!) + 0.08 * Math.sin((TAU * t) / 17.3 + p[3]!))
  );
};

/** Bank widths a second that things carried by the wind travel at now. */
export const travelSpeed = (w: WindField, t: number): number =>
  TRAVEL * Math.max(0.35, steady(w, t));

const bump = (x: number): number => (x <= -1 || x >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * x));

export interface Gust {
  /** Centre, in bank fractions, at the time asked. */
  f: number;
  /** Half width in bank fractions. */
  width: number;
  /** Signed strength in wind units. */
  amp: number;
}

const MAX_WIDTH = 0.22;

/**
 * The gust born in slot `k`, or null. `out` is filled at time `t` (the gust may not have started,
 * or may have left the bank: callers check `f`).
 */
const gustOf = (w: WindField, k: number, t: number, out: Gust): Gust | null => {
  const P = w.params;
  const h = mix(w.seed, k);
  if (unit(h, 0) >= P.chance) return null;
  const born = (k + unit(h, 1)) * P.every;
  if (t < born) return null;
  const dir = windDir(w, born);
  if (Math.abs(dir) < 0.3) return null;
  const sign = Math.sign(dir);
  const width = 0.1 + (MAX_WIDTH - 0.1) * unit(h, 2);
  const speed = travelSpeed(w, born) * (0.85 + 0.3 * unit(h, 3));
  const start = sign > 0 ? -width : 1 + width;
  out.f = start + sign * speed * (t - born);
  out.width = width;
  out.amp = sign * P.gust * P.mean * (0.6 + 0.8 * unit(h, 4));
  return out;
};

/** Longest a gust can take to cross the bank, in seconds (the steady speed never drops below 0.76 of the mean). */
const crossing = (w: WindField): number =>
  (1 + 2 * MAX_WIDTH) / (TRAVEL * Math.max(0.35, 0.76 * w.params.mean) * 0.85) + w.params.every;

const scratch: Gust = { f: 0, width: 0, amp: 0 };

/** Gusts alive at `t` with any part over the bank, into `out` (cleared first). At most `max`. */
export const gustsAt = (w: WindField, t: number, out: Gust[], max = 16): Gust[] => {
  out.length = 0;
  const P = w.params;
  const span = Math.min(crossing(w), 60);
  const k1 = Math.floor(t / P.every);
  const k0 = Math.floor((t - span) / P.every);
  for (let k = k0; k <= k1 && out.length < max; k++) {
    const g = gustOf(w, k, t, scratch);
    if (!g || g.f < -g.width || g.f > 1 + g.width) continue;
    out.push({ f: g.f, width: g.width, amp: g.amp });
  }
  for (const c of w.commanded) {
    const g = commandedAt(w, c, t);
    if (g && out.length < max) out.push(g);
  }
  return out;
};

const commandedAt = (w: WindField, c: CommandGust, t: number): Gust | null => {
  if (t < c.t0) return null;
  const sign = c.dir >= 0 ? 1 : -1;
  const speed = TRAVEL * Math.max(0.8, w.params.mean);
  const start = sign > 0 ? -COMMAND_WIDTH : 1 + COMMAND_WIDTH;
  const f = start + sign * speed * (t - c.t0);
  if (f < -COMMAND_WIDTH || f > 1 + COMMAND_WIDTH) return null;
  return { f, width: COMMAND_WIDTH, amp: sign * Math.max(1.3, 1.5 * w.params.mean) };
};

/** Add a commanded gust starting at `t0` (s), unless one started within 1.5 s of it. */
export const addGust = (w: WindField, t0: number, dir: number): boolean => {
  if (!Number.isFinite(t0)) return false;
  if (w.commanded.some((c) => Math.abs(c.t0 - t0) < 1.5)) return false;
  w.commanded.push({ t0, dir: dir >= 0 ? 1 : -1 });
  w.commanded.sort((a, b) => a.t0 - b.t0);
  if (w.commanded.length > MAX_COMMANDED) w.commanded.splice(0, w.commanded.length - MAX_COMMANDED);
  return true;
};

/** Drop commanded gusts that have crossed the bank. */
export const pruneGusts = (w: WindField, t: number): void => {
  const life = (1 + 2 * COMMAND_WIDTH) / (TRAVEL * Math.max(0.8, w.params.mean)) + 1;
  for (let i = w.commanded.length - 1; i >= 0; i--) {
    if (t - w.commanded[i]!.t0 > life) w.commanded.splice(i, 1);
  }
};

/**
 * The wind at bank fraction `f`, height `h` (sky heights) and shared time `t` (s): signed wind
 * units. Pure: the same inputs give the same wind on every frame.
 */
export const windAt = (w: WindField, t: number, f: number, h: number): number => {
  const P = w.params;
  const p = w.phase;
  let v = windDir(w, t) * steady(w, t);
  const k1 = Math.floor(t / P.every);
  const k0 = Math.floor((t - Math.min(crossing(w), 60)) / P.every);
  for (let k = k0; k <= k1; k++) {
    const g = gustOf(w, k, t, scratch);
    if (g) v += g.amp * bump((f - g.f) / g.width);
  }
  for (const c of w.commanded) {
    const g = commandedAt(w, c, t);
    if (g) v += g.amp * bump((f - g.f) / g.width);
  }
  v +=
    P.turb *
    P.mean *
    (Math.sin(TAU * (t / 2.9 + f * 1.3) + p[4]!) +
      0.6 * Math.sin(TAU * (t / 1.37 - f * 2.1) + p[5]!));
  const hh = h < 0 ? 0 : h > 1.2 ? 1.2 : h;
  return v * (0.72 + 0.4 * hh);
};

/**
 * Parameters for live wind: `speed` and `gusts` in m/s at 10 m, `from` the meteorological
 * direction in degrees (where it blows from). The bank is taken to run west to east, so an
 * easterly component of the flow blows to the right.
 */
export const liveParams = (speed: number, gusts: number, from: number): WindParams => {
  const s = Number.isFinite(speed) ? Math.max(0, speed) : 4;
  const g = Number.isFinite(gusts) ? Math.max(s, gusts) : s * 1.4;
  const rad = ((Number.isFinite(from) ? from : 270) * Math.PI) / 180;
  const east = -Math.sin(rad);
  const ratio = (g - s) / Math.max(1, s);
  return {
    mean: Math.min(1.8, Math.max(0.4, s / 4.5)),
    gust: Math.min(1.1, Math.max(0.2, ratio)),
    every: 5,
    chance: 0.75,
    turb: 0.07 + 0.05 * Math.min(1, ratio),
    dir: east < 0 ? -1 : 1,
  };
};
