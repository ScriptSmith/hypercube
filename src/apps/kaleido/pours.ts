/**
 * Pours: fingers and the attract's emitters, each turned into one fluid splat per step along the
 * path it moved since the last step. A pour is warm in the child band and hot above it; it jets
 * upwards, sways a little, and drags the water along with the finger's own movement.
 */
import type { Rng } from "../../core/types";
import type { Splat } from "./gpu/fluid";
import type { Rgb } from "./palette";

export const MAX_POURS = 24;
export const MAX_EMITTERS = 4;

export interface Pour {
  /** Small id, unique among live pours, for the wire. */
  wire: number;
  x: number;
  y: number;
  /** Where the last splat ended. */
  px: number;
  py: number;
  /** Venue px a second. */
  vx: number;
  vy: number;
  rgb: Rgb;
  hot: boolean;
  human: boolean;
  /** performance.now() when it started. */
  since: number;
  phase: number;
}

export interface PourSet {
  readonly list: readonly Pour[];
  get(key: number): Pour | undefined;
  /** Start a pour; returns null when MAX_POURS are live. */
  start(key: number, x: number, y: number, rgb: Rgb, human: boolean, now: number): Pour | null;
  move(key: number, x: number, y: number, vx: number, vy: number): void;
  end(key: number): void;
  clear(): void;
  readonly size: number;
}

export const createPourSet = (max = MAX_POURS): PourSet => {
  const byKey = new Map<number, Pour>();
  let list: Pour[] = [];
  const freeWire = () => {
    const used = new Set(list.map((p) => p.wire));
    for (let i = 0; i < 64; i++) if (!used.has(i)) return i;
    return -1;
  };
  return {
    get list() {
      return list;
    },
    get size() {
      return list.length;
    },
    get: (key) => byKey.get(key),
    start(key, x, y, rgb, human, now) {
      const old = byKey.get(key);
      if (old) return old;
      if (list.length >= max) return null;
      const wire = freeWire();
      if (wire < 0) return null;
      const p: Pour = {
        wire,
        x,
        y,
        px: x,
        py: y,
        vx: 0,
        vy: 0,
        rgb,
        hot: false,
        human,
        since: now,
        phase: (wire * 2.399) % (Math.PI * 2),
      };
      byKey.set(key, p);
      list = [...list, p];
      return p;
    },
    move(key, x, y, vx, vy) {
      const p = byKey.get(key);
      if (!p) return;
      p.x = x;
      p.y = y;
      p.vx = Number.isFinite(vx) ? vx : 0;
      p.vy = Number.isFinite(vy) ? vy : 0;
    },
    end(key) {
      const p = byKey.get(key);
      if (!p) return;
      byKey.delete(key);
      list = list.filter((q) => q !== p);
    },
    clear() {
      byKey.clear();
      list = [];
    },
  };
};

export interface PourLook {
  radius: number;
  warm: number;
  hot: number;
  jetWarm: number;
  jetHot: number;
  follow: number;
  /** Venue px/s; the jet's own speed is clipped here. */
  maxSpeed: number;
  /** How fast a pour's spot takes its ink (per second), and how strong that ink is. */
  inkRate: number;
  inkStrength: number;
}

const clampMag = (x: number, y: number, max: number): [number, number] => {
  const m = Math.hypot(x, y);
  return m > max ? [(x * max) / m, (y * max) / m] : [x, y];
};

/** The splat a pour makes this step; moves its path start up to where it is now. */
export const splatOf = (p: Pour, look: PourLook, dt: number, t: number, scale = 1): Splat => {
  const jet = p.hot ? look.jetHot : look.jetWarm;
  const sway = Math.sin(t * 2.1 + p.phase) * 0.22 + Math.sin(t * 0.77 + p.phase * 1.3) * 0.12;
  const [vx, vy] = clampMag(
    p.vx * look.follow + jet * sway,
    p.vy * look.follow - jet,
    look.maxSpeed * 0.8,
  );
  const s: Splat = {
    x0: p.px,
    y0: p.py,
    x1: p.x,
    y1: p.y,
    r: look.radius * scale,
    vx,
    vy,
    push: 1 - Math.exp(-6 * dt),
    rgb: [p.rgb[0] * look.inkStrength, p.rgb[1] * look.inkStrength, p.rgb[2] * look.inkStrength],
    ink: 1 - Math.exp(-look.inkRate * dt),
    temp: p.hot ? look.hot : look.warm,
    heat: 1 - Math.exp(-8 * dt),
  };
  p.px = p.x;
  p.py = p.y;
  return s;
};

/**
 * Attract emitters: pour spots drifting slowly along the bottom, each pouring for a few seconds
 * and resting for a few. Their colours come from `colour()` when each pour begins.
 */
export interface Emitters {
  update(dt: number, on: boolean, now: number): void;
  readonly pours: readonly Pour[];
  clear(): void;
}

export interface EmitterSpec {
  count: number;
  /** Venue px: the strip they wander along. */
  x0: number;
  x1: number;
  y: number;
  /** Fraction of pours that are hot. */
  hotShare: number;
  pour: [number, number];
  rest: [number, number];
  colour(): Rgb;
  rng: Rng;
}

export const createEmitters = (spec: EmitterSpec): Emitters => {
  const n = Math.max(0, Math.min(MAX_EMITTERS, spec.count));
  const { rng } = spec;
  const state = Array.from({ length: n }, (_, i) => ({
    on: false,
    timer: rng.range(0.3, 2.5) + i * 0.9,
    phase: rng.range(0, Math.PI * 2),
    speed: rng.range(0.05, 0.11),
    t: 0,
    pour: null as Pour | null,
  }));
  let pours: Pour[] = [];
  const width = spec.x1 - spec.x0;
  const xAt = (i: number, s: (typeof state)[number]) => {
    const base = (i + 0.5) / Math.max(1, n);
    const wander = 0.5 / Math.max(1, n);
    return spec.x0 + width * (base + wander * Math.sin(s.t * s.speed * Math.PI * 2 + s.phase));
  };
  return {
    get pours() {
      return pours;
    },
    update(dt, on, now) {
      let changed = false;
      state.forEach((s, i) => {
        s.t += dt;
        const x = xAt(i, s);
        if (s.pour) {
          const vx = (x - s.pour.x) / Math.max(1e-3, dt);
          s.pour.x = x;
          s.pour.vx = vx;
        }
        s.timer -= dt;
        if (s.timer > 0 && (on || !s.on)) return;
        if (s.on || !on) {
          if (s.on) changed = true;
          s.on = false;
          s.pour = null;
          s.timer = rng.range(spec.rest[0], spec.rest[1]);
          return;
        }
        s.on = true;
        changed = true;
        s.timer = rng.range(spec.pour[0], spec.pour[1]);
        s.pour = {
          wire: 40 + i,
          x,
          y: spec.y + rng.range(-40, 40),
          px: x,
          py: spec.y,
          vx: 0,
          vy: 0,
          rgb: spec.colour(),
          hot: rng.next() < spec.hotShare,
          human: false,
          since: now,
          phase: rng.range(0, Math.PI * 2),
        };
        s.pour.py = s.pour.y;
      });
      if (changed) pours = state.flatMap((s) => (s.pour ? [s.pour] : []));
    },
    clear() {
      for (const s of state) {
        s.on = false;
        s.pour = null;
      }
      pours = [];
    },
  };
};
