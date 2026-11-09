/**
 * The craft: a 2D rigid body of our own, stepped at a fixed rate. Venue px, y down, angle in
 * radians with positive clockwise (the top leaning right). Mass is 1, so forces are
 * accelerations. Drag is linear and pulls the craft towards the wind, which keeps the descent
 * calm and the sideways drift self-limiting. Pure.
 *
 * Duo: each engine sits low on its side, tilted a little outward, so its thrust points up and
 * slightly inward. The left engine alone lifts and turns the craft clockwise, the right alone
 * anticlockwise; both together lift it straight.
 */
import { type Assist, LAND_TILT, LAND_VX, LAND_VY, type Variant } from "./config";
import type { Layout } from "./layout";
import { circleHits, heightAt, type LandingPad, padUnder, type Terrain } from "./terrain";

/** The drop the speeds below are tuned for. Frames with other drops scale speeds by `q`. */
export const REF_DROP = 1200;

/** Craft geometry in craft sizes, relative to the centre of mass. */
export const FOOT = { x: 0.43, y: 0.4 };
export const HULL = { x: 0, y: -0.06, r: 0.33 };
export const ENGINE = { x: 0.26, y: 0.24 };
export const MAIN = { x: 0, y: 0.26 };
export const THRUSTER = { x: 0.31, y: -0.16 };

export interface Physics {
  variant: Variant;
  q: number;
  /** Craft size, venue px. */
  S: number;
  g: number;
  /** Linear drag, per second. Sideways is a little lower so the craft can travel. */
  drag: number;
  dragX: number;
  /** One duo engine's thrust. */
  engine: number;
  /** The crew's main engine. */
  main: number;
  /** Inward tilt of the duo engines' thrust, radians. */
  tiltIn: number;
  /** Angular acceleration from one duo engine, rad/s². */
  torque: number;
  /** Angular acceleration from a crew turn thruster. */
  turn: number;
  /** Spin damping, per second. */
  spin: number;
  /** Levelling stiffness while nobody turns, per second squared. */
  level: number;
  /** With the assist on: a soft stop at this tilt, so the craft never turns upside down. */
  tiltLimit: number | null;
  landVy: number;
  landVx: number;
  landTilt: number;
  ceiling: number;
  /** Where the craft's centre may go sideways. */
  x0: number;
  x1: number;
}

export interface Craft {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  w: number;
}

export interface Thrust {
  left: boolean;
  right: boolean;
  main: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  /** 0 to 1: full power, or less while sputtering. */
  power: number;
}

export const NO_THRUST: Thrust = {
  left: false,
  right: false,
  main: false,
  turnLeft: false,
  turnRight: false,
  power: 1,
};

const ASSIST: Record<Assist, { torque: number; turn: number; spin: number; level: number }> = {
  off: { torque: 1.7, turn: 1.45, spin: 0.6, level: 0 },
  gentle: { torque: 1.2, turn: 1.3, spin: 1.8, level: 2.2 },
  strong: { torque: 1, turn: 1.05, spin: 3, level: 4.5 },
};

export const physicsFor = (
  layout: Layout,
  lane: { x0: number; x1: number },
  assist: Assist,
): Physics => {
  const q = layout.drop / REF_DROP;
  const g = 17 * q;
  const a = ASSIST[assist];
  const S = layout.craft;
  return {
    variant: layout.variant,
    q,
    S,
    g,
    drag: 1 / 3.2,
    dragX: 1 / 4,
    engine: 0.95 * g,
    main: 1.9 * g,
    tiltIn: (8 * Math.PI) / 180,
    torque: a.torque,
    turn: a.turn,
    spin: a.spin,
    level: a.level,
    tiltLimit: assist === "off" ? null : ((assist === "strong" ? 40 : 70) * Math.PI) / 180,
    landVy: LAND_VY * q,
    landVx: LAND_VX * q,
    landTilt: LAND_TILT,
    ceiling: layout.ceiling,
    x0: lane.x0 + 0.55 * S,
    x1: lane.x1 - 0.55 * S,
  };
};

/** Angle wrapped to (-pi, pi]. */
export const wrap = (a: number): number => {
  const t = Math.PI * 2;
  let v = a % t;
  if (v > Math.PI) v -= t;
  if (v <= -Math.PI) v += t;
  return v;
};

/** Whether the engines are deliberately turning the craft (the assist doesn't level then). */
export const turning = (th: Thrust, variant: Variant): boolean =>
  variant === "duo" ? th.left !== th.right : th.turnLeft !== th.turnRight;

export const stepCraft = (c: Craft, th: Thrust, p: Physics, wind: number, dt: number): void => {
  let ax = p.dragX * (wind - c.vx);
  let ay = p.g - p.drag * c.vy;
  let alpha = -p.spin * c.w;
  const k = Math.max(0, Math.min(1, th.power));
  if (p.variant === "duo") {
    if (th.left) {
      ax += p.engine * k * Math.sin(c.a + p.tiltIn);
      ay -= p.engine * k * Math.cos(c.a + p.tiltIn);
      alpha += p.torque * k;
    }
    if (th.right) {
      ax += p.engine * k * Math.sin(c.a - p.tiltIn);
      ay -= p.engine * k * Math.cos(c.a - p.tiltIn);
      alpha -= p.torque * k;
    }
  } else {
    if (th.main) {
      ax += p.main * k * Math.sin(c.a);
      ay -= p.main * k * Math.cos(c.a);
    }
    if (th.turnRight) alpha += p.turn * k;
    if (th.turnLeft) alpha -= p.turn * k;
  }
  const a = wrap(c.a);
  if (!turning(th, p.variant) || k === 0) alpha -= p.level * a;
  if (p.tiltLimit !== null && Math.abs(a) > p.tiltLimit) {
    alpha -= 14 * (a - Math.sign(a) * p.tiltLimit) + 2 * c.w;
  }
  c.vx += ax * dt;
  c.vy += ay * dt;
  c.w += alpha * dt;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  c.a += c.w * dt;
  if (Math.abs(c.a) > Math.PI * 4) c.a = wrap(c.a);
  if (c.y < p.ceiling) {
    c.y = p.ceiling;
    if (c.vy < 0) c.vy = 0;
  }
  if (c.x < p.x0) {
    c.x = p.x0;
    if (c.vx < 0) c.vx = -c.vx * 0.35;
  } else if (c.x > p.x1) {
    c.x = p.x1;
    if (c.vx > 0) c.vx = -c.vx * 0.35;
  }
};

/** A point given in craft sizes, in world venue px. */
export const toWorld = (c: Craft, S: number, lx: number, ly: number): { x: number; y: number } => {
  const cos = Math.cos(c.a);
  const sin = Math.sin(c.a);
  return { x: c.x + (cos * lx - sin * ly) * S, y: c.y + (sin * lx + cos * ly) * S };
};

export type Bump = "fast" | "sideways" | "tilt" | "missed" | "hull";

export type Contact = { kind: "land"; pad: LandingPad } | { kind: "bump"; why: Bump } | null;

/** What touching the ground means right now, or null while the craft is clear of it. */
export const contactOf = (c: Craft, t: Terrain, p: Physics): Contact => {
  const S = p.S;
  const lf = toWorld(c, S, -FOOT.x, FOOT.y);
  const rf = toWorld(c, S, FOOT.x, FOOT.y);
  const hull = toWorld(c, S, HULL.x, HULL.y);
  const leftDown = lf.y >= heightAt(t, lf.x);
  const rightDown = rf.y >= heightAt(t, rf.x);
  const hullDown = circleHits(t, hull.x, hull.y, HULL.r * S);
  if (!leftDown && !rightDown && !hullDown) return null;
  if (hullDown) return { kind: "bump", why: "hull" };
  const pad = padUnder(t, lf.x, rf.x);
  if (!pad) return { kind: "bump", why: "missed" };
  if (Math.abs(wrap(c.a)) > p.landTilt) return { kind: "bump", why: "tilt" };
  if (c.vy > p.landVy) return { kind: "bump", why: "fast" };
  if (Math.abs(c.vx) > p.landVx) return { kind: "bump", why: "sideways" };
  return { kind: "land", pad };
};

/** The craft's centre height when it stands upright on a surface at `groundY`. */
export const standY = (groundY: number, S: number): number => groundY - FOOT.y * S;
