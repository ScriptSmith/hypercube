/**
 * Bots: the autopilot driving an arm with injected touches, so they take the same path as
 * fingers (the runtime's input, hit testing, controls.ts). A bot leaves its arm alone for a
 * while after a person touches it.
 */
import { type BotHand, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import type { Cell } from "./cell";
import { BOT_YIELD_MS } from "./config";
import { createDriver, type Driver, type Hand } from "./driver";
import type { CellLayout } from "./layout";

export interface Bot {
  readonly cell: number;
  readonly driver: Driver;
  update(dt: number, now: number): void;
  release(): void;
  dispose(): void;
}

/** A Hand in venue px over the runtime's bot hand in stage px. */
const injected = (hand: BotHand, unit: () => number): Hand => ({
  press(x, y) {
    const u = unit();
    const t = hand.press(x * u, y * u);
    return {
      get active() {
        return t.active;
      },
      move(nx, ny) {
        const k = unit();
        t.move(nx * k, ny * k);
      },
      up() {
        t.up();
      },
    };
  },
});

export const createBot = (o: {
  input: Pick<Input, "inject">;
  cell: Cell;
  layout: () => CellLayout | undefined;
  unit: () => number;
  rng: Rng;
  speed: number;
}): Bot => {
  const hand = createBotHand(o.input);
  const driver = createDriver({
    cell: o.cell,
    layout: o.layout,
    hand: injected(hand, o.unit),
    rng: o.rng,
    speed: o.speed,
    restAtHome: false,
    // A jammed arm goes home, as a person would give up and press reset.
    onStuck: () => o.cell.home(),
  });
  let yielding = false;
  let disposed = false;
  return {
    cell: o.cell.index,
    driver,
    update(dt, now) {
      if (disposed) return;
      if (now - o.cell.lastHuman < BOT_YIELD_MS) {
        if (!yielding) {
          driver.release();
          hand.release();
          yielding = true;
        }
        return;
      }
      yielding = false;
      driver.update(dt);
    },
    release() {
      driver.release();
      hand.release();
    },
    dispose() {
      disposed = true;
      driver.release();
      hand.dispose();
    },
  };
};
