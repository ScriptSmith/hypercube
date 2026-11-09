/**
 * The prize hatch at a wall cabinet's foot. A won prize drops down the chute out of sight, falls
 * into the hatch and lies there; the hatch shows a few at most, and the oldest fades away as a new
 * one lands or once it has lain there a while, as if someone had taken it.
 */
import type { Rng } from "../../core/types";
import type { DesignId } from "./designs";

/** Prizes lying in the hatch at most. */
export const TRAY_MAX = 4;
/** Seconds from the chute to the hatch, and of the fall into it. */
export const TRAY_DELAY_S = 0.55;
export const TRAY_FALL_S = 0.45;
/** Seconds a prize lies there before it fades, and how long the fade takes. */
export const TRAY_KEEP_S = 150;
export const TRAY_FADE_S = 2;
/** Prizes on their way or fading on top of those lying there, at most. */
const EXTRA = 4;

export interface TrayItem {
  id: number;
  design: DesignId;
  colour: number;
  /** Across the hatch, 0 to 1. */
  x: number;
  /** Turn when it comes to rest, radians, clockwise on the canvas. */
  angle: number;
  /** When it reaches the hatch's top, and when it began to fade (or null). */
  arrives: number;
  fading: number | null;
  /** The last time someone touched it, so it hops. */
  hop: number;
}

export interface TrayPose {
  /** 0 before it arrives, 0 to 1 as it falls in, 1 at rest. */
  fall: number;
  /** Height of a little bounce or hop, 0 to 1. */
  lift: number;
  alpha: number;
  angle: number;
}

export interface Tray {
  readonly items: readonly TrayItem[];
  /** Prizes that have landed. */
  readonly landed: number;
  /** The last time a prize landed. */
  readonly lastLanding: number;
  add(prize: { design: DesignId; colour: number }, now: number): TrayItem;
  /** Prizes already lying there when the show starts. */
  prefill(prizes: readonly { design: DesignId; colour: number }[], now: number): void;
  step(now: number): void;
  pose(it: TrayItem, now: number): TrayPose;
  /** A touch at `x` across the hatch, 0 to 1: the prizes near it hop. */
  poke(x: number, now: number): void;
  /** Prizes at rest and not fading. */
  resting(now: number): number;
}

export const createTray = (rng: Rng): Tray => {
  const items: TrayItem[] = [];
  let nextId = 1;
  let landed = 0;
  let lastLanding = Number.NEGATIVE_INFINITY;
  const counted = new Set<number>();

  const alive = () => items.filter((it) => it.fading === null);

  const spot = (): number => {
    // Somewhere across the hatch away from the newest prizes.
    const taken = alive()
      .slice(-2)
      .map((it) => it.x);
    let best = rng.range(0.2, 0.8);
    let bestD = -1;
    for (let i = 0; i < 6; i++) {
      const x = rng.range(0.18, 0.82);
      const d = Math.min(1, ...taken.map((t) => Math.abs(t - x)));
      if (d > bestD) {
        bestD = d;
        best = x;
      }
    }
    return best;
  };

  return {
    items,
    get landed() {
      return landed;
    },
    get lastLanding() {
      return lastLanding;
    },
    add(prize, now) {
      const it: TrayItem = {
        id: nextId++,
        design: prize.design,
        colour: prize.colour,
        x: spot(),
        angle: rng.range(-0.6, 0.6),
        arrives: now + TRAY_DELAY_S,
        fading: null,
        hop: Number.NEGATIVE_INFINITY,
      };
      items.push(it);
      const live = alive();
      if (live.length > TRAY_MAX) live[0]!.fading = it.arrives;
      while (items.length > TRAY_MAX + EXTRA) {
        const old = items.shift()!;
        counted.delete(old.id);
      }
      return it;
    },
    prefill(prizes, now) {
      for (const p of prizes.slice(0, TRAY_MAX)) {
        const it: TrayItem = {
          id: nextId++,
          design: p.design,
          colour: p.colour,
          x: spot(),
          angle: rng.range(-0.6, 0.6),
          arrives: now - TRAY_FALL_S - 1,
          fading: null,
          hop: Number.NEGATIVE_INFINITY,
        };
        items.push(it);
        counted.add(it.id);
      }
    },
    step(now) {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]!;
        if (!counted.has(it.id) && now >= it.arrives + TRAY_FALL_S) {
          counted.add(it.id);
          landed++;
          lastLanding = now;
        }
        if (it.fading === null && now - it.arrives > TRAY_KEEP_S) it.fading = now;
        if (it.fading !== null && now - it.fading >= TRAY_FADE_S) {
          items.splice(i, 1);
          counted.delete(it.id);
        }
      }
    },
    pose(it, now) {
      const t = now - it.arrives;
      const fall = Math.max(0, Math.min(1, t / TRAY_FALL_S));
      // A small bounce on landing, and a hop when touched.
      const b = t - TRAY_FALL_S;
      let lift = b > 0 && b < 0.35 ? 0.18 * Math.sin((b / 0.35) * Math.PI) : 0;
      const h = now - it.hop;
      if (h >= 0 && h < 0.5) lift = Math.max(lift, 0.35 * Math.sin((h / 0.5) * Math.PI));
      const alpha =
        it.fading === null ? 1 : Math.max(0, 1 - Math.max(0, now - it.fading) / TRAY_FADE_S);
      const spin = fall < 1 ? (1 - fall) * 1.4 : 0;
      return { fall, lift, alpha, angle: it.angle + spin };
    },
    poke(x, now) {
      for (const it of items) {
        if (it.fading !== null || now < it.arrives + TRAY_FALL_S) continue;
        if (Math.abs(it.x - x) < 0.22 && now - it.hop > 0.5) it.hop = now;
      }
    },
    resting(now) {
      return items.filter((it) => it.fading === null && now >= it.arrives + TRAY_FALL_S).length;
    },
  };
};
