/**
 * Touches on the open map: taps (vehicle cards), one-finger pans and two-finger pinches. The
 * first finger to move further than `slop` owns the map until it lifts, and a second finger
 * within `pinch` of it zooms. Fingers further away belong to other people along a wall: they never
 * move the map, so two people can't fight over it, but they can still tap.
 */

export type GestureEvent =
  | { kind: "start" }
  /** Move the ground under the map by (dx, dy) stage px. */
  | { kind: "pan"; dx: number; dy: number }
  /** Scale the map by `scale` about stage point (x, y). */
  | { kind: "zoom"; scale: number; x: number; y: number }
  /** The map was let go, moving at (vx, vy) stage px a second. */
  | { kind: "end"; vx: number; vy: number }
  | { kind: "tap"; x: number; y: number };

export interface GestureOptions {
  /** Stage px a finger moves before its touch is a drag rather than a tap. */
  slop: number;
  /** Stage px within which a second finger joins the owner's drag as a pinch. */
  pinch: number;
}

export interface Gestures {
  down(id: number, x: number, y: number, t: number): GestureEvent[];
  move(id: number, x: number, y: number, t: number): GestureEvent[];
  up(id: number, x: number, y: number, t: number): GestureEvent[];
  cancel(id: number): GestureEvent[];
  /** Somebody is moving the map. */
  readonly active: boolean;
  readonly fingers: number;
  clear(): void;
}

const MAX_FINGERS = 20;
/** Velocity smoothing time constant, ms. */
const VELOCITY_MS = 50;
/** A pinch changes scale by at most this factor per event, so a jumpy touch can't fling the zoom. */
const MAX_STEP = 2;

interface Finger {
  /** Start, current and last applied positions. */
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  lx: number;
  ly: number;
  moved: boolean;
  vx: number;
  vy: number;
  t: number;
}

export const createGestures = (opts: GestureOptions): Gestures => {
  const fingers = new Map<number, Finger>();
  let owner: number | null = null;
  let partner: number | null = null;

  const settle = (f: Finger) => {
    f.lx = f.cx;
    f.ly = f.cy;
  };

  const apply = (): GestureEvent[] => {
    const o = owner === null ? undefined : fingers.get(owner);
    if (!o) return [];
    const p = partner === null ? undefined : fingers.get(partner);
    if (!p) {
      const dx = o.cx - o.lx;
      const dy = o.cy - o.ly;
      settle(o);
      return dx || dy ? [{ kind: "pan", dx, dy }] : [];
    }
    const lmx = (o.lx + p.lx) / 2;
    const lmy = (o.ly + p.ly) / 2;
    const mx = (o.cx + p.cx) / 2;
    const my = (o.cy + p.cy) / 2;
    const ld = Math.hypot(o.lx - p.lx, o.ly - p.ly);
    const d = Math.hypot(o.cx - p.cx, o.cy - p.cy);
    settle(o);
    settle(p);
    const out: GestureEvent[] = [];
    if (mx !== lmx || my !== lmy) out.push({ kind: "pan", dx: mx - lmx, dy: my - lmy });
    if (ld > 1 && d > 1 && d !== ld) {
      const scale = Math.max(1 / MAX_STEP, Math.min(MAX_STEP, d / ld));
      out.push({ kind: "zoom", scale, x: mx, y: my });
    }
    return out;
  };

  /** The nearest finger to `f` that isn't part of anything yet, within pinch reach. */
  const nearbyIdle = (f: Finger, self: number): number | null => {
    let best: number | null = null;
    let bestD = opts.pinch;
    for (const [id, g] of fingers) {
      if (id === self || g.moved) continue;
      const d = Math.hypot(g.cx - f.cx, g.cy - f.cy);
      if (d <= bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  };

  const move = (id: number, x: number, y: number, t: number): GestureEvent[] => {
    const f = fingers.get(id);
    if (!f) return [];
    const dt = t - f.t;
    if (dt > 0) {
      const k = Math.min(1, dt / VELOCITY_MS);
      f.vx += (((x - f.cx) / dt) * 1000 - f.vx) * k;
      f.vy += (((y - f.cy) / dt) * 1000 - f.vy) * k;
      f.t = t;
    }
    f.cx = x;
    f.cy = y;
    const out: GestureEvent[] = [];
    if (!f.moved && Math.hypot(x - f.sx, y - f.sy) > opts.slop) {
      f.moved = true;
      if (owner === null) {
        owner = id;
        // Count the movement within the slop too, so the ground stays under the finger.
        f.lx = f.sx;
        f.ly = f.sy;
        const near = nearbyIdle(f, id);
        if (near !== null) {
          partner = near;
          const p = fingers.get(near)!;
          p.moved = true;
          p.lx = p.sx;
          p.ly = p.sy;
        }
        out.push({ kind: "start" });
      }
    }
    if (id === owner || id === partner) out.push(...apply());
    return out;
  };

  /** A finger leaves the gesture; returns whether it was the last one holding the map. */
  const leave = (id: number): boolean => {
    if (id === partner) {
      partner = null;
      const o = fingers.get(owner!);
      if (o) {
        settle(o);
        o.vx = 0;
        o.vy = 0;
      }
      return false;
    }
    if (id !== owner) return false;
    if (partner !== null) {
      owner = partner;
      partner = null;
      const o = fingers.get(owner);
      if (o) {
        settle(o);
        o.vx = 0;
        o.vy = 0;
      }
      return false;
    }
    owner = null;
    return true;
  };

  return {
    down(id, x, y, t) {
      if (fingers.has(id) || fingers.size >= MAX_FINGERS) return [];
      const f: Finger = { sx: x, sy: y, cx: x, cy: y, lx: x, ly: y, moved: false, vx: 0, vy: 0, t };
      fingers.set(id, f);
      if (owner !== null && partner === null) {
        const o = fingers.get(owner)!;
        if (Math.hypot(o.cx - x, o.cy - y) <= opts.pinch) {
          partner = id;
          f.moved = true;
          settle(o);
        }
      }
      return [];
    },
    move,
    up(id, x, y, t) {
      const f = fingers.get(id);
      if (!f) return [];
      const out = move(id, x, y, t);
      fingers.delete(id);
      if (id === owner || id === partner) {
        if (leave(id)) out.push({ kind: "end", vx: f.vx, vy: f.vy });
      } else if (!f.moved) {
        out.push({ kind: "tap", x, y });
      }
      return out;
    },
    cancel(id) {
      if (!fingers.has(id)) return [];
      const last = leave(id);
      fingers.delete(id);
      return last ? [{ kind: "end", vx: 0, vy: 0 }] : [];
    },
    get active() {
      return owner !== null;
    },
    get fingers() {
      return fingers.size;
    },
    clear() {
      fingers.clear();
      owner = null;
      partner = null;
    },
  };
};
