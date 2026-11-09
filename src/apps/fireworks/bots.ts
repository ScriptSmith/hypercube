/**
 * Bots work the pads with real (injected) touches: now and then they change a recipe and swipe
 * the tube, or flick. Every so often, on a beat taken from the shared clock and the room seed,
 * every bot in the group fires together, so a bank of bots sets off volleys with no messages.
 * A bot leaves its pad alone for a while after a person touches it.
 */
import { type BotHand, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import type { Config } from "./config";
import { aimKnob, type PadLayout } from "./pads";
import { hash01 } from "./records";

export interface PadBotsDeps {
  input: Input;
  layouts: readonly PadLayout[];
  config: Config;
  /** Stage px per venue px. */
  unit(): number;
  /** Which pads have bots. */
  pads: readonly number[];
  rng: Rng;
  /** Shared clock ms, for the volley beat. */
  clock(): number;
  seed: number;
  /** UI ms. */
  now(): number;
  lastHuman(i: number): number;
  ready(i: number): boolean;
}

export interface PadBots {
  update(): void;
  release(): void;
  dispose(): void;
}

const YIELD_MS = 15_000;
const BEAT_MS = 14_000;

interface Bot {
  pad: number;
  hand: BotHand;
  next: number;
  busy: boolean;
  beat: number;
}

export const createPadBots = (d: PadBotsDeps): PadBots => {
  const bots: Bot[] = d.pads.map((pad) => ({
    pad,
    hand: createBotHand(d.input),
    next: d.now() + d.rng.range(400, 2500),
    busy: false,
    beat: -1,
  }));
  let disposed = false;

  const at = (x: number, y: number) => ({ x: x * d.unit(), y: y * d.unit() });

  const run = (b: Bot, work: () => Promise<void>) => {
    b.busy = true;
    work()
      .catch(() => {})
      .finally(() => {
        b.busy = false;
      });
  };

  const swipe = (b: Bot) => {
    const p = d.layouts[b.pad];
    if (!p) return Promise.resolve();
    const x = p.tube.x + d.rng.range(-20, 20);
    const y = p.tube.base - p.tube.length * 0.45;
    return b.hand.drag([at(x, y), at(x + d.rng.range(-10, 10), y - 220)], 160);
  };

  const flick = (b: Bot) => {
    const p = d.layouts[b.pad];
    if (!p?.flick) return Promise.resolve();
    const x0 = d.rng.range(p.x0 + 120, p.x1 - 120);
    const y0 = p.tube.base - d.rng.range(40, 200);
    const angle = d.rng.range(-0.35, 0.35);
    const len = d.rng.range(180, p.flickMax);
    return b.hand.drag(
      [at(x0, y0), at(x0 + Math.sin(angle) * len, y0 - Math.cos(angle) * len)],
      d.rng.range(180, 320),
    );
  };

  const play = async (b: Bot, quick: boolean) => {
    const p = d.layouts[b.pad];
    if (!p) return;
    if (d.config.variant === "flick") {
      await flick(b);
      return;
    }
    if (!quick) {
      const buttons = [p.color, p.shape, p.size].filter((c) => c !== null);
      const taps = buttons.length ? d.rng.int(3) : 0;
      for (let i = 0; i < taps && !disposed; i++) {
        const c = d.rng.pick(buttons);
        await b.hand.tap(at(c.x, c.y).x, at(c.x, c.y).y, 90);
        await wait(d.rng.range(180, 420));
      }
      if (p.aim && d.rng.next() < 0.3) {
        const from = aimKnob(p.aim, 0);
        const to = aimKnob(p.aim, d.rng.range(-p.aim.max, p.aim.max) * 0.8);
        await b.hand.drag([at(from.x, from.y), at(to.x, to.y)], 260);
        await wait(200);
      }
    }
    if (!disposed) await swipe(b);
  };

  return {
    update() {
      const t = d.now();
      const clock = d.clock();
      const w = Math.floor(clock / BEAT_MS);
      const beatAt = w * BEAT_MS + BEAT_MS / 2;
      const together = hash01(d.seed, w) < 0.45;
      for (const b of bots) {
        if (b.busy || t - d.lastHuman(b.pad) < YIELD_MS) continue;
        if (together && b.beat !== w && clock >= beatAt && clock < beatAt + 1500) {
          b.beat = w;
          if (d.ready(b.pad)) {
            const delay = d.rng.range(0, 600);
            b.busy = true;
            window.setTimeout(() => {
              b.busy = false;
              if (!disposed) run(b, () => play(b, true));
            }, delay);
            b.next = t + d.rng.range(4000, 9000);
            continue;
          }
        }
        if (t < b.next) continue;
        b.next = t + d.rng.range(3500, 9000);
        if (d.ready(b.pad)) run(b, () => play(b, false));
      }
    },
    release() {
      for (const b of bots) {
        b.hand.release();
        b.busy = false;
      }
    },
    dispose() {
      disposed = true;
      for (const b of bots) b.hand.dispose();
    },
  };
};

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
