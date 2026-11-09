/**
 * Table devices a theme builds its toys from, each a small state machine like the deck's
 * (deckparts.ts), in table px and world seconds:
 *
 * - kickout: catches a slow ball near a spot, holds it, kicks it out at an aim (a saucer, a sink,
 *   a black hole, a clam). Unarmed, it is a kickback that waits to be lit.
 * - lock: holds up to N balls and lets them all go together (a multiball) after a countdown, or
 *   after `timeout` with fewer. While it waits for more, a new ball is served to the plunger.
 * - drop bank: targets that drop when hit and rise when the bank is done or after a while.
 * - orbiter and shuttle: bumpers moved every sub-step round a circle or to and fro.
 * - puffer: a bumper that swells when hit, then shrinks.
 * - flow and spin disc: forces on balls in a region, one way (which can turn) or round a centre.
 * - ride: a scripted path with height (a ramp), from a gate to where it lets go.
 * - carrier: a device that places a held ball by any function of time (a wheel's cup).
 * - stomp: an impulse to balls near a point; `strikeLevel` reads a hit's speed.
 *
 * Every device lets go of every ball by itself within HOLD_LIMIT_S, holds a bounded number, and
 * `reset` lets go of everything. `createToyBox` composes them into a table's `Toys`.
 */
import { BALL_R } from "./config";
import type { Point } from "./layout";
import { type Ball, type Circle, moveCircle, type PhysEvent, type Seg } from "./physics";
import type { HeldBall, ToyHost, Toys } from "./toys";

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** A ball a device lets go: where, and how fast. */
export interface Let {
  ball: Ball;
  x: number;
  y: number;
  vx: number;
  vy: number;
  why: string;
}

/** What a device's update puts out: a ball it held, or a new one (null) the table adds if it has room. */
export type Out = Omit<Let, "ball"> & { ball: Ball | null };

export interface Device {
  readonly name: string;
  /** Would it take this free ball now? (Rides and anything started by an event say no.) */
  wants(b: Ball, now: number): boolean;
  take(b: Ball, now: number): void;
  /** Move what it holds; push balls whose time is up onto `out`. */
  update(now: number, out: Out[]): void;
  /** Add the balls it holds to `out`, with where they are. */
  held(out: HeldBall[]): void;
  /** True while it keeps balls waiting for others (an open lock): the table serves a new one. */
  waits?(): boolean;
  /** Room for one more put straight in (`ToyBox.put`); always, when absent. */
  room?(): boolean;
  /** Nothing else is in play: stop waiting and let go soon. */
  flush(now: number): void;
  /** Forget every ball (they have left the table with the game). */
  reset(): void;
}

/** Longest any device holds a ball, seconds. */
export const HOLD_LIMIT_S = 20;

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const speedOf = (b: Ball) => Math.hypot(b.vx, b.vy);

// ---- Kickout -----------------------------------------------------------------------------------

export interface Aim {
  /** Where the ball comes out (the device's spot when absent). */
  x?: number;
  y?: number;
  vx: number;
  vy: number;
}

export interface KickoutSpec {
  name: string;
  x: number;
  y: number;
  /** A ball whose centre comes this close is caught. */
  r: number;
  /** Faster balls pass over. */
  maxSpeed: number;
  /** Seconds it holds a ball. */
  hold: number;
  /** How it lets go: a fixed aim, or one picked when it fires. */
  out: Aim | ((now: number) => Aim);
  /** Seconds after a kick before it takes another (default 0.8). */
  cool?: number;
  /** Takes only balls this accepts (a kickback: balls going down). */
  accept?(b: Ball): boolean;
  /**
   * Where the held ball is, `k` from 0 to 1 through the hold and `t` seconds in, from where it was
   * caught. Default: pulled into the middle and sunk a little.
   */
  place?(k: number, t: number, from: P3): { x: number; y: number; z: number; scale?: number };
  /** False: it takes nothing until `arm()` and disarms after each kick (a kickback). */
  armed?: boolean;
}

export interface Kickout extends Device {
  readonly spec: KickoutSpec;
  readonly ball: Ball | null;
  /** World seconds it took its ball, and last let one go. */
  readonly since: number;
  readonly kickedAt: number;
  readonly armed: boolean;
  arm(): void;
  disarm(): void;
}

export const createKickout = (spec: KickoutSpec): Kickout => {
  let ball: Ball | null = null;
  let since = 0;
  let kickedAt = -Infinity;
  let cool = 0;
  let from: P3 = { x: 0, y: 0, z: BALL_R };
  let armed = spec.armed !== false;
  let at = { x: spec.x, y: spec.y, z: BALL_R, scale: 1 };
  const hold = Math.min(spec.hold, HOLD_LIMIT_S);
  const place: NonNullable<KickoutSpec["place"]> =
    spec.place ??
    ((k, t, f) => {
      const p = ease(Math.min(1, t / 0.15));
      return {
        x: f.x + (spec.x - f.x) * p,
        y: f.y + (spec.y - f.y) * p,
        z: BALL_R - BALL_R * 0.5 * ease(Math.min(1, k * 4)),
      };
    });
  const kick = (now: number, out: Out[]) => {
    const b = ball;
    if (!b) return;
    ball = null;
    kickedAt = now;
    cool = now + (spec.cool ?? 0.8);
    if (spec.armed === false) armed = false;
    const aim = typeof spec.out === "function" ? spec.out(now) : spec.out;
    out.push({
      ball: b,
      x: aim.x ?? spec.x,
      y: aim.y ?? spec.y,
      vx: aim.vx,
      vy: aim.vy,
      why: spec.name,
    });
  };
  return {
    name: spec.name,
    spec,
    get ball() {
      return ball;
    },
    get since() {
      return since;
    },
    get kickedAt() {
      return kickedAt;
    },
    get armed() {
      return armed;
    },
    arm() {
      armed = true;
    },
    disarm() {
      armed = false;
    },
    wants: (b, now) =>
      ball === null &&
      armed &&
      now >= cool &&
      Math.hypot(b.x - spec.x, b.y - spec.y) < spec.r &&
      speedOf(b) < spec.maxSpeed &&
      (spec.accept?.(b) ?? true),
    take(b, now) {
      ball = b;
      since = now;
      from = { x: b.x, y: b.y, z: BALL_R };
      at = { ...from, scale: 1 };
    },
    update(now, out) {
      if (!ball) return;
      const t = now - since;
      const p = place(Math.min(1, t / Math.max(1e-6, hold)), t, from);
      at = { x: p.x, y: p.y, z: p.z, scale: p.scale ?? 1 };
      ball.px = ball.x;
      ball.py = ball.y;
      ball.x = p.x;
      ball.y = p.y;
      if (t >= hold) kick(now, out);
    },
    held(out) {
      if (ball) out.push({ ball, x: at.x, y: at.y, z: at.z, scale: at.scale, by: spec.name });
    },
    flush() {},
    reset() {
      ball = null;
      cool = 0;
      armed = spec.armed !== false;
    },
  };
};

// ---- Lock --------------------------------------------------------------------------------------

export type LockPhase = "open" | "countdown" | "release" | "closed";

export interface LockSpec {
  name: string;
  mouth: { x: number; y: number; r: number };
  maxSpeed: number;
  /** Where each held ball sits, first to last; their number is the lock's size. */
  slots: P3[];
  /** Where they move to for the countdown and release, when not their slots (into a launcher). */
  drop?: P3[];
  /** How big a ball looks in its slot, as a share of its radius (1 when absent): a porthole. */
  slotScale?: number;
  /** Seconds from the last ball in to the first out. */
  countdown: number;
  /** Seconds between balls on the way out. */
  gap: number;
  /** A lock that isn't full lets its balls go this long after the first came in, seconds. */
  timeout: number;
  /** Seconds it stays closed after it empties. */
  cool: number;
  /** Where balls come out, one aim per ball in turn. */
  out: { x: number; y: number; vx: number; vy: number }[];
}

export interface Lock extends Device {
  readonly spec: LockSpec;
  readonly phase: LockPhase;
  /** World seconds the phase began. */
  readonly phaseAt: number;
  /** Balls held now. */
  readonly count: number;
  /**
   * Balls locked towards the next multiball, held or not: a lock that times out lets its balls
   * go but keeps their count, so the multiball can be earned across its time limit. When it
   * reaches the lock's size, the countdown starts and the release tops the balls held up to the
   * size with new ones (as far as the table has room).
   */
  readonly progress: number;
  /** The release under way (or the last one) let a full lock go: a multiball. */
  readonly full: boolean;
  /** World seconds the first ball came in (Infinity when empty). */
  readonly firstAt: number;
}

const SLIDE_S = 0.35;

export const createLock = (spec: LockSpec): Lock => {
  const size = spec.slots.length;
  const balls: {
    b: Ball;
    from: P3;
    at: number;
    pos: P3;
    to: P3 | null;
    s0: number;
    s: number;
  }[] = [];
  let phase: LockPhase = "open";
  let progress = 0;
  let extra = 0;
  let phaseAt = 0;
  let firstAt = Infinity;
  let full = false;
  let nextOut = 0;
  let outs = 0;
  const timeout = Math.min(spec.timeout, HOLD_LIMIT_S - spec.countdown - spec.gap * size);
  const to = (p: LockPhase, now: number) => {
    phase = p;
    phaseAt = now;
  };
  const release = (now: number, isFull: boolean) => {
    full = isFull;
    extra = isFull ? Math.max(0, size - balls.length) : 0;
    if (isFull) progress = 0;
    to("release", now);
    nextOut = now;
  };
  return {
    name: spec.name,
    spec,
    get phase() {
      return phase;
    },
    get phaseAt() {
      return phaseAt;
    },
    get count() {
      return balls.length;
    },
    get progress() {
      return progress;
    },
    get full() {
      return full;
    },
    get firstAt() {
      return firstAt;
    },
    waits: () => phase === "open" && balls.length > 0,
    wants: (b) =>
      phase === "open" &&
      balls.length < size &&
      Math.hypot(b.x - spec.mouth.x, b.y - spec.mouth.y) < spec.mouth.r &&
      speedOf(b) < spec.maxSpeed,
    take(b, now) {
      if (balls.length === 0) firstAt = now;
      const from = { x: b.x, y: b.y, z: BALL_R };
      balls.push({ b, from, at: now, pos: { ...from }, to: null, s0: 1, s: 1 });
      progress = Math.min(size, progress + 1);
      if (progress >= size) to("countdown", now);
    },
    update(now, out) {
      if (phase === "open" && balls.length > 0 && now - firstAt >= timeout) release(now, false);
      if (phase === "countdown" && now - phaseAt >= spec.countdown) release(now, true);
      if (phase === "release" && now >= nextOut && balls.length + extra > 0) {
        const x = balls.shift();
        if (!x) extra--;
        const aim = spec.out[outs++ % spec.out.length]!;
        nextOut = now + spec.gap;
        const why = full ? "multiball" : spec.name;
        out.push({ ball: x?.b ?? null, x: aim.x, y: aim.y, vx: aim.vx, vy: aim.vy, why });
      }
      if (phase === "release" && balls.length === 0 && extra === 0) {
        firstAt = Infinity;
        to("closed", now);
      }
      if (phase === "closed" && now - phaseAt >= spec.cool) to("open", now);
      const leaving = (phase === "countdown" || phase === "release") && spec.drop !== undefined;
      balls.forEach((x, i) => {
        const list = leaving && spec.drop ? spec.drop : spec.slots;
        const slot = list[i] ?? list[list.length - 1] ?? spec.slots[0]!;
        if (x.to !== slot) {
          if (x.to) {
            x.from = { ...x.pos };
            x.at = now;
            x.s0 = x.s;
          }
          x.to = slot;
        }
        const scale = leaving ? 1 : (spec.slotScale ?? 1);
        const k = ease((now - x.at) / SLIDE_S);
        x.s = x.s0 + (scale - x.s0) * k;
        x.pos = {
          x: x.from.x + (slot.x - x.from.x) * k,
          y: x.from.y + (slot.y - x.from.y) * k,
          z: x.from.z + (slot.z - x.from.z) * k,
        };
        x.b.px = x.b.x;
        x.b.py = x.b.y;
        x.b.x = x.pos.x;
        x.b.y = x.pos.y;
      });
    },
    held(out) {
      for (const x of balls) out.push({ ball: x.b, ...x.pos, scale: x.s, by: spec.name });
    },
    flush(now) {
      if (phase === "open" && balls.length > 0) release(now, false);
    },
    reset() {
      balls.length = 0;
      phase = "open";
      phaseAt = 0;
      firstAt = Infinity;
      full = false;
      outs = 0;
      progress = 0;
      extra = 0;
    },
  };
};

// ---- Drop targets ------------------------------------------------------------------------------

export interface DropBankSpec {
  /** The targets, built as scoring segments; a hit event's index is the target's. */
  targets: Seg[];
  /** Seconds after the last one drops before they all rise. */
  rise: number;
  /** A bank with some down and no hit for this long rises again, seconds. */
  idle: number;
}

export interface DropBank {
  readonly up: readonly boolean[];
  /** World seconds each target last dropped or rose. */
  readonly at: readonly number[];
  /** A hit on target `i`: "drop" when it was up and fell, "done" when that completed the bank. */
  hit(i: number, now: number): "drop" | "done" | null;
  /** Raise targets that are due, each only when no ball is in its way. */
  update(now: number, balls: readonly Ball[]): void;
  reset(): void;
}

export const createDropBank = (spec: DropBankSpec): DropBank => {
  const n = spec.targets.length;
  const up = spec.targets.map(() => true);
  const at = spec.targets.map(() => 0);
  let riseAt = Infinity;
  let lastHit = 0;
  const clear = (s: Seg, balls: readonly Ball[]) =>
    balls.every((b) => {
      const dx = s.bx - s.ax;
      const dy = s.by - s.ay;
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((b.x - s.ax) * dx + (b.y - s.ay) * dy) / l2));
      return Math.hypot(b.x - (s.ax + dx * t), b.y - (s.ay + dy * t)) > s.r + b.r + 4;
    });
  return {
    up,
    at,
    hit(i, now) {
      if (!up[i]) return null;
      up[i] = false;
      at[i] = now;
      spec.targets[i]!.on = false;
      lastHit = now;
      if (up.some(Boolean)) return "drop";
      riseAt = now + spec.rise;
      return "done";
    },
    update(now, balls) {
      if (riseAt === Infinity && !up.every(Boolean) && now - lastHit >= spec.idle) riseAt = now;
      if (now < riseAt) return;
      let waiting = false;
      for (let i = 0; i < n; i++) {
        if (up[i]) continue;
        const s = spec.targets[i]!;
        if (!clear(s, balls)) {
          waiting = true;
          continue;
        }
        up[i] = true;
        at[i] = now;
        s.on = true;
      }
      if (!waiting) riseAt = Infinity;
    },
    reset() {
      for (let i = 0; i < n; i++) {
        up[i] = true;
        at[i] = 0;
        spec.targets[i]!.on = true;
      }
      riseAt = Infinity;
      lastHit = 0;
    },
  };
};

// ---- Moving and changing bumpers ---------------------------------------------------------------

export interface Mover {
  /** One physics sub-step of `h` seconds. */
  tick(h: number): void;
  reset(): void;
}

/** A bumper going round (cx, cy) at `omega` radians a second. */
export const createOrbiter = (
  c: Circle,
  o: { cx: number; cy: number; radius: number; omega: number; phase?: number },
): Mover & { readonly angle: number } => {
  let t = 0;
  const angle = () => (o.phase ?? 0) + t * o.omega;
  const put = (h: number) =>
    moveCircle(c, o.cx + Math.cos(angle()) * o.radius, o.cy + Math.sin(angle()) * o.radius, h);
  put(0);
  return {
    get angle() {
      return angle();
    },
    tick(h) {
      t += h;
      // Keep the clock small over days of play.
      if (Math.abs(t * o.omega) > 2000 * Math.PI) t -= (2000 * Math.PI) / o.omega;
      put(h);
    },
    reset() {
      t = 0;
      put(0);
    },
  };
};

/** A bumper running to and fro between a and b, there and back in `period` seconds. */
export const createShuttle = (
  c: Circle,
  o: { a: Point; b: Point; period: number; phase?: number },
): Mover & { readonly k: number } => {
  let t = 0;
  const k = () => 0.5 - 0.5 * Math.cos(((t + (o.phase ?? 0) * o.period) * Math.PI * 2) / o.period);
  const put = (h: number) =>
    moveCircle(c, o.a.x + (o.b.x - o.a.x) * k(), o.a.y + (o.b.y - o.a.y) * k(), h);
  put(0);
  return {
    get k() {
      return k();
    },
    tick(h) {
      t = (t + h) % o.period;
      put(h);
    },
    reset() {
      t = 0;
      put(0);
    },
  };
};

export interface PufferSpec {
  /** Radius at rest and fully puffed. */
  r0: number;
  r1: number;
  /** Seconds to swell, to stay swollen, and to shrink back. */
  grow: number;
  hold: number;
  shrink: number;
}

/**
 * A bumper that swells when `puff` is called (on a hit) and shrinks back. It changes size a
 * fraction of a pixel per sub-step, and the solver pushes any ball it reaches back out, so a ball
 * never ends up inside; leave room round it for a ball at its biggest.
 */
export const createPuffer = (
  c: Circle,
  spec: PufferSpec,
): Mover & { readonly shape: Circle; readonly k: number; puff(): void } => {
  let t = Infinity;
  const total = spec.grow + spec.hold + spec.shrink;
  const kAt = (s: number) =>
    s < spec.grow
      ? ease(s / spec.grow)
      : s < spec.grow + spec.hold
        ? 1
        : s < total
          ? 1 - ease((s - spec.grow - spec.hold) / spec.shrink)
          : 0;
  const size = () => {
    c.r = spec.r0 + (spec.r1 - spec.r0) * kAt(t);
    moveCircle(c, c.x, c.y, 0);
  };
  c.r = spec.r0;
  return {
    shape: c,
    get k() {
      return kAt(t);
    },
    puff() {
      // From about as big as it is now, so a hit while it shrinks swells it again smoothly.
      if (t < spec.grow) return;
      t = spec.grow * kAt(t);
    },
    tick(h) {
      if (t === Infinity) return;
      t += h;
      size();
      if (t >= total) t = Infinity;
    },
    reset() {
      t = Infinity;
      c.r = spec.r0;
      moveCircle(c, c.x, c.y, 0);
    },
  };
};

// ---- Forces ------------------------------------------------------------------------------------

export interface Force {
  /** Push the free balls for one sub-step of `h` seconds. */
  tick(balls: readonly Ball[], h: number): void;
  reset(): void;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A current across a box: balls inside are pushed along `dir` at `accel` px/s^2. `aim` turns it
 * towards a new direction at `turn` radians a second.
 */
export const createFlow = (o: {
  box: Box;
  dir: Point;
  accel: number;
  turn?: number;
}): Force & { aim(x: number, y: number): void; readonly dir: Point } => {
  const start = Math.atan2(o.dir.y, o.dir.x);
  let angle = start;
  let target = start;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  return {
    dir,
    aim(x, y) {
      target = Math.atan2(y, x);
    },
    tick(balls, h) {
      let d = target - angle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const step = (o.turn ?? 2) * h;
      angle += Math.max(-step, Math.min(step, d));
      dir.x = Math.cos(angle);
      dir.y = Math.sin(angle);
      for (const b of balls) {
        if (b.hold || b.x < o.box.x0 || b.x > o.box.x1 || b.y < o.box.y0 || b.y > o.box.y1)
          continue;
        b.vx += dir.x * o.accel * h;
        b.vy += dir.y * o.accel * h;
      }
    },
    reset() {
      angle = target = start;
      dir.x = Math.cos(angle);
      dir.y = Math.sin(angle);
    },
  };
};

/**
 * A turning disc: balls on it are dragged towards the disc's own motion under them, `grip` per
 * second, so a slow ball swings round and a fast one crosses with a curve.
 */
export const createSpinDisc = (o: {
  x: number;
  y: number;
  r: number;
  omega: number;
  grip: number;
}): Force & { omega: number; readonly angle: number } => {
  let angle = 0;
  const disc = {
    omega: o.omega,
    get angle() {
      return angle;
    },
    tick(balls: readonly Ball[], h: number) {
      angle = (angle + disc.omega * h) % (Math.PI * 2);
      const k = Math.min(1, o.grip * h);
      for (const b of balls) {
        if (b.hold) continue;
        const rx = b.x - o.x;
        const ry = b.y - o.y;
        if (rx * rx + ry * ry > o.r * o.r) continue;
        // The disc's surface velocity under the ball: omega x r, y down.
        const sx = -disc.omega * ry;
        const sy = disc.omega * rx;
        b.vx += (sx - b.vx) * k;
        b.vy += (sy - b.vy) * k;
      }
    },
    reset() {
      angle = 0;
      disc.omega = o.omega;
    },
  };
  return disc;
};

// ---- Rides and carriers ------------------------------------------------------------------------

export const length3 = (pts: readonly P3[]): number => {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    d += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return d;
};

/** The point `s` along a 3D polyline, and its direction across the playfield there. */
export const along3 = (pts: readonly P3[], s: number): P3 & { dx: number; dy: number } => {
  let left = Math.max(0, s);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (l <= 0) continue;
    if (left <= l || i === pts.length - 1) {
      const k = Math.min(1, left / l);
      const flat = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return {
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        z: a.z + (b.z - a.z) * k,
        dx: (b.x - a.x) / flat,
        dy: (b.y - a.y) / flat,
      };
    }
    left -= l;
  }
  const p = pts[0] ?? { x: 0, y: 0, z: BALL_R };
  return { ...p, dx: 0, dy: -1 };
};

export interface RideSpec {
  name: string;
  /** From where balls get on to where they get off, table px with height. */
  path: P3[];
  /** Average speed along it, px/s. */
  speed: number;
  /** Speed it leaves at, along the path's last direction; or a fixed velocity. */
  exit: number | { vx: number; vy: number };
  /** Most balls on it at once (default 4). */
  max?: number;
}

export interface Ride extends Device {
  readonly spec: RideSpec;
  readonly length: number;
  /** Balls on it and how far along each is, 0 to 1. */
  readonly riders: readonly { ball: Ball; k: number }[];
}

/**
 * A ramp: a ball put on it (by a gate's event, through `ToyBox.put`) runs along the path from
 * where it is to the end, at an even speed, and is let go there.
 */
export const createRide = (spec: RideSpec): Ride => {
  const length = length3(spec.path);
  const riders: { ball: Ball; start: number; pts: P3[]; len: number; k: number; at: P3 }[] = [];
  const max = spec.max ?? 4;
  return {
    name: spec.name,
    spec,
    length,
    get riders() {
      return riders;
    },
    wants: () => false,
    room: () => riders.length < max,
    take(b, now) {
      const from = { x: b.x, y: b.y, z: BALL_R };
      const pts = [from, ...spec.path];
      riders.push({ ball: b, start: now, pts, len: length3(pts), k: 0, at: from });
    },
    update(now, out) {
      for (let i = riders.length - 1; i >= 0; i--) {
        const r = riders[i]!;
        const ms = Math.min(HOLD_LIMIT_S, r.len / Math.max(1, spec.speed));
        r.k = Math.min(1, (now - r.start) / ms);
        const p = along3(r.pts, r.k * r.len);
        r.at = p;
        r.ball.px = r.ball.x;
        r.ball.py = r.ball.y;
        r.ball.x = p.x;
        r.ball.y = p.y;
        if (r.k < 1) continue;
        riders.splice(i, 1);
        const v =
          typeof spec.exit === "number"
            ? { vx: p.dx * spec.exit, vy: p.dy * spec.exit }
            : spec.exit;
        out.push({ ball: r.ball, x: p.x, y: p.y, vx: v.vx, vy: v.vy, why: spec.name });
      }
    },
    held(out) {
      for (const r of riders) out.push({ ball: r.ball, ...r.at, scale: 1, by: spec.name });
    },
    flush() {},
    reset() {
      riders.length = 0;
    },
  };
};

export interface CarrierSpec {
  name: string;
  wants(b: Ball, now: number): boolean;
  /**
   * Where a ball taken at `since` (world seconds) is `now`; `done` with a velocity lets it go
   * there. A carrier holds a ball HOLD_LIMIT_S at most whatever this says.
   */
  place(
    since: number,
    now: number,
    from: P3,
    slot: number,
  ): { x: number; y: number; z: number; scale?: number; done?: { vx: number; vy: number } };
  /** Most balls at once (default 1). */
  max?: number;
}

export interface Carrier extends Device {
  readonly carried: readonly { ball: Ball; since: number; slot: number }[];
}

/** A device that places held balls by any function of time: a wheel's cups, a lift, a mouth. */
export const createCarrier = (spec: CarrierSpec): Carrier => {
  const carried: {
    ball: Ball;
    since: number;
    slot: number;
    from: P3;
    at: P3 & { scale: number };
  }[] = [];
  const max = spec.max ?? 1;
  let slots = 0;
  return {
    name: spec.name,
    get carried() {
      return carried;
    },
    wants: (b, now) => carried.length < max && spec.wants(b, now),
    take(b, now) {
      const from = { x: b.x, y: b.y, z: BALL_R };
      carried.push({ ball: b, since: now, slot: slots++ % 1024, from, at: { ...from, scale: 1 } });
    },
    update(now, out) {
      for (let i = carried.length - 1; i >= 0; i--) {
        const c = carried[i]!;
        const p = spec.place(c.since, now, c.from, c.slot);
        c.at = { x: p.x, y: p.y, z: p.z, scale: p.scale ?? 1 };
        c.ball.px = c.ball.x;
        c.ball.py = c.ball.y;
        c.ball.x = p.x;
        c.ball.y = p.y;
        const late = now - c.since >= HOLD_LIMIT_S;
        if (!p.done && !late) continue;
        carried.splice(i, 1);
        const v = p.done ?? { vx: 0, vy: 200 };
        out.push({ ball: c.ball, x: p.x, y: p.y, vx: v.vx, vy: v.vy, why: spec.name });
      }
    },
    held(out) {
      for (const c of carried) out.push({ ball: c.ball, ...c.at, by: spec.name });
    },
    flush() {},
    reset() {
      carried.length = 0;
    },
  };
};

// ---- Impulses ----------------------------------------------------------------------------------

/**
 * Hop the free balls within `radius` of (x, y): up the playfield by as much as `up` px/s at the
 * middle, and a little away from it. Returns how many it moved.
 */
export const stomp = (
  balls: readonly Ball[],
  x: number,
  y: number,
  radius: number,
  up: number,
): number => {
  let n = 0;
  for (const b of balls) {
    if (b.hold) continue;
    const d = Math.hypot(b.x - x, b.y - y);
    if (d > radius) continue;
    const k = 1 - d / radius;
    b.vy -= up * (0.4 + 0.6 * k);
    b.vx += d > 1e-6 ? ((b.x - x) / d) * up * 0.4 * k : 0;
    n++;
  }
  return n;
};

/** How hard a hit was, 0 to 1, from its speed (hit events carry the impact speed). */
export const strikeLevel = (speed: number, lo: number, hi: number) =>
  Math.max(0, Math.min(1, (speed - lo) / Math.max(1, hi - lo)));

// ---- The toy box -------------------------------------------------------------------------------

export interface ToyBoxSpec {
  devices?: Device[];
  movers?: Mover[];
  forces?: Force[];
  /** The theme's rules: each solver event, after the table's own. */
  event?(e: PhysEvent, now: number): void;
  /** A device took a ball. */
  taken?(d: Device, b: Ball, now: number): void;
  /** A device let a ball go (it is back in the solver). */
  let?(l: Let, d: Device, now: number): void;
  /** Each update, after the devices. */
  update?(dt: number, now: number): void;
  reset?(): void;
}

export interface ToyBox extends Toys {
  /** Put a free ball into a device at once (a ride from its gate). False if it isn't free. */
  put(d: Device, b: Ball): boolean;
}

/** A table's `Toys` from devices, movers, forces and the theme's rules. */
export const createToyBox = (host: ToyHost, spec: ToyBoxSpec): ToyBox => {
  const devices = spec.devices ?? [];
  const movers = spec.movers ?? [];
  const forces = spec.forces ?? [];
  const outs: Out[] = [];
  const held: HeldBall[] = [];
  const put = (d: Device, b: Ball, now: number) => {
    if (d.room?.() === false || !host.take(b)) return false;
    d.take(b, now);
    spec.taken?.(d, b, now);
    if (d.waits?.()) host.serveIfEmpty();
    return true;
  };
  return {
    put: (d, b) => put(d, b, host.now()),
    tick(h) {
      for (const m of movers) m.tick(h);
      if (forces.length > 0) for (const f of forces) f.tick(host.world.balls, h);
    },
    event(e) {
      spec.event?.(e, host.now());
    },
    update(dt) {
      const now = host.now();
      if (host.playing() && devices.length > 0) {
        // Backwards, since a taken ball leaves the list.
        const balls = host.world.balls;
        for (let i = balls.length - 1; i >= 0; i--) {
          const b = balls[i];
          if (!b || b.hold) continue;
          for (const d of devices) {
            if (!d.wants(b, now)) continue;
            put(d, b, now);
            break;
          }
        }
      }
      for (const d of devices) {
        outs.length = 0;
        d.update(now, outs);
        for (const o of outs) {
          const ball = o.ball ?? host.addBall(o.x, o.y, o.vx, o.vy);
          if (!ball) continue;
          if (o.ball) host.free(ball, o.x, o.y, o.vx, o.vy);
          spec.let?.({ ...o, ball }, d, now);
        }
      }
      spec.update?.(dt, now);
    },
    held() {
      held.length = 0;
      for (const d of devices) d.held(held);
      return held;
    },
    flush() {
      const now = host.now();
      for (const d of devices) d.flush(now);
    },
    reset() {
      for (const d of devices) d.reset();
      for (const m of movers) m.reset();
      for (const f of forces) f.reset();
      spec.reset?.();
    },
  };
};
