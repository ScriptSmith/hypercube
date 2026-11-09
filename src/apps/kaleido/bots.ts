/**
 * Bot pourers: synthetic fingers through `input.inject`, so they take the same path as people.
 * Each rests, then touches somewhere in the reach band and draws a swirl (a circle, a figure of
 * eight or a slow wave) for a few seconds, then lifts.
 */
import { type BotTouch, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";

export const MAX_BOTS = 6;

export interface BotArea {
  /** Venue px: where fingers may go. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Bots {
  update(dt: number, active: number): void;
  release(): void;
  readonly touching: number;
  dispose(): void;
}

type Shape = "circle" | "eight" | "wave" | "still";

interface Bot {
  touch: BotTouch | null;
  timer: number;
  shape: Shape;
  cx: number;
  cy: number;
  r: number;
  speed: number;
  t: number;
  dir: number;
}

export const createBots = (
  input: Pick<Input, "inject">,
  rng: Rng,
  area: () => BotArea,
  unit: () => number,
): Bots => {
  const hand = createBotHand(input);
  const bots: Bot[] = Array.from({ length: MAX_BOTS }, (_, i) => ({
    touch: null,
    timer: rng.range(0.2, 1.5) + i * 0.4,
    shape: "circle",
    cx: 0,
    cy: 0,
    r: 0,
    speed: 1,
    t: 0,
    dir: 1,
  }));

  const at = (b: Bot): { x: number; y: number } => {
    const a = b.t * b.speed * b.dir;
    switch (b.shape) {
      case "circle":
        return { x: b.cx + Math.cos(a) * b.r, y: b.cy + Math.sin(a) * b.r * 0.8 };
      case "eight":
        return { x: b.cx + Math.sin(a) * b.r * 1.2, y: b.cy + Math.sin(2 * a) * b.r * 0.5 };
      case "wave":
        return { x: b.cx + (a / Math.PI - 1) * b.r * 1.5, y: b.cy + Math.sin(a * 1.6) * b.r * 0.4 };
      default:
        return { x: b.cx + Math.sin(a * 3) * 6, y: b.cy };
    }
  };

  const lift = (b: Bot) => {
    b.touch?.up();
    b.touch = null;
  };

  return {
    get touching() {
      return bots.filter((b) => b.touch?.active).length;
    },
    update(dt, active) {
      const u = unit();
      bots.forEach((b, i) => {
        if (i >= active) {
          if (b.touch) lift(b);
          return;
        }
        b.timer -= dt;
        if (b.touch) {
          b.t += dt;
          const p = at(b);
          b.touch.move(p.x * u, p.y * u);
          if (b.timer <= 0 || !b.touch.active) {
            lift(b);
            b.timer = rng.range(0.8, 3.5);
          }
          return;
        }
        if (b.timer > 0) return;
        const a = area();
        const span = a.x1 - a.x0;
        const tall = a.y1 - a.y0;
        b.shape = rng.pick<Shape>(["circle", "circle", "eight", "wave", "still"]);
        b.r = Math.min(span * 0.2, rng.range(80, 220));
        b.cx = rng.range(a.x0 + b.r * 1.5, Math.max(a.x0 + b.r * 1.5 + 1, a.x1 - b.r * 1.5));
        b.cy = rng.range(
          a.y0 + Math.min(tall * 0.3, b.r),
          Math.max(a.y0 + 1, a.y1 - Math.min(tall * 0.3, b.r)),
        );
        b.speed = rng.range(1.2, 2.6);
        b.dir = rng.next() < 0.5 ? -1 : 1;
        b.t = 0;
        b.timer = rng.range(2, 6);
        const p = at(b);
        b.touch = hand.press(p.x * u, p.y * u);
      });
    },
    release() {
      for (const b of bots) lift(b);
      hand.release();
    },
    dispose() {
      for (const b of bots) lift(b);
      hand.dispose();
    },
  };
};
