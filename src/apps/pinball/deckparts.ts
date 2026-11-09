/**
 * The deck's devices, each a small state machine that holds balls for a while and lets them go:
 *
 * - saucer: a kickout hole. Takes a ball that rolls in, holds it, kicks it out at its target.
 * - magnet: catches a ball that passes, pulls it in, holds it glowing, flings it at one of its
 *   targets in turn.
 * - up-kicker: a scoop that takes a falling ball and sends it up its ramp.
 * - lock: holds up to three balls in a tube and lets them all go together when it is full (a
 *   multiball), or LOCK_MS after the first came in.
 * - nest: cups that catch falling balls from many tables; when every cup is full, or NEST_MS
 *   after the first ball, it tips them all out to the playing tables.
 * - bubbles: gift bubbles rising through the deck, popped by any ball that touches one.
 *
 * Held balls leave the solver and are placed by their device, so nothing can push them through a
 * wall. Every hold ends by itself, and `drop` ends one at once.
 */
import type { Gift } from "./config";
import type { Aim, MagnetSpec, Playfield, SaucerSpec } from "./deckgeo";
import type { Motion, Pt } from "./path";
import type { Ball } from "./physics";

export type Phase = "chute" | "free" | "guided" | "fall" | "held" | "rail";

export interface DeckBall extends Ball {
  phase: Phase;
  /** Scripted phases: path, motion and clock ms start. */
  pts: Pt[];
  motion: Motion;
  start: number;
  /** Radius at the start and end of the scripted phase. */
  r0: number;
  r1: number;
  /** Clock ms it last became free. */
  freeAt: number;
  /** Clock ms it came onto the deck. */
  life: number;
  /** Slot index of the hole it is heading for or fell into, and the table it is going to. */
  hole: number;
  target: number;
  /** Launch speed at the chute's top. */
  vx0: number;
  /** Which frame sent it and its id there, for tests. */
  from: string;
  ref: number;
  rain: boolean;
  /** The device holding it ("" for none), and the ramp it rides (-1 for none). */
  dev: string;
  rail: number;
  /** Nudges since it last moved. */
  nudges: number;
}

export type Release =
  | { ball: DeckBall; vx: number; vy: number; why: string }
  | { ball: DeckBall; rail: number; why: string }
  | { ball: DeckBall; pour: true; why: string };

export interface Device {
  readonly name: string;
  readonly held: readonly DeckBall[];
  /** Would it take this free ball now? */
  wants(b: DeckBall, now: number): boolean;
  take(b: DeckBall, now: number): void;
  /** Place the balls it holds, and let go of any whose time is up. */
  update(now: number, out: Release[]): void;
  /** Let go of a ball at once, without a kick. False if it doesn't hold it. */
  drop(b: DeckBall, now: number): boolean;
}

const speedOf = (b: Ball) => Math.hypot(b.vx, b.vy);
const near = (b: Ball, x: number, y: number, r: number) => Math.hypot(b.x - x, b.y - y) < r;
const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

const holdBall = (b: DeckBall, dev: string) => {
  b.phase = "held";
  b.dev = dev;
  b.vx = 0;
  b.vy = 0;
};

/** A device that holds one ball at a spot for a while. */
interface OneSlot {
  ball: DeckBall | null;
  since: number;
  from: Pt;
  cool: number;
}

const takeOne = (s: OneSlot, b: DeckBall, now: number, name: string) => {
  s.ball = b;
  s.since = now;
  s.from = { x: b.x, y: b.y };
  holdBall(b, name);
};

/** Pull the ball from where it was caught to (x, y) over `ms`. */
const pull = (s: OneSlot, now: number, x: number, y: number, ms: number) => {
  const b = s.ball;
  if (!b) return;
  const k = ease((now - s.since) / ms);
  b.px = b.x;
  b.py = b.y;
  b.x = s.from.x + (x - s.from.x) * k;
  b.y = s.from.y + (y - s.from.y) * k;
};

export const SAUCER_MS = 1300;
const SAUCER_COOL_MS = 900;
/** Balls faster than this skip over a saucer. */
const SAUCER_MAX_V = 2800;

export interface Saucer extends Device {
  readonly spec: SaucerSpec;
  /** Clock ms it took its ball (meaningful while it holds one). */
  readonly since: number;
}

export const createSaucer = (spec: SaucerSpec, name: string): Saucer => {
  const s: OneSlot = { ball: null, since: 0, from: { x: 0, y: 0 }, cool: 0 };
  return {
    name,
    spec,
    get held() {
      return s.ball ? [s.ball] : [];
    },
    get since() {
      return s.since;
    },
    wants: (b, now) =>
      !s.ball && now >= s.cool && near(b, spec.x, spec.y, spec.r) && speedOf(b) < SAUCER_MAX_V,
    take: (b, now) => takeOne(s, b, now, name),
    update(now, out) {
      const b = s.ball;
      if (!b) return;
      pull(s, now, spec.x, spec.y, 160);
      if (now - s.since < SAUCER_MS) return;
      s.ball = null;
      s.cool = now + SAUCER_COOL_MS;
      out.push({ ball: b, vx: spec.kick.vx, vy: spec.kick.vy, why: name });
    },
    drop(b, now) {
      if (s.ball !== b) return false;
      s.ball = null;
      s.cool = now + SAUCER_COOL_MS;
      return true;
    },
  };
};

export const MAGNET_MS = 1100;
const MAGNET_PULL_MS = 180;
const MAGNET_COOL_MS = 1600;

export interface Magnet extends Device {
  readonly spec: MagnetSpec;
  readonly since: number;
  /** How many balls it has flung, which picks its next target. */
  readonly flung: number;
  /** The aim it will use next. */
  next(): Aim;
}

export const createMagnet = (spec: MagnetSpec, name: string): Magnet => {
  const s: OneSlot = { ball: null, since: 0, from: { x: 0, y: 0 }, cool: 0 };
  let flung = 0;
  const next = () => spec.aims[flung % spec.aims.length]!;
  return {
    name,
    spec,
    get held() {
      return s.ball ? [s.ball] : [];
    },
    get since() {
      return s.since;
    },
    get flung() {
      return flung;
    },
    next,
    wants: (b, now) => !s.ball && now >= s.cool && near(b, spec.x, spec.y, spec.r),
    take: (b, now) => takeOne(s, b, now, name),
    update(now, out) {
      const b = s.ball;
      if (!b) return;
      // In to the middle, then a small shiver while it charges.
      const t = now - s.since;
      const w = t > MAGNET_PULL_MS ? spec.r * 0.06 * Math.min(1, t / MAGNET_MS) : 0;
      pull(
        s,
        now,
        spec.x + Math.cos(t * 0.05) * w,
        spec.y + Math.sin(t * 0.07) * w,
        MAGNET_PULL_MS,
      );
      if (t < MAGNET_MS) return;
      const aim = next();
      flung++;
      s.ball = null;
      s.cool = now + MAGNET_COOL_MS;
      b.x = spec.x;
      b.y = spec.y;
      out.push({ ball: b, vx: aim.vx, vy: aim.vy, why: name });
    },
    drop(b, now) {
      if (s.ball !== b) return false;
      s.ball = null;
      s.cool = now + MAGNET_COOL_MS;
      return true;
    },
  };
};

export const VUK_MS = 700;
const VUK_COOL_MS = 400;

export interface UpKicker extends Device {
  readonly since: number;
}

export const createUpKicker = (spec: Playfield["vuk"], name = "vuk"): UpKicker => {
  const s: OneSlot = { ball: null, since: 0, from: { x: 0, y: 0 }, cool: 0 };
  return {
    name,
    get held() {
      return s.ball ? [s.ball] : [];
    },
    get since() {
      return s.since;
    },
    wants: (b, now) =>
      !s.ball &&
      now >= s.cool &&
      near(b, spec.x, spec.y, spec.r) &&
      b.vy > -300 &&
      speedOf(b) < 3200,
    take: (b, now) => takeOne(s, b, now, name),
    update(now, out) {
      const b = s.ball;
      if (!b) return;
      pull(s, now, spec.x, spec.y, 140);
      if (now - s.since < VUK_MS) return;
      s.ball = null;
      s.cool = now + VUK_COOL_MS;
      out.push({ ball: b, rail: spec.rail, why: name });
    },
    drop(b, now) {
      if (s.ball !== b) return false;
      s.ball = null;
      s.cool = now + VUK_COOL_MS;
      return true;
    },
  };
};

export const LOCK_SIZE = 3;
/** A lock that isn't full lets its balls go this long after the first came in. */
export const LOCK_MS = 20_000;
const LOCK_SLIDE_MS = 350;
const LOCK_GAP_MS = 220;
const LOCK_COOL_MS = 1200;

export interface Lock extends Device {
  readonly spec: Playfield["lock"];
  readonly releasing: boolean;
  /** Clock ms the first ball came in (Infinity when empty). */
  readonly firstAt: number;
}

export const createLock = (spec: Playfield["lock"], name = "lock"): Lock => {
  const balls: { b: DeckBall; from: Pt; at: number }[] = [];
  let firstAt = Infinity;
  let releasing = false;
  let full = false;
  let nextAt = 0;
  let cool = 0;
  return {
    name,
    spec,
    get held() {
      return balls.map((x) => x.b);
    },
    get releasing() {
      return releasing;
    },
    get firstAt() {
      return firstAt;
    },
    wants: (b, now) =>
      !releasing &&
      now >= cool &&
      balls.length < LOCK_SIZE &&
      near(b, spec.mouth.x, spec.mouth.y, spec.mouth.r),
    take(b, now) {
      if (balls.length === 0) firstAt = now;
      balls.push({ b, from: { x: b.x, y: b.y }, at: now });
      holdBall(b, name);
    },
    update(now, out) {
      if (!releasing && balls.length > 0) {
        if (balls.length >= LOCK_SIZE || now - firstAt >= LOCK_MS) {
          releasing = true;
          full = balls.length >= LOCK_SIZE;
          nextAt = now + 400;
        }
      }
      if (releasing && now >= nextAt && balls.length > 0) {
        const first = balls.shift()!;
        nextAt = now + LOCK_GAP_MS;
        // The rest drop one place from wherever they are.
        for (const x of balls) {
          x.from = { x: x.b.x, y: x.b.y };
          x.at = now;
        }
        const o = spec.out;
        first.b.x = o.x;
        first.b.y = o.y;
        out.push({ ball: first.b, vx: o.vx, vy: o.vy, why: full ? "multiball" : name });
      }
      if (releasing && balls.length === 0) {
        releasing = false;
        firstAt = Infinity;
        cool = now + LOCK_COOL_MS;
      }
      balls.forEach((x, i) => {
        const to = spec.stack[i] ?? spec.stack[spec.stack.length - 1]!;
        const k = ease((now - x.at) / LOCK_SLIDE_MS);
        x.b.px = x.b.x;
        x.b.py = x.b.y;
        x.b.x = x.from.x + (to.x - x.from.x) * k;
        x.b.y = x.from.y + (to.y - x.from.y) * k;
      });
    },
    drop(b) {
      const i = balls.findIndex((x) => x.b === b);
      if (i < 0) return false;
      balls.splice(i, 1);
      if (balls.length === 0) {
        releasing = false;
        firstAt = Infinity;
      }
      return true;
    },
  };
};

export const NEST_MS = 45_000;
export const NEST_TIP_MS = 700;
const NEST_COOL_MS = 1500;
const NEST_MIN_CUPS = 3;
export const NEST_MAX_CUPS = 8;

export interface Nest extends Device {
  readonly spec: Playfield["nest"];
  readonly x: number;
  readonly cups: number;
  /** Ball in each cup, or null. */
  readonly cupBalls: readonly (DeckBall | null)[];
  /** How far it has tipped, 0 to 1. */
  tilt(now: number): number;
  /** Width of its mouth. */
  readonly width: number;
  /** Where it should be, and how many cups it should have (taken up when it is next empty). */
  aimAt(x: number, cups: number): void;
  readonly firstAt: number;
}

export const createNest = (spec: Playfield["nest"], U: number, name = "nest"): Nest => {
  let cups = NEST_MIN_CUPS;
  let wantCups = cups;
  let x = (spec.minX + spec.maxX) / 2;
  let target = x;
  let held: ({ b: DeckBall; from: Pt; at: number } | null)[] = Array(cups).fill(null);
  let firstAt = Infinity;
  let tipAt = Infinity;
  let pouredAt = -Infinity;
  let cool = 0;
  let last = -Infinity;
  const width = () => Math.max(cups * spec.cupW, 14 * U);
  const cupX = (i: number) => x + (i - (cups - 1) / 2) * (width() / cups);
  const count = () => held.filter(Boolean).length;
  const tilt = (now: number) => {
    if (tipAt !== Infinity) return ease((now - tipAt) / NEST_TIP_MS);
    return 1 - ease((now - pouredAt) / 500);
  };
  const nest: Nest = {
    name,
    spec,
    get x() {
      return x;
    },
    get cups() {
      return cups;
    },
    get width() {
      return width();
    },
    get firstAt() {
      return firstAt;
    },
    get held() {
      return held.flatMap((c) => (c ? [c.b] : []));
    },
    get cupBalls() {
      return held.map((c) => c?.b ?? null);
    },
    tilt,
    aimAt(nx, n) {
      target = Math.max(spec.minX, Math.min(spec.maxX, nx));
      wantCups = Math.max(NEST_MIN_CUPS, Math.min(NEST_MAX_CUPS, Math.round(n)));
    },
    wants: (b, now) =>
      tipAt === Infinity &&
      now >= cool &&
      b.vy > 0 &&
      count() < cups &&
      Math.abs(b.x - x) < width() / 2 &&
      b.y > spec.y - spec.depth - b.r &&
      b.y < spec.y,
    take(b, now) {
      let best = -1;
      let d = Infinity;
      held.forEach((c, i) => {
        if (c) return;
        const e = Math.abs(cupX(i) - b.x);
        if (e < d) {
          d = e;
          best = i;
        }
      });
      if (best < 0) return;
      if (count() === 0) firstAt = now;
      held[best] = { b, from: { x: b.x, y: b.y }, at: now };
      holdBall(b, name);
    },
    update(now, out) {
      const dt = last === -Infinity ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      const n = count();
      if (n === 0 && tipAt === Infinity && wantCups !== cups) {
        cups = wantCups;
        held = Array(cups).fill(null);
      }
      // It glides along its track, quickly enough to keep up but slowly enough to follow.
      const glide = U * 8 * dt;
      x += Math.max(-glide, Math.min(glide, target - x));
      if (tipAt === Infinity && n > 0 && (n >= cups || now - firstAt >= NEST_MS)) tipAt = now;
      const a = tilt(now) * 1.1;
      held.forEach((c, i) => {
        if (!c) return;
        const k = ease((now - c.at) / 200);
        const ox = cupX(i) - x;
        const oy = -c.b.r * 0.6;
        // Round the nest's middle as it tips.
        const rx = x + ox * Math.cos(a) - oy * Math.sin(a);
        const ry = spec.y + ox * Math.sin(a) + oy * Math.cos(a);
        c.b.px = c.b.x;
        c.b.py = c.b.y;
        c.b.x = c.from.x + (rx - c.from.x) * k;
        c.b.y = c.from.y + (ry - c.from.y) * k;
      });
      if (tipAt !== Infinity && now - tipAt >= NEST_TIP_MS) {
        for (const c of held) if (c) out.push({ ball: c.b, pour: true, why: name });
        held = Array(cups).fill(null);
        tipAt = Infinity;
        pouredAt = now;
        firstAt = Infinity;
        cool = now + NEST_COOL_MS;
      }
    },
    drop(b) {
      const i = held.findIndex((c) => c?.b === b);
      if (i < 0) return false;
      held[i] = null;
      if (count() === 0) firstAt = Infinity;
      return true;
    },
  };
  return nest;
};

export interface Bubble {
  id: number;
  x: number;
  y: number;
  /** Centre of its sway. */
  cx: number;
  born: number;
  kind: Gift;
  /** Slot it rose from. */
  slot: number;
  /** Clock ms it popped (Infinity while whole). */
  popAt: number;
}

/** Most bubbles on the deck at once. */
export const MAX_BUBBLES = 3;
/** A bubble that hasn't been popped by now drifts off the top. */
const BUBBLE_LIFE_MS = 40_000;
const POP_SHOW_MS = 600;

export interface Bubbles {
  readonly list: readonly Bubble[];
  /** Whole bubbles. */
  live(): number;
  spawn(x: number, kind: Gift, slot: number, now: number): Bubble | null;
  /** The whole bubble a ball touches, popped, or null. */
  hit(b: Ball, now: number): Bubble | null;
  update(now: number, dt: number): void;
  clear(): void;
}

export const createBubbles = (spec: Playfield["bubbles"], H: number): Bubbles => {
  const list: Bubble[] = [];
  let nextId = 1;
  const rise = H * 0.03;
  return {
    list,
    live: () => list.filter((b) => b.popAt === Infinity).length,
    spawn(x, kind, slot, now) {
      if (list.filter((b) => b.popAt === Infinity).length >= MAX_BUBBLES) return null;
      const b: Bubble = {
        id: nextId++,
        x,
        y: spec.y0,
        cx: x,
        born: now,
        kind,
        slot,
        popAt: Infinity,
      };
      list.push(b);
      return b;
    },
    hit(ball, now) {
      for (const b of list) {
        if (b.popAt !== Infinity) continue;
        if (Math.hypot(ball.x - b.x, ball.y - b.y) < spec.r + ball.r) {
          b.popAt = now;
          return b;
        }
      }
      return null;
    },
    update(now, dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const b = list[i]!;
        if (b.popAt !== Infinity) {
          if (now - b.popAt > POP_SHOW_MS) list.splice(i, 1);
          continue;
        }
        b.y -= rise * dt;
        const age = (now - b.born) / 1000;
        b.x = b.cx + Math.sin(age * 0.9 + b.id) * spec.r * 0.7;
        if (b.y < spec.y1 || now - b.born > BUBBLE_LIFE_MS) list.splice(i, 1);
      }
    },
    clear() {
      list.length = 0;
    },
  };
};
