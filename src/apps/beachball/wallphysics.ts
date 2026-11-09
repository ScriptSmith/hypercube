/**
 * Beach balls on a wall: big, light, bouncy balls in the plane of the wall, batted, carried and
 * thrown by fingers. Metres and seconds; x runs right from the wall's left edge, y up from its
 * bottom, and z out of the wall towards the people in front of it.
 *
 * Each ball is a thin vinyl shell (moment of inertia two thirds of m r²) moving in the plane,
 * spinning about any axis. Gravity is a little gentler than Earth's and air drag strong, so a
 * ball hangs in the air the way a beach ball does. Every touch (sand, sides, top, another ball, a
 * finger) is an impulse with restitution and Coulomb friction at the contact point, which is
 * what spins a ball when it is struck off centre and makes it roll on the sand.
 *
 * A finger that lands on a ball holds it: the ball follows the finger, and leaves with the
 * finger's speed when it lifts. A finger that lifts where it landed pops the ball up instead,
 * however long it pressed, so a child's slow press does something. A finger that lands
 * elsewhere bats any ball it sweeps into, tested along its whole path so a fast swipe never
 * passes through.
 *
 * Beach toys (`wallprops.ts`) share the world: rigid bodies made of discs, solved together with
 * sequential impulses (speculative contacts so nothing tunnels, a restitution pass, position
 * correction, and sleep once at rest). A finger holds a toy by the point it landed on, through a
 * soft spring joint, so gravity swings it from there. A net can stand across the middle: soft
 * mesh, a firmer tape along its top and a post below it. A beach umbrella can stand in the sand
 * (`wallumbrella.ts`): everything bounces off its canopy and pole, and knocks rock it.
 */
import { type Mat3, multiply3, orthonormalize3, rotationAbout, type Vec3 } from "../../core/sphere";
import type { Rng } from "../../core/types";
import { type PropKind, type PropSpec, PROP_SPECS, extentAt } from "./wallprops";
import {
  createWobble,
  FOLD_S,
  HOLD_S,
  knock,
  nearestOn,
  PULL,
  RISE_S,
  type Segment,
  stepWobble,
  UMBRELLA_FEEL,
  type UmbrellaLayout,
  umbrellaSegments,
  type Wobble,
} from "./wallumbrella";

export const GRAVITY = 7.8;
const DRAG_LIN = 0.05;
const DRAG_QUAD = 0.09;
export const MAX_SPEED = 15;
export const MAX_SPIN = 25;
/** Spin lost to the air, per second. */
const SPIN_DRAG = 0.22;
const SHELL = 2 / 3;

const BOUNCE = { floor: 0.58, side: 0.72, ball: 0.82, finger: 0.7 };
const GRIP = { floor: 0.55, side: 0.3, ball: 0.2, finger: 0.5 };
/** Rolling resistance on sand, m/s². */
export const ROLL = 1.3;
/** Landing speed below which a ball stops bouncing and sits. */
const SETTLE = 0.35;

/** A fingertip, made generous for imprecise touch. */
export const FINGER_R = 0.08;
/** A finger landing this far outside a ball or toy still takes hold of it. */
export const GRAB = 0.12;
/** A finger landing within this of a ball, but not on it, puffs it gently away. */
export const NEAR = 0.4;
/** A finger on a ball that moves less than this before lifting taps it. */
export const TAP_TRAVEL = 0.08;
/** A tap pops a ball up this fast, plus a little away from the finger. */
export const BUMP = 3.4;
const BUMP_AWAY = 1.1;
/** A ball let go faster than this is thrown, at the finger's speed times the gain. */
const THROW_MIN = 0.7;
const THROW_GAIN = 1.15;
/** How quickly a held ball closes on the finger, s. */
const HOLD_TAU = 0.04;
/** Smoothing of a finger's speed when the world measures it itself, s. */
const FINGER_TAU = 0.04;
/** A grabbed ball eases its centre this close to the finger, a share of its radius. */
const HOLD_OFFSET = 0.55;
/** Anything left resting up off the sand this long, s, is nudged off so it is never stuck. */
const PERCH = 1.2;
/** Resting on something no higher than this off the sand is fine: it is still in reach. */
const BALL_PERCH_LOW = 0.25;
const PROP_PERCH_LOW = 0.5;
const ORTHO_EVERY = 60;
export const MAX_EVENTS = 64;

/** A beach ball's mass, the unit the toys' masses are given in. */
const BALL_MASS = 1;
/** A held ball barely gives to anything pushing it: the finger holds it. */
const HELD_IM = 0.1;

/** A tapped toy pops up this fast and flips over at this many radians a second. */
export const PROP_BUMP = 3;
export const TAP_SPIN = [4.5, 9] as const;
/** The spring a finger holds a toy by: its frequency, damping ratio and strongest pull. */
const GRIP_HZ = 5;
const GRIP_ZETA = 0.7;
const GRIP_ACCEL = 120;
/** A held toy's swing dies away at this rate, per second, as a hand's soft grip damps it. */
const HELD_SWING = 2.5;
/** A finger this far from what it holds, which the net is keeping back, lets go. */
const STRETCH = 0.6;
export const MAX_PROP_SPEED = 14;
export const MAX_PROP_SPIN = 30;
const PROP_AIR_SPIN = 0.3;
/** Contact solving: iterations, allowed overlap, share corrected a step, largest correction. */
const ITERATIONS = 8;
const SLOP = 0.004;
const BAUMGARTE = 0.25;
const MAX_CORRECTION = 0.06;
/** Contacts are found this far ahead, so a fast toy meets things before it overlaps them. */
const SPECULATIVE = 0.02;
const SUB_DISP = 0.025;
const MAX_SUB = 6;
/** Closing speed below which a contact doesn't bounce. */
const BOUNCE_MIN = 0.7;
const SLEEP_SPEED = 0.05;
const SLEEP_SPIN = 0.12;
const SLEEP_AFTER = 0.5;
/** A ball moving faster than this wakes a sleeping toy it comes near. */
const BALL_STIR = 0.15;
export const MAX_CONTACTS = 384;
/** Sand drags on a toy lying on it, per second, and on its spin. */
const SAND_SPIN = 2.5;
/** A toy landing faster than this throws up sand. */
const PROP_LAND = 1.6;

/** How the net takes a hit: its soft mesh, the firmer tape along its top and the post below. */
export const NET_TAPE = 0.07;
const NET_FEEL = {
  mesh: { bounce: 0.1, grip: 0.5 },
  tape: { bounce: 0.45, grip: 0.3 },
  post: { bounce: 0.5, grip: 0.3 },
};
/** Something on top of the tape is pushed off it at this many m/s². */
const NET_SHRUG = 2.5;
/** Something resting on the umbrella's canopy is pushed outwards at this many m/s². */
const CANOPY_SHRUG = 2;
/** How hard a finger landing on the umbrella rocks it, and a swipe across it, per m/s. */
const NUDGE = 9;
const SWIPE_ROCK = 3.6;
const SWIPE_TURN = 1.1;
/** How much a glancing blow on the canopy turns it, rad/s per unit of sideways impulse. */
const GLANCE_TURN = 0.35;

export interface Bounds {
  width: number;
  height: number;
  /** The sand line the balls rest on. */
  floor: number;
}

/** A net across the wall at `x`: a post from the sand up to `top`, mesh from `bottom` up. */
export interface Net {
  x: number;
  top: number;
  bottom: number;
  /** Half its thickness, as the post's. */
  radius: number;
}

export interface Ball {
  readonly index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Angular velocity, rad/s. */
  w: [number, number, number];
  /** The ball's own frame to the wall's. */
  rot: Mat3;
  r: number;
  /** The finger holding it, or null. */
  holder: number | null;
  grounded: boolean;
  perched: number;
  steps: number;
  /**
   * Which side of the net it is on, -1 or 1. It changes only while its centre is above the
   * net's top, so nothing low down ever pushes through, nor sticks straddling the net.
   */
  side: number;
}

export interface Prop {
  readonly index: number;
  readonly kind: PropKind;
  /** Its shape and feel; the bucket changes it as it empties and fills. */
  spec: PropSpec;
  x: number;
  y: number;
  /** Angle in the wall's plane, radians, kept within ±π. */
  a: number;
  vx: number;
  vy: number;
  w: number;
  im: number;
  ii: number;
  /** Cosine and sine of `a`. */
  cs: number;
  sn: number;
  holder: number | null;
  /** Touching the sand. */
  grounded: boolean;
  asleep: boolean;
  still: number;
  perched: number;
  /** A turn about its own upright axis that is only drawn, and how fast it turns. */
  yaw: number;
  yawRate: number;
  /** Which side of the net it is on, as for a ball. */
  side: number;
  /**
   * Taken out of the world for now (the spade standing in the bucket, the closed umbrella while
   * it is planted): nothing touches it, it does not move, and its owner poses it.
   */
  off: boolean;
}

export interface Finger {
  readonly id: number;
  x: number;
  y: number;
  /** Where the last step left it, for sweeping its path. */
  lastX: number;
  lastY: number;
  /**
   * Given with its moves (the input's timed speed, which a finger resting still has none of),
   * or else measured from its moves step by step.
   */
  vx: number;
  vy: number;
  given: boolean;
  readonly startX: number;
  readonly startY: number;
  travel: number;
  ball: Ball | null;
  offX: number;
  offY: number;
  prop: Prop | null;
  /** Where it holds the toy, in the toy's own frame about its centre of mass. */
  gripX: number;
  gripY: number;
  /** The net kept what it holds back this step. */
  blocked: boolean;
  /** It is touching the umbrella, so a swipe rocks it only as it comes on. */
  umb: boolean;
  /** It landed on the standing umbrella and may yet fold it or pull it out. */
  umbHold: boolean;
  /** Seconds since it landed. */
  held: number;
  readonly synthetic: boolean;
}

/**
 * `hit` is one thing knocking another, `bat` a finger striking a ball or toy, `nudge` a finger
 * rocking the umbrella.
 */
export type EventKind = "land" | "hit" | "bat" | "tap" | "throw" | "puff" | "grab" | "nudge";

export interface WorldEvent {
  kind: EventKind;
  /** The ball it happened to, or -1. */
  ball: number;
  /** The toy it happened to, or -1. */
  prop: number;
  x: number;
  y: number;
  /** Landing speed, or the change in speed a touch gave. */
  speed: number;
  synthetic: boolean;
}

export interface WorldOptions {
  /** Toys, each put out on the sand at `x`. */
  props?: readonly { kind: PropKind; x: number }[];
  net?: Net | null;
  umbrella?: UmbrellaLayout | null;
}

/**
 * What the umbrella is doing: standing open, folding, standing closed, unfolding, out of the
 * sand as a toy (`loose`), or being stood up again before it opens (`rising`).
 */
export type UmbrellaState = "open" | "closing" | "closed" | "opening" | "loose" | "rising";

/** The umbrella as the world holds it: where it stands, how it rocks, and how often it was hit. */
export interface Umbrella {
  /** Where it is put out, and where it stands now (stood up again elsewhere, it moves). */
  readonly layout: UmbrellaLayout;
  readonly at: UmbrellaLayout;
  readonly wobble: Wobble;
  state: UmbrellaState;
  /** How far its canopy is folded, 0 open to 1 furled. */
  fold: number;
  /** How far over it still leans while being stood up, radians. */
  stand: number;
  /** Closed and out of the sand, the toy it is, which the world holds out of play otherwise. */
  readonly prop: Prop;
  /** Balls and toys that struck it, fingers that rocked it, and times it was folded, pulled out
   * and stood up again. */
  hits: number;
  nudges: number;
  closes: number;
  pulls: number;
  plants: number;
}

export interface World {
  readonly balls: readonly Ball[];
  readonly props: readonly Prop[];
  readonly fingers: ReadonlyMap<number, Finger>;
  readonly net: Net | null;
  readonly umbrella: Umbrella | null;
  bounds: Bounds;
  setBounds(b: Bounds): void;
  setNet(n: Net | null): void;
  setUmbrella(u: UmbrellaLayout | null): void;
  /** Stand the umbrella up where it lies, closed, to open, as an unseen hand might. */
  plantUmbrella(): void;
  /** Put the umbrella back where it was put out, standing open. */
  resetUmbrella(): void;
  /** A finger lands. Returns what it did. */
  down(id: number, x: number, y: number, synthetic?: boolean): "grab" | "puff" | "nudge" | "none";
  /** A finger moves, with its speed if the caller knows it better than steps can measure. */
  move(id: number, x: number, y: number, vx?: number, vy?: number): void;
  up(id: number): "tap" | "throw" | "drop" | "none";
  cancel(id: number): void;
  /** Let go of every finger, as if they all lifted still. */
  releaseAll(): void;
  step(dt: number): void;
  /** Throw ball `i` with this velocity and spin, as an unseen hand would. */
  kick(i: number, vx: number, vy: number, spin?: Vec3): void;
  /** Throw toy `i` with this velocity, spin, and a drawn turn about its own axis. */
  kickProp(i: number, vx: number, vy: number, w?: number, yawRate?: number): void;
  /** Put ball `i` at rest on the sand at `x`. */
  place(i: number, x: number): void;
  /** Put toy `i` back at rest on the sand at `x`, as it is put out. */
  placeProp(i: number, x: number): void;
  /**
   * Give toy `i` a new shape and feel (the same outline about a different centre of mass), so
   * that it stays exactly where it is and keeps moving as it was.
   */
  setPropSpec(i: number, spec: PropSpec): void;
  /** How far (x, y) is from the surface of the nearest free ball or toy, metres. */
  nearestThing(x: number, y: number): number;
  /** Take toy `i` out of the world, or put it back in where it is now, letting go of it. */
  setPropOff(i: number, off: boolean): void;
  /** Put toy `i` here, turned `a`, moving so, as its owner poses it. */
  poseProp(i: number, x: number, y: number, a: number, vx?: number, vy?: number, w?: number): void;
  /** Events since the last drain. */
  drain(): WorldEvent[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const wrapAngle = (a: number) => {
  const t = Math.PI * 2;
  return a - t * Math.floor((a + Math.PI) / t);
};

/** A random rotation, from a random axis and angle. */
const randomRotation = (rng: Rng): Mat3 => {
  const z = rng.range(-1, 1);
  const a = rng.range(0, Math.PI * 2);
  const s = Math.sqrt(1 - z * z);
  return rotationAbout([s * Math.cos(a), s * Math.sin(a), z], rng.range(0, Math.PI * 2));
};

/** Where on the net something at height `y` meets it. */
const netZone = (n: Net, y: number) =>
  y > n.top - NET_TAPE ? NET_FEEL.tape : y >= n.bottom ? NET_FEEL.mesh : NET_FEEL.post;

/**
 * One contact on ball `b` with a surface that doesn't move in response (sand, sides, a finger):
 * `n` points from the surface into the ball, `sv` is the surface's velocity. Returns the normal
 * impulse per unit mass, 0 when they were already parting. With `support` set, a resting
 * contact: no bounce, and friction limited to what that impulse allows.
 */
const contact = (
  b: Ball,
  nx: number,
  ny: number,
  svx: number,
  svy: number,
  e: number,
  mu: number,
  support = 0,
): number => {
  const r = b.r;
  const w = b.w;
  // Velocity of the ball's contact point (centre - r n) relative to the surface.
  const cvx = b.vx + w[2] * r * ny - svx;
  const cvy = b.vy - w[2] * r * nx - svy;
  const cvz = r * (w[1] * nx - w[0] * ny);
  const vn = cvx * nx + cvy * ny;
  let jn = support;
  if (support <= 0) {
    if (vn >= 0) return 0;
    jn = -(1 + e) * vn;
    b.vx += jn * nx;
    b.vy += jn * ny;
  }
  // Friction along the wall's plane (t) and out of it (z, from spin alone: the plane holds the
  // ball's centre), each with its own effective mass, sharing the Coulomb limit.
  const tx = -ny;
  const ty = nx;
  const vt = cvx * tx + cvy * ty;
  let jt = (-vt * SHELL) / (1 + SHELL);
  let jz = -cvz * SHELL;
  const want = Math.hypot(jt, jz);
  const limit = mu * jn;
  if (want > limit && want > 0) {
    jt *= limit / want;
    jz *= limit / want;
  }
  const fx = jt * tx;
  const fy = jt * ty;
  b.vx += fx;
  b.vy += fy;
  // Spin from the impulse at the contact point: (−r n) × (fx, fy, jz) / (SHELL r²).
  const k = 1 / (SHELL * r);
  w[0] += -ny * jz * k;
  w[1] += nx * jz * k;
  w[2] += (ny * fx - nx * fy) * k;
  return jn;
};

/** Contact between two balls, `n` from a to b; inverse masses ia and ib. */
const collide = (a: Ball, b: Ball, nx: number, ny: number, ia: number, ib: number): number => {
  const wa = a.w;
  const wb = b.w;
  // Contact point velocities: a's at +ra n, b's at −rb n.
  const avx = a.vx - wa[2] * a.r * ny;
  const avy = a.vy + wa[2] * a.r * nx;
  const avz = a.r * (wa[0] * ny - wa[1] * nx);
  const bvx = b.vx + wb[2] * b.r * ny;
  const bvy = b.vy - wb[2] * b.r * nx;
  const bvz = -b.r * (wb[0] * ny - wb[1] * nx);
  const rx = bvx - avx;
  const ry = bvy - avy;
  const rz = bvz - avz;
  const vn = rx * nx + ry * ny;
  if (vn >= 0) return 0;
  const im = ia + ib;
  const jn = (-(1 + BOUNCE.ball) * vn) / im;
  a.vx -= jn * ia * nx;
  a.vy -= jn * ia * ny;
  b.vx += jn * ib * nx;
  b.vy += jn * ib * ny;
  const tx = -ny;
  const ty = nx;
  const vt = rx * tx + ry * ty;
  let jt = -vt / (im * (1 + 1 / SHELL));
  let jz = -rz / (im / SHELL);
  const want = Math.hypot(jt, jz);
  const limit = GRIP.ball * jn;
  if (want > limit && want > 0) {
    jt *= limit / want;
    jz *= limit / want;
  }
  const fx = jt * tx;
  const fy = jt * ty;
  b.vx += fx * ib;
  b.vy += fy * ib;
  a.vx -= fx * ia;
  a.vy -= fy * ia;
  // b's contact point is at −rb n, a's at +ra n and it takes the opposite impulse.
  const kb = ib / (SHELL * b.r);
  wb[0] += -ny * jz * kb;
  wb[1] += nx * jz * kb;
  wb[2] += (ny * fx - nx * fy) * kb;
  const ka = ia / (SHELL * a.r);
  wa[0] += -ny * jz * ka;
  wa[1] += nx * jz * ka;
  wa[2] += (ny * fx - nx * fy) * ka;
  return jn;
};

/** Where along the segment p0 to p1 it first comes within `reach` of c, 0 to 1, or -1. */
export const sweep = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  reach: number,
): number => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const c = fx * fx + fy * fy - reach * reach;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return -1;
  const bq = fx * dx + fy * dy;
  const disc = bq * bq - a * c;
  if (disc < 0) return -1;
  const t = (-bq - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 ? t : -1;
};

/**
 * A ball thrown from (x, y) at (vx, vy) in free flight, with the balls' gravity and drag and
 * ignoring anything in the way: how far its lowest point clears the net's top as it passes over
 * (-Infinity if it comes down before reaching it), and where it comes down.
 */
export const netFlight = (
  net: Net,
  floor: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  r: number,
): { clear: number; land: number } => {
  const dt = 1 / 120;
  const side = Math.sign(x - net.x);
  let clear = -Infinity;
  for (let i = 0; i < 720; i++) {
    vy -= GRAVITY * dt;
    const s = Math.hypot(vx, vy);
    const k = Math.max(0, 1 - (DRAG_LIN + DRAG_QUAD * s) * dt);
    vx *= k;
    vy *= k;
    x += vx * dt;
    y += vy * dt;
    if (clear === -Infinity && Math.sign(x - net.x) !== side) {
      clear = y - r - net.top - net.radius;
    }
    if (y - r < floor) break;
  }
  return { clear, land: x };
};

/** The solver's view of a ball or a toy: centre, velocity, spin about z and inverse masses. */
interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  im: number;
  ii: number;
}

interface BallBody extends Body {
  readonly ball: Ball;
  r: number;
  /** The x of whatever toy it rests on, or NaN. */
  support: number;
}

const FLOOR = 0;
const LEFT = 1;
const RIGHT = 2;
const TOP = 3;
const NET = 4;
const PAIR = 5;
const BALL = 6;
const UMBRELLA = 7;

/** One contact: disc `da` of toy `a` (null for the sand, sides, top or net) against `b`. */
interface Contact {
  kind: number;
  a: Prop | null;
  da: number;
  b: Body;
  /** The disc of `b` when it is a toy, -1 for a ball. */
  db: number;
  /** The umbrella's segment, for a contact with it. */
  seg: number;
  nx: number;
  ny: number;
  sep: number;
  rax: number;
  ray: number;
  rbx: number;
  rby: number;
  /** Inverse masses as this contact sees them: a sleeping toy holds still like the sand. */
  imA: number;
  iiA: number;
  imB: number;
  iiB: number;
  mn: number;
  mt: number;
  vn0: number;
  jn: number;
  jt: number;
  e: number;
  mu: number;
}

interface Grip {
  p: Prop;
  f: Finger;
  rx: number;
  ry: number;
  i11: number;
  i12: number;
  i22: number;
  cx: number;
  cy: number;
  gamma: number;
  ax: number;
  ay: number;
  max: number;
}

export const createWorld = (
  rng: Rng,
  count: number,
  radius: number,
  initial: Bounds,
  rest: readonly number[],
  options: WorldOptions = {},
): World => {
  let bounds = initial;
  let net: Net | null = options.net ?? null;
  let umbrella: Umbrella | null = null;
  /** The umbrella's outline about its foot, and where each segment is now as it rocks. */
  let segs: Segment[] = [];
  const segAt = { ax: [] as number[], ay: [] as number[], bx: [] as number[], by: [] as number[] };
  /** Room round the umbrella's outline: least and most x and y of every segment and its skin. */
  const umbBox = { left: 0, right: 0, bottom: 0, top: 0 };
  const balls: Ball[] = Array.from({ length: count }, (_, index) => ({
    index,
    x: rest[index] ?? (index + 0.5) * (bounds.width / count),
    y: bounds.floor + radius,
    vx: 0,
    vy: 0,
    w: [0, 0, 0],
    rot: randomRotation(rng),
    r: radius,
    holder: null,
    grounded: true,
    perched: 0,
    steps: 0,
    side: 1,
  }));
  const makeProp = (kind: PropKind, index: number): Prop => {
    const spec = PROP_SPECS[kind];
    return {
      index,
      kind,
      spec,
      x: 0,
      y: 0,
      a: spec.rest,
      vx: 0,
      vy: 0,
      w: 0,
      im: 1 / spec.mass,
      ii: 1 / spec.inertia,
      cs: 1,
      sn: 0,
      holder: null,
      grounded: true,
      asleep: true,
      still: 0,
      perched: 0,
      yaw: 0,
      yawRate: 0,
      side: 1,
      off: false,
    };
  };
  const props: Prop[] = (options.props ?? []).map(({ kind }, index) => makeProp(kind, index));
  // The closed umbrella out of the sand is a toy too, out of play until it is pulled out.
  const brolly = options.umbrella ? makeProp("brolly", props.length) : null;
  if (brolly) {
    brolly.off = true;
    props.push(brolly);
  }
  const fingers = new Map<number, Finger>();
  let events: WorldEvent[] = [];

  const ballBodies: BallBody[] = balls.map((ball) => ({
    ball,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    w: 0,
    im: 0,
    ii: 0,
    r: ball.r,
    support: Number.NaN,
  }));
  const contacts: Contact[] = Array.from({ length: MAX_CONTACTS }, () => ({
    kind: 0,
    a: null,
    da: 0,
    b: ballBodies[0] ?? (props[0] as Body),
    db: -1,
    seg: -1,
    nx: 0,
    ny: 1,
    sep: 0,
    rax: 0,
    ray: 0,
    rbx: 0,
    rby: 0,
    imA: 0,
    iiA: 0,
    imB: 0,
    iiB: 0,
    mn: 0,
    mt: 0,
    vn0: 0,
    jn: 0,
    jt: 0,
    e: 0,
    mu: 0,
  }));
  let used = 0;
  const grips: Grip[] = [];
  /** The x of whatever each toy rests on other than the sand, or NaN. */
  const propSupport = props.map(() => Number.NaN);
  const landed = props.map(() => false);
  const struck = props.map(() => false);

  const emit = (
    kind: EventKind,
    b: Ball,
    x: number,
    y: number,
    speed: number,
    synthetic: boolean,
  ) => {
    if (events.length < MAX_EVENTS) {
      events.push({ kind, ball: b.index, prop: -1, x, y, speed, synthetic });
    }
  };
  const emitProp = (
    kind: EventKind,
    p: Prop,
    x: number,
    y: number,
    speed: number,
    synthetic: boolean,
  ) => {
    if (events.length < MAX_EVENTS) {
      events.push({ kind, ball: -1, prop: p.index, x, y, speed, synthetic });
    }
  };

  const capSpeed = (b: Ball) => {
    const s = Math.hypot(b.vx, b.vy);
    if (s > MAX_SPEED) {
      b.vx *= MAX_SPEED / s;
      b.vy *= MAX_SPEED / s;
    }
    const w = Math.hypot(b.w[0], b.w[1], b.w[2]);
    if (w > MAX_SPIN) for (let i = 0; i < 3; i++) b.w[i]! *= MAX_SPIN / w;
  };

  const capProp = (p: Prop) => {
    const s = Math.hypot(p.vx, p.vy);
    if (s > MAX_PROP_SPEED) {
      p.vx *= MAX_PROP_SPEED / s;
      p.vy *= MAX_PROP_SPEED / s;
    }
    p.w = clamp(p.w, -MAX_PROP_SPIN, MAX_PROP_SPIN);
  };

  const orient = (p: Prop) => {
    p.cs = Math.cos(p.a);
    p.sn = Math.sin(p.a);
  };

  const wake = (p: Prop) => {
    if (p.off) return;
    p.asleep = false;
    p.still = 0;
  };

  const letGo = (f: Finger) => {
    if (f.ball && f.ball.holder === f.id) f.ball.holder = null;
    f.ball = null;
    if (f.prop && f.prop.holder === f.id) f.prop.holder = null;
    f.prop = null;
  };

  /** The free ball whose surface is nearest (x, y), and how far off it that is. */
  const nearestBall = (x: number, y: number) => {
    let best: Ball | null = null;
    let bestD = Infinity;
    for (const b of balls) {
      if (b.holder !== null) continue;
      const d = Math.hypot(b.x - x, b.y - y) - b.r;
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return { ball: best, d: bestD };
  };

  /** The free toy whose outline is nearest (x, y), the distance and the nearest disc. */
  const nearestProp = (x: number, y: number) => {
    let best: Prop | null = null;
    let bestD = Infinity;
    let disc = 0;
    for (const p of props) {
      if (p.holder !== null || p.off) continue;
      if (Math.hypot(p.x - x, p.y - y) - p.spec.reach > bestD) continue;
      p.spec.discs.forEach((d, i) => {
        const cx = p.x + p.cs * d.x - p.sn * d.y;
        const cy = p.y + p.sn * d.x + p.cs * d.y;
        const dist = Math.hypot(cx - x, cy - y) - d.r;
        if (dist < bestD) {
          best = p;
          bestD = dist;
          disc = i;
        }
      });
    }
    return { prop: best as Prop | null, d: bestD, disc };
  };

  const netBall = (b: Ball, held: boolean, dt: number): boolean => {
    if (!net) return false;
    const qy = clamp(b.y, bounds.floor, net.top);
    const dx = b.x - net.x;
    const reach = b.r + net.radius;
    let nx: number;
    let ny: number;
    if (b.y < net.top) {
      // Beside the post or mesh: pushed back to its own side, however far it got.
      if (b.side * dx >= reach) return false;
      nx = b.side;
      ny = 0;
      b.x = net.x + nx * reach;
    } else {
      const dy = b.y - qy;
      const d = Math.hypot(dx, dy);
      if (d >= reach) return false;
      nx = d > 1e-9 ? dx / d : b.side;
      ny = d > 1e-9 ? dy / d : 0;
      b.x = net.x + nx * reach;
      b.y = qy + ny * reach;
    }
    if (held) {
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= vn * nx;
        b.vy -= vn * ny;
      }
      return true;
    }
    const feel = netZone(net, qy);
    contact(b, nx, ny, 0, 0, feel.bounce, feel.grip);
    if (feel === NET_FEEL.mesh && b.vy > 0) b.vy *= 0.5;
    if (ny > 0.5) {
      // Nothing balances on the tape: it rolls off whichever way it leans.
      const way = Math.abs(dx) > 1e-4 ? Math.sign(dx) : rng.next() < 0.5 ? -1 : 1;
      b.vx += way * NET_SHRUG * dt;
    }
    return true;
  };

  /** Put the umbrella's outline where it is now, rocked on its foot. */
  const placeSegs = () => {
    const u = umbrella;
    const n = u ? segs.length : 0;
    segAt.ax.length = n;
    segAt.ay.length = n;
    segAt.bx.length = n;
    segAt.by.length = n;
    if (!u) return;
    const c = Math.cos(u.wobble.tilt + u.stand);
    const s = Math.sin(u.wobble.tilt + u.stand);
    const fx = u.at.x;
    const fy = bounds.floor;
    umbBox.left = Infinity;
    umbBox.right = -Infinity;
    umbBox.bottom = Infinity;
    umbBox.top = -Infinity;
    for (let i = 0; i < n; i++) {
      const g = segs[i]!;
      const ax = fx + c * g.ax - s * g.ay;
      const ay = fy + s * g.ax + c * g.ay;
      const bx = fx + c * g.bx - s * g.by;
      const by = fy + s * g.bx + c * g.by;
      segAt.ax[i] = ax;
      segAt.ay[i] = ay;
      segAt.bx[i] = bx;
      segAt.by[i] = by;
      umbBox.left = Math.min(umbBox.left, ax - g.skin, bx - g.skin);
      umbBox.right = Math.max(umbBox.right, ax + g.skin, bx + g.skin);
      umbBox.bottom = Math.min(umbBox.bottom, ay - g.skin, by - g.skin);
      umbBox.top = Math.max(umbBox.top, ay + g.skin, by + g.skin);
    }
  };

  /** Its outline for how it stands and how far it is folded; none while it is out of the sand. */
  const shapeUmbrella = () => {
    const u = umbrella;
    segs = u && u.state !== "loose" ? umbrellaSegments(u.at, bounds.floor, u.fold) : [];
    placeSegs();
  };

  const setupUmbrella = (u: UmbrellaLayout | null) => {
    const was = umbrella;
    umbrella =
      u && brolly
        ? {
            layout: u,
            at: was ? { ...u, x: was.at.x } : { ...u },
            wobble: was?.wobble ?? createWobble(),
            state: was?.state ?? "open",
            fold: was?.fold ?? 0,
            stand: was?.stand ?? 0,
            prop: brolly,
            hits: was?.hits ?? 0,
            nudges: was?.nudges ?? 0,
            closes: was?.closes ?? 0,
            pulls: was?.pulls ?? 0,
            plants: was?.plants ?? 0,
          }
        : null;
    shapeUmbrella();
  };
  setupUmbrella(options.umbrella ?? null);

  /** Where it can stand: its canopy inside the wall and clear of the net. */
  const plantAt = (x: number) => {
    const u = umbrella!;
    const r = u.layout.radius + 0.1;
    let p = clamp(x, r, Math.max(r, bounds.width - r));
    if (net && Math.abs(p - net.x) < r + net.radius + 0.15) {
      const side = p < net.x ? -1 : 1;
      p = net.x + side * (r + net.radius + 0.15);
      if (p < r || p > bounds.width - r) p = net.x - side * (r + net.radius + 0.15);
    }
    return p;
  };

  /** Pulled by a finger, the closed umbrella comes out of the sand, held where it was touched. */
  const loosen = (f: Finger) => {
    const u = umbrella!;
    const p = u.prop;
    const a = u.wobble.tilt;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const ox = p.spec.origin.x;
    const oy = p.spec.origin.y;
    const cx = u.at.x - (c * ox - s * oy);
    const cy = bounds.floor - (s * ox + c * oy);
    u.state = "loose";
    u.pulls++;
    shapeUmbrella();
    p.a = a;
    p.cs = c;
    p.sn = s;
    p.x = cx;
    p.y = cy;
    p.off = false;
    p.vx = 0;
    p.vy = 0;
    p.w = 0;
    p.yaw = u.wobble.yaw;
    if (net) p.side = p.x < net.x ? -1 : 1;
    wake(p);
    // Held by the point the finger first landed on, so the pull draws it up out of the sand.
    const gx = f.startX - p.x;
    const gy = Math.max(bounds.floor + 0.05, f.startY) - p.y;
    f.prop = p;
    f.gripX = c * gx + s * gy;
    f.gripY = -s * gx + c * gy;
    f.umbHold = false;
    p.holder = f.id;
  };

  /** The loose umbrella is stood up on its foot where it lies, closed, and then opens. */
  const plant = () => {
    const u = umbrella;
    if (!u || u.state !== "loose") return;
    const p = u.prop;
    if (p.holder !== null) {
      const f = fingers.get(p.holder);
      if (f) f.prop = null;
      p.holder = null;
    }
    const fx = p.x + p.cs * p.spec.origin.x - p.sn * p.spec.origin.y;
    u.at.x = plantAt(fx);
    u.stand = wrapAngle(p.a - u.wobble.tilt);
    u.state = "rising";
    u.fold = 1;
    u.plants++;
    p.off = true;
    p.asleep = true;
    p.vx = 0;
    p.vy = 0;
    p.w = 0;
    shapeUmbrella();
  };

  /** Folding, unfolding and standing up, a step at a time. */
  const stepUmbrella = (dt: number) => {
    const u = umbrella;
    if (!u) return;
    stepWobble(u.wobble, dt);
    let shaped = false;
    if (u.state === "closing") {
      u.fold = Math.min(1, u.fold + dt / FOLD_S);
      if (u.fold >= 1) u.state = "closed";
      shaped = true;
    } else if (u.state === "opening") {
      u.fold = Math.max(0, u.fold - dt / FOLD_S);
      if (u.fold <= 0) u.state = "open";
      shaped = true;
    } else if (u.state === "rising") {
      const turn = Math.max(Math.abs(u.stand) * (1 - Math.exp(-dt / 0.14)), (dt * 0.6) / RISE_S);
      u.stand = Math.abs(u.stand) <= turn ? 0 : u.stand - Math.sign(u.stand) * turn;
      if (u.stand === 0) u.state = "opening";
      shaped = true;
    }
    if (shaped) shapeUmbrella();
    else placeSegs();
  };

  /** The nearest point of the umbrella's outline to (x, y), and how far off its skin that is. */
  const near = { d: Infinity, seg: -1, qx: 0, qy: 0 };
  const nearUmbrella = (x: number, y: number) => {
    near.d = Infinity;
    near.seg = -1;
    for (let i = 0; i < segAt.ax.length; i++) {
      const ax = segAt.ax[i]!;
      const ay = segAt.ay[i]!;
      const bx = segAt.bx[i]!;
      const by = segAt.by[i]!;
      const t = nearestOn(ax, ay, bx, by, x, y);
      const qx = ax + (bx - ax) * t;
      const qy = ay + (by - ay) * t;
      const d = Math.hypot(x - qx, y - qy) - segs[i]!.skin;
      if (d < near.d) {
        near.d = d;
        near.seg = i;
        near.qx = qx;
        near.qy = qy;
      }
    }
    return near;
  };

  /** An impulse (ix, iy) on the umbrella at (x, y) rocks it about its foot. */
  const rock = (x: number, y: number, ix: number, iy: number, turn: number) => {
    const u = umbrella;
    if (!u) return;
    knock(u.wobble, (x - u.at.x) * iy - (y - bounds.floor) * ix, turn);
  };

  /** A ball against the umbrella's outline. Returns whether it touched. */
  const umbrellaBall = (b: Ball, held: boolean, dt: number): boolean => {
    const u = umbrella;
    if (
      !u ||
      b.x + b.r < umbBox.left ||
      b.x - b.r > umbBox.right ||
      b.y - b.r > umbBox.top ||
      b.y + b.r < umbBox.bottom
    ) {
      return false;
    }
    let touched = false;
    for (let i = 0; i < segs.length; i++) {
      const g = segs[i]!;
      const ax = segAt.ax[i]!;
      const ay = segAt.ay[i]!;
      const bx = segAt.bx[i]!;
      const by = segAt.by[i]!;
      const t = nearestOn(ax, ay, bx, by, b.x, b.y);
      const qx = ax + (bx - ax) * t;
      const qy = ay + (by - ay) * t;
      const dx = b.x - qx;
      const dy = b.y - qy;
      const reach = b.r + g.skin;
      const d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2);
      let nx = 0;
      let ny = 1;
      if (d > 1e-9) {
        nx = dx / d;
        ny = dy / d;
      }
      b.x = qx + nx * reach;
      b.y = qy + ny * reach;
      touched = true;
      if (held) {
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          b.vx -= vn * nx;
          b.vy -= vn * ny;
        }
        continue;
      }
      const feel = UMBRELLA_FEEL[g.part];
      const vx0 = b.vx;
      const vy0 = b.vy;
      const jn = contact(b, nx, ny, 0, 0, feel.bounce, feel.grip);
      if (jn > 0) {
        const ix = (b.vx - vx0) * BALL_MASS;
        const iy = (b.vy - vy0) * BALL_MASS;
        // A glancing blow on the canopy turns it on its pole.
        const glance = g.part === "canopy" ? (ix * -ny + iy * nx) * GLANCE_TURN : 0;
        rock(qx, qy, -ix, -iy, -glance);
        if (jn > 1) {
          u.hits++;
          emit("hit", b, qx + nx * g.skin, qy + ny * g.skin, jn, false);
        }
      }
      // Nothing balances on the canopy: it slides off whichever way it leans.
      if (g.part === "canopy" && ny > 0.5) {
        b.vx += (Math.sign(b.x - u.at.x) || 1) * CANOPY_SHRUG * dt;
      }
    }
    return touched;
  };

  /** A finger landing on the umbrella pushes it away from itself. */
  const nudgeUmbrella = (f: Finger, x: number, y: number) => {
    const u = umbrella;
    if (!u) return;
    let dx = near.qx - x;
    let dy = near.qy - y;
    let d = Math.hypot(dx, dy);
    if (d < 0.01) {
      dx = Math.sign(u.at.x - x) || (rng.next() < 0.5 ? -1 : 1);
      dy = -0.3;
      d = Math.hypot(dx, dy);
    }
    const canopy = segs[near.seg]?.part === "canopy";
    rock(near.qx, near.qy, (NUDGE * dx) / d, (NUDGE * dy) / d, canopy ? rng.range(-1.5, 1.5) : 0);
    f.umb = true;
    f.umbHold = true;
    u.nudges++;
    if (events.length < MAX_EVENTS) {
      events.push({
        kind: "nudge",
        ball: -1,
        prop: -1,
        x,
        y,
        speed: NUDGE,
        synthetic: f.synthetic,
      });
    }
  };

  /** A free finger coming onto the umbrella rocks it with its speed, and a swipe turns it. */
  const swipeUmbrella = (f: Finger) => {
    const u = umbrella;
    if (!u) return;
    const q = nearUmbrella(f.x, f.y);
    if (q.d > FINGER_R + 0.06) {
      f.umb = false;
      return;
    }
    if (f.umb || q.d > FINGER_R) return;
    f.umb = true;
    const speed = Math.hypot(f.vx, f.vy);
    if (speed < 0.3) return;
    const canopy = segs[q.seg]?.part === "canopy";
    rock(q.qx, q.qy, f.vx * SWIPE_ROCK, f.vy * SWIPE_ROCK, canopy ? f.vx * SWIPE_TURN : 0);
    u.nudges++;
    if (events.length < MAX_EVENTS) {
      events.push({
        kind: "nudge",
        ball: -1,
        prop: -1,
        x: f.x,
        y: f.y,
        speed,
        synthetic: f.synthetic,
      });
    }
  };

  const sides = (b: Ball, held: boolean) => {
    if (b.x - b.r < 0) {
      b.x = b.r;
      if (held) b.vx = Math.max(0, b.vx);
      else contact(b, 1, 0, 0, 0, BOUNCE.side, GRIP.side);
    } else if (b.x + b.r > bounds.width) {
      b.x = bounds.width - b.r;
      if (held) b.vx = Math.min(0, b.vx);
      else contact(b, -1, 0, 0, 0, BOUNCE.side, GRIP.side);
    }
    if (b.y + b.r > bounds.height) {
      b.y = bounds.height - b.r;
      if (held) b.vy = Math.min(0, b.vy);
      else contact(b, 0, -1, 0, 0, BOUNCE.side, GRIP.side);
    }
  };

  const ground = (b: Ball, dt: number) => {
    const floorY = bounds.floor + b.r;
    if (b.y > floorY + 1e-4) {
      b.grounded = false;
      return;
    }
    b.y = floorY;
    if (b.holder !== null) {
      b.vy = Math.max(0, b.vy);
      b.grounded = true;
      return;
    }
    if (b.vy < -SETTLE) {
      const speed = -b.vy;
      contact(b, 0, 1, 0, 0, BOUNCE.floor, GRIP.floor);
      // Sand gives under a hard landing and takes some of the run with it.
      b.vx *= 0.92;
      b.grounded = false;
      emit("land", b, b.x, bounds.floor, speed, false);
      return;
    }
    if (b.vy < 0) b.vy = 0;
    if (b.vy > 0) {
      b.grounded = false;
      return;
    }
    b.grounded = true;
    contact(b, 0, 1, 0, 0, 0, GRIP.floor, GRAVITY * dt);
    const s = Math.abs(b.vx);
    b.vx = s <= ROLL * dt ? 0 : b.vx - Math.sign(b.vx) * ROLL * dt;
    b.w[1] *= Math.exp(-dt / 0.4);
    if (b.vx === 0) {
      const k = Math.exp(-dt / 0.15);
      b.w[0] *= k;
      b.w[2] *= k;
    }
  };

  const pairs = () => {
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i]!;
        const b = balls[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const reach = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= reach * reach) continue;
        const d = Math.sqrt(d2);
        const nx = d > 1e-9 ? dx / d : 1;
        const ny = d > 1e-9 ? dy / d : 0;
        // A held ball is pushed by its finger, so it barely gives.
        const ia = a.holder !== null ? HELD_IM : 1;
        const ib = b.holder !== null ? HELD_IM : 1;
        const jn = collide(a, b, nx, ny, ia, ib);
        const push = (reach - d) / (ia + ib);
        a.x -= nx * push * ia;
        a.y -= ny * push * ia;
        b.x += nx * push * ib;
        b.y += ny * push * ib;
        if (jn > 1) {
          emit("hit", a, a.x + nx * a.r, a.y + ny * a.r, jn * ia, false);
          emit("hit", b, a.x + nx * a.r, a.y + ny * a.r, jn * ib, false);
        }
      }
    }
  };

  const keepIn = (b: Ball) => {
    b.x = clamp(b.x, b.r, Math.max(b.r, bounds.width - b.r));
    b.y = clamp(b.y, bounds.floor + b.r, Math.max(bounds.floor + b.r, bounds.height - b.r));
  };

  const bat = (f: Finger) => {
    for (const b of balls) {
      if (b.holder !== null) continue;
      const reach = b.r + FINGER_R;
      const t = sweep(f.lastX, f.lastY, f.x, f.y, b.x, b.y, reach);
      if (t < 0) continue;
      const cx = f.lastX + (f.x - f.lastX) * t;
      const cy = f.lastY + (f.y - f.lastY) * t;
      let nx = b.x - cx;
      let ny = b.y - cy;
      const d = Math.hypot(nx, ny);
      if (d < 1e-9) {
        nx = 0;
        ny = 1;
      } else {
        nx /= d;
        ny /= d;
      }
      const bx = b.vx;
      const by = b.vy;
      const jn = contact(b, nx, ny, f.vx, f.vy, BOUNCE.finger, GRIP.finger);
      // Hands strike from below more often than not, so a bat lifts a little as well.
      if (jn > 0) b.vy += 0.15 * jn;
      // The ball ends just clear of where the finger is now.
      const ex = b.x - f.x;
      const ey = b.y - f.y;
      const de = Math.hypot(ex, ey);
      if (de < reach) {
        const k = de > 1e-9 ? reach / de : 0;
        b.x = de > 1e-9 ? f.x + ex * k : b.x;
        b.y = de > 1e-9 ? f.y + ey * k : b.y + reach;
      }
      keepIn(b);
      capSpeed(b);
      const dv = Math.hypot(b.vx - bx, b.vy - by);
      if (jn > 0.4) emit("bat", b, cx + nx * FINGER_R, cy + ny * FINGER_R, dv, f.synthetic);
    }
  };

  /** A finger's swept path striking a toy: an impulse at the disc it meets first. */
  const batProps = (f: Finger) => {
    for (const p of props) {
      if (p.holder !== null || p.off) continue;
      const pad = p.spec.reach + FINGER_R;
      if (sweep(f.lastX, f.lastY, f.x, f.y, p.x, p.y, pad) < 0) continue;
      let first = 2;
      let hit = -1;
      p.spec.discs.forEach((d, i) => {
        const cx = p.x + p.cs * d.x - p.sn * d.y;
        const cy = p.y + p.sn * d.x + p.cs * d.y;
        const t = sweep(f.lastX, f.lastY, f.x, f.y, cx, cy, d.r + FINGER_R);
        if (t >= 0 && t < first) {
          first = t;
          hit = i;
        }
      });
      if (hit < 0) continue;
      const d = p.spec.discs[hit]!;
      const cx = p.x + p.cs * d.x - p.sn * d.y;
      const cy = p.y + p.sn * d.x + p.cs * d.y;
      const fx = f.lastX + (f.x - f.lastX) * first;
      const fy = f.lastY + (f.y - f.lastY) * first;
      let nx = cx - fx;
      let ny = cy - fy;
      const dist = Math.hypot(nx, ny);
      if (dist < 1e-9) {
        nx = 0;
        ny = 1;
      } else {
        nx /= dist;
        ny /= dist;
      }
      const rx = cx - nx * d.r - p.x;
      const ry = cy - ny * d.r - p.y;
      const vn = (p.vx - p.w * ry - f.vx) * nx + (p.vy + p.w * rx - f.vy) * ny;
      if (vn >= 0) continue;
      const rn = rx * ny - ry * nx;
      const jn = (-(1 + BOUNCE.finger) * vn) / (p.im + p.ii * rn * rn);
      const tx = -ny;
      const ty = nx;
      const vt = (p.vx - p.w * ry - f.vx) * tx + (p.vy + p.w * rx - f.vy) * ty;
      const rt = rx * ty - ry * tx;
      const jt = clamp(-vt / (p.im + p.ii * rt * rt), -GRIP.finger * jn, GRIP.finger * jn);
      const jx = jn * nx + jt * tx;
      const jy = jn * ny + jt * ty + 0.12 * jn;
      const bx = p.vx;
      const by = p.vy;
      p.vx += p.im * jx;
      p.vy += p.im * jy;
      p.w += p.ii * (rx * jy - ry * jx);
      // No push clear of the finger, as a ball gets: that could shove a toy into the net, and
      // it leaves faster than the finger anyway.
      wake(p);
      capProp(p);
      const dv = Math.hypot(p.vx - bx, p.vy - by);
      if (dv > 0.4) emitProp("bat", p, fx + nx * FINGER_R, fy + ny * FINGER_R, dv, f.synthetic);
    }
  };

  const perch = (b: Ball, dt: number) => {
    if (
      b.grounded ||
      b.holder !== null ||
      Math.hypot(b.vx, b.vy) > 0.15 ||
      b.y - b.r < bounds.floor + BALL_PERCH_LOW
    ) {
      b.perched = 0;
      return;
    }
    b.perched += dt;
    if (b.perched < PERCH) return;
    // Whatever it sits on: another ball, a toy or the net.
    let under = Number.NaN;
    for (const o of balls) {
      if (o === b || o.y >= b.y) continue;
      if (Math.hypot(o.x - b.x, o.y - b.y) < o.r + b.r + 0.02) under = o.x;
    }
    if (Number.isNaN(under)) under = ballBodies[b.index]!.support;
    if (Number.isNaN(under) && net && Math.abs(b.x - net.x) < b.r + net.radius + 0.05) {
      under = net.x;
    }
    if (Number.isNaN(under) && umbrella && nearUmbrella(b.x, b.y).d < b.r + 0.05) {
      under = umbrella.at.x;
    }
    const side =
      Number.isNaN(under) || b.x === under ? (rng.next() < 0.5 ? -1 : 1) : Math.sign(b.x - under);
    const towards = b.x < b.r * 2 ? 1 : b.x > bounds.width - b.r * 2 ? -1 : side;
    b.vx += 0.7 * towards;
    b.vy += 0.4;
    b.perched = 0;
  };

  const turn = (b: Ball, dt: number) => {
    const w = b.w;
    const s = Math.hypot(w[0], w[1], w[2]);
    if (s > 1e-6) b.rot = multiply3(rotationAbout(w, s * dt), b.rot);
    if (++b.steps >= ORTHO_EVERY) {
      b.steps = 0;
      b.rot = orthonormalize3(b.rot);
    }
  };

  // Toys: contacts, the grip joint and the solver.

  const discX = (p: Prop, i: number) => {
    const d = p.spec.discs[i]!;
    return p.x + p.cs * d.x - p.sn * d.y;
  };
  const discY = (p: Prop, i: number) => {
    const d = p.spec.discs[i]!;
    return p.y + p.sn * d.x + p.cs * d.y;
  };

  /** Work out a contact's normal, separation and contact point from where things are now. */
  const measure = (c: Contact) => {
    const B = c.b;
    let bx: number;
    let by: number;
    let br: number;
    if (c.db >= 0) {
      const p = B as Prop;
      bx = discX(p, c.db);
      by = discY(p, c.db);
      br = p.spec.discs[c.db]!.r;
    } else {
      bx = B.x;
      by = B.y;
      br = (B as BallBody).r;
    }
    let nx = 0;
    let ny = 1;
    let sep: number;
    let px: number;
    let py: number;
    switch (c.kind) {
      case FLOOR:
        sep = by - br - bounds.floor;
        px = bx;
        py = by - br;
        break;
      case LEFT:
        nx = 1;
        ny = 0;
        sep = bx - br;
        px = bx - br;
        py = by;
        break;
      case RIGHT:
        nx = -1;
        ny = 0;
        sep = bounds.width - bx - br;
        px = bx + br;
        py = by;
        break;
      case TOP:
        ny = -1;
        sep = bounds.height - by - br;
        px = bx;
        py = by + br;
        break;
      case NET: {
        const n = net!;
        const side = (B as Prop).side;
        if (by < n.top) {
          // Beside the post or mesh: back to the toy's own side, whichever side this disc is.
          nx = side;
          ny = 0;
          sep = side * (bx - n.x) - br - n.radius;
        } else {
          const dx = bx - n.x;
          const dy = by - n.top;
          const d = Math.hypot(dx, dy);
          nx = d > 1e-9 ? dx / d : side;
          ny = d > 1e-9 ? dy / d : 0;
          sep = d - br - n.radius;
        }
        px = bx - nx * br;
        py = by - ny * br;
        break;
      }
      case UMBRELLA: {
        const j = c.seg;
        const sax = segAt.ax[j]!;
        const say = segAt.ay[j]!;
        const sbx = segAt.bx[j]!;
        const sby = segAt.by[j]!;
        const t = nearestOn(sax, say, sbx, sby, bx, by);
        const dx = bx - (sax + (sbx - sax) * t);
        const dy = by - (say + (sby - say) * t);
        const d = Math.hypot(dx, dy);
        nx = d > 1e-9 ? dx / d : 0;
        ny = d > 1e-9 ? dy / d : 1;
        sep = d - br - segs[j]!.skin;
        px = bx - nx * br;
        py = by - ny * br;
        break;
      }
      default: {
        const A = c.a!;
        const ax = discX(A, c.da);
        const ay = discY(A, c.da);
        const ar = A.spec.discs[c.da]!.r;
        const dx = bx - ax;
        const dy = by - ay;
        const d = Math.hypot(dx, dy);
        nx = d > 1e-9 ? dx / d : 0;
        ny = d > 1e-9 ? dy / d : 1;
        sep = d - ar - br;
        px = ax + nx * (ar + 0.5 * sep);
        py = ay + ny * (ar + 0.5 * sep);
        c.rax = px - A.x;
        c.ray = py - A.y;
      }
    }
    if (c.a === null) {
      c.rax = 0;
      c.ray = 0;
    }
    c.nx = nx;
    c.ny = ny;
    c.sep = sep;
    c.rbx = px - B.x;
    c.rby = py - B.y;
  };

  const normalSpeed = (c: Contact) => {
    const A = c.a;
    const B = c.b;
    let dvx = B.vx - B.w * c.rby;
    let dvy = B.vy + B.w * c.rbx;
    if (A) {
      dvx -= A.vx - A.w * c.ray;
      dvy -= A.vy + A.w * c.rax;
    }
    return dvx * c.nx + dvy * c.ny;
  };

  const tangentSpeed = (c: Contact) => {
    const A = c.a;
    const B = c.b;
    let dvx = B.vx - B.w * c.rby;
    let dvy = B.vy + B.w * c.rbx;
    if (A) {
      dvx -= A.vx - A.w * c.ray;
      dvy -= A.vy + A.w * c.rax;
    }
    return -dvx * c.ny + dvy * c.nx;
  };

  const push = (c: Contact, px: number, py: number) => {
    const A = c.a;
    const B = c.b;
    B.vx += c.imB * px;
    B.vy += c.imB * py;
    B.w += c.iiB * (c.rbx * py - c.rby * px);
    if (A) {
      A.vx -= c.imA * px;
      A.vy -= c.imA * py;
      A.w -= c.iiA * (c.rax * py - c.ray * px);
    }
  };

  /** A new contact if `b` (disc `db`) is within reach of `a` (disc `da`) or a surface. */
  const consider = (kind: number, a: Prop | null, da: number, b: Body, db: number, seg = -1) => {
    if (used >= MAX_CONTACTS) return;
    const c = contacts[used]!;
    c.kind = kind;
    c.a = a;
    c.da = da;
    c.b = b;
    c.db = db;
    c.seg = seg;
    measure(c);
    if (c.sep > SPECULATIVE) return;
    used++;
    const pb = db >= 0 ? (b as Prop) : null;
    if (kind === PAIR) {
      c.e = Math.sqrt(a!.spec.bounce * pb!.spec.bounce);
      c.mu = Math.sqrt(a!.spec.grip * pb!.spec.grip);
    } else if (kind === BALL) {
      c.e = Math.sqrt(a!.spec.bounce * BOUNCE.ball);
      c.mu = 0.3;
    } else if (kind === NET) {
      const feel = netZone(net!, c.b.y + c.rby);
      c.e = Math.sqrt(pb!.spec.bounce * feel.bounce);
      c.mu = feel.grip;
    } else if (kind === FLOOR) {
      c.e = pb!.spec.bounce;
      c.mu = pb!.spec.grip;
    } else if (kind === UMBRELLA) {
      const feel = UMBRELLA_FEEL[segs[seg]!.part];
      c.e = Math.sqrt(pb!.spec.bounce * feel.bounce);
      c.mu = feel.grip;
    } else {
      c.e = Math.sqrt(pb!.spec.bounce * BOUNCE.side);
      c.mu = pb!.spec.grip * 0.5;
    }
    const still = (q: Prop | null) => q !== null && q.asleep;
    c.imA = a && !a.asleep ? a.im : 0;
    c.iiA = a && !a.asleep ? a.ii : 0;
    c.imB = still(pb) ? 0 : b.im;
    c.iiB = still(pb) ? 0 : b.ii;
    const rnA = c.rax * c.ny - c.ray * c.nx;
    const rnB = c.rbx * c.ny - c.rby * c.nx;
    const kn = c.imA + c.imB + c.iiA * rnA * rnA + c.iiB * rnB * rnB;
    c.mn = kn > 0 ? 1 / kn : 0;
    const rtA = c.rax * c.nx + c.ray * c.ny;
    const rtB = c.rbx * c.nx + c.rby * c.ny;
    const kt = c.imA + c.imB + c.iiA * rtA * rtA + c.iiB * rtB * rtB;
    c.mt = kt > 0 ? 1 / kt : 0;
    c.vn0 = normalSpeed(c);
    c.jn = 0;
    c.jt = 0;
  };

  const findContacts = () => {
    used = 0;
    const floor = bounds.floor;
    for (const p of props) {
      if (p.off) continue;
      const reach = p.spec.reach + SPECULATIVE;
      if (!p.asleep) {
        const n = p.spec.discs.length;
        for (let i = 0; i < n; i++) {
          if (p.y - reach < floor) consider(FLOOR, null, -1, p, i);
          if (p.x - reach < 0) consider(LEFT, null, -1, p, i);
          if (p.x + reach > bounds.width) consider(RIGHT, null, -1, p, i);
          if (p.y + reach > bounds.height) consider(TOP, null, -1, p, i);
          if (
            net &&
            p.side * (p.x - net.x) < reach + net.radius &&
            p.y - reach < net.top + net.radius
          ) {
            consider(NET, null, -1, p, i);
          }
        }
        if (
          umbrella &&
          p.x + reach > umbBox.left &&
          p.x - reach < umbBox.right &&
          p.y + reach > umbBox.bottom &&
          p.y - reach < umbBox.top
        ) {
          for (let i = 0; i < n; i++) {
            for (let j = 0; j < segs.length; j++) consider(UMBRELLA, null, -1, p, i, j);
          }
        }
      }
      for (const bb of ballBodies) {
        const b = bb.ball;
        if (Math.hypot(b.x - p.x, b.y - p.y) > reach + b.r) continue;
        for (let i = 0; i < p.spec.discs.length; i++) consider(BALL, p, i, bb, -1);
      }
    }
    for (let i = 0; i < props.length; i++) {
      const a = props[i]!;
      for (let j = i + 1; j < props.length; j++) {
        const b = props[j]!;
        if ((a.asleep && b.asleep) || a.off || b.off) continue;
        const reach = a.spec.reach + b.spec.reach + SPECULATIVE;
        if (Math.abs(a.x - b.x) > reach || Math.hypot(a.x - b.x, a.y - b.y) > reach) continue;
        for (let m = 0; m < a.spec.discs.length; m++) {
          for (let n = 0; n < b.spec.discs.length; n++) consider(PAIR, a, m, b, n);
        }
      }
    }
  };

  const prepareGrips = (h: number) => {
    grips.length = 0;
    for (const f of fingers.values()) {
      const p = f.prop;
      if (!p) continue;
      const rx = p.cs * f.gripX - p.sn * f.gripY;
      const ry = p.sn * f.gripX + p.cs * f.gripY;
      const m = p.spec.mass;
      const omega = 2 * Math.PI * GRIP_HZ;
      const d = 2 * m * GRIP_ZETA * omega;
      const k = m * omega * omega;
      let gamma = h * (d + h * k);
      gamma = gamma > 0 ? 1 / gamma : 0;
      const beta = h * k * gamma;
      const k11 = p.im + p.ii * ry * ry + gamma;
      const k12 = -p.ii * rx * ry;
      const k22 = p.im + p.ii * rx * rx + gamma;
      const det = k11 * k22 - k12 * k12;
      const inv = det !== 0 ? 1 / det : 0;
      // The swing dies away: its spin, and its motion apart from the finger's.
      const damp = Math.exp(-HELD_SWING * h);
      p.w *= damp;
      p.vx = f.vx + (p.vx - f.vx) * damp;
      p.vy = f.vy + (p.vy - f.vy) * damp;
      grips.push({
        p,
        f,
        rx,
        ry,
        i11: k22 * inv,
        i12: -k12 * inv,
        i22: k11 * inv,
        cx: (p.x + rx - f.x) * beta,
        cy: (p.y + ry - f.y) * beta,
        gamma,
        ax: 0,
        ay: 0,
        max: GRIP_ACCEL * m * h,
      });
    }
  };

  const solveGrip = (g: Grip) => {
    const p = g.p;
    const cdx = p.vx - p.w * g.ry - g.f.vx;
    const cdy = p.vy + p.w * g.rx - g.f.vy;
    const bx = -(cdx + g.cx + g.gamma * g.ax);
    const by = -(cdy + g.cy + g.gamma * g.ay);
    let lx = g.i11 * bx + g.i12 * by;
    let ly = g.i12 * bx + g.i22 * by;
    const ox = g.ax;
    const oy = g.ay;
    g.ax += lx;
    g.ay += ly;
    const mag = Math.hypot(g.ax, g.ay);
    if (mag > g.max) {
      g.ax *= g.max / mag;
      g.ay *= g.max / mag;
    }
    lx = g.ax - ox;
    ly = g.ay - oy;
    p.vx += p.im * lx;
    p.vy += p.im * ly;
    p.w += p.ii * (g.rx * ly - g.ry * lx);
  };

  const solveNormal = (c: Contact, h: number) => {
    const vn = normalSpeed(c);
    const target = c.sep > 0 ? -c.sep / h : 0;
    const old = c.jn;
    c.jn = Math.max(0, old - c.mn * (vn - target));
    const l = c.jn - old;
    if (l !== 0) push(c, l * c.nx, l * c.ny);
  };

  const solveFriction = (c: Contact) => {
    const vt = tangentSpeed(c);
    const max = c.mu * c.jn;
    const old = c.jt;
    c.jt = clamp(old - c.mt * vt, -max, max);
    const l = c.jt - old;
    if (l !== 0) push(c, -l * c.ny, l * c.nx);
  };

  const restitute = (c: Contact) => {
    if (c.vn0 > -BOUNCE_MIN || c.jn <= 0) return;
    const vn = normalSpeed(c);
    const old = c.jn;
    c.jn = Math.max(0, old - c.mn * (vn + c.e * c.vn0));
    const l = c.jn - old;
    if (l !== 0) push(c, l * c.nx, l * c.ny);
  };

  const correct = (c: Contact) => {
    measure(c);
    const C = clamp(BAUMGARTE * (c.sep + SLOP), -MAX_CORRECTION, 0);
    if (C >= 0) return;
    const A = c.a;
    const B = c.b;
    const turnsB = c.db >= 0;
    const imA = c.imA;
    const iiA = c.iiA;
    const iiB = turnsB ? c.iiB : 0;
    const rnA = c.rax * c.ny - c.ray * c.nx;
    const rnB = c.rbx * c.ny - c.rby * c.nx;
    const k = imA + c.imB + iiA * rnA * rnA + iiB * rnB * rnB;
    if (k <= 0) return;
    const P = -C / k;
    B.x += c.imB * P * c.nx;
    B.y += c.imB * P * c.ny;
    if (turnsB) {
      const p = B as Prop;
      p.a += iiB * P * rnB;
      orient(p);
    }
    if (A && imA > 0) {
      A.x -= imA * P * c.nx;
      A.y -= imA * P * c.ny;
      A.a -= iiA * P * rnA;
      orient(A);
    }
  };

  /** Anything moving that comes near a sleeping toy wakes it, so it can be pushed. */
  const wakeNear = () => {
    for (const p of props) {
      if (!p.asleep || p.off) continue;
      for (const b of balls) {
        // A ball's step of gravity is already in its speed here, so resting ones show a little.
        const moving = b.holder !== null || Math.hypot(b.vx, b.vy) > BALL_STIR;
        if (moving && Math.hypot(b.x - p.x, b.y - p.y) < p.spec.reach + b.r + 2 * SPECULATIVE) {
          wake(p);
          break;
        }
      }
      if (!p.asleep) continue;
      for (const q of props) {
        if (q === p || q.asleep || q.off) continue;
        if (
          Math.hypot(q.x - p.x, q.y - p.y) < p.spec.reach + q.spec.reach + 2 * SPECULATIVE &&
          (q.holder !== null || Math.hypot(q.vx, q.vy) > SLEEP_SPEED || Math.abs(q.w) > SLEEP_SPIN)
        ) {
          wake(p);
          break;
        }
      }
    }
  };

  const subStep = (h: number) => {
    // Before gravity, which would make anything resting look as if it moves.
    wakeNear();
    for (const p of props) {
      if (p.asleep) continue;
      p.vy -= p.spec.gravity * h;
      const s = Math.hypot(p.vx, p.vy);
      const k = Math.max(0, 1 - (p.spec.drag[0] + p.spec.drag[1] * s) * h);
      p.vx *= k;
      p.vy *= k;
      p.w *= Math.exp(-PROP_AIR_SPIN * h);
    }
    prepareGrips(h);
    findContacts();
    for (let it = 0; it < ITERATIONS; it++) {
      for (const g of grips) solveGrip(g);
      for (let i = 0; i < used; i++) {
        const c = contacts[i]!;
        solveNormal(c, h);
        solveFriction(c);
      }
    }
    for (let i = 0; i < used; i++) restitute(contacts[i]!);
    for (const p of props) {
      if (p.asleep) continue;
      capProp(p);
      p.x += p.vx * h;
      p.y += p.vy * h;
      p.a += p.w * h;
      orient(p);
    }
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < used; i++) correct(contacts[i]!);
    }
  };

  const lowest = (p: Prop) => {
    let y = Infinity;
    for (let i = 0; i < p.spec.discs.length; i++) {
      y = Math.min(y, discY(p, i) - p.spec.discs[i]!.r);
    }
    return y;
  };

  const settleProp = (p: Prop, dt: number) => {
    if (p.off) return;
    const i = p.index;
    if (!p.asleep && p.grounded) {
      p.w *= Math.exp(-SAND_SPIN * dt);
      if (p.holder === null) p.yawRate *= Math.exp(-dt / 0.12);
    } else if (!p.grounded) {
      p.yawRate *= Math.exp(-0.3 * dt);
    }
    p.yaw += p.yawRate * dt;
    if (p.grounded && p.holder === null && Math.abs(p.yawRate) < 1) {
      const step = p.spec.yawStep;
      if (step > 0) {
        const target = Math.round(p.yaw / step) * step;
        p.yaw += (target - p.yaw) * (1 - Math.exp(-dt / 0.25));
      }
    }
    p.yaw = wrapAngle(p.yaw);
    p.a = wrapAngle(p.a);
    orient(p);
    const speed = Math.hypot(p.vx, p.vy);
    const resting = p.grounded || !Number.isNaN(propSupport[i]!);
    // Sleep once it has sat still for a moment; anything that moves it wakes it.
    if (p.asleep) {
      if (p.holder !== null || speed > SLEEP_SPEED * 1.6 || Math.abs(p.w) > SLEEP_SPIN * 1.6) {
        wake(p);
      } else {
        p.vx = 0;
        p.vy = 0;
        p.w = 0;
      }
    } else if (resting && p.holder === null && speed < SLEEP_SPEED && Math.abs(p.w) < SLEEP_SPIN) {
      p.still += dt;
      if (p.still > SLEEP_AFTER) {
        p.asleep = true;
        p.vx = 0;
        p.vy = 0;
        p.w = 0;
      }
    } else {
      p.still = 0;
    }
    // Nothing stays up off the sand out of reach: a toy resting on something high is nudged off.
    if (
      p.holder === null &&
      !p.grounded &&
      speed < 0.2 &&
      Math.abs(p.w) < 0.8 &&
      lowest(p) > bounds.floor + PROP_PERCH_LOW
    ) {
      p.perched += dt;
      if (p.perched >= PERCH) {
        const under = propSupport[i]!;
        let way =
          Number.isNaN(under) || under === p.x
            ? rng.next() < 0.5
              ? -1
              : 1
            : Math.sign(p.x - under);
        if (p.x < p.spec.reach * 2) way = 1;
        if (p.x > bounds.width - p.spec.reach * 2) way = -1;
        p.vx += 0.9 * way;
        p.vy += 0.8;
        p.w += rng.range(-2, 2);
        p.perched = 0;
        wake(p);
      }
    } else {
      p.perched = 0;
    }
    if (net && p.y >= net.top) p.side = p.x < net.x ? -1 : 1;
    // A last guard: anything that escaped the wall, or went wrong, is put back on the sand.
    const ok =
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      Number.isFinite(p.a) &&
      Number.isFinite(p.vx) &&
      Number.isFinite(p.vy) &&
      Number.isFinite(p.w);
    if (!ok || p.x < -0.05 || p.x > bounds.width + 0.05 || p.y < bounds.floor - 0.3) {
      putProp(p, ok ? clamp(p.x, p.spec.reach, bounds.width - p.spec.reach) : bounds.width / 2);
    } else if (p.y > bounds.height) {
      p.y = bounds.height - p.spec.reach;
      p.vy = Math.min(0, p.vy);
    }
  };

  const stepProps = (dt: number) => {
    if (props.length === 0) return;
    for (const bb of ballBodies) {
      const b = bb.ball;
      bb.x = b.x;
      bb.y = b.y;
      bb.vx = b.vx;
      bb.vy = b.vy;
      bb.w = b.w[2];
      bb.r = b.r;
      bb.im = (b.holder !== null ? HELD_IM : 1) / BALL_MASS;
      bb.ii = bb.im / (SHELL * b.r * b.r);
      bb.support = Number.NaN;
    }
    let fast = 0;
    for (const p of props) {
      if (p.asleep) continue;
      fast = Math.max(fast, (Math.hypot(p.vx, p.vy) + Math.abs(p.w) * p.spec.reach) * dt);
    }
    const n = clamp(Math.ceil(fast / SUB_DISP), 1, MAX_SUB);
    const h = dt / n;
    landed.fill(false);
    struck.fill(false);
    for (let s = 0; s < n; s++) {
      subStep(h);
      // Whatever pressed on the umbrella pushes it back, about its foot.
      for (let i = 0; umbrella && i < used; i++) {
        const c = contacts[i]!;
        if (c.kind !== UMBRELLA || c.jn <= 0) continue;
        const ix = c.jn * c.nx - c.jt * c.ny;
        const iy = c.jn * c.ny + c.jt * c.nx;
        const canopy = segs[c.seg]!.part === "canopy";
        rock(c.b.x + c.rbx, c.b.y + c.rby, -ix, -iy, canopy ? -c.jt * GLANCE_TURN : 0);
        const p = c.b as Prop;
        if (c.vn0 < -1 && !struck[p.index]) {
          struck[p.index] = true;
          umbrella.hits++;
        }
      }
      // A hard landing on the sand throws some of it up.
      for (let i = 0; i < used; i++) {
        const c = contacts[i]!;
        if (c.kind !== FLOOR || c.vn0 > -PROP_LAND || c.jn <= 0) continue;
        const p = c.b as Prop;
        if (landed[p.index]) continue;
        landed[p.index] = true;
        emitProp("land", p, p.x + c.rbx, bounds.floor, -c.vn0, false);
      }
    }
    // What the last pass found: which toys are on the sand, and what rests on what.
    for (const p of props) {
      // A sleeping toy went to sleep on the sand and finds no contacts until it wakes.
      if (!p.asleep) p.grounded = false;
      propSupport[p.index] = Number.NaN;
    }
    for (let i = 0; i < used; i++) {
      const c = contacts[i]!;
      const pb = c.db >= 0 ? (c.b as Prop) : null;
      if (c.kind === FLOOR) {
        if (c.sep < 0.01 && pb) pb.grounded = true;
        continue;
      }
      if (c.jn <= 0 && c.sep > 0.005) continue;
      if (c.kind === UMBRELLA && pb) {
        // On the canopy: pushed off outwards, and nudged off if it stays.
        const ux = umbrella!.at.x;
        if (c.ny > 0.3) propSupport[pb.index] = ux;
        if (c.ny > 0.5 && segs[c.seg]!.part === "canopy") {
          pb.vx += (Math.sign(pb.x - ux) || 1) * CANOPY_SHRUG * dt;
          wake(pb);
        }
        continue;
      }
      if (pb && c.ny > 0.3) propSupport[pb.index] = c.b.x + c.rbx;
      if (c.a && c.ny < -0.3) propSupport[c.a.index] = c.b.x + c.rbx;
      if (c.kind === BALL && c.ny > 0.3) (c.b as BallBody).support = c.b.x + c.rbx;
      if (c.kind === BALL && c.jn * c.b.im > 1) {
        const b = (c.b as BallBody).ball;
        emit("hit", b, c.b.x + c.rbx, c.b.y + c.rby, c.jn * c.b.im, false);
      }
      if (c.kind === NET && pb && c.ny > 0.5) {
        // Nothing balances on the tape.
        const way =
          Math.abs(pb.x - net!.x) > 1e-4 ? Math.sign(pb.x - net!.x) : rng.next() < 0.5 ? -1 : 1;
        pb.vx += way * NET_SHRUG * dt;
        wake(pb);
      }
    }
    for (const g of grips) {
      if (!net && !umbrella) break;
      for (let i = 0; i < used; i++) {
        const c = contacts[i]!;
        if ((c.kind === NET || c.kind === UMBRELLA) && c.b === g.p && c.jn > 0) {
          g.f.blocked = true;
        }
      }
    }
    for (const bb of ballBodies) {
      const b = bb.ball;
      b.x = bb.x;
      b.y = bb.y;
      b.vx = bb.vx;
      b.vy = bb.vy;
      b.w[2] = bb.w;
    }
    for (const p of props) settleProp(p, dt);
  };

  const putProp = (p: Prop, x: number) => {
    p.a = p.spec.rest;
    orient(p);
    const e = extentAt(p.spec, p.a);
    p.x = clamp(x, -e.left, Math.max(-e.left, bounds.width - e.right));
    p.y = bounds.floor - e.bottom;
    p.vx = 0;
    p.vy = 0;
    p.w = 0;
    p.yaw = 0;
    p.yawRate = 0;
    p.grounded = true;
    p.asleep = true;
    p.still = 0;
    p.perched = 0;
    if (net) p.side = p.x < net.x ? -1 : 1;
  };
  (options.props ?? []).forEach(({ x }, i) => putProp(props[i]!, x));

  /** Each thing's side of the net from where it is now. */
  const takeSides = () => {
    if (!net) return;
    for (const b of balls) b.side = b.x < net.x ? -1 : 1;
    for (const p of props) p.side = p.x < net.x ? -1 : 1;
  };
  takeSides();

  const tapProp = (p: Prop, f: Finger) => {
    const rx = p.cs * f.gripX - p.sn * f.gripY;
    const off = clamp(rx / Math.max(0.05, p.spec.reach * 0.6), -1, 1);
    p.vx = p.vx * 0.3 - off * 0.6;
    p.vy = PROP_BUMP * p.spec.pop;
    const spin = (TAP_SPIN[0] + (TAP_SPIN[1] - TAP_SPIN[0]) * Math.abs(off)) * p.spec.pop;
    const way = Math.abs(off) > 0.15 ? -Math.sign(off) : rng.next() < 0.5 ? -1 : 1;
    p.w = way * spin;
    p.yawRate += rng.range(-3, 3);
    wake(p);
    capProp(p);
    emitProp("tap", p, f.startX, f.startY, PROP_BUMP, f.synthetic);
  };

  const throwProp = (p: Prop, f: Finger) => {
    const rx = p.cs * f.gripX - p.sn * f.gripY;
    const ry = p.sn * f.gripX + p.cs * f.gripY;
    const gx = f.vx * THROW_GAIN;
    const gy = f.vy * THROW_GAIN;
    p.vx = gx + p.w * ry;
    p.vy = gy - p.w * rx;
    p.w += rng.range(-2.5, 2.5) - (0.25 * gx) / p.spec.reach;
    p.yawRate = rng.range(-1, 1) * (p.kind === "hat" ? 14 : 7);
    wake(p);
    capProp(p);
    emitProp("throw", p, f.x, f.y, Math.hypot(p.vx, p.vy), f.synthetic);
  };

  return {
    balls,
    props,
    fingers,
    get net() {
      return net;
    },
    get umbrella() {
      return umbrella;
    },
    get bounds() {
      return bounds;
    },
    set bounds(b) {
      bounds = b;
    },
    setBounds(b) {
      bounds = b;
      if (umbrella) setupUmbrella(umbrella.layout);
      for (const ball of balls) keepIn(ball);
      for (const p of props) {
        const e = extentAt(p.spec, p.a);
        p.x = clamp(p.x, -e.left, Math.max(-e.left, bounds.width - e.right));
        p.y = Math.max(p.y, bounds.floor - e.bottom);
        wake(p);
      }
    },
    setNet(n) {
      net = n;
      takeSides();
      for (const p of props) wake(p);
    },
    setUmbrella(u) {
      setupUmbrella(u);
      for (const p of props) wake(p);
    },
    plantUmbrella() {
      plant();
    },
    resetUmbrella() {
      const u = umbrella;
      if (!u) return;
      const p = u.prop;
      if (p.holder !== null) {
        const f = fingers.get(p.holder);
        if (f) f.prop = null;
        p.holder = null;
      }
      p.off = true;
      p.asleep = true;
      u.at.x = u.layout.x;
      u.state = "open";
      u.fold = 0;
      u.stand = 0;
      u.wobble.tilt = 0;
      u.wobble.rate = 0;
      u.wobble.yawRate = 0;
      for (const f of fingers.values()) f.umbHold = false;
      shapeUmbrella();
    },
    down(id, x, y, synthetic = false) {
      const old = fingers.get(id);
      if (old) letGo(old);
      const f: Finger = {
        id,
        x,
        y,
        lastX: x,
        lastY: y,
        vx: 0,
        vy: 0,
        given: false,
        startX: x,
        startY: y,
        travel: 0,
        ball: null,
        offX: 0,
        offY: 0,
        prop: null,
        gripX: 0,
        gripY: 0,
        blocked: false,
        umb: false,
        umbHold: false,
        held: 0,
        synthetic,
      };
      fingers.set(id, f);
      const nb = nearestBall(x, y);
      const np = nearestProp(x, y);
      if (umbrella) {
        const nu = nearUmbrella(x, y);
        if (nu.d < FINGER_R && nu.d < nb.d && nu.d < np.d) {
          nudgeUmbrella(f, x, y);
          return "nudge";
        }
      }
      if (np.prop && np.d < GRAB && np.d < nb.d) {
        const p = np.prop;
        // Hold it by the point the finger landed on, or the nearest point of its outline.
        const d = p.spec.discs[np.disc]!;
        const cx = discX(p, np.disc);
        const cy = discY(p, np.disc);
        const off = Math.hypot(x - cx, y - cy);
        const k = off > d.r ? d.r / off : 1;
        const gx = cx + (x - cx) * k - p.x;
        const gy = cy + (y - cy) * k - p.y;
        f.prop = p;
        f.gripX = p.cs * gx + p.sn * gy;
        f.gripY = -p.sn * gx + p.cs * gy;
        p.holder = id;
        wake(p);
        emitProp("grab", p, x, y, 0, synthetic);
        return "grab";
      }
      if (nb.ball && nb.d < GRAB) {
        const held = nb.ball;
        f.ball = held;
        f.offX = held.x - x;
        f.offY = held.y - y;
        held.holder = id;
        held.grounded = false;
        emit("grab", held, x, y, 0, synthetic);
        return "grab";
      }
      if (nb.ball && nb.d < NEAR) {
        const near = nb.ball;
        const dx = near.x - x;
        const dy = near.y - y;
        const d = Math.hypot(dx, dy) || 1;
        const k = 1.4 * (1 - (d - near.r) / NEAR);
        near.vx += (dx / d) * k;
        near.vy += Math.max(0, (dy / d) * k) + 0.6 * k;
        emit("puff", near, x, y, k, synthetic);
        return "puff";
      }
      if (np.prop && np.d < NEAR) {
        const p = np.prop;
        const dx = p.x - x;
        const dy = p.y - y;
        const d = Math.hypot(dx, dy) || 1;
        const k = (1.2 * (1 - np.d / NEAR)) / Math.sqrt(p.spec.mass);
        p.vx += (dx / d) * k;
        p.vy += Math.max(0, (dy / d) * k) + 0.6 * k;
        p.w += rng.range(-3, 3) * k;
        wake(p);
        emitProp("puff", p, x, y, k, synthetic);
        return "puff";
      }
      return "none";
    },
    move(id, x, y, vx, vy) {
      const f = fingers.get(id);
      if (!f) return;
      f.travel = Math.max(f.travel, Math.hypot(x - f.startX, y - f.startY));
      f.x = x;
      f.y = y;
      if (vx !== undefined && vy !== undefined) {
        f.vx = vx;
        f.vy = vy;
        f.given = true;
      }
    },
    up(id) {
      const f = fingers.get(id);
      if (!f) return "none";
      fingers.delete(id);
      const p = f.prop;
      const b = f.ball;
      letGo(f);
      if (p) {
        if (f.travel < TAP_TRAVEL) {
          tapProp(p, f);
          return "tap";
        }
        if (Math.hypot(f.vx, f.vy) > THROW_MIN) {
          throwProp(p, f);
          return "throw";
        }
        return "drop";
      }
      if (!b) return "none";
      if (f.travel < TAP_TRAVEL) {
        const dx = b.x - f.startX;
        const dy = b.y - f.startY;
        const off = clamp(dx / b.r, -1, 1);
        b.vx = b.vx * 0.3 + off * BUMP_AWAY;
        b.vy = BUMP + Math.max(0, dy / b.r) * 0.5 * BUMP_AWAY;
        b.w[2] += -off * 4;
        b.w[0] += rng.range(-1.5, 1.5);
        capSpeed(b);
        emit("tap", b, f.startX, f.startY, BUMP, f.synthetic);
        return "tap";
      }
      const speed = Math.hypot(f.vx, f.vy);
      if (speed > THROW_MIN) {
        b.vx = f.vx * THROW_GAIN;
        b.vy = f.vy * THROW_GAIN;
        capSpeed(b);
        const s = Math.hypot(b.vx, b.vy) / b.r;
        b.w[0] += rng.range(-0.35, 0.35) * s;
        b.w[1] += rng.range(-0.25, 0.25) * s;
        b.w[2] += -(b.vx / b.r) * 0.4;
        capSpeed(b);
        emit("throw", b, f.x, f.y, Math.hypot(b.vx, b.vy), f.synthetic);
        return "throw";
      }
      b.vx = f.vx;
      b.vy = f.vy;
      return "drop";
    },
    cancel(id) {
      const f = fingers.get(id);
      if (!f) return;
      fingers.delete(id);
      letGo(f);
    },
    releaseAll() {
      for (const f of fingers.values()) letGo(f);
      fingers.clear();
    },
    step(dt) {
      stepUmbrella(dt);
      const ease = 1 - Math.exp(-dt / FINGER_TAU);
      for (const f of fingers.values()) {
        f.blocked = false;
        if (!f.given) {
          f.vx += ((f.x - f.lastX) / dt - f.vx) * ease;
          f.vy += ((f.y - f.lastY) / dt - f.vy) * ease;
        }
        const b = f.ball;
        if (!b) continue;
        // The ball eases its centre in towards the finger without a jump.
        const off = Math.hypot(f.offX, f.offY);
        const most = HOLD_OFFSET * b.r;
        if (off > most) {
          const k = Math.max(most / off, 1 - dt / 0.15);
          f.offX *= k;
          f.offY *= k;
        }
        b.vx = f.vx + (f.x + f.offX - b.x) / HOLD_TAU;
        b.vy = f.vy + (f.y + f.offY - b.y) / HOLD_TAU;
        capSpeed(b);
        const k = Math.exp(-dt / 0.3);
        for (let i = 0; i < 3; i++) b.w[i]! *= k;
      }
      for (const b of balls) {
        if (b.holder === null && !b.grounded) {
          b.vy -= GRAVITY * dt;
          const s = Math.hypot(b.vx, b.vy);
          const k = Math.max(0, 1 - (DRAG_LIN + DRAG_QUAD * s) * dt);
          b.vx *= k;
          b.vy *= k;
        }
        if (b.holder === null) {
          const k = Math.exp(-SPIN_DRAG * dt);
          for (let i = 0; i < 3; i++) b.w[i]! *= k;
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }
      for (const f of fingers.values()) {
        if (!f.ball && !f.prop) {
          bat(f);
          batProps(f);
          swipeUmbrella(f);
        }
        f.lastX = f.x;
        f.lastY = f.y;
      }
      for (let k = 0; k < 2; k++) pairs();
      stepProps(dt);
      for (const b of balls) {
        const held = b.holder !== null;
        sides(b, held);
        if (netBall(b, held, dt) && held) {
          const f = fingers.get(b.holder!);
          if (f) f.blocked = true;
        }
        if (umbrellaBall(b, held, dt) && held) {
          const f = fingers.get(b.holder!);
          if (f) f.blocked = true;
        }
        ground(b, dt);
        keepIn(b);
        perch(b, dt);
        capSpeed(b);
        turn(b, dt);
        if (net && b.y >= net.top) b.side = b.x < net.x ? -1 : 1;
      }
      // A finger held still on the umbrella folds or unfolds it; one dragging it closed pulls it
      // out of the sand; one held still on it out of the sand stands it up again.
      for (const f of fingers.values()) {
        f.held += dt;
        const u = umbrella;
        if (!u) break;
        if (f.umbHold) {
          if (f.travel < TAP_TRAVEL) {
            if (f.held >= HOLD_S) {
              f.umbHold = false;
              if (u.state === "open" || u.state === "opening") {
                u.state = "closing";
                u.closes++;
              } else if (u.state === "closed" || u.state === "closing") {
                u.state = "opening";
              }
            }
          } else if (u.state === "closed" && f.travel >= PULL) {
            loosen(f);
          } else if (u.state !== "closed") {
            f.umbHold = false;
          }
        } else if (
          f.prop === u.prop &&
          f.travel < TAP_TRAVEL &&
          f.held >= HOLD_S &&
          (u.prop.grounded || Math.hypot(u.prop.vx, u.prop.vy) < 0.3)
        ) {
          plant();
        }
      }
      // A finger the net keeps from what it holds, and that has gone on well past, lets go.
      for (const f of fingers.values()) {
        if (!f.blocked) continue;
        if (f.ball) {
          const b = f.ball;
          if (Math.hypot(f.x + f.offX - b.x, f.y + f.offY - b.y) > STRETCH) letGo(f);
        } else if (f.prop) {
          const p = f.prop;
          const gx = p.x + p.cs * f.gripX - p.sn * f.gripY;
          const gy = p.y + p.sn * f.gripX + p.cs * f.gripY;
          if (Math.hypot(f.x - gx, f.y - gy) > STRETCH) letGo(f);
        }
      }
    },
    kick(i, vx, vy, spin) {
      const b = balls[i];
      if (!b || b.holder !== null) return;
      b.vx = vx;
      b.vy = vy;
      b.grounded = false;
      if (spin) for (let k = 0; k < 3; k++) b.w[k] = spin[k]!;
      capSpeed(b);
    },
    kickProp(i, vx, vy, w, yawRate) {
      const p = props[i];
      if (!p || p.holder !== null) return;
      p.vx = vx;
      p.vy = vy;
      if (w !== undefined) p.w = w;
      if (yawRate !== undefined) p.yawRate = yawRate;
      wake(p);
      capProp(p);
    },
    place(i, x) {
      const b = balls[i];
      if (!b) return;
      if (b.holder !== null) {
        const f = fingers.get(b.holder);
        if (f) f.ball = null;
        b.holder = null;
      }
      b.x = x;
      b.y = bounds.floor + b.r;
      b.vx = 0;
      b.vy = 0;
      b.w = [0, 0, 0];
      b.grounded = true;
      b.perched = 0;
      keepIn(b);
      if (net) b.side = b.x < net.x ? -1 : 1;
    },
    placeProp(i, x) {
      const p = props[i];
      if (!p) return;
      if (p.holder !== null) {
        const f = fingers.get(p.holder);
        if (f) f.prop = null;
        p.holder = null;
      }
      putProp(p, x);
    },
    setPropSpec(i, spec) {
      const p = props[i];
      if (!p || p.spec === spec) return;
      // The model stays where it is: its base keeps its place as the centre of mass moves.
      const ox = p.spec.origin.x - spec.origin.x;
      const oy = p.spec.origin.y - spec.origin.y;
      const dx = p.cs * ox - p.sn * oy;
      const dy = p.sn * ox + p.cs * oy;
      p.x += dx;
      p.y += dy;
      p.vx -= p.w * dy;
      p.vy += p.w * dx;
      p.spec = spec;
      p.im = 1 / spec.mass;
      p.ii = 1 / spec.inertia;
      for (const f of fingers.values()) {
        if (f.prop !== p) continue;
        f.gripX -= ox;
        f.gripY -= oy;
      }
      wake(p);
    },
    nearestThing(x, y) {
      return Math.min(nearestBall(x, y).d, nearestProp(x, y).d);
    },
    setPropOff(i, off) {
      const p = props[i];
      if (!p || p.off === off) return;
      if (p.holder !== null) {
        const f = fingers.get(p.holder);
        if (f) f.prop = null;
        p.holder = null;
      }
      p.off = off;
      if (off) {
        p.asleep = true;
        p.grounded = false;
        p.vx = 0;
        p.vy = 0;
        p.w = 0;
      } else {
        p.grounded = false;
        p.perched = 0;
        p.yawRate = 0;
        if (net) p.side = p.x < net.x ? -1 : 1;
        wake(p);
      }
    },
    poseProp(i, x, y, a, vx = 0, vy = 0, w = 0) {
      const p = props[i];
      if (!p) return;
      p.x = x;
      p.y = y;
      p.a = wrapAngle(a);
      p.vx = vx;
      p.vy = vy;
      p.w = w;
      orient(p);
    },
    drain() {
      const out = events;
      events = [];
      return out;
    },
  };
};
