/**
 * The kaleidoscope's parameters and how hands set them.
 *
 * The picture is a Julia set (z goes to z * z + c) folded by `mirrors` mirrors through the centre.
 * The most varied Julia sets have c near the edge of the main cardioid of the Mandelbrot set, so
 * the first hand picks c on a band around that edge: across the frame (or bank) goes around the
 * edge, up the reach band goes from inside it to just outside. A hand at waist height reaches
 * every shape. The second hand turns (across) and zooms (up). The third chooses the number of
 * mirrors by thirds across the frame. With no hands everything drifts along slow waves.
 *
 * Nothing may flash: the follower eases every value with a time constant and caps how fast c
 * moves, and a change of mirrors crossfades and can't happen more than once every few seconds.
 */

export interface KParams {
  cx: number;
  cy: number;
  /** Radians. */
  rot: number;
  /** Magnification; 1 shows the whole set in the shorter side. */
  zoom: number;
  mirrors: number;
}

/** A hand on the kaleidoscope: `x` across the frame or bank (0 to 1), `b` up the reach band. */
export interface KHand {
  x: number;
  b: number;
  /** When it touched, any clock; the smallest is the first hand. */
  since: number;
}

export const MIRROR_CHOICES = [6, 8, 12] as const;
export const PHI_MIN = 0.35;
export const PHI_MAX = Math.PI;
export const S_MIN = 0.9;
export const S_MAX = 1.035;
export const ZOOM_MIN = 0.65;
export const ZOOM_MAX = 2.2;
/** Fastest change of c, per second. */
export const C_SPEED = 0.09;
export const MIRROR_FADE_S = 1.6;
export const MIRROR_HOLD_S = 3.5;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** c on the band around the main cardioid's edge, for a hand at (x, b). */
export const cFromHand = (x: number, b: number): { cx: number; cy: number } => {
  const phi = PHI_MIN + clamp01(x) * (PHI_MAX - PHI_MIN);
  const s = S_MIN + clamp01(b) * (S_MAX - S_MIN);
  // The cardioid's edge: e^(i phi) / 2 - e^(2 i phi) / 4.
  const ex = Math.cos(phi) / 2 - Math.cos(2 * phi) / 4;
  const ey = Math.sin(phi) / 2 - Math.sin(2 * phi) / 4;
  return { cx: ex * s, cy: ey * s };
};

export const rotFromHand = (x: number): number => (clamp01(x) - 0.5) * 2 * Math.PI;
export const zoomFromHand = (b: number): number =>
  ZOOM_MIN * Math.exp(clamp01(b) * Math.log(ZOOM_MAX / ZOOM_MIN));
export const mirrorsFromHand = (x: number): number =>
  MIRROR_CHOICES[Math.min(2, Math.floor(clamp01(x) * 3))]!;

/** Where the parameters wander with nobody touching, at `t` seconds. */
export const drift = (t: number, mirrors: number): KParams => {
  const x = 0.5 + 0.42 * Math.sin((2 * Math.PI * t) / 97) * Math.cos((2 * Math.PI * t) / 233);
  const b = 0.5 + 0.38 * Math.sin((2 * Math.PI * t) / 61 + 1.3);
  const c = cFromHand(x, b);
  return {
    ...c,
    rot: wrap((2 * Math.PI * t) / 190),
    zoom: Math.exp(0.22 * Math.sin((2 * Math.PI * t) / 73 + 0.4)),
    mirrors,
  };
};

/** What the hands ask for; anything no hand sets comes from `base` (the drift). */
export const handTargets = (hands: readonly KHand[], base: KParams): KParams => {
  const sorted = [...hands].sort((a, b) => a.since - b.since);
  const out = { ...base };
  const [first, second, third] = sorted;
  if (first) Object.assign(out, cFromHand(first.x, first.b));
  if (second) {
    out.rot = rotFromHand(second.x);
    out.zoom = zoomFromHand(second.b);
  }
  if (third) out.mirrors = mirrorsFromHand(third.x);
  return out;
};

export interface Follower {
  readonly now: KParams;
  /** Mirror count fading out, and how far the fade to `now.mirrors` has gone (1 when done). */
  readonly fromMirrors: number;
  readonly fade: number;
  step(dt: number, target: KParams): KParams;
  /** Jump to `p` (no easing), e.g. on the first beacon from a screen. */
  set(p: KParams): void;
}

export const createFollower = (start: KParams, tau = { c: 0.9, rot: 0.7, zoom: 0.9 }): Follower => {
  const now = { ...start };
  let fromMirrors = start.mirrors;
  let fade = 1;
  let hold = 0;
  return {
    get now() {
      return now;
    },
    get fromMirrors() {
      return fromMirrors;
    },
    get fade() {
      return fade;
    },
    step(dt, target) {
      const d = Math.max(0, Math.min(0.25, dt));
      const kc = 1 - Math.exp(-d / tau.c);
      let dx = (target.cx - now.cx) * kc;
      let dy = (target.cy - now.cy) * kc;
      const len = Math.hypot(dx, dy);
      const cap = C_SPEED * d;
      if (len > cap) {
        dx *= cap / len;
        dy *= cap / len;
      }
      now.cx += dx;
      now.cy += dy;
      now.rot = wrap(now.rot + wrap(target.rot - now.rot) * (1 - Math.exp(-d / tau.rot)));
      const lz =
        Math.log(now.zoom) +
        (Math.log(target.zoom) - Math.log(now.zoom)) * (1 - Math.exp(-d / tau.zoom));
      now.zoom = Math.exp(lz);
      hold = Math.max(0, hold - d);
      fade = Math.min(1, fade + d / MIRROR_FADE_S);
      if (target.mirrors !== now.mirrors && hold <= 0 && fade >= 1) {
        fromMirrors = now.mirrors;
        now.mirrors = target.mirrors;
        fade = 0;
        hold = MIRROR_HOLD_S;
      }
      return now;
    },
    set(p) {
      Object.assign(now, p);
      fromMirrors = p.mirrors;
      fade = 1;
    },
  };
};
