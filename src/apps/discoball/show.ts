/**
 * The light show: a run of scenes, each a few spotlights aimed at the ball from round the room
 * and a few dim glows on the walls, that changes over minutes. Scene k's lights come from a
 * random stream seeded by the show's seed and k alone, so the same seed always gives the same
 * show and any moment of it can be worked out. Scenes cross-fade over `FADE` seconds by
 * brightness, never by jumping, so nothing on the ball flashes when the scene changes.
 *
 * Angles are radians. A light's direction is from the ball's centre: azimuth 0 towards +z,
 * growing towards +x, elevation above the centre's height. Distances are in the ball's radii,
 * so the room scales with the ball. Colours are linear, brightest channel 1.
 */
import { createRng } from "../../core/rng";
import type { Rng } from "../../core/types";

export type LightsMode = "party" | "white";
export type SceneKind = "party" | "sparkle" | "amber" | "sweep" | "quiet";
export type Rgb = readonly [number, number, number];

/** Seconds two scenes overlap while one fades into the next. */
export const FADE = 6;
/** Most spotlights and glows at once, during a cross-fade. */
export const MAX_SPOTS = 10;
export const MAX_GLOWS = 8;
export const DOT_SLOTS = 4;

/** No saturated red: a red flash is the colour most likely to trigger a seizure. */
export const PARTY: readonly Rgb[] = [
  [1, 0.14, 0.6], // magenta
  [0.6, 0.22, 1], // violet
  [0.16, 0.36, 1], // blue
  [0.1, 0.85, 1], // cyan
  [0.25, 1, 0.32], // green
  [1, 0.56, 0.12], // amber
  [1, 0.4, 0.68], // pink
  [0.62, 1, 0.16], // lime
];
export const WHITES: readonly Rgb[] = [
  [0.86, 0.93, 1],
  [1, 1, 1],
  [1, 0.86, 0.68],
];
export const AMBERS: readonly Rgb[] = [
  [1, 0.56, 0.12],
  [1, 0.72, 0.3],
  [1, 0.86, 0.68],
];

interface SpotPlan {
  az: number;
  el: number;
  /** Radii from the centre. */
  dist: number;
  /** Swing about `az` and `el`, and its period in seconds. */
  swingAz: number;
  swingEl: number;
  period: number;
  phase: number;
  /** Steady travel round the room, radians a second. */
  sweep: number;
  color: Rgb;
  power: number;
  /** Angular radius of the lamp's lens seen from the ball. */
  size: number;
}

interface GlowPlan {
  az: number;
  el: number;
  width: number;
  color: Rgb;
  level: number;
}

export interface ScenePlan {
  kind: SceneKind;
  /** When it is fully up (the fade in ends `FADE / 2` after this). */
  start: number;
  /** When it is half faded into the next. */
  end: number;
  spots: SpotPlan[];
  glows: GlowPlan[];
  /** Light on the floor, linear. */
  floor: number;
  /** Brightness of the little lamps round the walls, 0 to 1. */
  lamps: number;
}

export interface SpotNow {
  /** Unit direction from the ball's centre. */
  dir: [number, number, number];
  dist: number;
  color: [number, number, number];
  /** Brightness on the ball, already faded. */
  power: number;
  size: number;
}

export interface GlowNow {
  dir: [number, number, number];
  width: number;
  /** Colour times level, already faded. */
  color: [number, number, number];
}

export interface LightsNow {
  spots: SpotNow[];
  glows: GlowNow[];
  floor: [number, number, number];
  lamps: number;
  /**
   * Colours of the dots of light the ball throws round the room, in `DOT_SLOTS` slots, each one
   * spotlight's colour times its brightness over 3. They cross-fade with the scenes.
   */
  dots: [number, number, number][];
  scene: SceneKind;
  /** The scene fading in, or null. */
  next: SceneKind | null;
  /** How far the fade into `next` has gone, 0 to 1. */
  fade: number;
  /** Which scene of the show this is, from 0. */
  index: number;
}

const WEIGHTS: Record<LightsMode, readonly [SceneKind, number][]> = {
  party: [
    ["party", 3],
    ["sparkle", 2],
    ["amber", 1.5],
    ["sweep", 2],
    ["quiet", 1],
  ],
  white: [
    ["sparkle", 3],
    ["amber", 2],
    ["sweep", 2],
    ["quiet", 1],
  ],
};

const pickKind = (rng: Rng, mode: LightsMode, not: SceneKind | null): SceneKind => {
  const choices = WEIGHTS[mode].filter(([k]) => k !== not);
  let x = rng.next() * choices.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of choices) {
    x -= w;
    if (x <= 0) return k;
  }
  return choices[choices.length - 1]![0];
};

/** Some distinct items from `from`, in random order. */
const several = <T>(rng: Rng, from: readonly T[], n: number): T[] => {
  const left = [...from];
  const out: T[] = [];
  while (out.length < n && left.length > 0) out.push(left.splice(rng.int(left.length), 1)[0]!);
  return out;
};

const spot = (rng: Rng, az: number, el: number, color: Rgb, swing = 1): SpotPlan => ({
  az,
  el,
  dist: rng.range(3.2, 4.6),
  swingAz: rng.range(0.12, 0.4) * swing,
  swingEl: rng.range(0.03, 0.12) * swing,
  period: rng.range(18, 48),
  phase: rng.range(0, Math.PI * 2),
  sweep: 0,
  color,
  power: rng.range(2.6, 3.2),
  size: rng.range(0.014, 0.022),
});

/**
 * Spotlights mostly hang high, so their sparkle falls where people beside the ball look; most
 * scenes also have one standing low, which sparkles near the bottom for people underneath.
 */
const height = (rng: Rng): number => rng.range(0.08, 0.5);
const low = (rng: Rng): number => rng.range(-0.95, -0.6);

/** Scene `k` of a show, starting at `start`. */
export const planScene = (
  seed: string | number,
  mode: LightsMode,
  k: number,
  start: number,
  previous: SceneKind | null,
): ScenePlan => {
  const rng = createRng(`${seed}:discoball:scene:${k}`);
  const kind: SceneKind =
    k === 0 ? (mode === "party" ? "party" : "sparkle") : pickKind(rng, mode, previous);
  const length = kind === "quiet" ? rng.range(25, 40) : rng.range(50, 90);
  const base = rng.range(0, Math.PI * 2);
  const whites = mode === "white";
  const spots: SpotPlan[] = [];
  const glows: GlowPlan[] = [];
  let floor = 0.02;
  let lamps = 0.6;
  const glow = (color: Rgb, level: number): GlowPlan => ({
    az: rng.range(0, Math.PI * 2),
    el: rng.range(-0.05, 0.3),
    width: rng.range(0.35, 0.65),
    color,
    level,
  });

  switch (kind) {
    case "party": {
      const colors = several(rng, PARTY, 4);
      for (let i = 0; i < 4; i++) {
        const el = i === 3 ? low(rng) : height(rng);
        spots.push(spot(rng, base + (i * Math.PI) / 2 + rng.range(-0.35, 0.35), el, colors[i]!));
      }
      for (const c of several(rng, PARTY, 3)) glows.push(glow(c, rng.range(0.06, 0.11)));
      break;
    }
    case "sparkle": {
      const n = whites ? 5 : 4;
      for (let i = 0; i < n; i++) {
        const el = i === n - 1 ? low(rng) : height(rng);
        const az = base + (i * 2 * Math.PI) / n + rng.range(-0.3, 0.3);
        spots.push(spot(rng, az, el, rng.pick(WHITES), 0.6));
      }
      glows.push(glow([0.5, 0.62, 0.85], 0.06), glow([0.85, 0.75, 0.62], 0.04));
      break;
    }
    case "amber": {
      const n = 3 + rng.int(2);
      const colors = whites ? [WHITES[2]!, WHITES[1]!, WHITES[2]!, WHITES[0]!] : AMBERS;
      for (let i = 0; i < n; i++) {
        const az = base + (i * 2 * Math.PI) / n + rng.range(-0.3, 0.3);
        const el = i === n - 1 ? low(rng) : height(rng);
        spots.push(spot(rng, az, el, colors[i % colors.length]!, 0.8));
      }
      glows.push(glow([1, 0.58, 0.24], 0.08), glow([1, 0.45, 0.16], 0.05));
      floor = 0.024;
      break;
    }
    case "sweep": {
      const color = whites ? rng.pick(WHITES) : rng.pick(PARTY);
      const turn = (Math.PI * 2) / rng.range(28, 45);
      const sweep = rng.next() < 0.5 ? turn : -turn;
      for (let i = 0; i < 2; i++) {
        const s = spot(rng, base + i * Math.PI, i === 0 ? height(rng) : low(rng), color, 0.3);
        s.sweep = sweep;
        spots.push(s);
      }
      glows.push(glow(color, 0.05), glow([0.6, 0.65, 0.8], 0.03));
      floor = 0.016;
      break;
    }
    case "quiet": {
      const color = whites || rng.next() < 0.5 ? rng.pick(WHITES) : rng.pick(PARTY);
      spots.push(spot(rng, base, rng.next() < 0.35 ? low(rng) : height(rng), color, 0.5));
      glows.push(glow([0.45, 0.55, 0.8], 0.025));
      floor = 0.01;
      lamps = 0.4;
      break;
    }
  }
  return { kind, start, end: start + length, spots, glows, floor, lamps };
};

const smooth = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

const dirOf = (az: number, el: number, out: [number, number, number]) => {
  const c = Math.cos(el);
  out[0] = c * Math.sin(az);
  out[1] = Math.sin(el);
  out[2] = c * Math.cos(az);
};

export interface Show {
  /** The lights at `t` seconds since the show began. The result is reused by the next call. */
  at(t: number): LightsNow;
  /** The scenes now up or fading in. */
  readonly current: readonly ScenePlan[];
}

/** A show for `seed`. Scene 0 is fully up at t = 0. */
export const createShow = (seed: string | number, mode: LightsMode): Show => {
  let scenes: ScenePlan[] = [];
  let first = 0;
  const restart = () => {
    scenes = [planScene(seed, mode, 0, 0, null)];
    first = 0;
  };
  restart();
  const spots: SpotNow[] = Array.from({ length: MAX_SPOTS }, () => ({
    dir: [0, 0, 1],
    dist: 4,
    color: [1, 1, 1],
    power: 0,
    size: 0.015,
  }));
  const glows: GlowNow[] = Array.from({ length: MAX_GLOWS }, () => ({
    dir: [0, 0, 1],
    width: 0.5,
    color: [0, 0, 0],
  }));
  const out: LightsNow = {
    spots: [],
    glows: [],
    floor: [0, 0, 0],
    lamps: 0,
    dots: Array.from({ length: DOT_SLOTS }, () => [0, 0, 0] as [number, number, number]),
    scene: scenes[0]!.kind,
    next: null,
    fade: 0,
    index: 0,
  };

  return {
    get current() {
      return scenes;
    },
    at(t) {
      if (t < scenes[0]!.start - FADE) restart();
      // Keep the scene that is up and the one after it; drop those that have faded out.
      while (scenes[scenes.length - 1]!.end - FADE / 2 <= t) {
        const last = scenes[scenes.length - 1]!;
        scenes.push(planScene(seed, mode, first + scenes.length, last.end, last.kind));
      }
      while (scenes.length > 1 && scenes[0]!.end + FADE / 2 <= t) {
        scenes.shift();
        first++;
      }
      const a = scenes[0]!;
      const b = scenes[1];
      const fade = b ? smooth((t - (b.start - FADE / 2)) / FADE) : 0;
      let ns = 0;
      let ng = 0;
      let floor = 0;
      let lamps = 0;
      let fr = 0;
      let fg = 0;
      let fb = 0;
      for (const d of out.dots) d.fill(0);
      for (const [plan, w] of [
        [a, 1 - fade],
        [b, fade],
      ] as const) {
        if (!plan || w <= 0) continue;
        const local = t - plan.start;
        for (const s of plan.spots) {
          if (ns >= MAX_SPOTS) break;
          const now = spots[ns++]!;
          const swing = Math.sin((2 * Math.PI * local) / s.period + s.phase);
          const swingEl = Math.sin((2 * Math.PI * local) / (s.period * 1.37) + s.phase * 0.7);
          dirOf(s.az + s.sweep * local + s.swingAz * swing, s.el + s.swingEl * swingEl, now.dir);
          now.dist = s.dist;
          now.color[0] = s.color[0];
          now.color[1] = s.color[1];
          now.color[2] = s.color[2];
          now.power = s.power * w;
          now.size = s.size;
        }
        for (const g of plan.glows) {
          if (ng >= MAX_GLOWS) break;
          const now = glows[ng++]!;
          dirOf(g.az + 0.05 * Math.sin(local / 23), g.el, now.dir);
          now.width = g.width;
          now.color[0] = g.color[0] * g.level * w;
          now.color[1] = g.color[1] * g.level * w;
          now.color[2] = g.color[2] * g.level * w;
          fr += now.color[0];
          fg += now.color[1];
          fb += now.color[2];
        }
        out.dots.forEach((d, j) => {
          const s = plan.spots[j % plan.spots.length]!;
          const k = (s.power / 3) * w;
          d[0] += s.color[0] * k;
          d[1] += s.color[1] * k;
          d[2] += s.color[2] * k;
        });
        floor += plan.floor * w;
        lamps += plan.lamps * w;
      }
      // The floor takes a little of the walls' colour.
      const sum = fr + fg + fb || 1;
      out.floor[0] = floor * (0.75 + (0.75 * fr) / sum);
      out.floor[1] = floor * (0.75 + (0.75 * fg) / sum);
      out.floor[2] = floor * (0.75 + (0.75 * fb) / sum);
      out.spots = spots.slice(0, ns);
      out.glows = glows.slice(0, ng);
      out.lamps = lamps;
      out.scene = fade < 0.5 || !b ? a.kind : b.kind;
      out.next = b && fade > 0 ? b.kind : null;
      out.fade = b ? fade : 0;
      out.index = first + (fade < 0.5 || !b ? 0 : 1);
      return out;
    },
  };
};

/** Seconds a turn takes at each `spin` setting, on average. */
export const TURN_SECONDS = { slow: 36, medium: 22 } as const;
export type SpinSetting = keyof typeof TURN_SECONDS;

// The ball's speed wanders by up to about a fifth over a minute or two, as a motor does.
const WANDER: readonly [number, number, number][] = [
  [0.12, 97, 0],
  [0.06, 41, 1.3],
];

/** How fast the ball turns at `t`, radians a second. */
export const spinRate = (t: number, turn: number): number => {
  let f = 1;
  for (const [a, p, ph] of WANDER) f += a * Math.sin((2 * Math.PI * t) / p + ph);
  return ((2 * Math.PI) / turn) * f;
};

/** How far the ball has turned at `t`, radians in [0, 2π). The integral of `spinRate`. */
export const spinAngle = (t: number, turn: number): number => {
  let s = t;
  for (const [a, p, ph] of WANDER) {
    s += ((a * p) / (2 * Math.PI)) * (Math.cos(ph) - Math.cos((2 * Math.PI * t) / p + ph));
  }
  const tau = 2 * Math.PI;
  const angle = (((2 * Math.PI) / turn) * s) % tau;
  return angle < 0 ? angle + tau : angle;
};
