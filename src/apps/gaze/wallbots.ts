/**
 * Bot visitors for the wall, so the eye has someone to look at in tests and soaks: each walks up
 * now and then, touches the wall within reach (a child's lower), holds a moment, sometimes slides
 * the finger along, sometimes strokes the wall back and forth for a few seconds, and sometimes
 * pokes the eye itself. They use injected touches, so they take the same path as fingers, and
 * stand back while a person is at the wall.
 */
import { type BotHand, type BotTouch, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";

export interface WallBotSpec {
  /** Stage size, CSS px. */
  stage(): { width: number; height: number };
  /** Stage y of the top of adult and child reach. */
  reach(): { adult: number; child: number };
  /** The eye on the stage, CSS px, if known. */
  ball(): { x: number; y: number; r: number } | null;
}

export interface WallBots {
  /** Bot fingers down now. */
  readonly touches: number;
  update(dt: number, active: boolean): void;
  dispose(): void;
}

/** At most this many bot visitors at once, whatever `bots` asks for. */
export const MAX_WALL_BOTS = 3;
/** Shares of touches on the eye itself and in a child's reach, and of touches that slide or stroke. */
const ON_EYE = 0.15;
const CHILD = 0.35;
const SLIDE = 0.22;
export const BOT_STROKE = {
  share: 0.12,
  /** Half a sweep, a share of the stage's width; a sweep there and back, seconds; how long. */
  amp: [0.015, 0.03] as [number, number],
  period: [0.9, 1.5] as [number, number],
  hold: [3, 7] as [number, number],
};

interface Visitor {
  timer: number;
  touch: BotTouch | null;
  from: { x: number; y: number };
  to: { x: number; y: number };
  hold: number;
  held: number;
  stroke: { amp: number; period: number } | null;
}

export const createWallBots = (
  input: Pick<Input, "inject">,
  count: number,
  rng: Rng,
  spec: WallBotSpec,
): WallBots => {
  const hand: BotHand = createBotHand(input);
  const n = Math.max(0, Math.min(MAX_WALL_BOTS, Math.round(count)));
  const visitors: Visitor[] = Array.from({ length: n }, (_, i) => ({
    timer: 1 + i * rng.range(1.5, 3),
    touch: null,
    from: { x: 0, y: 0 },
    to: { x: 0, y: 0 },
    hold: 0,
    held: 0,
    stroke: null,
  }));

  /** Somewhere to touch; with `clear`, that far (CSS px) to either side stays off the eye. */
  const spot = (others: Visitor[], clear = -1): { x: number; y: number } => {
    const st = spec.stage();
    const reach = spec.reach();
    const ball = spec.ball();
    const bottom = st.height * 0.97;
    if (ball && clear < 0 && rng.next() < ON_EYE) {
      // The lower half of the eye, where it is in reach.
      const top = Math.max(ball.y + ball.r * 0.2, reach.adult);
      const low = Math.min(ball.y + ball.r * 0.85, bottom);
      if (low > top) {
        return { x: ball.x + rng.range(-0.5, 0.5) * ball.r, y: rng.range(top, low) };
      }
    }
    const child = rng.next() < CHILD;
    const top = child ? reach.child : reach.adult;
    // Failing better, beside the eye.
    let best = { x: st.width * (clear >= 0 ? 0.2 : 0.5), y: (top + bottom) / 2 };
    let bestGap = -1;
    // A few tries for somewhere clear of the other visitors.
    for (let i = 0; i < 4; i++) {
      const p = { x: rng.range(0.06, 0.94) * st.width, y: rng.range(top, bottom) };
      let gap = Infinity;
      for (const o of others) if (o.touch) gap = Math.min(gap, Math.abs(o.touch.x - p.x));
      if (ball && clear >= 0) {
        const dx = Math.max(0, Math.abs(p.x - ball.x) - clear);
        if (Math.hypot(dx, p.y - ball.y) < ball.r * 1.15) gap = -1;
      }
      if (gap > bestGap) {
        bestGap = gap;
        best = p;
      }
    }
    return best;
  };

  const lift = (v: Visitor) => {
    v.touch?.up();
    v.touch = null;
  };

  return {
    get touches() {
      return hand.touches;
    },
    update(dt, active) {
      for (const v of visitors) {
        if (!active) {
          lift(v);
          v.timer = Math.max(v.timer, 1);
          continue;
        }
        v.timer -= dt;
        if (!v.touch) {
          if (v.timer > 0) continue;
          const st = spec.stage();
          if (rng.next() < BOT_STROKE.share) {
            const amp = rng.range(...BOT_STROKE.amp) * st.width;
            v.stroke = { amp, period: rng.range(...BOT_STROKE.period) };
            v.from = spot(visitors, amp);
            v.to = v.from;
            v.hold = rng.range(...BOT_STROKE.hold);
            v.held = 0;
            v.touch = hand.press(v.from.x, v.from.y);
            continue;
          }
          v.stroke = null;
          v.from = spot(visitors);
          const slide = rng.next() < SLIDE;
          const along = slide ? rng.range(0.06, 0.25) * st.width * (rng.next() < 0.5 ? -1 : 1) : 0;
          v.to = {
            x: Math.max(0, Math.min(st.width, v.from.x + along)),
            y: v.from.y + (slide ? rng.range(-0.05, 0.05) * st.height : 0),
          };
          v.hold = slide ? rng.range(1.2, 3) : rng.range(0.4, 3.5);
          v.held = 0;
          v.touch = hand.press(v.from.x, v.from.y);
          continue;
        }
        v.held += dt;
        if (v.stroke) {
          const k = (2 * Math.PI * v.held) / v.stroke.period;
          v.touch.move(
            v.from.x + v.stroke.amp * Math.sin(k),
            v.from.y + 0.12 * v.stroke.amp * Math.sin(0.6 * k),
          );
        } else if (v.to.x !== v.from.x || v.to.y !== v.from.y) {
          const t = Math.min(1, v.held / v.hold);
          const e = t * t * (3 - 2 * t);
          v.touch.move(v.from.x + (v.to.x - v.from.x) * e, v.from.y + (v.to.y - v.from.y) * e);
        }
        if (v.held >= v.hold) {
          lift(v);
          v.timer = rng.range(1.5, 7);
        }
      }
    },
    dispose() {
      hand.dispose();
    },
  };
};
