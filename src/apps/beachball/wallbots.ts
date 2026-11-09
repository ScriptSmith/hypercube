/**
 * Bot players for the wall: synthetic fingers through `input.inject`, so they take the same
 * path as people's. Each one keeps to its own stretch of the wall and reaches only as high as an
 * adult can. It waits for a ball to come within reach, then taps it up, picks it up and throws
 * it, or swipes up through it as it falls, and rests a moment before the next go. Now and then
 * it flips or throws a toy instead, pokes the crab to watch it snap, and near a net it sometimes
 * throws a ball over it.
 */
import { type BotTouch, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";

export const MAX_BOTS = 3;

/** A ball as the bots see it, in stage px (y down) and px a second. */
export interface BotBall {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  held: boolean;
}

export interface BotView {
  balls(): readonly BotBall[];
  /** Toys, seen the same way, with `r` about the size of a hand's target on them. */
  props?(): readonly BotBall[];
  /** Stage x of the net, or null for none. */
  netX?(): number | null;
  /** The crab's body in stage px, and whether it is busy (running, snapping or upside down). */
  crab?(): { x: number; y: number; r: number; busy: boolean } | null;
  width(): number;
  height(): number;
  /** Stage y of the top of adult reach. */
  reachTop(): number;
}

export type BotMove = "tap" | "throw" | "bat";

export interface WallBots {
  update(dt: number, active: boolean): void;
  release(): void;
  readonly touching: number;
  readonly moves: Readonly<Record<BotMove, number>>;
  /** Throws aimed over the net, goes spent on a toy, and pokes at the crab. */
  readonly volleys: number;
  readonly toys: number;
  readonly crab: number;
  dispose(): void;
}

interface Point {
  x: number;
  y: number;
}

interface Bot {
  touch: BotTouch | null;
  wait: number;
  path: Point[];
  t: number;
  dur: number;
}

const along = (path: readonly Point[], u: number): Point => {
  if (path.length === 1) return path[0]!;
  const f = Math.min(0.9999, Math.max(0, u)) * (path.length - 1);
  const i = Math.floor(f);
  const k = f - i;
  const a = path[i]!;
  const b = path[i + 1]!;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
};

export const createWallBots = (
  input: Pick<Input, "inject">,
  rng: Rng,
  view: BotView,
  count: number,
): WallBots => {
  const hand = createBotHand(input);
  const n = Math.max(0, Math.min(MAX_BOTS, count));
  const bots: Bot[] = Array.from({ length: n }, (_, i) => ({
    touch: null,
    wait: 0.6 + i * 0.9 + rng.range(0, 0.6),
    path: [],
    t: 0,
    dur: 0,
  }));
  const moves: Record<BotMove, number> = { tap: 0, throw: 0, bat: 0 };
  let volleys = 0;
  let toys = 0;
  let crabPokes = 0;
  /**
   * Share of goes spent on a toy when one is in reach, of throws near a net sent over it, and of
   * goes spent poking the crab when it is near.
   */
  const TOY = 0.3;
  const VOLLEY = 0.5;
  const CRAB = 0.15;

  /** A press on the crab, held a moment so it has time to snap. */
  const poke = (b: Bot, home: number): boolean => {
    const c = view.crab?.();
    if (!c || c.busy || c.y < view.reachTop() || Math.abs(c.x - home) > 0.6 * view.width()) {
      return false;
    }
    const at = inside({ x: c.x + rng.range(-0.3, 0.3) * c.r, y: c.y + rng.range(-0.3, 0.2) * c.r });
    b.path = [at, inside({ x: at.x + rng.range(-0.2, 0.2) * c.r, y: at.y })];
    b.dur = rng.range(0.5, 1.1);
    b.t = 0;
    b.touch = hand.press(at.x, at.y);
    crabPokes++;
    return true;
  };

  const lift = (b: Bot) => {
    b.touch?.up();
    b.touch = null;
  };

  const inside = (p: Point): Point => ({
    x: Math.min(view.width() - 2, Math.max(2, p.x)),
    y: Math.min(view.height() - 2, Math.max(view.reachTop(), p.y)),
  });

  const pickFrom = (list: readonly BotBall[], home: number) => {
    const w = view.width();
    const top = view.reachTop();
    let best: BotBall | null = null;
    let bestScore = Infinity;
    for (const ball of list) {
      if (ball.held || ball.y - ball.r * 0.3 < top) continue;
      // Rising things are left to come back down.
      if (ball.vy < -ball.r) continue;
      const score = Math.abs(ball.x - home) / w;
      if (score < bestScore && score < 0.6) {
        best = ball;
        bestScore = score;
      }
    }
    return best;
  };

  const plan = (b: Bot, i: number): boolean => {
    const w = view.width();
    const home = ((i + 0.5) / n) * w;
    if (rng.next() < CRAB && poke(b, home)) return true;
    const toy = rng.next() < TOY ? pickFrom(view.props?.() ?? [], home) : null;
    const best = toy ?? pickFrom(view.balls(), home);
    if (!best) return false;
    const r = best.r;
    const falling = best.vy > r * 0.5;
    const resting = Math.hypot(best.vx, best.vy) < r * 0.2;
    const roll = rng.next();
    const side = best.x < home ? 1 : -1;
    let move: BotMove;
    if (toy) move = roll < 0.55 ? "tap" : "throw";
    else if (falling) move = roll < 0.7 ? "bat" : "tap";
    else if (resting) move = roll < 0.45 ? "tap" : "throw";
    else move = roll < 0.5 ? "tap" : "throw";
    if (toy) toys++;
    const net = view.netX?.() ?? null;
    if (move === "tap") {
      const at = inside({
        x: best.x + rng.range(-0.45, 0.45) * r,
        y: best.y + rng.range(0, 0.5) * r,
      });
      b.path = [at];
      b.dur = rng.range(0.07, 0.13);
    } else if (move === "throw") {
      const start = inside({ x: best.x, y: best.y });
      const over = !toy && net !== null && Math.abs(net - best.x) < 0.33 * w && rng.next() < VOLLEY;
      // A volley is a long, quick flick up and towards the net.
      const reach = over ? rng.range(0.3, 0.38) * view.height() : rng.range(2.5, 5) * r;
      const dir = over
        ? Math.sign(net - best.x) * rng.range(0.45, 0.8)
        : side * rng.range(0.2, 0.9);
      const end = inside({ x: start.x + dir * reach, y: start.y - reach });
      const mid = inside({ x: (start.x + end.x) / 2 - dir * r * 0.3, y: (start.y + end.y) / 2 });
      b.path = [start, start, mid, end];
      b.dur = over ? rng.range(0.2, 0.26) : rng.range(0.28, 0.45);
      if (over) volleys++;
    } else {
      const lead = 0.18;
      const px = best.x + best.vx * lead;
      const py = best.y + best.vy * lead;
      b.path = [
        inside({ x: px - side * 1.5 * r, y: py + 1.3 * r }),
        inside({ x: px + side * 0.6 * r, y: py - 1.4 * r }),
      ];
      b.dur = rng.range(0.14, 0.22);
    }
    moves[move]++;
    b.t = 0;
    const p = b.path[0]!;
    b.touch = hand.press(p.x, p.y);
    return true;
  };

  return {
    get touching() {
      return bots.filter((b) => b.touch?.active).length;
    },
    moves,
    get volleys() {
      return volleys;
    },
    get toys() {
      return toys;
    },
    get crab() {
      return crabPokes;
    },
    update(dt, active) {
      bots.forEach((b, i) => {
        if (!active) {
          if (b.touch) lift(b);
          b.wait = Math.max(b.wait, 1 + i * 0.5);
          return;
        }
        if (b.touch) {
          b.t += dt;
          const u = b.t / b.dur;
          const p = along(b.path, u);
          b.touch.move(p.x, p.y);
          if (u >= 1 || !b.touch.active) {
            lift(b);
            b.wait = rng.range(1.2, 3.6);
          }
          return;
        }
        b.wait -= dt;
        if (b.wait > 0) return;
        if (!plan(b, i)) b.wait = 0.4;
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
