/**
 * Bots: the autopilot's plan turned into injected touches on a crane's pad, release button and
 * block buttons, through the runtime's input like any finger. The same bot works on a crane
 * simulated here and on a bank frame whose crane lives on the screen (it reads whichever
 * readout it is given). A bot stands back for a while after a person touches its crane.
 */
import { type BotHand, type BotTouch, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import { BOT_YIELD_MS, KIND } from "./config";
import { boxToPad } from "./controls";
import type { Readout } from "./crane";
import type { CraneLayout } from "./layout";
import { createPilot, type Pilot } from "./pilot";

export interface Bot {
  readonly crane: number;
  readonly pilot: Pilot;
  readonly sent: number;
  update(
    dt: number,
    now: number,
    o: { readout: Readout | null; room: number; lastHuman: number },
  ): void;
  release(): void;
  dispose(): void;
}

/** Fewest ms between a bot's injected moves. */
const MOVE_MS = 33;

export const createBot = (o: {
  input: Pick<Input, "inject">;
  crane: number;
  layout: () => CraneLayout | undefined;
  unit: () => number;
  rng: Rng;
}): Bot => {
  const hand: BotHand = createBotHand(o.input);
  let finger: BotTouch | null = null;
  let movedAt = 0;
  let clock = 0;
  let sendAt = 1500 + o.rng.range(0, 2500);
  let sent = 0;
  let yielding = false;
  let disposed = false;

  const toStage = (p: { x: number; y: number }) => {
    const u = o.unit();
    return { x: p.x * u, y: p.y * u };
  };

  const pilot = createPilot({
    rng: o.rng.fork("pilot"),
    sloppy: true,
    hand: {
      aim(x, y) {
        const l = o.layout();
        if (!l) return;
        const p = toStage(boxToPad(l.pad, x, y));
        if (!finger?.active) {
          finger = hand.press(p.x, p.y);
          movedAt = clock;
          return;
        }
        if (clock - movedAt < MOVE_MS) return;
        movedAt = clock;
        finger.move(p.x, p.y);
      },
      release() {
        const l = o.layout();
        if (!l) return;
        const p = toStage({ x: l.release.x, y: l.release.y });
        void hand.tap(p.x, p.y, 90);
      },
      rest() {
        finger?.up();
        finger = null;
      },
    },
  });

  const sendBlock = (room: number) => {
    const l = o.layout();
    if (!l || room <= 0 || l.buttons.length === 0) return;
    // Mostly floors, now and then a roof.
    const roofs = l.buttons.filter((b) => b.kind === KIND.roof);
    const floors = l.buttons.filter((b) => b.kind !== KIND.roof);
    const pool = roofs.length > 0 && o.rng.next() < 0.18 ? roofs : floors;
    const b = o.rng.pick(pool.length > 0 ? pool : l.buttons);
    const p = toStage({ x: b.rect.x + b.rect.width / 2, y: b.rect.y + b.rect.height / 2 });
    void hand.tap(p.x, p.y, 90);
    sent++;
  };

  return {
    crane: o.crane,
    pilot,
    get sent() {
      return sent;
    },
    update(dt, now, s) {
      if (disposed) return;
      clock += dt * 1000;
      if (now - s.lastHuman < BOT_YIELD_MS) {
        if (!yielding) {
          pilot.reset();
          hand.release();
          finger = null;
          yielding = true;
        }
        return;
      }
      yielding = false;
      if (clock >= sendAt) {
        sendAt = clock + 2600 + o.rng.range(0, 3400);
        sendBlock(s.room);
      }
      if (s.readout) pilot.update(dt, s.readout);
    },
    release() {
      pilot.reset();
      hand.release();
      finger = null;
    },
    dispose() {
      disposed = true;
      hand.dispose();
      finger = null;
    },
  };
};
