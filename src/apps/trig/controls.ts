/**
 * Fingers on the circle, the wheel and the graph, turning one angle. Pure apart from the
 * angle it drives; venue px and ms throughout.
 *
 * - The point: drag it and it follows the finger round the circle.
 * - The ring (or anywhere inside the circle): turns it by as much as the finger goes round the
 *   centre, so a wall's reachable lower half turns it all the way round. A tap goes to the
 *   tapped angle, or to the tick mark it is near.
 * - The wheel: turns it one to one; a flick coasts.
 * - The graph: the finger's position along it sets the angle. A tap near a tick goes there.
 *
 * The latest finger leads. An earlier one still down is ignored until the leader lifts; then
 * it leads again from where things are.
 */
import type { Angle } from "./angle";
import { DEG, TAU } from "./config";
import { angleAbout, graphTheta, type Hit, hitAt, type Layout, type Pic, ringOf } from "./layout";
import { nearestSpecial, shortest } from "./maths";

/** A press shorter than this, moving less than TAP_MOVE, is a tap. */
export const TAP_MS = 350;
export const TAP_MOVE = 36;
/** A tap this close to a tick mark goes to it. */
export const TICK_TOL = 7 * DEG;
/** Window (ms) over which the wheel's flick speed is measured. */
const FLICK_MS = 90;

interface Touch {
  id: number;
  hit: Hit;
  person: boolean;
  downAt: number;
  x0: number;
  y0: number;
  /** Where it was last. */
  x: number;
  y: number;
  moved: number;
  /** The finger's last angle about the circle or wheel centre. */
  last: number | null;
  /** Wheel: recent (time, total turn) samples for the flick. */
  samples: { t: number; a: number }[];
  total: number;
}

export interface Controls {
  /** Hit test and take hold; false if the finger isn't on a control. */
  down(id: number, x: number, y: number, t: number, person: boolean): boolean;
  move(id: number, x: number, y: number, t: number): void;
  up(id: number, t: number): void;
  cancel(id: number, t: number): void;
  /** Lift everything (idle, resize). */
  clear(t: number): void;
  /** The leading finger's control, or null. */
  readonly leading: Hit | null;
  /** True while a person's finger is down on a control. */
  readonly personDown: boolean;
  readonly count: number;
}

export const createControls = (o: {
  layout: () => Layout;
  /** The picture as drawn now (it slides between the zoomed circle and the full one). */
  pic?: () => Pic;
  /** Whether the graph is shown, so it can be scrubbed. */
  graphs?: () => boolean;
  angle: Angle;
  /** A finger took hold of a control (the frame leaves the walk-through). */
  onTake?(hit: Hit, person: boolean, t: number): void;
}): Controls => {
  const touches = new Map<number, Touch>();
  let leader: number | null = null;
  const picOf = () => o.pic?.() ?? o.layout().pic;

  const centreOf = (hit: Hit): { x: number; y: number; r: number } | null => {
    const l = o.layout();
    if (hit === "wheel") return l.wheel ? { x: l.wheel.x, y: l.wheel.y, r: l.wheel.r } : null;
    const p = picOf();
    if (hit === "point" || hit === "ring") return { x: p.cx, y: p.cy, r: p.r };
    return null;
  };

  /** Turning about a centre is unreliable right next to it. */
  const fingerAngle = (hit: Hit, x: number, y: number): number | null => {
    const c = centreOf(hit);
    if (!c) return null;
    const d = Math.hypot(x - c.x, y - c.y);
    const min = hit === "wheel" ? c.r * 0.12 : ringOf(picOf()).inner * (hit === "point" ? 0.5 : 1);
    return d < min ? null : angleAbout(c.x, c.y, x, y);
  };

  const lead = (tc: Touch, x: number, y: number, t: number) => {
    leader = tc.id;
    tc.last = fingerAngle(tc.hit, x, y);
    tc.samples = [{ t, a: 0 }];
    tc.total = 0;
    o.angle.grab(t);
    if (tc.hit === "point" && tc.last !== null) o.angle.setTo(tc.last, t, true);
    if (tc.hit === "graph") o.angle.setTo(graphTheta(picOf(), x), t, false);
  };

  const apply = (tc: Touch, x: number, y: number, t: number) => {
    switch (tc.hit) {
      case "point": {
        const a = fingerAngle("point", x, y);
        if (a !== null) o.angle.setTo(a, t, true);
        tc.last = a;
        break;
      }
      case "ring":
      case "wheel": {
        const a = fingerAngle(tc.hit, x, y);
        if (a === null) {
          tc.last = null;
          break;
        }
        if (tc.last !== null) {
          const d = shortest(tc.last, a);
          tc.total += d;
          o.angle.turnBy(d, t);
        }
        tc.last = a;
        if (tc.hit === "wheel") {
          tc.samples.push({ t, a: tc.total });
          while (tc.samples.length > 2 && t - tc.samples[0]!.t > FLICK_MS) tc.samples.shift();
        }
        break;
      }
      case "graph":
        o.angle.setTo(graphTheta(picOf(), x), t, false);
        break;
    }
  };

  const flick = (tc: Touch, t: number): number => {
    const s = tc.samples;
    if (s.length < 2) return 0;
    const first = s[0]!;
    const last = s[s.length - 1]!;
    // A finger that stopped before lifting has no flick.
    if (t - last.t > 60) return 0;
    const dt = (last.t - first.t) / 1000;
    return dt > 0.01 ? (last.a - first.a) / dt : 0;
  };

  const tap = (tc: Touch, t: number) => {
    if (tc.hit === "ring" || tc.hit === "point") {
      const a = fingerAngle("ring", tc.x0, tc.y0);
      if (a === null) return false;
      o.angle.goTo(nearestSpecial(a, TICK_TOL) ?? a, t);
      return true;
    }
    if (tc.hit === "graph") {
      const a = graphTheta(picOf(), tc.x0);
      const near = nearestSpecial(a, TICK_TOL);
      // The graph's ends are 0 and a full turn; a tap near the right end means 360°.
      const target = near === null ? a : near === 0 && a > Math.PI ? TAU : near;
      o.angle.goTo(target, t);
      return true;
    }
    return false;
  };

  const end = (id: number, t: number, cancelled: boolean) => {
    const tc = touches.get(id);
    if (!tc) return;
    touches.delete(id);
    if (leader !== id) return;
    leader = null;
    const isTap = !cancelled && t - tc.downAt < TAP_MS && tc.moved < TAP_MOVE;
    // An earlier finger still down leads again.
    let next: Touch | null = null;
    for (const other of touches.values()) if (!next || other.downAt > next.downAt) next = other;
    if (isTap && tap(tc, t)) {
      if (next) leader = next.id;
      return;
    }
    if (next) {
      lead(next, next.x, next.y, t);
      return;
    }
    o.angle.release(t, tc.hit === "wheel" && !cancelled ? flick(tc, t) : undefined);
  };

  return {
    down(id, x, y, t, person) {
      const hit = hitAt(o.layout(), picOf(), o.angle.theta, x, y, o.graphs?.() ?? true);
      if (!hit) return false;
      const tc: Touch = {
        id,
        hit,
        person,
        downAt: t,
        x0: x,
        y0: y,
        x,
        y,
        moved: 0,
        last: null,
        samples: [],
        total: 0,
      };
      touches.set(id, tc);
      lead(tc, x, y, t);
      o.onTake?.(hit, person, t);
      return true;
    },
    move(id, x, y, t) {
      const tc = touches.get(id);
      if (!tc) return;
      tc.moved = Math.max(tc.moved, Math.hypot(x - tc.x0, y - tc.y0));
      tc.x = x;
      tc.y = y;
      if (leader === id) apply(tc, x, y, t);
    },
    up(id, t) {
      end(id, t, false);
    },
    cancel(id, t) {
      end(id, t, true);
    },
    clear(t) {
      const held = leader !== null;
      touches.clear();
      leader = null;
      if (held) o.angle.release(t);
    },
    get leading() {
      return leader === null ? null : (touches.get(leader)?.hit ?? null);
    },
    get personDown() {
      for (const tc of touches.values()) if (tc.person) return true;
      return false;
    },
    get count() {
      return touches.size;
    },
  };
};
