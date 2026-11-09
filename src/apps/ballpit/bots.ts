/**
 * Bots tap the answer buttons with real (injected) touches, each at a fresh spot on the button,
 * picking answers by the question's bot weights. They start with a
 * quick burst so a fresh frame soon has something in its tubes, and they leave the buttons alone
 * for a while after a person touches the frame. Their touches are synthetic, so a press only shows
 * a faded ball in the pipe: it is never counted, stored or sent.
 */
import { type BotHand, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import { BOT_YIELD_MS } from "./config";
import type { ButtonSpot } from "./layout";
import type { Question } from "./questions";

export interface BotTarget {
  question: Question;
  buttons: readonly ButtonSpot[];
}

export interface BotDeps {
  input: Input;
  count: number;
  rng: Rng;
  /** Local ms. */
  now(): number;
  /** Stage px per venue px. */
  unit(): number;
  /** What can be tapped now. */
  targets(): readonly BotTarget[];
  lastHuman(): number;
}

export interface Bots {
  update(): void;
  release(): void;
  dispose(): void;
}

const BURST_MS = 6000;
/** Spots on a button, far apart, which bots take in turn (each starting at its own). */
const SPOTS = [
  [0.15, 0.2],
  [0.85, 0.8],
  [0.85, 0.2],
  [0.15, 0.8],
] as const;

export const createBots = (d: BotDeps): Bots => {
  const start = d.now();
  const hands: { hand: BotHand; next: number; taps: number }[] = Array.from(
    { length: Math.max(0, d.count) },
    (_, i) => ({
      hand: createBotHand(d.input),
      next: start + d.rng.range(200, 900),
      taps: i,
    }),
  );

  const pick = (t: BotTarget): ButtonSpot | null => {
    if (t.buttons.length === 0) return null;
    let sum = 0;
    for (const b of t.buttons) sum += Math.max(0.01, t.question.answers[b.answer]?.bot ?? 1);
    let x = d.rng.next() * sum;
    for (const b of t.buttons) {
      x -= Math.max(0.01, t.question.answers[b.answer]?.bot ?? 1);
      if (x <= 0) return b;
    }
    return t.buttons[t.buttons.length - 1]!;
  };

  return {
    update() {
      const t = d.now();
      if (t - d.lastHuman() < BOT_YIELD_MS) return;
      for (const h of hands) {
        if (t < h.next) continue;
        const burst = t - start < BURST_MS;
        h.next = t + (burst ? d.rng.range(250, 700) : d.rng.range(1400, 4200));
        const targets = d.targets();
        if (targets.length === 0) continue;
        const b = pick(d.rng.pick(targets));
        if (!b) continue;
        const u = d.unit();
        const [fx, fy] = SPOTS[h.taps++ % SPOTS.length]!;
        const x = (b.x + b.w * (fx + d.rng.range(-0.05, 0.05))) * u;
        const y = (b.y + b.h * (fy + d.rng.range(-0.05, 0.05))) * u;
        void h.hand.tap(x, y, d.rng.range(60, 140));
      }
    },
    release() {
      for (const h of hands) h.hand.release();
    },
    dispose() {
      for (const h of hands) h.hand.dispose();
    },
  };
};
