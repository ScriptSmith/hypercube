/**
 * Shells and bursts are small records in fixed rings of slots, so memory is bounded however long
 * the page runs. A burst is a pure function of its record and the time, which the GPU evaluates
 * per star; the CPU only fills a few numbers per burst.
 */
import { type Ballistic, positionAt, velocityAt } from "./path";
import { isPictogram, MIXED, partnerColor, SHAPE, type ShapeId } from "./recipe";

/** 32-bit integer hash, stable everywhere, for per-shell choices that must match across frames. */
export const hash32 = (a: number, b = 0): number => {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
};
/** Uniform in [0, 1) from a seed and a salt. */
export const hash01 = (a: number, b = 0): number => hash32(a, b) / 4294967296;

export interface Shell {
  live: boolean;
  id: number;
  /** Clock ms at release. */
  t0: number;
  /** Start state, sky units. */
  path: Ballistic;
  /** Clock ms of the burst. */
  tb: number;
  color: number;
  shape: ShapeId;
  size: number;
  seed: number;
  /** Burst radius and star size, sky units. */
  radius: number;
  star: number;
  /** Extra stars for volleys. */
  boost: number;
  /** Volley this shell belongs to, 0 for none. */
  volley: number;
  /** Who launched it, for the echo. Null for the show and remote copies. */
  frame: string | null;
  pad: number;
  /** Fraction across the launching frame where it left the top, for the echo glow. */
  exitU: number;
  burst: boolean;
  /** Sent to the other corner screen, or came from it. */
  shared: boolean;
  /** Climbs on this frame but bursts elsewhere (a panel under its screen). */
  ghost: boolean;
}

export interface Burst {
  live: boolean;
  id: number;
  /** Clock ms of the burst. */
  t0: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  shape: ShapeId;
  color: number;
  color2: number;
  radius: number;
  star: number;
  /** Stars to draw, before the frame's own density. */
  count: number;
  seed: number;
  /** Radians, for pictograms and ring planes. */
  tilt: number;
  /** Seconds. */
  life: number;
  drag: number;
  gravity: number;
  /** Star speed, sky units per s. */
  speed: number;
  /** Clock ms at which an early end has the burst faded out; Infinity normally. */
  endAt: number;
  /** Relative brightness of the light it throws on the sky. */
  light: number;
}

export interface BurstLook {
  life: number;
  drag: number;
  /** How far stars sag by the end, as a fraction of the radius. */
  droop: number;
  /** Stars on a large screen before density scaling. */
  count: number;
}

export const LOOKS: Record<ShapeId, BurstLook> = {
  [SHAPE.peony]: { life: 2.4, drag: 3.4, droop: 0.5, count: 1300 },
  [SHAPE.ring]: { life: 2.2, drag: 3.4, droop: 0.38, count: 460 },
  [SHAPE.willow]: { life: 3.7, drag: 3.6, droop: 1.25, count: 760 },
  [SHAPE.palm]: { life: 2.8, drag: 2.4, droop: 0.85, count: 720 },
  [SHAPE.crossette]: { life: 2.6, drag: 3.0, droop: 0.55, count: 800 },
  [SHAPE.heart]: { life: 2.5, drag: 3.6, droop: 0.24, count: 700 },
  [SHAPE.star]: { life: 2.5, drag: 3.6, droop: 0.24, count: 700 },
  [SHAPE.smiley]: { life: 2.5, drag: 3.6, droop: 0.24, count: 740 },
  [SHAPE.flower]: { life: 2.5, drag: 3.6, droop: 0.24, count: 740 },
  [SHAPE.cascade]: { life: 3.8, drag: 1.2, droop: 3, count: 900 },
  [SHAPE.glitter]: { life: 1.9, drag: 3.2, droop: 0.3, count: 520 },
};

/** Star speed and gravity that give spread `radius` and sag `droop * radius` over `look.life`. */
export const starPhysics = (
  radius: number,
  look: BurstLook,
): { speed: number; gravity: number } => {
  const k = look.drag;
  const L = look.life;
  const spread = (1 - Math.exp(-k * L * 0.75)) / k;
  const fall = (L - (1 - Math.exp(-k * L)) / k) / k;
  return { speed: radius / spread, gravity: (look.droop * radius) / Math.max(1e-3, fall) };
};

const MAX_TILT = (20 * Math.PI) / 180;

/** The burst a shell makes at its burst time. Pure, so every frame holding the shell agrees. */
export const fillBurst = (out: Burst, s: Shell): Burst => {
  const t = (s.tb - s.t0) / 1000;
  const p = positionAt(s.path, t);
  const v = velocityAt(s.path, t);
  const look = LOOKS[s.shape];
  const phys = starPhysics(s.radius, look);
  out.t0 = s.tb;
  out.x = p.x;
  out.y = p.y;
  out.vx = v.x * 0.3;
  out.vy = v.y * 0.3;
  out.shape = s.shape;
  out.color = s.color;
  out.color2 = s.color >= MIXED ? MIXED : partnerColor(s.color, hash01(s.seed, 7));
  out.radius = s.radius;
  out.star = s.star;
  out.count = Math.round(look.count * s.boost);
  out.seed = s.seed;
  out.tilt = isPictogram(s.shape)
    ? (hash01(s.seed, 3) * 2 - 1) * MAX_TILT
    : hash01(s.seed, 3) * Math.PI * 2;
  out.life = look.life;
  out.drag = look.drag;
  out.gravity = phys.gravity;
  out.speed = phys.speed;
  out.endAt = Infinity;
  out.light = isPictogram(s.shape) ? 0.7 : s.shape === SHAPE.willow ? 0.8 : 1;
  return out;
};

/** A burst with no shell (cascades, volley rings, corner volleys). */
export const fillEffect = (
  out: Burst,
  e: {
    t0: number;
    x: number;
    y: number;
    shape: ShapeId;
    color: number;
    radius: number;
    star: number;
    seed: number;
    boost?: number;
  },
): Burst => {
  const look = LOOKS[e.shape];
  const phys = starPhysics(e.radius, look);
  out.t0 = e.t0;
  out.x = e.x;
  out.y = e.y;
  out.vx = 0;
  out.vy = 0;
  out.shape = e.shape;
  out.color = e.color;
  out.color2 = e.color >= MIXED ? MIXED : partnerColor(e.color, hash01(e.seed, 7));
  out.radius = e.radius;
  out.star = e.star;
  out.count = Math.round(look.count * (e.boost ?? 1));
  out.seed = e.seed;
  out.tilt = hash01(e.seed, 3) * Math.PI * 2;
  out.life = look.life;
  out.drag = look.drag;
  out.gravity = phys.gravity;
  out.speed = phys.speed;
  out.endAt = Infinity;
  out.light = e.shape === SHAPE.cascade ? 0.5 : 0.8;
  return out;
};

export const newShell = (): Shell => ({
  live: false,
  id: 0,
  t0: 0,
  path: { x: 0, y: 0, vx: 0, vy: 0, g: 0, k: 0 },
  tb: 0,
  color: 0,
  shape: SHAPE.peony,
  size: 0.5,
  seed: 0,
  radius: 0,
  star: 0,
  boost: 1,
  volley: 0,
  frame: null,
  pad: 0,
  exitU: 0.5,
  burst: false,
  shared: false,
  ghost: false,
});

export const newBurst = (): Burst => ({
  live: false,
  id: 0,
  t0: 0,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  shape: SHAPE.peony,
  color: 0,
  color2: 0,
  radius: 0,
  star: 0,
  count: 0,
  seed: 0,
  tilt: 0,
  life: 1,
  drag: 1,
  gravity: 0,
  speed: 0,
  endAt: Infinity,
  light: 1,
});

/** How long an early-ended burst takes to fade out. */
export const END_FADE_MS = 350;

export interface Pool<T extends { live: boolean; id: number; t0: number }> {
  readonly slots: readonly T[];
  /** A slot to fill. Reuses a dead one, or the oldest live one when every slot is taken. */
  alloc(): T;
  readonly live: number;
  /** Mark dead. */
  free(item: T): void;
  clear(): void;
}

export const createPool = <T extends { live: boolean; id: number; t0: number }>(
  capacity: number,
  make: () => T,
): Pool<T> => {
  const slots: T[] = Array.from({ length: Math.max(1, capacity) }, make);
  let nextId = 1;
  return {
    slots,
    alloc() {
      let pick: T | null = null;
      for (const s of slots) {
        if (!s.live) {
          pick = s;
          break;
        }
      }
      if (!pick) for (const s of slots) if (!pick || s.t0 < pick.t0) pick = s;
      const slot = pick as T;
      slot.live = true;
      slot.id = nextId++;
      return slot;
    },
    // Counted rather than tracked, so it can't drift from the slots themselves.
    get live() {
      let n = 0;
      for (const s of slots) if (s.live) n++;
      return n;
    },
    free(item) {
      item.live = false;
    },
    clear() {
      for (const s of slots) s.live = false;
    },
  };
};

/**
 * Keep at most `budget` bursts going: when there are more, the oldest ones that aren't already
 * ending get a quick fade instead of vanishing.
 */
export const enforceBudget = (pool: Pool<Burst>, budget: number, now: number): number => {
  let going = 0;
  for (const b of pool.slots) if (b.live && b.endAt === Infinity) going++;
  let ended = 0;
  while (going > budget) {
    let oldest: Burst | null = null;
    for (const b of pool.slots) {
      if (b.live && b.endAt === Infinity && (!oldest || b.t0 < oldest.t0)) oldest = b;
    }
    if (!oldest) break;
    oldest.endAt = now + END_FADE_MS;
    going--;
    ended++;
  }
  return ended;
};

/** True once a burst has nothing left to draw. */
export const burstDone = (b: Burst, now: number): boolean =>
  now >= b.endAt || now - b.t0 > b.life * 1000 + 200;

/** True once a shell has burst and its trail has faded. */
export const shellDone = (s: Shell, now: number): boolean => s.burst && now - s.tb > 900;
