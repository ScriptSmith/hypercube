/**
 * The marble run as it moves: balls shoot up tubes, hop out onto the top rail, roll and drop
 * from rail to rail and fall into the jar; a full jar celebrates, opens its trapdoor, empties and
 * closes. No general physics: balls follow the plan's paths, queued so they never overlap, and
 * every list is bounded.
 *
 * Tube balls run on the shared clock, so a ball that leaves a frame's tube and the same ball
 * entering the screen's tube above are at the same height at the same moment on both. Positions
 * are glass metres (see runplan.ts); `depth` is 0 in the tubes' plane and 1 in the rails'.
 */
import {
  entryOn,
  pathFor,
  type Point,
  pointAt,
  type RunPath,
  type RunPlan,
  segmentAt,
  tubeTop,
} from "./runplan";

export type BallState = "tube" | "top" | "hop" | "rail" | "drop" | "jar" | "out";

export interface RunBall {
  id: number;
  color: number;
  human: boolean;
  state: BallState;
  x: number;
  y: number;
  depth: number;
  /** Rolled angle about the depth axis, radians. */
  spin: number;
  alpha: number;
  tube: number;
  /** Tube kinematics: y = y0 + v0 t + a t^2 / 2 up to vmax, from t0 (shared ms). */
  t0: number;
  y0: number;
  v0: number;
  a: number;
  vmax: number;
  /** Above this height (glass), the ball has left the frame for the screen; Infinity if not. */
  exit: number;
  /** When (shared ms) and how fast (m/s) it crosses `exit`; past it, it rises steadily. */
  te: number;
  ve: number;
  path: number;
  s: number;
  /** A hop or a drop: from, to, elapsed and length (s). */
  from: Point;
  to: Point;
  t: number;
  T: number;
  slot: number;
  vx: number;
  vy: number;
}

export interface Tube {
  x: number;
  yBase: number;
}

export type JarPhase = "fill" | "full" | "open" | "close";

export type RunEvent =
  | { type: "landed"; slot: number; color: number }
  | { type: "full" }
  | { type: "emptied" }
  | { type: "left"; tube: number };

export interface Run {
  readonly plan: RunPlan | null;
  readonly balls: readonly RunBall[];
  readonly tubes: readonly Tube[];
  readonly jar: { count: number; phase: JarPhase; phaseT: number; door: number };
  readonly events: RunEvent[];
  readonly counts: { arrived: number; jarred: number; emptied: number; refused: number };
  setPlan(plan: RunPlan | null): void;
  setTubes(tubes: readonly Tube[]): void;
  /** Shoot a ball up a tube from its base now (or at `at`, shared ms), into this run's rails. */
  launch(tube: number, color: number, human: boolean, at?: number): boolean;
  /**
   * Shoot a ball up and out of the frame, crossing `edge` (glass y) at the returned time (shared
   * ms) and speed (m/s), never to come back.
   */
  launchOut(
    tube: number,
    color: number,
    human: boolean,
    edge: number,
  ): { t: number; v: number } | null;
  /** A ball coming up into this run's tube from below: at height `y` at shared ms `t`, rising at `v`. */
  arrive(tube: number, color: number, human: boolean, t: number, y: number, v: number): boolean;
  step(dt: number): void;
  /** Open the trapdoor now (admin). */
  empty(): void;
  /** Take every ball out, and empty the jar. */
  clear(): void;
}

/** Tube acceleration and top speed, in radii per second (squared). */
export const TUBE_A = 200;
export const TUBE_V = 58;
/** Rolling speed on the rails and gravity for drops, in radii per second (squared). */
export const ROLL_V = 18;
export const FALL_G = 200;
export const HOP_S = 0.32;
export const FULL_S = 2.2;
export const OPEN_S = 1.6;
export const CLOSE_S = 0.4;
/** Closest two balls come along a tube or a rail, in radii. */
const GAP = 2.15;
const MAX_TUBE_QUEUE = 5;
const MAX_EVENTS = 32;

export const tubeY = (b: RunBall, t: number): number => {
  const tau = (t - b.t0) / 1000;
  if (tau <= 0) return b.y0;
  if (b.a <= 0) return b.y0 + b.v0 * tau;
  const tCap = Math.max(0, (b.vmax - b.v0) / b.a);
  if (tau <= tCap) return b.y0 + b.v0 * tau + 0.5 * b.a * tau * tau;
  return b.y0 + b.v0 * tCap + 0.5 * b.a * tCap * tCap + b.vmax * (tau - tCap);
};

/** When (ms after t0) and how fast a ball with these kinematics reaches height `y`. */
export const reachTime = (y0: number, a: number, vmax: number, y: number) => {
  const d = Math.max(0, y - y0);
  const tCap = vmax / a;
  const dCap = 0.5 * a * tCap * tCap;
  if (d <= dCap) {
    const t = Math.sqrt((2 * d) / a);
    return { t: t * 1000, v: a * t };
  }
  return { t: (tCap + (d - dCap) / vmax) * 1000, v: vmax };
};

export const createRun = (now: () => number, maxBalls = 90): Run => {
  let plan: RunPlan | null = null;
  let tubes: Tube[] = [];
  const balls: RunBall[] = [];
  const events: RunEvent[] = [];
  const counts = { arrived: 0, jarred: 0, emptied: 0, refused: 0 };
  const jar = { count: 0, phase: "fill" as JarPhase, phaseT: 0, door: 0 };
  let assigned = 0;
  let nextId = 1;
  const tmp: Point = { x: 0, y: 0 };

  const push = (e: RunEvent) => {
    if (events.length >= MAX_EVENTS) events.shift();
    events.push(e);
  };

  const make = (tube: number, color: number, human: boolean): RunBall | null => {
    const t = tubes[tube];
    if (!t || balls.length >= maxBalls) {
      counts.refused++;
      return null;
    }
    const queued = balls.filter(
      (b) => b.tube === tube && (b.state === "tube" || b.state === "top"),
    );
    if (queued.length >= MAX_TUBE_QUEUE) {
      counts.refused++;
      return null;
    }
    return {
      id: nextId++,
      color,
      human,
      state: "tube",
      x: t.x,
      y: t.yBase,
      depth: 0,
      spin: 0,
      alpha: 1,
      tube,
      t0: now(),
      y0: t.yBase,
      v0: 0,
      a: 0,
      vmax: 0,
      exit: Number.POSITIVE_INFINITY,
      te: 0,
      ve: 0,
      path: -1,
      s: 0,
      from: { x: 0, y: 0 },
      to: { x: 0, y: 0 },
      t: 0,
      T: 0,
      slot: -1,
      vx: 0,
      vy: 0,
    };
  };

  const rb = () => plan?.rb ?? 0.02;
  /** Ball radius as it looks in the tubes' plane (the rails may be nearer or farther). */
  const tb = () => plan?.tubeRb ?? 0.02;

  const openDoor = () => {
    jar.phase = "open";
    jar.phaseT = 0;
    for (const b of balls) {
      if (b.state !== "jar" && b.state !== "drop") continue;
      b.state = "out";
      b.vx = (Math.random() - 0.5) * 0.6 * rb() * 10;
      b.vy = 0;
      b.t = 0;
    }
    jar.count = 0;
    assigned = 0;
  };

  /**
   * Whether a ball may hop onto `path` at arc length `s` now: nothing there, and nothing coming
   * along the rail that would get there during the hop.
   */
  const clearAt = (pi: number, s: number) => {
    const gap = GAP * rb();
    const coming = ROLL_V * rb() * HOP_S * 1.2;
    for (const b of balls) {
      if (b.path !== pi || (b.state !== "rail" && b.state !== "hop")) continue;
      if (b.s > s - gap - coming && b.s < s + gap) return false;
    }
    return true;
  };

  const stepTubes = () => {
    if (!plan) return;
    const t = now();
    const r = plan.tubeRb;
    for (let ti = 0; ti < tubes.length; ti++) {
      const tube = tubes[ti]!;
      const path = pathFor(plan, tube.x);
      const pi = path ? plan.paths.indexOf(path) : -1;
      const top = path ? tubeTop(plan, path, tube.x) : tube.yBase;
      const list = balls
        .filter((b) => b.tube === ti && (b.state === "tube" || b.state === "top"))
        .sort((a, b) => tubeY(b, t) - tubeY(a, t));
      let ceiling = Number.POSITIVE_INFINITY;
      for (const b of list) {
        if (t < b.t0) {
          // Not launched yet (or still below, on its way up to a screen): not in the tube.
          b.alpha = 0;
          continue;
        }
        let y = b.exit < Infinity && t >= b.te ? b.exit + (b.ve * (t - b.te)) / 1000 : tubeY(b, t);
        if (y > b.exit + 2.6 * r) {
          b.state = "out";
          b.alpha = 0;
          b.t = OPEN_S;
          push({ type: "left", tube: ti });
          continue;
        }
        const limit = Math.min(ceiling, b.exit === Number.POSITIVE_INFINITY ? top : Infinity);
        if (y > limit) {
          if (b.state === "tube" && limit < top - 1e-9) {
            // Held up by the ball ahead: start rising again from here when it moves.
            b.t0 = t;
            b.y0 = limit;
            b.v0 = 0;
            b.a = TUBE_A * r;
            b.vmax = TUBE_V * r;
          }
          y = limit;
        }
        b.x = tube.x;
        b.y = y;
        b.alpha = 1;
        b.state = y >= top - 1e-9 && b.exit === Number.POSITIVE_INFINITY ? "top" : "tube";
        ceiling = y - GAP * r;
        if (b.state === "top" && path && pi >= 0) {
          const e = entryOn(path, tube.x);
          if (clearAt(pi, e.s)) {
            b.state = "hop";
            b.path = pi;
            b.s = e.s;
            b.from = { x: tube.x, y };
            b.to = { x: e.p.x, y: e.p.y };
            b.t = 0;
            b.T = HOP_S;
          }
        }
      }
    }
  };

  const speedOn = (path: RunPath, s: number) => {
    const r = rb();
    const seg = segmentAt(path, s);
    if (!path.fall[seg]) return ROLL_V * r;
    const top = path.pts[seg]!.y;
    pointAt(path, s, tmp);
    return Math.sqrt((ROLL_V * r) ** 2 + 2 * FALL_G * r * Math.max(0, top - tmp.y));
  };

  const stepRails = (dt: number) => {
    const p = plan;
    if (!p) return;
    const r = p.rb;
    const accepting = jar.phase === "fill";
    p.paths.forEach((path, pi) => {
      // Balls hopping on hold their landing place, so nothing rolls into them.
      const list = balls
        .filter((b) => b.path === pi && (b.state === "rail" || b.state === "hop"))
        .sort((a, b) => b.s - a.s);
      let ahead: RunBall | null = null;
      for (const b of list) {
        if (b.state === "hop") {
          ahead = b;
          continue;
        }
        const limit = Math.min(path.length, ahead ? ahead.s - GAP * r : Infinity);
        let ns = Math.max(b.s, Math.min(limit, b.s + speedOn(path, b.s) * dt));
        if (ahead && ns > b.s) {
          // Round a corner (onto a drop) no closer than touching.
          pointAt(path, ns, tmp);
          const ax = ahead.state === "hop" ? ahead.to.x : ahead.x;
          const ay = ahead.state === "hop" ? ahead.to.y : ahead.y;
          if (Math.hypot(tmp.x - ax, tmp.y - ay) < 2.02 * r) ns = b.s;
        }
        b.s = ns;
        const px = b.x;
        pointAt(path, b.s, tmp);
        b.x = tmp.x;
        b.y = tmp.y;
        b.spin -= (b.x - px) / r;
        if (b.s >= path.length - 1e-9 && accepting && assigned < p.jar.capacity) {
          const slot = p.jar.slots[assigned]!;
          assigned++;
          b.state = "drop";
          b.slot = assigned - 1;
          b.from = { x: b.x, y: b.y };
          b.to = { x: slot.x, y: slot.y };
          b.t = 0;
          b.T = Math.sqrt((2 * Math.max(r, b.y - slot.y)) / (FALL_G * r));
          continue;
        }
        ahead = b;
      }
    });
  };

  const stepMoves = (dt: number) => {
    if (!plan) return;
    const r = plan.rb;
    for (const b of balls) {
      if (b.state === "hop") {
        b.t += dt;
        const f = Math.min(1, b.t / b.T);
        b.x = b.from.x + (b.to.x - b.from.x) * f;
        b.y = b.from.y + (b.to.y - b.from.y) * f + 2 * r * 4 * f * (1 - f);
        b.depth = f;
        b.spin -= (dt * ROLL_V) / 2;
        if (f >= 1) {
          b.state = "rail";
          b.depth = 1;
        }
      } else if (b.state === "drop") {
        b.t += dt;
        const f = Math.min(1, b.t / b.T);
        b.x = b.from.x + (b.to.x - b.from.x) * Math.min(1, f * 1.6);
        b.y = b.from.y - 0.5 * FALL_G * r * b.t * b.t;
        if (b.y <= b.to.y || f >= 1) {
          b.y = b.to.y;
          b.x = b.to.x;
          b.state = "jar";
          jar.count++;
          counts.jarred++;
          push({ type: "landed", slot: b.slot, color: b.color });
          if (jar.count >= plan.jar.capacity && jar.phase === "fill") {
            jar.phase = "full";
            jar.phaseT = 0;
            push({ type: "full" });
          }
        }
      } else if (b.state === "out") {
        b.t += dt;
        b.vy -= FALL_G * r * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.alpha = Math.max(0, 1 - Math.max(0, b.t - 0.7) / 0.8);
      }
    }
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i]!;
      if (b.state === "out" && b.t >= OPEN_S) balls.splice(i, 1);
    }
  };

  const stepJar = (dt: number) => {
    jar.phaseT += dt;
    switch (jar.phase) {
      case "fill":
        jar.door = Math.max(0, jar.door - dt / CLOSE_S);
        break;
      case "full":
        if (jar.phaseT >= FULL_S) openDoor();
        break;
      case "open":
        jar.door = Math.min(1, jar.door + dt / 0.3);
        if (jar.phaseT >= OPEN_S) {
          jar.phase = "close";
          jar.phaseT = 0;
          counts.emptied++;
          push({ type: "emptied" });
        }
        break;
      case "close":
        jar.door = Math.max(0, jar.door - dt / CLOSE_S);
        if (jar.phaseT >= CLOSE_S) {
          jar.phase = "fill";
          jar.phaseT = 0;
        }
        break;
    }
  };

  /** Put settled jar balls into a new plan's slots, dropping any that no longer fit. */
  const replan = (next: RunPlan | null) => {
    const old = plan;
    plan = next;
    const kept: RunBall[] = [];
    let n = 0;
    for (const b of balls) {
      if (b.state !== "jar" || !next || n >= next.jar.capacity) continue;
      const slot = next.jar.slots[n]!;
      b.x = slot.x;
      b.y = slot.y;
      b.slot = n++;
      kept.push(b);
    }
    balls.length = 0;
    balls.push(...kept);
    jar.count = kept.length;
    assigned = kept.length;
    if (!old || !next || jar.count < next.jar.capacity) {
      if (jar.phase === "full") jar.phase = "fill";
    }
  };

  return {
    get plan() {
      return plan;
    },
    balls,
    get tubes() {
      return tubes;
    },
    jar,
    events,
    counts,
    setPlan(next) {
      replan(next);
    },
    setTubes(list) {
      const changed =
        list.length !== tubes.length ||
        list.some((t, i) => t.x !== tubes[i]?.x || t.yBase !== tubes[i]?.yBase);
      if (!changed) return;
      tubes = list.map((t) => ({ ...t }));
      // Balls in tubes that moved or went would float in the air; take them out.
      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i]!;
        if ((b.state === "tube" || b.state === "top") && b.tube >= tubes.length) balls.splice(i, 1);
      }
    },
    launch(tube, color, human, at) {
      const b = make(tube, color, human);
      if (!b) return false;
      b.t0 = at ?? now();
      b.a = TUBE_A * tb();
      b.vmax = TUBE_V * tb();
      b.alpha = 0;
      balls.push(b);
      counts.arrived++;
      return true;
    },
    launchOut(tube, color, human, edge) {
      const b = make(tube, color, human);
      if (!b) return null;
      b.a = TUBE_A * tb();
      b.vmax = TUBE_V * tb();
      b.exit = edge;
      b.alpha = 0;
      balls.push(b);
      const hit = reachTime(b.y0, b.a, b.vmax, edge);
      b.te = b.t0 + hit.t;
      b.ve = hit.v;
      return { t: b.te, v: b.ve };
    },
    arrive(tube, color, human, t, y, v) {
      const b = make(tube, color, human);
      if (!b) return false;
      b.t0 = t;
      b.y0 = y;
      b.v0 = v;
      b.a = 0;
      b.vmax = v;
      b.y = y;
      balls.push(b);
      counts.arrived++;
      return true;
    },
    step(dt) {
      stepTubes();
      stepMoves(dt);
      stepRails(dt);
      stepJar(dt);
    },
    empty() {
      if (jar.phase === "fill" && (jar.count > 0 || assigned > 0)) openDoor();
    },
    clear() {
      balls.length = 0;
      jar.count = 0;
      assigned = 0;
      jar.phase = "fill";
      jar.phaseT = 0;
      jar.door = 0;
    },
  };
};
