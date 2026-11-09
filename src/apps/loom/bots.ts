/**
 * Bots: injected touches on the sliders and dials, through the runtime's input like fingers.
 * In `match` each bot works its harmonic towards the hint, overshooting a little and coming
 * back, now and then giving it another nudge so it stays live; in `free` it sets values at
 * random. A bot leaves its harmonic alone for a while after a person touches it.
 */
import { type BotHand, type BotTouch, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import { TAU } from "./config";
import { type Layout, sliderY } from "./layout";
import { phaseDelta, type Term } from "./series";
import type { Strand } from "./strands";

/** A bot stands back this long after a person touches its harmonic. */
export const BOT_YIELD_MS = 20_000;
/** A bot with nothing to do touches its harmonic again after this long, keeping it live. */
const NUDGE_MS = 4000;

interface Point {
  x: number;
  y: number;
}

interface Leg {
  to: Point;
  /** Seconds to get there. */
  s: number;
}

export interface Bot {
  readonly strand: number;
  /** Gestures finished. */
  readonly moves: number;
  update(dt: number, now: number): void;
  release(): void;
  dispose(): void;
}

export const createBot = (o: {
  input: Pick<Input, "inject">;
  strand: Strand;
  layout: () => Layout;
  unit: () => number;
  rng: Rng;
  /** The hint for this harmonic, or null (no target, or hints off). */
  hint: () => Term | null;
  /** The value the harmonic shows now. */
  value: () => Term;
  free: boolean;
}): Bot => {
  const hand: BotHand = createBotHand(o.input);
  const rng = o.rng;
  let wait = rng.range(0.8, 3);
  let touch: BotTouch | null = null;
  let legs: Leg[] = [];
  let from: Point = { x: 0, y: 0 };
  let legT = 0;
  let moves = 0;
  let yielding = false;
  let disposed = false;

  const spec = () => o.layout().strands[o.strand.index];

  const stop = () => {
    touch?.up();
    touch = null;
    legs = [];
  };

  const at = (p: Point) => {
    const u = o.unit();
    return { x: p.x * u, y: p.y * u };
  };

  const begin = (start: Point, path: Leg[]) => {
    const s = at(start);
    touch = hand.press(s.x, s.y);
    from = start;
    legs = path;
    legT = 0;
  };

  const sliderPlan = (goal: number) => {
    const s = spec();
    if (!s) return;
    const v = o.value();
    const x = s.slider.x + rng.range(-0.2, 0.2) * s.slider.w;
    const over = Math.max(
      0,
      Math.min(1, goal + Math.sign(goal - v.amp || 1) * rng.range(0.03, 0.12)),
    );
    const dist = Math.abs(over - v.amp) * Math.abs(s.slider.y0 - s.slider.y1);
    begin({ x, y: sliderY(s.slider, v.amp) }, [
      { to: { x, y: sliderY(s.slider, over) }, s: 0.25 + dist / 900 },
      { to: { x, y: sliderY(s.slider, over) }, s: rng.range(0.1, 0.35) },
      { to: { x, y: sliderY(s.slider, goal) }, s: rng.range(0.25, 0.5) },
      { to: { x, y: sliderY(s.slider, goal) }, s: 0.1 },
    ]);
  };

  const dialPlan = (turn: number) => {
    const s = spec();
    if (!s) return;
    const d = s.dial;
    const r = d.r * rng.range(0.55, 0.8);
    const a0 = rng.range(0, TAU);
    const over = turn + Math.sign(turn || 1) * rng.range(0.05, 0.3);
    const ring = (a: number): Point => ({ x: d.x + Math.cos(a) * r, y: d.y + Math.sin(a) * r });
    const path: Leg[] = [];
    const arc = (a: number, b: number, speed: number) => {
      const steps = Math.max(2, Math.ceil(Math.abs(b - a) / 0.12));
      for (let i = 1; i <= steps; i++) {
        path.push({ to: ring(a + ((b - a) * i) / steps), s: Math.abs(b - a) / steps / speed });
      }
    };
    arc(a0, a0 + over, rng.range(1.8, 3.2));
    path.push({ to: ring(a0 + over), s: rng.range(0.1, 0.3) });
    arc(a0 + over, a0 + turn, 1.5);
    path.push({ to: ring(a0 + turn), s: 0.1 });
    begin(ring(a0), path);
  };

  const plan = (now: number) => {
    const v = o.value();
    if (o.free) {
      if (rng.next() < 0.55) sliderPlan(rng.range(0, 1));
      else dialPlan(rng.range(-Math.PI, Math.PI));
      wait = rng.range(2, 6);
      return;
    }
    const h = o.hint();
    if (!h) {
      wait = rng.range(1, 2);
      return;
    }
    const ampErr = h.amp - v.amp;
    const turn = phaseDelta(v.phase, h.phase);
    const noise = () => rng.range(-0.02, 0.02);
    if (Math.abs(ampErr) > 0.04) sliderPlan(Math.max(0, Math.min(1, h.amp + noise())));
    else if (h.amp > 0.04 && Math.abs(turn) * Math.max(v.amp, 0.3) > 0.04) dialPlan(turn + noise());
    else if (now - o.strand.lastTouch > NUDGE_MS) {
      // Nothing to do, but a bot keeps its harmonic live, as someone standing there would.
      sliderPlan(Math.max(0, Math.min(1, h.amp + noise())));
    } else {
      wait = rng.range(1, 2);
      return;
    }
    wait = rng.range(1.2, 4.5);
  };

  return {
    strand: o.strand.index,
    get moves() {
      return moves;
    },
    update(dt, now) {
      if (disposed) return;
      if (now - o.strand.lastPerson < BOT_YIELD_MS) {
        if (!yielding) {
          stop();
          hand.release();
          yielding = true;
        }
        return;
      }
      yielding = false;
      if (touch) {
        if (!touch.active) {
          stop();
          return;
        }
        legT += dt;
        while (legs.length > 0 && legT >= legs[0]!.s) {
          legT -= legs[0]!.s;
          from = legs.shift()!.to;
        }
        if (legs.length === 0) {
          const p = at(from);
          touch.move(p.x, p.y);
          stop();
          moves++;
          return;
        }
        const leg = legs[0]!;
        const f = leg.s > 0 ? Math.min(1, legT / leg.s) : 1;
        const p = at({ x: from.x + (leg.to.x - from.x) * f, y: from.y + (leg.to.y - from.y) * f });
        touch.move(p.x, p.y);
        return;
      }
      wait -= dt;
      if (wait <= 0) plan(now);
    },
    release() {
      stop();
      hand.release();
      wait = rng.range(0.8, 2);
    },
    dispose() {
      disposed = true;
      stop();
      hand.dispose();
    },
  };
};
