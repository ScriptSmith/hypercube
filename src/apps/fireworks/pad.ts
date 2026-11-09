/**
 * The pads on one frame: touches in, launches out. Drop-in, with no stations: the first touch
 * on a recipe button changes it, a tap or an upward swipe on the tube launches, and the aim
 * handle tilts the tube. In `flick`, a drag up from anywhere low on the pad aims and sets the
 * height when it lets go.
 */
import type { Rng } from "../../core/types";
import { type Config, PAD_COOLDOWN_MS } from "./config";
import type { PadLook } from "./padview";
import { aimAngle, flickOf, inCircle, inRect, MAX_AIM_NARROW, type PadLayout } from "./pads";
import {
  COLOR_CHOICES,
  cycle,
  defaultRecipe,
  padColor,
  padShapes,
  randomShape,
  type Recipe,
  SIZES,
} from "./recipe";

export interface LaunchIntent {
  pad: number;
  angle: number;
  recipe: Recipe;
  seed: number;
}

export interface PadDeps {
  layouts: readonly PadLayout[];
  config: Config;
  /** The pad's number along the bank or wall, for its colour. */
  globalPad(i: number): number;
  /** UI time, ms. */
  now(): number;
  rng: Rng;
  /** Narrow frames (panels, pairs) tilt a little less, so shells leave through the top. */
  narrow: boolean;
  /** Launch; returns how long the shell is in flight (ms) before the pad may fire again. */
  launch(i: LaunchIntent): number;
  /** A person (not a bot) touched pad `i`. */
  touched?(i: number): void;
}

export interface Pads {
  down(id: number, x: number, y: number, synthetic: boolean): void;
  move(id: number, x: number, y: number): void;
  up(id: number, x: number, y: number): void;
  cancel(id: number): void;
  looks(): readonly PadLook[];
  /** Back to each pad's starting recipe and straight up. */
  reset(): void;
  resetPad(i: number): void;
  /** The pad's shell has burst (the screen's echo): it may fire again. */
  landed(i: number): void;
  lastHuman(i: number): number;
  readonly count: number;
  /** Launches since start. */
  readonly launches: number;
}

/** A swipe up this far from where it started launches at once. */
const SWIPE_PX = 80;
/** A press that moved less than this is a tap. */
const TAP_SLOP = 70;
/** Pads untouched this long go back to their starting recipe. */
const PAD_IDLE_MS = 60_000;
/** The aim eases back to straight up when nobody has touched it for this long. */
const AIM_IDLE_MS = 20_000;
/** A pad not launched for this long pulses its tube. */
const ATTRACT_MS = 9000;

interface Press {
  pad: number;
  kind: "tube" | "aim" | "flick";
  x0: number;
  y0: number;
  done: boolean;
  synthetic: boolean;
}

interface PadState {
  recipe: Recipe;
  angle: number;
  aimAt: number;
  lastLaunch: number;
  busyUntil: number;
  lastTouch: number;
  lastHuman: number;
  launchedAt: number;
  refusedAt: number;
  charge: number | null;
}

export const createPads = (d: PadDeps): Pads => {
  const shapes = padShapes(d.config.pictograms);
  const fresh = (i: number): PadState => ({
    recipe: defaultRecipe(d.globalPad(i)),
    angle: 0,
    aimAt: -Infinity,
    lastLaunch: -Infinity,
    busyUntil: -Infinity,
    lastTouch: -Infinity,
    lastHuman: -Infinity,
    launchedAt: 0,
    refusedAt: 0,
    charge: null,
  });
  const pads: PadState[] = d.layouts.map((_, i) => fresh(i));
  const presses = new Map<number, Press>();
  const looks: PadLook[] = [];
  let launches = 0;

  const padAt = (x: number): number => d.layouts.findIndex((p) => x >= p.x0 - 12 && x <= p.x1 + 12);

  const fire = (i: number, angle: number, recipe: Recipe): boolean => {
    const s = pads[i];
    if (!s) return false;
    const t = d.now();
    if (t - s.lastLaunch < PAD_COOLDOWN_MS || t < s.busyUntil) {
      s.refusedAt = t;
      return false;
    }
    const r = d.rng;
    let chosen = recipe;
    if (d.config.variant === "flick") {
      chosen = {
        color: padColor(d.globalPad(i)),
        shape: randomShape(r.next(), r.next(), d.config.pictograms),
        size: recipe.size,
      };
    } else if (d.config.recipe === "colour") {
      chosen = {
        color: recipe.color,
        shape: randomShape(r.next(), r.next(), d.config.pictograms),
        size: r.pick(SIZES),
      };
    }
    const flight = d.launch({ pad: i, angle, recipe: chosen, seed: r.int(0x7fffffff) });
    s.lastLaunch = t;
    s.busyUntil = t + Math.max(0, flight);
    s.launchedAt = t;
    launches++;
    return true;
  };

  const touch = (i: number, synthetic: boolean) => {
    const s = pads[i];
    if (!s) return;
    const t = d.now();
    s.lastTouch = t;
    if (!synthetic) {
      s.lastHuman = t;
      d.touched?.(i);
    }
  };

  return {
    down(id, x, y, synthetic) {
      const i = padAt(x);
      const p = d.layouts[i];
      const s = pads[i];
      if (!p || !s) return;
      touch(i, synthetic);
      if (inCircle(p.color, x, y)) {
        s.recipe = { ...s.recipe, color: (s.recipe.color + 1) % COLOR_CHOICES };
        return;
      }
      if (inCircle(p.shape, x, y)) {
        s.recipe = { ...s.recipe, shape: cycle(shapes, s.recipe.shape) };
        return;
      }
      if (inCircle(p.size, x, y)) {
        s.recipe = { ...s.recipe, size: cycle(SIZES, s.recipe.size as (typeof SIZES)[number]) };
        return;
      }
      if (inCircle(p.reset, x, y, 0)) return;
      if (p.flick && inRect(p.flick, x, y)) {
        presses.set(id, { pad: i, kind: "flick", x0: x, y0: y, done: false, synthetic });
        s.charge = 0;
        return;
      }
      if (inRect(p.tubeHit, x, y)) {
        presses.set(id, { pad: i, kind: "tube", x0: x, y0: y, done: false, synthetic });
        return;
      }
      if (p.aim) {
        const a = aimAngle(p.aim, x, y, true);
        if (a !== null) {
          s.angle = a;
          s.aimAt = d.now();
          presses.set(id, { pad: i, kind: "aim", x0: x, y0: y, done: false, synthetic });
        }
      }
    },
    move(id, x, y) {
      const pr = presses.get(id);
      if (!pr || pr.done) return;
      const p = d.layouts[pr.pad];
      const s = pads[pr.pad];
      if (!p || !s) return;
      if (pr.kind === "tube") {
        if (pr.y0 - y > SWIPE_PX) {
          pr.done = true;
          fire(pr.pad, s.angle, s.recipe);
        }
      } else if (pr.kind === "aim" && p.aim) {
        s.angle = aimAngle(p.aim, x, y, false) ?? s.angle;
        s.aimAt = d.now();
      } else if (pr.kind === "flick") {
        const f = flickOf(p, pr.x0, pr.y0, x, y, d.narrow ? MAX_AIM_NARROW : undefined);
        s.charge = f ? f.size : 0;
        if (f) s.angle = f.angle;
      }
    },
    up(id, x, y) {
      const pr = presses.get(id);
      presses.delete(id);
      if (!pr || pr.done) return;
      const p = d.layouts[pr.pad];
      const s = pads[pr.pad];
      if (!p || !s) return;
      if (pr.kind === "tube" && Math.hypot(x - pr.x0, y - pr.y0) < TAP_SLOP) {
        fire(pr.pad, s.angle, s.recipe);
      } else if (pr.kind === "flick") {
        s.charge = null;
        const f = flickOf(p, pr.x0, pr.y0, x, y, d.narrow ? MAX_AIM_NARROW : undefined);
        if (f) fire(pr.pad, f.angle, { ...s.recipe, size: f.size });
        else if (Math.hypot(x - pr.x0, y - pr.y0) < TAP_SLOP && inRect(p.tubeHit, pr.x0, pr.y0)) {
          // Small hands tap the tube rather than drag: a low shell straight up.
          fire(pr.pad, 0, { ...s.recipe, size: 0.15 });
        }
        s.angle = 0;
      }
    },
    cancel(id) {
      const pr = presses.get(id);
      presses.delete(id);
      const s = pr ? pads[pr.pad] : null;
      if (s && pr?.kind === "flick") {
        s.charge = null;
        s.angle = 0;
      }
    },
    looks() {
      const t = d.now();
      pads.forEach((s, i) => {
        if (t - s.lastTouch > PAD_IDLE_MS && s.lastTouch > -Infinity) {
          const keep = { lastTouch: -Infinity, lastHuman: s.lastHuman, lastLaunch: s.lastLaunch };
          Object.assign(s, fresh(i), keep);
        }
        if (d.config.variant === "build" && t - s.aimAt > AIM_IDLE_MS && s.angle !== 0) {
          s.angle = Math.abs(s.angle) < 0.01 ? 0 : s.angle * 0.9;
        }
        looks[i] = {
          recipe: s.recipe,
          angle: s.angle,
          ready: t - s.lastLaunch >= PAD_COOLDOWN_MS && t >= s.busyUntil,
          attract: t - Math.max(s.lastLaunch, s.lastTouch) > ATTRACT_MS,
          launchedAt: s.launchedAt,
          refusedAt: s.refusedAt,
          charge: s.charge,
          padColor: padColor(d.globalPad(i)),
        };
      });
      return looks;
    },
    reset() {
      presses.clear();
      pads.forEach((_, i) => {
        pads[i] = fresh(i);
      });
    },
    resetPad(i) {
      const s = pads[i];
      if (!s) return;
      for (const [id, pr] of presses) if (pr.pad === i) presses.delete(id);
      pads[i] = {
        ...fresh(i),
        lastLaunch: s.lastLaunch,
        busyUntil: s.busyUntil,
        lastHuman: s.lastHuman,
      };
    },
    landed(i) {
      const s = pads[i];
      if (s) s.busyUntil = Math.min(s.busyUntil, d.now());
    },
    lastHuman(i) {
      return pads[i]?.lastHuman ?? -Infinity;
    },
    get count() {
      return pads.length;
    },
    get launches() {
      return launches;
    },
  };
};
