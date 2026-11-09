/**
 * Bot hands for the wall: synthetic touches through `input.inject`, so they take the same path as
 * fingers. Each rests, then picks a ball nobody is touching that is waiting or has shown its answer
 * a while, and taps it or shakes it from side to side within reach, then rests again.
 */
import { type BotHand, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";

export const MAX_BOTS = 3;

export interface BotBall {
  /** Centre and outline radius, stage px. */
  x: number;
  y: number;
  r: number;
  /** Whether a bot may shake it now. */
  free: boolean;
}

export interface WallBots {
  update(dt: number, active: number): void;
  release(): void;
  dispose(): void;
}

export const createWallBots = (
  input: Pick<Input, "inject">,
  rng: Rng,
  balls: () => readonly BotBall[],
  /** Stage y of the top of adult reach and of the floor, and stage px per venue px. */
  area: () => { top: number; floor: number; unit: number },
): WallBots => {
  const hand: BotHand = createBotHand(input);
  const timers = Array.from({ length: MAX_BOTS }, (_, i) => rng.range(1, 3) + i * 1.5);
  const busy = Array.from({ length: MAX_BOTS }, () => false);
  const claimed = new Set<number>();

  const go = (bot: number) => {
    const list = balls();
    const open = list.map((b, i) => (b.free && !claimed.has(i) ? i : -1)).filter((i) => i >= 0);
    if (open.length === 0) return;
    const i = rng.pick(open);
    const b = list[i]!;
    const { top, floor, unit } = area();
    // Somewhere on the ball's lower half that a hand reaches.
    const y0 = Math.max(top + 40 * unit, b.y - 0.1 * b.r);
    const y1 = Math.max(y0, Math.min(floor - 0.12 * b.r, b.y + 0.85 * b.r));
    const y = rng.range(y0, y1);
    const half = Math.sqrt(Math.max(0, b.r * b.r - (y - b.y) ** 2)) * 0.7;
    const x = b.x + rng.range(-half, half);
    claimed.add(i);
    busy[bot] = true;
    const done = () => {
      claimed.delete(i);
      busy[bot] = false;
    };
    if (rng.next() < 0.3) {
      void hand.tap(x, y, rng.range(70, 140)).then(done);
      return;
    }
    const strokes = 2 + rng.int(4);
    const dx = rng.range(100, 280) * unit;
    const tilt = rng.range(-0.4, 0.4);
    const path = [{ x, y }];
    for (let k = 0; k < strokes; k++) {
      const s = k % 2 === 0 ? 1 : -1;
      path.push({ x: x + s * dx, y: y + s * dx * tilt + rng.range(-20, 20) * unit });
    }
    path.push({ x, y });
    void hand.drag(path, rng.range(600, 1400)).then(done);
  };

  return {
    update(dt, active) {
      for (let k = 0; k < MAX_BOTS; k++) {
        if (k >= active || busy[k]) continue;
        timers[k]! -= dt;
        if (timers[k]! > 0) continue;
        timers[k] = rng.range(4, 9);
        go(k);
      }
    },
    release() {
      hand.release();
      claimed.clear();
      busy.fill(false);
    },
    dispose() {
      hand.dispose();
      claimed.clear();
    },
  };
};
