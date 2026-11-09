/**
 * A bot: injected touches through the runtime's input, as a visitor's finger would make them. It
 * turns and flicks the wheel, turns and taps the dial, drags the tilt and place sliders and
 * presses the buttons. It touches only what an adult can reach, and stands back for a while
 * after a person touches.
 */
import { type BotHand, type BotTouch, createBotHand } from "../../core/input";
import type { Input, Rect, Rng } from "../../core/types";
import { EARTH_TILT } from "./astro";
import { BRISBANE } from "./config";
import { latU, tiltU } from "./controls";
import { type Layout, sliderX } from "./layout";

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

export type Gesture =
  | "wheel"
  | "flick"
  | "dial"
  | "tap"
  | "tilt"
  | "place"
  | "spin"
  | "reset"
  | "flat"
  | "speed";

export interface Bot {
  readonly moves: Readonly<Record<Gesture, number>>;
  update(dt: number, now: number): void;
  release(): void;
  dispose(): void;
}

export const createBot = (o: {
  input: Pick<Input, "inject">;
  layout: () => Layout;
  unit: () => number;
  rng: Rng;
  /** Venue y of the top of adult reach. */
  reachTop: () => number;
  lastPerson: () => number;
  tilt: () => number;
  baseTilt: number;
  placeLat: (i: number) => number;
  /** Called just before the bot presses a UI kit button, which hides who pressed it. */
  markPress: () => void;
}): Bot => {
  const hand: BotHand = createBotHand(o.input);
  const rng = o.rng;
  const moves: Record<Gesture, number> = {
    wheel: 0,
    flick: 0,
    dial: 0,
    tap: 0,
    tilt: 0,
    place: 0,
    spin: 0,
    reset: 0,
    flat: 0,
    speed: 0,
  };
  let wait = rng.range(0.8, 2.5);
  let touch: BotTouch | null = null;
  let legs: Leg[] = [];
  let from: Point = { x: 0, y: 0 };
  let legT = 0;
  let kind: Gesture = "wheel";
  let yielding = false;
  let disposed = false;

  const at = (p: Point) => {
    const u = o.unit();
    return { x: p.x * u, y: p.y * u };
  };
  const reachable = (p: Point) => p.y >= o.reachTop() + 10;

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

  const arc = (
    c: { x: number; y: number; r: number },
    a0: number,
    d: number,
    rr: number,
    secs: number,
  ): { start: Point; legs: Leg[] } => {
    const pt = (a: number): Point => ({ x: c.x + rr * Math.cos(a), y: c.y - rr * Math.sin(a) });
    const n = Math.max(4, Math.ceil(Math.abs(d) / 0.12));
    return {
      start: pt(a0),
      legs: Array.from({ length: n }, (_, i) => ({ to: pt(a0 + (d * (i + 1)) / n), s: secs / n })),
    };
  };

  const turn = (g: "wheel" | "flick" | "dial"): boolean => {
    const l = o.layout();
    const c = g === "dial" ? l.dial : l.wheel;
    if (!c || !reachable({ x: c.x, y: c.y - c.r })) return false;
    const flick = g === "flick";
    // Mostly forwards: anticlockwise on the wheel, clockwise on the dial.
    const fwd = rng.next() < 0.75 ? 1 : -1;
    const d = (flick ? rng.range(1.2, 2) : rng.range(0.5, 2.4)) * (g === "dial" ? -fwd : fwd);
    const secs = flick ? rng.range(0.14, 0.2) : 0.6 + Math.abs(d) * 0.45;
    const a = arc(c, rng.range(0, Math.PI * 2), d, c.r * rng.range(0.55, 0.8), secs);
    if (!flick) a.legs.push({ to: a.legs[a.legs.length - 1]!.to, s: 0.2 });
    begin(g, a.start, a.legs);
    return true;
  };

  const tapDial = (): boolean => {
    const c = o.layout().dial;
    if (!c) return false;
    const a = rng.range(0, Math.PI * 2);
    const p = { x: c.x + c.r * 0.7 * Math.cos(a), y: c.y - c.r * 0.7 * Math.sin(a) };
    if (!reachable(p)) return false;
    begin("tap", p, [{ to: p, s: 0.08 }]);
    return true;
  };

  const drag = (g: "tilt" | "place", u0: number, u1: number, index = 0): boolean => {
    const l = o.layout();
    const s = g === "tilt" ? l.tilt : l.places[index];
    if (!s || !reachable({ x: s.x0, y: s.y })) return false;
    const x0 = sliderX(s, u0);
    const x1 = sliderX(s, u1);
    const steps = 12;
    const secs = 0.5 + Math.abs(u1 - u0) * 1.4;
    const path: Leg[] = Array.from({ length: steps }, (_, i) => ({
      to: { x: x0 + ((x1 - x0) * (i + 1)) / steps, y: s.y },
      s: secs / steps,
    }));
    path.push({ to: { x: x1, y: s.y }, s: 0.25 });
    begin(g, { x: x0, y: s.y }, path);
    return true;
  };

  const press = (g: Gesture, r: Rect | null): boolean => {
    if (!r) return false;
    const p = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    if (!reachable(p)) return false;
    o.markPress();
    begin(g, p, [{ to: p, s: 0.1 }]);
    return true;
  };

  const plan = () => {
    const l = o.layout();
    const r = rng.next();
    const tries: (() => boolean)[] = [];
    if (r < 0.32) tries.push(() => turn("wheel"));
    else if (r < 0.42) tries.push(() => turn("flick"));
    else if (r < 0.54) tries.push(() => turn("dial"));
    else if (r < 0.6) tries.push(tapDial);
    else if (r < 0.74 && l.tilt) {
      const targets = [0, EARTH_TILT, 45, 90, rng.range(5, 80)];
      tries.push(() => drag("tilt", tiltU(o.tilt()), tiltU(rng.pick(targets))));
    } else if (r < 0.84 && l.places.length > 0) {
      const i = rng.int(l.places.length);
      const targets = [BRISBANE.lat, 0, 51.5, -60, rng.range(-85, 85)];
      tries.push(() => drag("place", latU(o.placeLat(i)), latU(rng.pick(targets)), i));
    } else if (r < 0.9) tries.push(() => press("spin", l.spin));
    else if (r < 0.94 && l.resetTilt && Math.abs(o.tilt() - o.baseTilt) > 1) {
      tries.push(() => press("reset", l.resetTilt));
    } else if (r < 0.97 && l.flat) tries.push(() => press("flat", l.flat));
    else if (l.speeds.length > 0) tries.push(() => press("speed", rng.pick(l.speeds)));
    tries.push(() => turn("wheel"));
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
          wait = rng.range(1.5, 4);
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
      wait = rng.range(1, 2.5);
    },
    dispose() {
      disposed = true;
      stop();
      hand.dispose();
    },
  };
};
