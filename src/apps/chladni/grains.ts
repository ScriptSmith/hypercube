import { type Mode, onPlate, type PlateShape, sample } from "./modes";

/**
 * How sand moves on a ringing plate, and how much of it there is. The GPU step in
 * `gpu/shaders.ts` does exactly what `stepGrain` does here, for every grain at once.
 *
 * The plate moves as a sum of modes, each with an amplitude and a phase, so its motion at a
 * point has an in-step part and a quarter-cycle part: w = wr + i wi, and |w| is how far the plate
 * swings there. A grain only moves while the plate under it shakes hard enough to throw it: where
 * |w| is above BAND times the plate's overall level it bounces (a random kick that grows with the
 * motion) and drifts down the slope of |w|^2, towards stiller ground. Inside that band it only
 * creeps on towards the still line, so a figure's lines are narrow bands that sharpen slowly.
 * Where the two parts' still lines don't meet (a heavily damped plate) there is no still line,
 * only a smudge where the motion is least.
 *
 * Grains live in plate coordinates; slopes and steps are measured in true lengths, so on a
 * stretched plate (half sides hx and hy) a grain moves the same in every direction. Everything is
 * scaled by the plate's typical wavenumber, so a figure takes about as long to form whatever its
 * mode.
 */
export const TUNE = {
  /** Drift towards still lines, per second, at full lift. */
  drift: 1,
  /** Random kick, plate units per root second, per unit of motion. */
  kick: 0.7,
  /** Motion below this share of the level throws nothing. */
  band: 0.07,
  /** Drift that keeps going inside the band, as a share of the full drift. */
  creep: 0.4,
  /** Longest move in one step, plate units. */
  maxStep: 0.08,
} as const;

/** The sum of the active modes at a point: both parts of the displacement and their gradients. */
export interface Field {
  wr: number;
  wi: number;
  /** Gradient of wr and of wi, in plate coordinates. */
  dur: number;
  dvr: number;
  dui: number;
  dvi: number;
}

export const fieldAt = (
  modes: readonly Mode[],
  active: readonly number[],
  re: ArrayLike<number>,
  im: ArrayLike<number>,
  u: number,
  v: number,
): Field => {
  const f: Field = { wr: 0, wi: 0, dur: 0, dvr: 0, dui: 0, dvi: 0 };
  for (const i of active) {
    const m = modes[i];
    const ar = re[i] ?? 0;
    const ai = im[i] ?? 0;
    if (!m || (ar === 0 && ai === 0)) continue;
    const s = sample(m, u, v);
    f.wr += ar * s.w;
    f.wi += ai * s.w;
    f.dur += ar * s.du;
    f.dvr += ar * s.dv;
    f.dui += ai * s.du;
    f.dvi += ai * s.dv;
  }
  return f;
};

/** How far the plate swings at a point of the field. */
export const swing = (f: Field): number => Math.hypot(f.wr, f.wi);

/** The per-step uniforms: overall level and the squared wavenumber, amplitude-weighted. */
export const levels = (
  modes: readonly Mode[],
  active: readonly number[],
  amps: ArrayLike<number>,
): { level: number; wave2: number } => {
  let a2 = 0;
  let w2 = 0;
  for (const i of active) {
    const a = amps[i] ?? 0;
    a2 += a * a;
    w2 += a * a * (modes[i]?.wave ?? 1) ** 2;
  }
  return { level: Math.sqrt(a2), wave2: w2 };
};

/** Keep a point on the plate by reflecting it off the edge. */
export const keepOn = (shape: PlateShape, u: number, v: number): [number, number] => {
  if (shape === "square") {
    const fold = (x: number) => {
      let y = x;
      if (y > 1) y = 2 - y;
      if (y < -1) y = -2 - y;
      return Math.min(1, Math.max(-1, y));
    };
    return [fold(u), fold(v)];
  }
  const r = Math.hypot(u, v);
  if (r <= 0.999) return [u, v];
  const to = Math.min(0.999, Math.max(0, 2 - r));
  return [(u / r) * to, (v / r) * to];
};

/** Half sides of the square plate: plate units are true lengths. */
export const SQUARE_HALF = { hx: 1, hy: 1 } as const;

/**
 * One grain's move for one step. `noise` is a pair of standard normal numbers and `half` the
 * plate's half sides. Returns the new point and the local motion (which the drawing uses to make
 * moving grains shiver).
 */
export const stepGrain = (
  shape: PlateShape,
  f: Field,
  level: number,
  wave2: number,
  liftNow: number,
  dt: number,
  u: number,
  v: number,
  noise: [number, number],
  half: { hx: number; hy: number } = SQUARE_HALF,
): { u: number; v: number; motion: number } => {
  const motion = swing(f);
  if (liftNow <= 0 || wave2 <= 0 || level <= 0) return { u, v, motion };
  const band = TUNE.band * level;
  const bounce = Math.min(1, Math.max(0, (motion - band) / Math.max(1e-4, band)));
  const pull = -TUNE.drift * liftNow * (bounce + TUNE.creep) * ((level * level) / wave2) * dt;
  const kick =
    (TUNE.kick * liftNow * Math.max(0, motion - band) * level * Math.sqrt(dt)) / Math.sqrt(wave2);
  // Half the slope of |w|^2, in true lengths.
  const gx = (f.wr * f.dur + f.wi * f.dui) / half.hx;
  const gy = (f.wr * f.dvr + f.wi * f.dvi) / half.hy;
  let dx = pull * gx + kick * noise[0];
  let dy = pull * gy + kick * noise[1];
  const len = Math.hypot(dx, dy);
  if (len > TUNE.maxStep) {
    dx *= TUNE.maxStep / len;
    dy *= TUNE.maxStep / len;
  }
  const [nu, nv] = keepOn(shape, u + dx / half.hx, v + dy / half.hy);
  return { u: nu, v: nv, motion };
};

/** Grains per venue px² of plate at `res` 1: about 300,000 on a full-height wall plate. */
export const DENSITY = 0.055;
export const MIN_GRAINS = 4096;
export const MAX_GRAINS = 400_000;
/** A software rasteriser gets this share of the grains. */
export const SOFTWARE_SHARE = 1 / 6;
/** Share of the plate the grains would cover if spread out evenly. */
export const COVER = 0.45;

/** Grains for a plate of `size` venue px (the square's side), with `res` squared, fewer on a software GPU. */
export const grainCount = (
  size: number,
  shape: PlateShape,
  res: number,
  software: boolean,
): number => {
  const area = shape === "square" ? size * size : (Math.PI / 4) * size * size;
  const n = area * DENSITY * res * res * (software ? SOFTWARE_SHARE : 1);
  return Math.round(Math.min(MAX_GRAINS, Math.max(MIN_GRAINS, n)));
};

/**
 * Grain size in venue px, so `count` grains would cover COVER of a plate `width` by `height` (a
 * stretched plate's grains grow or shrink with its drawn area).
 */
export const grainSize = (
  width: number,
  height: number,
  shape: PlateShape,
  count: number,
): number => {
  const area = shape === "square" ? width * height : (Math.PI / 4) * width * height;
  return Math.sqrt((COVER * area) / Math.max(1, count));
};

/** A state texture's size for `count` grains: a fixed width and as many rows as needed. */
export const stateSize = (count: number): { width: number; height: number } => {
  const width = count > 65_536 ? 1024 : 256;
  return { width, height: Math.max(1, Math.ceil(count / width)) };
};

/**
 * Fresh sand is sprinkled over a spell: each grain has a fixed place in [0, 1) for each sprinkle
 * (a hash of its index and the sprinkle's seed) and lands when the spell's progress passes it.
 * `span` gives the slice of [0, 1) to land this step, so every grain lands exactly once.
 */
export interface Sprinkler {
  start(now: number, ms: number, seed: number): void;
  /** The hash range to land this step, or null when nothing is landing. */
  span(now: number): { seed: number; from: number; to: number } | null;
  readonly busy: boolean;
}

export const createSprinkler = (): Sprinkler => {
  let seed = 0;
  let start = 0;
  let ms = 1;
  let done = 1;
  let busy = false;
  return {
    start(now, length, s) {
      seed = s >>> 0;
      start = now;
      ms = Math.max(1, length);
      done = 0;
      busy = true;
    },
    span(now) {
      if (!busy) return null;
      const p = Math.min(1, Math.max(0, (now - start) / ms));
      const from = done;
      done = p;
      if (p >= 1) busy = false;
      return { seed, from, to: p >= 1 ? 2 : p };
    },
    get busy() {
      return busy;
    },
  };
};

/** An even scatter of `n` points over a plate, from a 0-to-1 random source. */
export const scatter = (shape: PlateShape, n: number, rnd: () => number): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (shape === "square") out.push([rnd() * 2 - 1, rnd() * 2 - 1]);
    else {
      const r = Math.sqrt(rnd()) * 0.995;
      const a = rnd() * Math.PI * 2;
      out.push([r * Math.sin(a), -r * Math.cos(a)]);
    }
  }
  return out.filter(([u, v]) => onPlate(shape, u, v));
};
