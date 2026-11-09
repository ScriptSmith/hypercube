/**
 * Bots: the autopilot steering a board with injected touches on its pad (or one lever of a pair
 * in together mode), so they take the same path as fingers. The finger glides towards where the
 * pilot wants it rather than jumping, lifts while there's no ball to steer, and the bot leaves
 * the board alone for a while after a person touches it.
 */
import { type BotHand, type BotTouch, createBotHand } from "../../core/input";
import type { Input } from "../../core/types";
import type { Board } from "./board";
import { BOT_YIELD_MS } from "./config";
import { PAD_REACH } from "./controls";
import type { BoardSlot } from "./layout";
import type { Pilot } from "./pilot";

export interface Bot {
  readonly board: number;
  readonly axis: "both" | "h" | "v";
  readonly pilot: Pilot;
  /** True while it has a finger down. */
  readonly active: boolean;
  update(dt: number, now: number): void;
  release(): void;
  dispose(): void;
}

/** Fastest a bot's finger moves, venue px per second. */
const FINGER_SPEED = 2600;

export const createBot = (o: {
  input: Pick<Input, "inject">;
  board: Board;
  slot: () => BoardSlot | undefined;
  unit: () => number;
  pilot: Pilot;
  axis: "both" | "h" | "v";
}): Bot => {
  const hand: BotHand = createBotHand(o.input);
  let touch: BotTouch | null = null;
  let fx = 0;
  let fy = 0;
  let disposed = false;

  const lift = () => {
    touch?.up();
    touch = null;
  };

  /** Where the finger should be for a command, venue px. */
  const spot = (slot: BoardSlot, cx: number, cy: number) => {
    if (o.axis === "both" && slot.pad) {
      const p = slot.pad;
      return { x: p.x + cx * p.r * PAD_REACH, y: p.y + cy * p.r * PAD_REACH };
    }
    const l = slot.levers?.[o.axis === "v" ? "v" : "h"];
    if (!l) return null;
    const f = ((o.axis === "v" ? cy : cx) + 1) / 2;
    return { x: l.x0 + (l.x1 - l.x0) * f, y: l.y0 + (l.y1 - l.y0) * f };
  };

  return {
    board: o.board.index,
    axis: o.axis,
    pilot: o.pilot,
    get active() {
      return touch?.active === true;
    },
    update(dt, now) {
      if (disposed) return;
      const b = o.board;
      if (now - b.lastHuman < BOT_YIELD_MS) {
        lift();
        o.pilot.reset();
        return;
      }
      const c = o.pilot.update(dt, b);
      const slot = o.slot();
      if (!slot || (b.phase !== "roll" && b.phase !== "enter")) {
        lift();
        return;
      }
      const target = spot(slot, c.x, c.y);
      if (!target) return;
      const u = o.unit();
      if (!touch?.active) {
        // Put the finger down near the middle and glide out from there.
        const mid = spot(slot, 0, 0)!;
        fx = mid.x;
        fy = mid.y;
        touch = hand.press(fx * u, fy * u);
      }
      const dx = target.x - fx;
      const dy = target.y - fy;
      const l = Math.hypot(dx, dy);
      const step = FINGER_SPEED * dt;
      if (l > step) {
        fx += (dx / l) * step;
        fy += (dy / l) * step;
      } else {
        fx = target.x;
        fy = target.y;
      }
      touch.move(fx * u, fy * u);
    },
    release() {
      lift();
      hand.release();
    },
    dispose() {
      disposed = true;
      lift();
      hand.dispose();
    },
  };
};
