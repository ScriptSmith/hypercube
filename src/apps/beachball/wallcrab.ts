/**
 * A little crab on the sand at the balls' line. It scuttles sideways on its own, stops, looks
 * about, waves a claw and sets off again, turning back at the wall's ends and at anything lying
 * in its way, though now and then it shoves a resting ball out of its path instead.
 *
 * Nothing bowls it over. A ball or toy coming at it, rolling or falling, finds it braced with its
 * claws up, and it reaches out and pushes the thing away. It is never picked up or thrown
 * either: a finger on it makes it stop, raise its claws and snap at the finger, hopping and
 * blowing bubbles, for as long as the finger stays and a moment after; then it scuttles off.
 * Metres and seconds, y up from the wall's bottom.
 */
import type { Rng } from "../../core/types";
import type { Ball, Prop } from "./wallphysics";
import { extentAt } from "./wallprops";

export type CrabMode = "walk" | "pause" | "angry" | "flee" | "brace" | "push";

/**
 * The model is built at about four times a ghost crab's size and drawn this much bigger again,
 * so it reads from across the room and makes a large target, while staying small beside a ball.
 */
export const CRAB_SIZE = 1.35;

/** Its size, metres: half its shell's width and its middle's height standing. */
export const CRAB = {
  half: 0.12 * CRAB_SIZE,
  stand: 0.12 * CRAB_SIZE,
  /** How far its legs reach either side of its middle. */
  span: 0.3 * CRAB_SIZE,
  /** Its body as a target: a circle about its middle. */
  hit: 0.2 * CRAB_SIZE,
  /** How far beyond its body its claws reach to push something. */
  reach: 0.1 * CRAB_SIZE,
} as const;

/** Walking and running speeds, m/s, and how long it walks, pauses and runs, s. */
export const WALK = [0.35, 0.8] as const;
export const SCURRY = [1.5, 2] as const;
const WALK_FOR = [0.6, 2.4] as const;
const PAUSE_FOR = [0.7, 2.8] as const;
const FLEE_FOR = [0.8, 1.3] as const;
/** Snapping lasts at least this long, this long after the finger lifts, and no longer than. */
export const ANGRY_MIN = 1.3;
const ANGRY_AFTER = 1;
export const ANGRY_MAX = 3.4;
/** Snaps a second, and bubbles blown a second while it snaps. */
const SNAPS = 5;
const BUBBLE_GAP = 0.16;
/** It braces for anything due to reach it within this long, s, and waits for it this long. */
const BRACE_T = 0.55;
const BRACE_FOR = 0.9;
/**
 * A push sends a thing off sideways and up, m/s for a ball's mass: gently for something that
 * drifts up to it, harder for something that comes at it fast.
 */
export const PUSH_OUT = [0.9, 2.4] as const;
const PUSH_UP = [0.5, 2.2] as const;
/** How long its claws stay out after a push, s, and before it pushes the same thing again. */
const PUSH_FOR = 0.45;
const PUSH_GAP = 0.4;
/**
 * Share of the times it walks into a resting ball that it shoves it away rather than turning,
 * and how long after one shove before it will shove again, s.
 */
const SHOVE = 0.3;
const SHOVE_GAP = 6;
/** Leg cycles per metre walked, and the fastest they cycle, per second. */
const STRIDE = 1 / 0.11;
const MAX_CYCLE = 9;
const MAX_EVENTS = 16;

export interface Crab {
  x: number;
  /** Its middle's height. */
  y: number;
  mode: CrabMode;
  /** Seconds in this mode, and left in it. */
  t: number;
  left: number;
  /** Which way it walks or runs, -1 or 1, and how fast. */
  dir: number;
  speed: number;
  /** The legs' cycle, radians. */
  gait: number;
  /** Claws raised, 0 to 1, how far they are open, 0 to 1, and one claw waved while it rests. */
  claws: number;
  open: number;
  wave: number;
  waveSide: number;
  /** Claws thrust out towards what it pushes, 0 to 1. */
  thrust: number;
  /** Eye stalks up, 0 folded down to 1 standing, and how cross it looks, 0 to 1. */
  eyes: number;
  cross: number;
  /** Where it looks, a direction in the wall's plane. */
  lookX: number;
  lookY: number;
  /** A hop off the sand, metres, and a lean towards what it faces, radians. */
  hop: number;
  lean: number;
  /** The finger it is snapping at, where that is, and how long since it lifted. */
  finger: number | null;
  fx: number;
  fy: number;
  lifted: number;
  pokes: number;
  angers: number;
  pushes: number;
  shoves: number;
}

export interface CrabEvent {
  kind: "bubble" | "snap" | "push";
  x: number;
  y: number;
  /** For a push: the ball or toy pushed (the other -1), and the speed it is sent off at. */
  ball: number;
  prop: number;
  vx: number;
  vy: number;
}

export interface CrabWorld {
  readonly bounds: { readonly width: number; readonly floor: number };
  readonly balls: readonly Ball[];
  readonly props: readonly Prop[];
}

export interface Crabs {
  readonly crab: Crab;
  step(dt: number, world: CrabWorld, mound?: (x: number) => number): void;
  /** How far (x, y) is from its body, metres; under 0 is on it. */
  distance(x: number, y: number): number;
  /** A finger lands on it, or sweeps across it. */
  poke(id: number, x: number, y: number): void;
  move(id: number, x: number, y: number): void;
  release(id: number): void;
  /** Put it standing still on the sand at x. */
  place(x: number, floor: number): void;
  drain(): CrabEvent[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Something near the crab: its surface's distance from the crab's body, and how fast it closes. */
interface Near {
  ball: number;
  prop: number;
  x: number;
  y: number;
  gap: number;
  closing: number;
  held: boolean;
  mass: number;
}

export const createCrab = (rng: Rng, x0: number, floor0: number): Crabs => {
  const c: Crab = {
    x: x0,
    y: floor0 + CRAB.stand,
    mode: "pause",
    t: 0,
    left: rng.range(0.4, 1.2),
    dir: rng.next() < 0.5 ? -1 : 1,
    speed: 0,
    gait: 0,
    claws: 0,
    open: 0,
    wave: 0,
    waveSide: 1,
    thrust: 0,
    eyes: 1,
    cross: 0,
    lookX: 0,
    lookY: 1,
    hop: 0,
    lean: 0,
    finger: null,
    fx: 0,
    fy: 0,
    lifted: 0,
    pokes: 0,
    angers: 0,
    pushes: 0,
    shoves: 0,
  };
  let events: CrabEvent[] = [];
  let bubbleWait = 0;
  let snapPhase = 0;
  /** Where it was poked, so its lunges keep near there. */
  let anchor = x0;
  /** What it braces for or last pushed, and when it may push that again. */
  let target = { ball: -1, prop: -1, x: 0, y: 0 };
  let pushGap = 0;
  let shoveGap = 0;
  const near: Near = { ball: -1, prop: -1, x: 0, y: 0, gap: 0, closing: 0, held: false, mass: 1 };

  const emit = (e: Omit<CrabEvent, "ball" | "prop" | "vx" | "vy"> & Partial<CrabEvent>) => {
    if (events.length >= MAX_EVENTS) return;
    events.push({ ball: -1, prop: -1, vx: 0, vy: 0, ...e });
  };

  const enter = (mode: CrabMode, left: number) => {
    c.mode = mode;
    c.t = 0;
    c.left = left;
  };

  /** Anything lying in its way within `ahead` of its legs in direction `dir`. */
  const blocked = (w: CrabWorld, dir: number, ahead: number, mound?: (x: number) => number) => {
    const { width, floor } = w.bounds;
    const front = c.x + dir * (CRAB.span + ahead);
    if (front < 0.05 || front > width - 0.05) return "end";
    for (const b of w.balls) {
      if (b.holder !== null || b.y - b.r > floor + 0.2 || Math.hypot(b.vx, b.vy) > 0.4) continue;
      // A ball on the sand is only as wide as the crab is tall at its foot.
      const d = (b.x - c.x) * dir;
      if (d > 0 && d < CRAB.span + ahead + 0.33) return b;
    }
    for (const p of w.props) {
      if (p.off || p.holder !== null || !p.grounded) continue;
      const e = extentAt(p.spec, p.a);
      if (p.y + e.bottom > floor + 0.12) continue;
      const lo = p.x + e.left;
      const hi = p.x + e.right;
      const gap = dir > 0 ? lo - c.x : c.x - hi;
      if (gap > 0 && gap < CRAB.span + ahead) return "toy";
    }
    if (mound) {
      for (const s of [0.2, 0.45, 0.7]) {
        if (mound(front - dir * (1 - s) * ahead) > 0.07) return "mound";
      }
    }
    return null;
  };

  /** The moving or held thing nearest its body, how far its surface is and how fast it closes. */
  const nearest = (w: CrabWorld): Near | null => {
    const cy = c.y;
    let best = Infinity;
    const consider = (
      ball: number,
      prop: number,
      x: number,
      y: number,
      gap: number,
      vx: number,
      vy: number,
      held: boolean,
      mass: number,
    ) => {
      if (gap >= best) return;
      const dx = c.x - x;
      const dy = cy - y;
      const d = Math.hypot(dx, dy) || 1;
      best = gap;
      near.ball = ball;
      near.prop = prop;
      near.x = x;
      near.y = y;
      near.gap = gap;
      near.closing = (vx * dx + vy * dy) / d;
      near.held = held;
      near.mass = mass;
    };
    for (const b of w.balls) {
      const gap = Math.hypot(b.x - c.x, b.y - cy) - b.r - CRAB.hit;
      if (gap > 1.5) continue;
      consider(b.index, -1, b.x, b.y, gap, b.vx, b.vy, b.holder !== null, 1);
    }
    for (const p of w.props) {
      if (p.off || (p.asleep && p.holder === null)) continue;
      if (Math.hypot(p.x - c.x, p.y - cy) - p.spec.reach - CRAB.hit > 1.5) continue;
      let gap = Infinity;
      for (const d of p.spec.discs) {
        const dx = p.x + p.cs * d.x - p.sn * d.y;
        const dy = p.y + p.sn * d.x + p.cs * d.y;
        gap = Math.min(gap, Math.hypot(dx - c.x, dy - cy) - d.r - CRAB.hit);
      }
      consider(-1, p.index, p.x, p.y, gap, p.vx, p.vy, p.holder !== null, p.spec.mass);
    }
    return best < Infinity ? near : null;
  };

  /** It reaches out and pushes the thing away, sideways and up. */
  const push = (n: Near) => {
    const away = Math.sign(n.x - c.x) || (rng.next() < 0.5 ? -1 : 1);
    const k = 1 / Math.sqrt(Math.max(0.3, n.mass));
    const hard = clamp((Math.max(0, n.closing) - 0.3) / 2.5, 0, 1) * rng.range(0.85, 1);
    emit({
      kind: "push",
      x: c.x + away * (CRAB.half + CRAB.reach * 0.6),
      y: c.y + 0.03,
      ball: n.ball,
      prop: n.prop,
      vx: away * (PUSH_OUT[0] + (PUSH_OUT[1] - PUSH_OUT[0]) * hard) * k,
      vy: (PUSH_UP[0] + (PUSH_UP[1] - PUSH_UP[0]) * hard) * k,
    });
    target = { ball: n.ball, prop: n.prop, x: n.x, y: n.y };
    pushGap = PUSH_GAP;
    c.pushes++;
    // Done with it, it goes the other way.
    c.dir = -away;
    c.hop = 0.025;
    c.speed = 0;
    enter("push", PUSH_FOR);
  };

  const flee = (w: CrabWorld, from: number, mound?: (x: number) => number) => {
    c.dir = Math.sign(c.x - from) || (rng.next() < 0.5 ? -1 : 1);
    if (blocked(w, c.dir, 0.4, mound)) c.dir = -c.dir;
    c.speed = rng.range(SCURRY[0], SCURRY[1]);
    c.finger = null;
    enter("flee", rng.range(FLEE_FOR[0], FLEE_FOR[1]));
  };

  const pause = () => {
    c.speed = 0;
    c.waveSide = rng.next() < 0.5 ? -1 : 1;
    enter("pause", rng.range(PAUSE_FOR[0], PAUSE_FOR[1]));
  };

  const anger = (id: number, x: number, y: number) => {
    if (c.mode !== "angry") {
      c.angers++;
      anchor = c.x;
      snapPhase = 0;
      enter("angry", 0);
    }
    c.finger = id;
    c.fx = x;
    c.fy = y;
    c.lifted = -1;
    c.speed = 0;
  };

  const ease = (v: number, to: number, rate: number, dt: number) =>
    v + (to - v) * (1 - Math.exp(-rate * dt));

  return {
    crab: c,
    step(dt, w, mound) {
      const { width, floor } = w.bounds;
      c.t += dt;
      c.left -= dt;
      pushGap -= dt;
      shoveGap -= dt;
      // Anything coming at it: braced for, then pushed away as it arrives.
      const n = nearest(w);
      if (n) {
        const same = n.ball === target.ball && n.prop === target.prop;
        if (n.gap < CRAB.reach && !(same && pushGap > 0)) {
          if (n.held) {
            if (c.mode !== "angry") {
              anger(-2, n.x, n.y);
              c.finger = null;
              c.lifted = 0;
            }
          } else if (n.closing > 0.15 || n.gap < 0) {
            push(n);
          }
        } else if (
          (c.mode === "walk" || c.mode === "pause" || c.mode === "flee") &&
          !n.held &&
          n.closing > 0.4 &&
          n.gap / n.closing < BRACE_T
        ) {
          target = { ball: n.ball, prop: n.prop, x: n.x, y: n.y };
          c.speed = 0;
          enter("brace", BRACE_FOR);
        }
        if (c.mode === "brace" || c.mode === "push") {
          target.x = n.ball === target.ball && n.prop === target.prop ? n.x : target.x;
          target.y = n.ball === target.ball && n.prop === target.prop ? n.y : target.y;
        }
      }
      let crossTo = 0;
      let clawsTo = 0;
      let thrustTo = 0;
      let eyesTo = 1;
      let leanTo = 0;
      let lookX = c.dir * 0.4;
      let lookY = 1;
      c.hop = ease(c.hop, 0, 18, dt);
      switch (c.mode) {
        case "walk":
        case "flee": {
          const ahead = blocked(w, c.dir, 0.03, mound);
          const shove = typeof ahead === "object" && ahead !== null && c.mode === "walk";
          if (shove && shoveGap <= 0 && rng.next() < SHOVE) {
            // It shoves the resting ball out of its way.
            const k = rng.range(0.6, 0.8);
            emit({
              kind: "push",
              x: c.x + c.dir * (CRAB.span * 0.8),
              y: c.y,
              ball: ahead.index,
              prop: -1,
              vx: c.dir * rng.range(PUSH_OUT[0], PUSH_OUT[1]) * k,
              vy: rng.range(0.4, 0.9),
            });
            target = { ball: ahead.index, prop: -1, x: ahead.x, y: ahead.y };
            pushGap = PUSH_GAP;
            shoveGap = SHOVE_GAP;
            c.shoves++;
            c.speed = 0;
            enter("push", PUSH_FOR);
            break;
          }
          if (ahead) {
            if (c.mode === "flee" && c.t > 0.05 && !blocked(w, -c.dir, 0.03, mound)) {
              c.dir = -c.dir;
            } else {
              pause();
              break;
            }
          }
          c.x += c.dir * c.speed * dt;
          if (c.left <= 0) pause();
          break;
        }
        case "pause": {
          // Now and then it waves a claw or looks about.
          const u = c.t / Math.max(0.1, c.t + c.left);
          c.wave = c.left > 0.4 && u > 0.2 && u < 0.7 ? Math.sin(((u - 0.2) / 0.5) * Math.PI) : 0;
          lookX = Math.sin(c.t * 2.3) * 0.7;
          if (c.left <= 0) {
            c.wave = 0;
            if (rng.next() < 0.45) c.dir = -c.dir;
            if (blocked(w, c.dir, 0.2, mound)) c.dir = -c.dir;
            if (blocked(w, c.dir, 0.2, mound)) {
              pause();
            } else {
              c.speed = rng.range(WALK[0], WALK[1]);
              enter("walk", rng.range(WALK_FOR[0], WALK_FOR[1]));
            }
          }
          break;
        }
        case "brace":
        case "push": {
          // Claws up and out towards the thing, leaning into it.
          const dx = target.x - c.x;
          const dy = target.y - c.y;
          const d = Math.hypot(dx, dy) || 1;
          lookX = dx / d;
          lookY = Math.max(0.15, dy / d);
          clawsTo = 1;
          thrustTo = c.mode === "push" ? 1 : 0.3;
          leanTo = clamp(-Math.sign(dx) * (c.mode === "push" ? 0.2 : 0.08), -0.22, 0.22);
          c.open = c.mode === "push" ? 0.15 : 0.8;
          if (c.left <= 0) pause();
          break;
        }
        case "angry": {
          if (c.finger === null) c.lifted += dt;
          crossTo = 1;
          clawsTo = 1;
          snapPhase += dt * SNAPS;
          const snap = Math.sin(snapPhase * Math.PI * 2);
          c.open = 0.5 + 0.5 * snap;
          if (snap > 0.95 && c.hop < 0.004) {
            c.hop = 0.03;
            emit({ kind: "snap", x: c.x, y: c.y });
          }
          const dx = c.fx - c.x;
          const dy = c.fy - c.y;
          const d = Math.hypot(dx, dy) || 1;
          lookX = dx / d;
          lookY = Math.max(0.2, dy / d);
          leanTo = clamp(-dx * 0.6, -0.22, 0.22);
          // Little lunges at the finger, keeping near where it was poked.
          c.x = clamp(c.x + Math.sign(dx) * 0.25 * dt, anchor - 0.1, anchor + 0.1);
          bubbleWait -= dt;
          if (bubbleWait <= 0) {
            bubbleWait = BUBBLE_GAP;
            emit({ kind: "bubble", x: c.x + rng.range(-0.03, 0.03), y: c.y + 0.02 });
          }
          if ((c.lifted >= ANGRY_AFTER && c.t >= ANGRY_MIN) || c.t >= ANGRY_MAX) {
            flee(w, c.fx, mound);
          }
          break;
        }
      }
      c.y = floor + CRAB.stand;
      c.x = clamp(c.x, CRAB.half, width - CRAB.half);
      if (c.mode === "walk" || c.mode === "flee" || c.mode === "pause") {
        c.open = ease(c.open, c.mode === "pause" ? 0.2 : 0, 10, dt);
      }
      if (c.mode !== "pause") c.wave = ease(c.wave, 0, 10, dt);
      c.claws = ease(c.claws, clawsTo, 14, dt);
      c.thrust = ease(c.thrust, thrustTo, 16, dt);
      c.cross = ease(c.cross, crossTo, 10, dt);
      c.eyes = ease(c.eyes, eyesTo, 12, dt);
      c.lean = ease(c.lean, leanTo, 10, dt);
      c.lookX = ease(c.lookX, lookX, 8, dt);
      c.lookY = ease(c.lookY, lookY, 8, dt);
      const moving = c.mode === "walk" || c.mode === "flee" ? c.speed : 0;
      const cycle = Math.min(MAX_CYCLE, moving * STRIDE);
      c.gait = (c.gait + cycle * Math.PI * 2 * dt * c.dir) % (Math.PI * 2 * 64);
    },
    distance(x, y) {
      return Math.hypot(x - c.x, y - (c.y + 0.03)) - CRAB.hit;
    },
    poke(id, x, y) {
      c.pokes++;
      anger(id, x, y);
    },
    move(id, x, y) {
      if (c.finger !== id) return;
      c.fx = x;
      c.fy = y;
    },
    release(id) {
      if (c.finger !== id) return;
      c.finger = null;
      c.lifted = 0;
    },
    place(x, floor) {
      c.x = x;
      c.y = floor + CRAB.stand;
      c.finger = null;
      c.claws = 0;
      c.open = 0;
      c.thrust = 0;
      c.cross = 0;
      c.eyes = 1;
      c.hop = 0;
      c.lean = 0;
      target = { ball: -1, prop: -1, x: 0, y: 0 };
      pause();
    },
    drain() {
      const out = events;
      events = [];
      return out;
    },
  };
};
