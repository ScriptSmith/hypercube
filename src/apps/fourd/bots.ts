/**
 * Bots: injected touches on a stage's controls and view, so they take the same path as fingers
 * (the runtime's input, hit testing, controls.ts). Every few seconds a bot slides the lever or
 * flicks it, turns a dial, presses a "first" button, now and then picks another shape, or swings
 * the view. It leaves its stage alone while a person is using it.
 */
import { type BotHand, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import { leverX, type StageLayout } from "./layout";

export interface Bot {
  readonly stage: number;
  update(now: number): void;
  release(): void;
  dispose(): void;
  readonly actions: number;
}

export const createBot = (o: {
  input: Pick<Input, "inject">;
  stage: number;
  layout: () => StageLayout | undefined;
  unit: () => number;
  rng: Rng;
  /** True while a person is using the stage. */
  yieldNow: () => boolean;
}): Bot => {
  const hand: BotHand = createBotHand(o.input);
  let busy = false;
  let nextAt = 0;
  let actions = 0;
  let disposed = false;
  let yielding = false;
  const rng = o.rng;

  const act = (st: StageLayout): Promise<void> => {
    const u = o.unit();
    const at = (x: number, y: number) => ({ x: x * u, y: y * u });
    const r = rng.next();
    const lever = st.lever;
    if (lever && r < 0.36) {
      const t0 = rng.range(-1, 1);
      const flick = rng.next() < 0.3;
      const t1 = flick ? t0 + (t0 < 0 ? 0.35 : -0.35) : rng.range(-1, 1);
      return hand.drag(
        [at(leverX(lever, t0), lever.y), at(leverX(lever, t1), lever.y)],
        flick ? 140 : rng.range(900, 2000),
      );
    }
    if (st.dials.length > 0 && r < 0.68) {
      const d = st.dials[rng.int(st.dials.length)]!;
      const a0 = rng.range(0, Math.PI * 2);
      const turn = (rng.next() < 0.5 ? -1 : 1) * rng.range(0.6, 2.4);
      const steps = 24;
      const path = Array.from({ length: steps + 1 }, (_, i) => {
        const a = a0 + (turn * i) / steps;
        return at(d.x + Math.cos(a) * d.r * 0.72, d.y + Math.sin(a) * d.r * 0.72);
      });
      return hand.drag(path, rng.range(1000, 2400));
    }
    if (st.orients.length > 0 && r < 0.82) {
      const b = st.orients[rng.int(st.orients.length)]!.rect;
      const p = at(b.x + b.width / 2, b.y + b.height / 2);
      return hand.tap(p.x, p.y);
    }
    if (st.shapes.length > 0 && r < 0.89) {
      const b = st.shapes[rng.int(st.shapes.length)]!.rect;
      const p = at(b.x + b.width / 2, b.y + b.height / 2);
      return hand.tap(p.x, p.y);
    }
    const v = st.views[st.views.length - 1];
    if (!v) return Promise.resolve();
    const f = v.focus;
    const y = f.y + f.height * rng.range(0.3, 0.7);
    const x0 = f.x + f.width * rng.range(0.25, 0.4);
    const x1 = f.x + f.width * rng.range(0.6, 0.75);
    const [a, b] = rng.next() < 0.5 ? [x0, x1] : [x1, x0];
    return hand.drag([at(a, y), at(b, y + rng.range(-60, 60))], rng.range(500, 1100));
  };

  return {
    stage: o.stage,
    get actions() {
      return actions;
    },
    update(now) {
      if (disposed) return;
      if (o.yieldNow()) {
        if (!yielding) {
          hand.release();
          yielding = true;
        }
        nextAt = now + 2000;
        return;
      }
      yielding = false;
      if (busy || now < nextAt) return;
      const st = o.layout();
      if (!st) return;
      busy = true;
      actions++;
      act(st)
        .catch(() => undefined)
        .then(() => {
          busy = false;
          nextAt = performance.now() + rng.range(1500, 4500);
        });
    },
    release() {
      hand.release();
    },
    dispose() {
      disposed = true;
      hand.dispose();
    },
  };
};
