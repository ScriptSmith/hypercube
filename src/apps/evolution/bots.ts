/**
 * Bots play like visitors, through injected touches on the same paths: they tap the fish that
 * catch their eye (the most conspicuous of a few they glance at), and now and then one presses a
 * floor tile. Each bot keeps to one pond.
 */
import { type BotHand, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import type { Layout } from "./layout";
import type { Fish, Pond } from "./pond";

export interface Bots {
  update(now: number): void;
  release(): void;
  dispose(): void;
  readonly taps: number;
}

/** Seconds between a bot's taps, and its chance of pressing a floor tile instead. */
const TAP_MIN = 1.4;
const TAP_MAX = 3.6;
const FLOOR_CHANCE = 0.025;
const GLANCES = 4;

interface Bot {
  pond: number;
  hand: BotHand;
  next: number;
}

export const pickFish = (pond: Pond, rng: Rng): Fish | null => {
  const pool = pond.fish.filter((f) => f.state === "swim" && f.arriving <= 0);
  if (pool.length === 0) return null;
  let best: Fish | null = null;
  let score = -Infinity;
  for (let i = 0; i < GLANCES; i++) {
    const f = rng.pick(pool);
    const s = f.standout + rng.next() * 0.3;
    if (s > score) {
      best = f;
      score = s;
    }
  }
  return best;
};

export const createBots = (opts: {
  input: Input;
  count: number;
  ponds: () => readonly Pond[];
  layout: () => Layout;
  unit: () => number;
  rng: Rng;
}): Bots => {
  const rng = opts.rng;
  const bots: Bot[] = Array.from({ length: Math.max(0, Math.min(16, opts.count)) }, (_, i) => ({
    pond: i,
    hand: createBotHand(opts.input),
    next: rng.range(1, 3),
  }));
  let taps = 0;
  let disposed = false;
  return {
    update(now) {
      if (disposed) return;
      const ponds = opts.ponds();
      const l = opts.layout();
      const u = opts.unit();
      for (const b of bots) {
        if (now < b.next) continue;
        b.next = now + rng.range(TAP_MIN, TAP_MAX);
        const i = b.pond % Math.max(1, ponds.length);
        const pond = ponds[i];
        const pl = l.ponds[i];
        if (!pond || !pl) continue;
        if (rng.next() < FLOOR_CHANCE) {
          const tiles = pl.tiles.filter((t) => t.floor !== pond.floor);
          const t = tiles.length ? rng.pick(tiles) : null;
          if (t) {
            void b.hand.tap((t.box.x + t.box.w / 2) * u, (t.box.y + t.box.h / 2) * u, 90);
            taps++;
          }
          continue;
        }
        const f = pickFish(pond, rng);
        if (!f) continue;
        const jx = rng.range(-20, 20);
        const jy = rng.range(-20, 20);
        void b.hand.tap((f.x + jx) * u, (f.y + jy) * u, 70);
        taps++;
      }
    },
    release() {
      for (const b of bots) b.hand.release();
    },
    dispose() {
      disposed = true;
      for (const b of bots) b.hand.dispose();
      bots.length = 0;
    },
    get taps() {
      return taps;
    },
  };
};
