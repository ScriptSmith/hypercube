/**
 * A bot: injected touches through the runtime's input, as a finger would make them. It drags
 * the point, turns the ring, turns and flicks the wheel, scrubs the graph, taps tick marks,
 * toggles a function off and on again, and in `steps` presses Next and Back. It only touches
 * what an adult could reach, and stands back for a while after a person touches.
 */
import { type BotHand, type BotTouch, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import { DEG, type Fn, TAU } from "./config";
import { graphX, type Layout, type Pic, pointAt } from "./layout";
import { SPECIAL } from "./maths";

/** A bot stands back this long after a person touches. */
export const BOT_YIELD_MS = 20_000;

interface Point {
  x: number;
  y: number;
}

interface Leg {
  to: Point;
  /** Seconds to get there. */
  s: number;
}

export type Gesture = "point" | "ring" | "wheel" | "flick" | "graph" | "tick" | "toggle" | "step";

export interface Bot {
  /** Gestures finished, by kind. */
  readonly moves: Readonly<Record<Gesture, number>>;
  update(dt: number, now: number): void;
  release(): void;
  dispose(): void;
}

export const createBot = (o: {
  input: Pick<Input, "inject">;
  layout: () => Layout;
  /** The picture as drawn now. */
  pic: () => Pic;
  /** Whether the graph can be scrubbed now. */
  graphs: () => boolean;
  unit: () => number;
  rng: Rng;
  theta: () => number;
  /** Venue y of the top of adult reach. */
  reachTop: () => number;
  lastPerson: () => number;
  toggles: () => readonly { fn: Fn; on: boolean }[];
  steps: boolean;
}): Bot => {
  const hand: BotHand = createBotHand(o.input);
  const rng = o.rng;
  const moves: Record<Gesture, number> = {
    point: 0,
    ring: 0,
    wheel: 0,
    flick: 0,
    graph: 0,
    tick: 0,
    toggle: 0,
    step: 0,
  };
  let wait = rng.range(0.6, 2);
  let touch: BotTouch | null = null;
  let legs: Leg[] = [];
  let from: Point = { x: 0, y: 0 };
  let legT = 0;
  let kind: Gesture = "point";
  let yielding = false;
  let disposed = false;

  const at = (p: Point) => {
    const u = o.unit();
    return { x: p.x * u, y: p.y * u };
  };
  const reachable = (p: Point) => p.y >= o.reachTop() + 20;

  const begin = (g: Gesture, start: Point, path: Leg[]) => {
    const s = at(start);
    kind = g;
    touch = hand.press(s.x, s.y);
    from = start;
    legs = path;
    legT = 0;
  };

  const stop = () => {
    touch?.up();
    touch = null;
    legs = [];
  };

  const ringPoint = (a: number, rr: number): Point => {
    const p = o.pic();
    return { x: p.cx + rr * Math.cos(a), y: p.cy - rr * Math.sin(a) };
  };

  /** Legs along an arc about the circle's centre. */
  const arcLegs = (a0: number, a1: number, rr: number, secs: number): Leg[] => {
    const n = Math.max(3, Math.ceil(Math.abs(a1 - a0) / 0.1));
    return Array.from({ length: n }, (_, i) => ({
      to: ringPoint(a0 + ((a1 - a0) * (i + 1)) / n, rr),
      s: secs / n,
    }));
  };

  const target = () => SPECIAL[rng.int(SPECIAL.length - 1)]!;

  const dragPoint = (): boolean => {
    const p = o.pic();
    const th = o.theta();
    const start = pointAt(p, th);
    if (!reachable(start)) return false;
    let d = target() - th;
    d -= Math.round(d / TAU) * TAU;
    if (Math.abs(d) < 10 * DEG) d = rng.next() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    const legsOut = arcLegs(th, th + d, p.r, 0.5 + Math.abs(d) * 0.5);
    if (!legsOut.every((g) => reachable(g.to))) return false;
    begin("point", start, [...legsOut, { to: legsOut[legsOut.length - 1]!.to, s: 0.25 }]);
    return true;
  };

  /** Turn by the ring where it can be reached: on a wall, its lower half. */
  const turnRing = (): boolean => {
    const rr = o.pic().r * rng.range(0.85, 1.05);
    const dir = rng.next() < 0.5 ? -1 : 1;
    let a: number;
    let b: number;
    if (reachable(ringPoint(Math.PI / 2, rr))) {
      a = rng.range(0, TAU);
      b = a + dir * rng.range(0.6, 2.2);
    } else {
      a = rng.range(1.12, 1.32) * Math.PI;
      b = rng.range(1.68, 1.88) * Math.PI;
      if (dir < 0) [a, b] = [b, a];
      if (!reachable(ringPoint(a, rr)) || !reachable(ringPoint(b, rr))) return false;
    }
    begin("ring", ringPoint(a, rr), [
      ...arcLegs(a, b, rr, 0.5 + Math.abs(b - a) * 0.45),
      { to: ringPoint(b, rr), s: 0.2 },
    ]);
    return true;
  };

  const turnWheel = (flick: boolean): boolean => {
    const w = o.layout().wheel;
    if (!w) return false;
    const rr = w.r * rng.range(0.55, 0.8);
    const a0 = rng.range(0, TAU);
    const d = (flick ? rng.range(1.2, 2.2) : rng.range(0.4, 2.6)) * (rng.next() < 0.5 ? -1 : 1);
    const pt = (a: number): Point => ({ x: w.x + rr * Math.cos(a), y: w.y - rr * Math.sin(a) });
    const n = Math.max(4, Math.ceil(Math.abs(d) / 0.12));
    const secs = flick ? rng.range(0.14, 0.22) : 0.5 + Math.abs(d) * 0.5;
    const path: Leg[] = Array.from({ length: n }, (_, i) => ({
      to: pt(a0 + (d * (i + 1)) / n),
      s: secs / n,
    }));
    if (!flick) path.push({ to: pt(a0 + d), s: 0.2 });
    begin(flick ? "flick" : "wheel", pt(a0), path);
    return true;
  };

  const scrub = (): boolean => {
    if (!o.graphs()) return false;
    const p = o.pic();
    const y = Math.max(
      o.reachTop() + 60,
      Math.min(p.bottom - 40, p.cy + p.r * rng.range(-0.6, 0.9)),
    );
    if (y < p.top || y > p.bottom) return false;
    const x1 = graphX(p, target());
    const x0 = graphX(p, o.theta());
    const steps = 10;
    const path: Leg[] = Array.from({ length: steps }, (_, i) => ({
      to: { x: x0 + ((x1 - x0) * (i + 1)) / steps, y },
      s: (0.6 + Math.abs(x1 - x0) / (p.s * 4)) / steps,
    }));
    path.push({ to: { x: x1, y }, s: 0.3 });
    begin("graph", { x: x0, y }, path);
    return true;
  };

  const tapTick = (): boolean => {
    for (let i = 0; i < 6; i++) {
      const a = target();
      const pt = ringPoint(a, o.pic().r);
      if (!reachable(pt)) continue;
      begin("tick", pt, [{ to: pt, s: 0.08 }]);
      return true;
    }
    return false;
  };

  const tapRect = (g: Gesture, r: { x: number; y: number; width: number; height: number }) => {
    const pt = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    begin(g, pt, [{ to: pt, s: 0.1 }]);
    return true;
  };

  const toggle = (): boolean => {
    const l = o.layout();
    const states = o.toggles();
    const off = states.find((s) => !s.on);
    const pick = off ?? states[rng.int(states.length)];
    const spec = pick && l.toggles.find((t) => t.fn === pick.fn);
    return spec ? tapRect("toggle", spec.rect) : false;
  };

  const press = (): boolean => {
    const l = o.layout();
    const r = rng.next() < 0.75 ? l.next : l.back;
    return r ? tapRect("step", r) : false;
  };

  let done = 0;
  const plan = () => {
    // Anything switched off goes back on soon.
    if (o.toggles().some((s) => !s.on) && rng.next() < 0.6 && toggle()) return;
    // Like a visitor, turn the angle a few times before trying the toggles.
    const r = done++ < 4 ? rng.next() * 0.9 : rng.next();
    const tries: (() => boolean)[] =
      o.steps && r < 0.25
        ? [press]
        : r < 0.22
          ? [dragPoint, turnRing]
          : r < 0.42
            ? [turnRing, turnWheel.bind(null, false)]
            : r < 0.58
              ? [turnWheel.bind(null, false)]
              : r < 0.68
                ? [turnWheel.bind(null, true)]
                : r < 0.82
                  ? [scrub, turnRing]
                  : r < 0.92
                    ? [tapTick, turnWheel.bind(null, false)]
                    : [toggle];
    for (const t of tries) if (t()) return;
  };

  return {
    get moves() {
      return moves;
    },
    update(dt, now) {
      if (disposed) return;
      if (now - o.lastPerson() < BOT_YIELD_MS) {
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
          moves[kind]++;
          wait = rng.range(1.2, 3.5);
          return;
        }
        const leg = legs[0]!;
        const f = leg.s > 0 ? Math.min(1, legT / leg.s) : 1;
        const p = at({ x: from.x + (leg.to.x - from.x) * f, y: from.y + (leg.to.y - from.y) * f });
        touch.move(p.x, p.y);
        return;
      }
      wait -= dt;
      if (wait <= 0) {
        plan();
        if (!touch) wait = rng.range(0.5, 1.5);
      }
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
