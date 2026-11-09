/**
 * Puck physics for one lane, in lane coordinates: x runs along the lane from end 0 to end 1
 * (0..length), y across it (0..width), both in venue px. No DOM, no clock, no randomness, so
 * the same inputs always give the same result.
 *
 * Mallets are kinematic: they chase a target (a finger or a bot) with a speed cap and are never
 * pushed by pucks, except back out of a puck pinned against a wall. Pucks are sub-stepped so
 * that no puck moves more than a fraction of its radius relative to anything per sub-step,
 * which keeps fast shots from tunnelling through mallets, paddles or posts.
 */
import type { Side, Variant } from "./config";

export interface Vec {
  x: number;
  y: number;
}

/** An axis-aligned box in lane coordinates. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A gap in a goal end that pucks score through. Closed mouths act as wall (sealed slots). */
export interface Mouth {
  y0: number;
  y1: number;
  /** Which slot along the end, for ends with several (defence). */
  slot: number;
  open: boolean;
}

/**
 * A goal end defended by `side`; an open end that leads to another frame (versus, or the
 * screen above a bank); or a plain wall. A goal end has one centred mouth unless `mouths`
 * lists several.
 */
export interface End {
  kind: "goal" | "open" | "wall";
  side: Side;
  mouths?: Mouth[];
  /**
   * Open ends: how far past the end, in puck radii, a puck's centre goes before it leaves.
   * The default 1 waits until it is wholly off the lane. Versus uses -1, so a puck is handed
   * over as its leading edge reaches the end and the other frame can bring it in while this
   * one still shows it sliding off.
   */
  leaveAt?: number;
}

/** A fixed round bumper on the lane: a target or a splitter in defence. */
export interface Obstacle {
  id: number;
  x: number;
  y: number;
  r: number;
  /** Extra speed it gives a puck, as a fraction of the cap (splitters); 0 for a plain bounce. */
  kick?: number;
}

export interface LaneParams {
  variant: Variant;
  length: number;
  width: number;
  ends: readonly [End, End];
  puckR: number;
  malletR: number;
  /** Paddles: half the paddle's length (along y) and half its thickness. */
  paddleHalf: number;
  paddleR: number;
  /** Half the goal mouth. Paddles score across the whole end. */
  goalHalf: number;
  /** Each end's mouths (empty for open ends and walls). `open` may change during play. */
  mouths: readonly [Mouth[], Mouth[]];
  /** Which end a stalled puck drifts towards, or null for the middle of the lane. */
  drift: 0 | 1 | null;
  /** Radius of the rounded corners at goal ends; 0 for square corners. */
  corner: number;
  /** Speed cap for pucks, px/s. */
  maxPuck: number;
  /** Paddles: serve speed, and the floor a ball never drops below. */
  baseBall: number;
  maxMallet: number;
}

export interface Puck {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** rad/s, for looks only. */
  spin: number;
  angle: number;
  /** Position at the start of the last step, for interpolated drawing. */
  px: number;
  py: number;
  live: boolean;
  /** Seconds spent nearly still; a long stall earns a nudge. */
  slow: number;
  /** Seconds since it appeared. */
  age: number;
  /** It slid in through an open end rather than being put down, so it is drawn without a drop. */
  slidIn: boolean;
  lastSide: Side | -1;
}

export interface Mallet {
  side: Side;
  /** The end this player defends. */
  goalEnd: 0 | 1;
  /** Where the centre may go. Paddles have x0 === x1. */
  zone: Box;
  x: number;
  y: number;
  vx: number;
  vy: number;
  px: number;
  py: number;
  /** Where the finger or bot wants it. */
  tx: number;
  ty: number;
  /** Speed cap, px/s. Bots run slower than people. */
  cap: number;
}

export type LaneEvent =
  | { type: "goal"; puck: Puck; end: 0 | 1; slot: number; speed: number }
  | { type: "bump"; puck: Puck; obstacle: Obstacle; speed: number }
  | { type: "exit"; puck: Puck; end: 0 | 1 }
  | { type: "hit"; puck: Puck; mallet: Mallet; speed: number }
  | { type: "bounce"; puck: Puck; speed: number };

const WALL_E = 0.88;
const MALLET_E = 0.86;
const PUCK_E = 0.94;
/** Air-table drag on pucks, 1/s. */
const FRICTION = 0.2;
const SPIN_DRAG = 1.5;
/** How hard a mallet chases its target, 1/s. Higher is snappier. */
const CATCH_UP = 50;
const MAX_SUBSTEPS = 16;
/** Largest relative move per sub-step, as a fraction of the puck radius. */
const SUBSTEP_REACH = 0.35;
const STALL_SPEED = 0.035;
const STALL_SECONDS = 1.8;
const NUDGE = 0.14;
/**
 * Out of every player's reach (no-man's land round a seam, the open middle of a long table)
 * a puck is pushed along the lane at this rate, as a fraction of the speed cap per second,
 * until it moves along the lane at DRIFT_SPEED: onwards if it is already going one way, else
 * towards the nearest player.
 */
const DRIFT_ACCEL = 0.9;
const DRIFT_SPEED = 0.4;
/** Below this (fraction of the cap) a puck counts as still, for choosing its drift. */
const DRIFT_STILL = 0.05;
const PADDLE_ANGLE = (55 * Math.PI) / 180;
const PADDLE_SPEEDUP = 1.05;
const PADDLE_ENGLISH = 0.25;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Sizes and speeds for a lane of the given size. Speeds scale with the lane so a kiosk and a
 * wall table feel alike; long thin lanes (versus, the wall's stacked lanes) take their pace
 * from their width.
 */
export const laneParams = (o: {
  length: number;
  width: number;
  ends: readonly [End, End];
  variant: Variant;
  speed: number;
  child: boolean;
  drift?: 0 | 1 | null;
}): LaneParams => {
  const { length: L, width: W } = o;
  const scale = Math.min(W, 0.62 * L);
  const paddles = o.variant === "paddles";
  // A versus lane is long and well defended, so its goal is wider.
  const versus = o.ends[1].kind === "open";
  const base = clamp(0.05 * scale, 32, 72) * (o.child ? 1.15 : 1);
  const puckR = paddles ? base * 0.85 : base;
  const maxPuck = 1.25 * Math.min(L, 2 * W) * o.speed * (o.child ? 0.55 : 1);
  const goalHalf = paddles ? W : W * (versus ? 0.25 : 0.19);
  const mouthsOf = (e: End): Mouth[] =>
    e.kind !== "goal"
      ? []
      : (e.mouths?.map((m) => ({ ...m })) ?? [
          { y0: W / 2 - goalHalf, y1: W / 2 + goalHalf, slot: 0, open: true },
        ]);
  return {
    variant: o.variant,
    length: L,
    width: W,
    ends: o.ends,
    puckR,
    malletR: base * 1.6,
    paddleHalf: Math.min(W * 0.3, Math.max(W * 0.15, base * 2.2) * (o.child ? 1.2 : 1)),
    paddleR: Math.max(14, base * 0.45),
    goalHalf,
    mouths: [mouthsOf(o.ends[0]), mouthsOf(o.ends[1])],
    drift: o.drift ?? null,
    // Paddles score across the whole end, so their corners must stay square.
    corner: paddles ? 0 : Math.min(W * 0.14, 110),
    maxPuck,
    baseBall: maxPuck * 0.55,
    maxMallet: maxPuck * 2.2,
  };
};

export const createPuck = (id: number): Puck => ({
  id,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  spin: 0,
  angle: 0,
  px: 0,
  py: 0,
  live: false,
  slow: 0,
  age: 0,
  slidIn: false,
  lastSide: -1,
});

/** Put a puck on the lane, moving. */
export const placePuck = (p: Puck, x: number, y: number, vx = 0, vy = 0, spin = 0): void => {
  p.x = x;
  p.y = y;
  p.px = x;
  p.py = y;
  p.vx = vx;
  p.vy = vy;
  p.spin = spin;
  p.live = true;
  p.slow = 0;
  p.age = 0;
  p.slidIn = false;
  p.lastSide = -1;
};

/** Slowest a puck crosses an open end, as a fraction of the cap, so none hangs across a join. */
export const CROSS_SPEED = 0.05;

/**
 * Where a puck's height and sideways velocity get to in `t` seconds (negative for earlier) with
 * nothing in its way but the side walls. For a puck crossing between frames: the sender draws
 * it sliding off this way, and the receiver brings it in where this puts it.
 */
export const glide = (lane: LaneParams, y: number, vy: number, t: number) => {
  const { width: W, puckR: r } = lane;
  const span = Math.max(1e-6, W - 2 * r);
  const u = (((y - r + vy * t) % (2 * span)) + 2 * span) % (2 * span);
  return u <= span ? { y: r + u, vy } : { y: r + 2 * span - u, vy: -vy };
};

/**
 * The zone a mallet's centre may use, given the part of the lane its player owns (`area`).
 * Paddles sit on a fixed line near the goal-side edge of the area.
 */
export const malletZone = (lane: LaneParams, area: Box, goalEnd: 0 | 1): Box => {
  if (lane.variant === "paddles") {
    const inset = Math.max(lane.paddleR * 3, lane.length * 0.05);
    const x = goalEnd === 0 ? area.x0 + inset : area.x1 - inset;
    return { x0: x, x1: x, y0: lane.paddleHalf, y1: lane.width - lane.paddleHalf };
  }
  const r = lane.malletR;
  const x0 = area.x0 + r;
  const x1 = Math.max(x0, area.x1 - r);
  const y0 = Math.max(r, area.y0 + r);
  const y1 = Math.max(y0, Math.min(lane.width - r, area.y1 - r));
  return { x0, x1, y0, y1 };
};

export const createMallet = (side: Side, goalEnd: 0 | 1, zone: Box, cap: number): Mallet => {
  const x = (zone.x0 + zone.x1) / 2;
  const y = (zone.y0 + zone.y1) / 2;
  return { side, goalEnd, zone, x, y, vx: 0, vy: 0, px: x, py: y, tx: x, ty: y, cap };
};

const speedOf = (p: Puck) => Math.hypot(p.vx, p.vy);

const capSpeed = (p: Puck, max: number) => {
  const s = speedOf(p);
  if (s > max) {
    p.vx *= max / s;
    p.vy *= max / s;
  }
};

/** Reflect a puck off a fixed point (a goal post) if it overlaps it. */
const post = (p: Puck, x: number, y: number, r: number): number => {
  const dx = p.x - x;
  const dy = p.y - y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r || d2 === 0) return 0;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  p.x = x + nx * r;
  p.y = y + ny * r;
  const vn = p.vx * nx + p.vy * ny;
  if (vn >= 0) return 0;
  p.vx -= (1 + WALL_E) * vn * nx;
  p.vy -= (1 + WALL_E) * vn * ny;
  return -vn;
};

/** Side walls, end walls and goal posts. Returns the impact speed of the hardest bounce. */
const walls = (lane: LaneParams, p: Puck): number => {
  const { length: L, width: W, puckR: r } = lane;
  let hit = 0;
  if (p.y < r) {
    p.y = r;
    if (p.vy < 0) {
      hit = Math.max(hit, -p.vy);
      p.vy = -p.vy * WALL_E;
    }
  } else if (p.y > W - r) {
    p.y = W - r;
    if (p.vy > 0) {
      hit = Math.max(hit, p.vy);
      p.vy = -p.vy * WALL_E;
    }
  }
  for (const end of [0, 1] as const) {
    if (lane.ends[end].kind === "open") continue;
    const lineX = end === 0 ? 0 : L;
    const into = end === 0 ? p.x < r : p.x > L - r;
    const mouths = lane.mouths[end];
    if (into && !mouths.some((m) => m.open && p.y > m.y0 && p.y < m.y1)) {
      p.x = end === 0 ? r : L - r;
      const vin = end === 0 ? -p.vx : p.vx;
      if (vin > 0) {
        hit = Math.max(hit, vin);
        p.vx = -p.vx * WALL_E;
      }
    }
    for (const m of mouths) {
      if (!m.open) continue;
      if (m.y0 > 0) hit = Math.max(hit, post(p, lineX, m.y0, r));
      if (m.y1 < W) hit = Math.max(hit, post(p, lineX, m.y1, r));
    }
    hit = Math.max(hit, corners(lane, end, p, r));
  }
  return hit;
};

/**
 * Keep a circle of radius `rad` inside the rounded corners at `end`. Moves it back onto the
 * corner arc and returns the outward speed it had there (0 if it was inside or moving in).
 */
const cornerClamp = (lane: LaneParams, end: 0 | 1, b: { x: number; y: number }, rad: number) => {
  const c = lane.corner;
  if (c <= rad) return null;
  const cx = end === 0 ? c : lane.length - c;
  if (end === 0 ? b.x >= cx : b.x <= cx) return null;
  const cy = b.y < c ? c : b.y > lane.width - c ? lane.width - c : null;
  if (cy === null) return null;
  const dx = b.x - cx;
  const dy = b.y - cy;
  const d = Math.hypot(dx, dy);
  const lim = c - rad;
  if (d <= lim || d === 0) return null;
  const nx = dx / d;
  const ny = dy / d;
  b.x = cx + nx * lim;
  b.y = cy + ny * lim;
  return { nx, ny };
};

const corners = (lane: LaneParams, end: 0 | 1, p: Puck, r: number): number => {
  const n = cornerClamp(lane, end, p, r);
  if (!n) return 0;
  const vn = p.vx * n.nx + p.vy * n.ny;
  if (vn <= 0) return 0;
  p.vx -= (1 + WALL_E) * vn * n.nx;
  p.vy -= (1 + WALL_E) * vn * n.ny;
  return vn;
};

/** Keep a mallet inside its zone and the lane's rounded corners. */
const placeMallet = (lane: LaneParams, m: Mallet, x: number, y: number) => {
  m.x = clamp(x, m.zone.x0, m.zone.x1);
  m.y = clamp(y, m.zone.y0, m.zone.y1);
  if (lane.variant === "paddles") return;
  for (const end of [0, 1] as const) {
    if (lane.ends[end].kind !== "open") cornerClamp(lane, end, m, lane.malletR);
  }
};

const puckPair = (a: Puck, b: Puck, r: number) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  const min = 2 * r;
  if (d2 >= min * min || d2 === 0) return;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  const push = (min - d) / 2;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn >= 0) return;
  const j = (-(1 + PUCK_E) * vn) / 2;
  a.vx -= j * nx;
  a.vy -= j * ny;
  b.vx += j * nx;
  b.vy += j * ny;
};

/** A round mallet against a puck. Returns the closing speed, or 0 for no hit. */
const malletHit = (lane: LaneParams, m: Mallet, p: Puck): number => {
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const min = lane.malletR + lane.puckR;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return 0;
  const d = Math.sqrt(d2) || 1e-6;
  const nx = d2 === 0 ? (m.goalEnd === 0 ? 1 : -1) : dx / d;
  const ny = d2 === 0 ? 0 : dy / d;
  p.x = m.x + nx * min;
  p.y = m.y + ny * min;
  const rvx = p.vx - m.vx;
  const rvy = p.vy - m.vy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return 0;
  p.vx -= (1 + MALLET_E) * vn * nx;
  p.vy -= (1 + MALLET_E) * vn * ny;
  // The sliding part of the contact sets the puck spinning.
  const vt = -rvx * ny + rvy * nx;
  p.spin += (vt / lane.puckR) * 0.35;
  return -vn;
};

/**
 * A paddle against a ball. Paddles only stop balls heading for their own goal, from the field
 * side; the rebound angle depends on where the ball meets the paddle, not on physics.
 */
const paddleHit = (lane: LaneParams, m: Mallet, p: Puck, floor: number, cap: number): number => {
  const toGoal = m.goalEnd === 0 ? -1 : 1;
  if (p.vx * toGoal <= 0 || (p.x - m.x) * toGoal > 0) return 0;
  const cy = clamp(p.y, m.y - lane.paddleHalf, m.y + lane.paddleHalf);
  const dx = p.x - m.x;
  const dy = p.y - cy;
  const min = lane.paddleR + lane.puckR;
  if (dx * dx + dy * dy >= min * min) return 0;
  const speed = speedOf(p);
  const offset = clamp((p.y - m.y) / (lane.paddleHalf + lane.puckR), -1, 1);
  const angle = offset * PADDLE_ANGLE;
  const out = Math.min(cap, Math.max(speed, floor) * PADDLE_SPEEDUP);
  let vx = -toGoal * Math.cos(angle) * out;
  let vy = Math.sin(angle) * out + m.vy * PADDLE_ENGLISH;
  const s = Math.hypot(vx, vy) || 1;
  vx = (vx / s) * out;
  vy = (vy / s) * out;
  p.vx = vx;
  p.vy = vy;
  p.x = m.x - toGoal * min;
  p.spin += m.vy * 0.004;
  return speed;
};

/** A bumper sends a puck off as fast as it came, plus its kick. */
const bumper = (o: Obstacle, p: Puck, r: number, cap: number): number => {
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  const min = o.r + r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return 0;
  const d = Math.sqrt(d2) || 1e-6;
  const nx = d2 === 0 ? 1 : dx / d;
  const ny = d2 === 0 ? 0 : dy / d;
  p.x = o.x + nx * min;
  p.y = o.y + ny * min;
  const vn = p.vx * nx + p.vy * ny;
  if (vn >= 0) return 0;
  const kick = (o.kick ?? 0) * cap;
  p.vx += (-2 * vn + kick) * nx;
  p.vy += (-2 * vn + kick) * ny;
  return -vn;
};

/** Push a mallet back out of a puck that a wall holds in place, so pucks are never squeezed. */
const unpin = (lane: LaneParams, m: Mallet, p: Puck) => {
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const min = lane.malletR + lane.puckR;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min || d2 === 0) return;
  const d = Math.sqrt(d2);
  const over = min - d;
  placeMallet(lane, m, m.x - (dx / d) * over, m.y - (dy / d) * over);
};

/** Where a mallet heads this step: towards its target, no faster than its cap. */
const malletVelocity = (m: Mallet, dt: number) => {
  const tx = clamp(m.tx, m.zone.x0, m.zone.x1);
  const ty = clamp(m.ty, m.zone.y0, m.zone.y1);
  let vx = (tx - m.x) * CATCH_UP;
  let vy = (ty - m.y) * CATCH_UP;
  const s = Math.hypot(vx, vy);
  if (s > m.cap) {
    vx *= m.cap / s;
    vy *= m.cap / s;
  }
  // Never overshoot the target within one step.
  if (Math.abs(vx * dt) > Math.abs(tx - m.x)) vx = (tx - m.x) / dt;
  if (Math.abs(vy * dt) > Math.abs(ty - m.y)) vy = (ty - m.y) / dt;
  m.vx = vx;
  m.vy = vy;
};

/** Sub-steps needed so nothing moves more than SUBSTEP_REACH puck radii relative to anything. */
export const substepsFor = (
  lane: LaneParams,
  pucks: readonly Puck[],
  mallets: readonly Mallet[],
  dt: number,
): number => {
  let fastPuck = 0;
  for (const p of pucks) if (p.live) fastPuck = Math.max(fastPuck, speedOf(p));
  let fastMallet = 0;
  for (const m of mallets) fastMallet = Math.max(fastMallet, Math.hypot(m.vx, m.vy));
  const reach = (fastPuck + fastMallet) * dt;
  return clamp(Math.ceil(reach / (SUBSTEP_REACH * lane.puckR)), 1, MAX_SUBSTEPS);
};

/**
 * Advance one lane by `dt` seconds. `tempo` scales the speed limits (slow attract rallies).
 * Scored and departed pucks are marked not live and reported in `events`; pucks striking an
 * obstacle are reported as bumps.
 */
export const stepLane = (
  lane: LaneParams,
  pucks: Puck[],
  mallets: Mallet[],
  dt: number,
  events: LaneEvent[],
  tempo = 1,
  obstacles: readonly Obstacle[] = [],
): void => {
  const cap = lane.maxPuck * tempo;
  const floor = lane.baseBall * tempo;
  const paddles = lane.variant === "paddles";
  for (const p of pucks) {
    p.px = p.x;
    p.py = p.y;
  }
  for (const m of mallets) {
    m.px = m.x;
    m.py = m.y;
    malletVelocity(m, dt);
  }
  const n = substepsFor(lane, pucks, mallets, dt);
  const h = dt / n;
  // Per-puck scratch for this step's hardest mallet hit and wall bounce.
  hitBy.length = pucks.length;
  hitSpeed.length = pucks.length;
  wallSpeed.length = pucks.length;
  hitBy.fill(null);
  hitSpeed.fill(0);
  wallSpeed.fill(0);

  for (let s = 0; s < n; s++) {
    for (const m of mallets) placeMallet(lane, m, m.x + m.vx * h, m.y + m.vy * h);
    for (const p of pucks) {
      if (!p.live) continue;
      p.x += p.vx * h;
      p.y += p.vy * h;
      p.angle += p.spin * h;
    }
    for (let i = 0; i < pucks.length; i++) {
      const a = pucks[i]!;
      if (!a.live) continue;
      for (let j = i + 1; j < pucks.length; j++) {
        const b = pucks[j]!;
        if (b.live) puckPair(a, b, lane.puckR);
      }
    }
    for (let i = 0; i < pucks.length; i++) {
      const p = pucks[i]!;
      if (!p.live) continue;
      for (const m of mallets) {
        const speed = paddles ? paddleHit(lane, m, p, floor, cap) : malletHit(lane, m, p);
        if (speed > 0) {
          p.lastSide = m.side;
          if (speed > hitSpeed[i]!) {
            hitSpeed[i] = speed;
            hitBy[i] = m;
          }
        }
      }
      for (const o of obstacles) {
        const speed = bumper(o, p, lane.puckR, cap);
        if (speed > 0) events.push({ type: "bump", puck: p, obstacle: o, speed });
      }
      capSpeed(p, cap);
      wallSpeed[i] = Math.max(wallSpeed[i]!, walls(lane, p));
      if (!paddles) for (const m of mallets) unpin(lane, m, p);
    }
    for (const p of pucks) {
      if (!p.live) continue;
      const out = departed(lane, p);
      if (out === null) continue;
      p.live = false;
      const { end, slot } = out;
      if (lane.ends[end].kind === "goal") {
        events.push({ type: "goal", puck: p, end, slot, speed: speedOf(p) });
      } else {
        events.push({ type: "exit", puck: p, end });
      }
    }
  }

  for (const m of mallets) {
    m.vx = (m.x - m.px) / dt;
    m.vy = (m.y - m.py) / dt;
  }
  const drag = paddles ? 1 : Math.exp(-FRICTION * dt);
  const spinDrag = Math.exp(-SPIN_DRAG * dt);
  for (let i = 0; i < pucks.length; i++) {
    const p = pucks[i]!;
    if (!p.live) continue;
    p.age += dt;
    p.vx *= drag;
    p.vy *= drag;
    p.spin *= spinDrag;
    if (paddles) keepMoving(p, floor);
    else {
      if (lane.drift === null && mallets.length > 0) driftToReach(lane, p, mallets, dt, cap);
      stall(lane, p, mallets, dt, cap);
    }
    capSpeed(p, cap);
    const by = hitBy[i];
    if (by) events.push({ type: "hit", puck: p, mallet: by, speed: hitSpeed[i]! });
    if (wallSpeed[i]! > 0) events.push({ type: "bounce", puck: p, speed: wallSpeed[i]! });
  }
  hitBy.fill(null);
};

const hitBy: (Mallet | null)[] = [];
const hitSpeed: number[] = [];
const wallSpeed: number[] = [];

/** The end (and slot) a puck has left through, if any. */
const departed = (lane: LaneParams, p: Puck): { end: 0 | 1; slot: number } | null => {
  const r = lane.puckR;
  for (const end of [0, 1] as const) {
    const kind = lane.ends[end].kind;
    if (kind === "wall") continue;
    // Goals count once the puck is mostly over the line; open ends once it is off the lane,
    // or as it reaches the end (versus).
    const past = kind === "goal" ? r * 0.3 : r * (lane.ends[end].leaveAt ?? 1);
    if (end === 0 ? p.x >= -past : p.x <= lane.length + past) continue;
    if (kind === "open") {
      // Only on its way out: a puck sliding in from the other frame starts beyond the line.
      if (end === 0 ? p.vx < 0 : p.vx > 0) return { end, slot: 0 };
      continue;
    }
    const m = lane.mouths[end].find((m) => m.open && p.y >= m.y0 && p.y <= m.y1);
    if (m) return { end, slot: m.slot };
  }
  return null;
};

/** Paddle balls never crawl: they keep at least the serve speed, and never run flat along y. */
const keepMoving = (p: Puck, floor: number) => {
  const s = speedOf(p);
  if (s === 0) {
    p.vx = floor;
    return;
  }
  if (s < floor) {
    p.vx *= floor / s;
    p.vy *= floor / s;
  }
  const minX = 0.3 * Math.max(s, floor);
  if (Math.abs(p.vx) < minX) {
    const sign = p.vx < 0 ? -1 : 1;
    const total = Math.max(s, floor);
    p.vx = sign * minX;
    p.vy = Math.sign(p.vy || 1) * Math.sqrt(Math.max(0, total * total - minX * minX));
  }
};

/** How far a puck centre is from where a mallet could touch it (0 when it could). */
const reachGap = (lane: LaneParams, m: Mallet, x: number, y: number) => {
  const reach = lane.malletR + lane.puckR;
  const dx = Math.max(m.zone.x0 - x, 0, x - m.zone.x1);
  const dy = Math.max(m.zone.y0 - y, 0, y - m.zone.y1);
  return Math.max(0, Math.hypot(dx, dy) - reach);
};

/** The nearest point a mallet could touch the puck at, or null if one already can. */
const nearestReach = (lane: LaneParams, p: Puck, mallets: readonly Mallet[], skipInside = true) => {
  let best: { x: number; y: number; d: number } | null = null;
  for (const m of mallets) {
    const gap = reachGap(lane, m, p.x, p.y);
    if (gap === 0) {
      if (skipInside) return null;
      continue;
    }
    if (best && gap >= best.d) continue;
    const x = Math.min(m.zone.x1, Math.max(m.zone.x0, p.x));
    const y = Math.min(m.zone.y1, Math.max(m.zone.y0, p.y));
    best = { x, y, d: gap };
  }
  return best;
};

/**
 * Air jets: a puck nobody can reach is carried along the lane, the way it is already going or
 * else towards the nearest player, until it moves along the lane at DRIFT_SPEED. Its sideways
 * motion is left alone, so a puck running along a strip of no-man's land still leaves it.
 */
const driftToReach = (
  lane: LaneParams,
  p: Puck,
  mallets: readonly Mallet[],
  dt: number,
  cap: number,
) => {
  if (Math.abs(p.vx) > DRIFT_SPEED * cap) return;
  const to = nearestReach(lane, p, mallets);
  if (!to) return;
  const dir = Math.abs(p.vx) > DRIFT_STILL * cap ? Math.sign(p.vx) : Math.sign(to.x - p.x) || 1;
  p.vx += dir * DRIFT_ACCEL * cap * dt;
  p.slow = 0;
};

/**
 * A puck that sits still for too long drifts back into play (air jets on a real table): to
 * a player who can reach it, never towards the middle of a long table that nobody can.
 */
const stall = (lane: LaneParams, p: Puck, mallets: readonly Mallet[], dt: number, cap: number) => {
  if (speedOf(p) > STALL_SPEED * cap) {
    p.slow = 0;
    return;
  }
  p.slow += dt;
  if (p.slow < STALL_SECONDS) return;
  p.slow = 0;
  const push = NUDGE * cap;
  if (lane.drift !== null) {
    // Towards the players at that end (defence), or down off a screen's deck.
    p.vx = (lane.drift === 0 ? -1 : 1) * push;
    p.vy = (p.id % 2 === 0 ? 0.3 : -0.3) * push;
    return;
  }
  // Sitting by a player who isn't playing it: send it on to the nearest other player, fast
  // enough to get there against the drag.
  const to = mallets.length > 0 ? nearestReach(lane, p, mallets, false) : null;
  if (to) {
    const dx = to.x - p.x;
    const dy = to.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const speed = Math.min(cap * 0.5, Math.max(push, d * FRICTION * 1.3 + cap * 0.08));
    p.vx = (dx / d) * speed;
    p.vy = (dy / d) * speed;
    return;
  }
  const cx = lane.length / 2 - p.x;
  const cy = lane.width / 2 - p.y;
  const d = Math.hypot(cx, cy);
  if (d > lane.length * 0.15) {
    p.vx = (cx / d) * push;
    p.vy = (cy / d) * push;
  } else {
    p.vx = (p.id % 2 === 0 ? 1 : -1) * push;
    p.vy = 0;
  }
};
