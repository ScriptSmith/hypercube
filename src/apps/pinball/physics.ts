/**
 * Ball physics for a table or the deck: balls against walls (thick segments and arcs), posts and
 * bumpers (circles), flippers (tapered capsules turning about a pivot) and each other. No DOM,
 * clock or randomness, so the same inputs always give the same result.
 *
 * The caller sub-steps so that a ball at the speed cap, and a flipper tip at full swing, each
 * move well under a ball radius per step; a wall is then always met before a ball can cross its
 * middle. Flippers also remember which side of them each nearby ball was on, so a ball caught by
 * a moving flipper is always pushed back out on the side it came from.
 *
 * A ball a finger holds chases its hold point under the same speed cap and meets walls, posts
 * and other balls as usual, so it can be pressed against a wall but never pulled through one.
 * It ignores gravity and flippers, fires nothing and reports nothing.
 */

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Position at the start of the last update, for interpolated drawing. */
  px: number;
  py: number;
  r: number;
  /** Palette index of the colour it carries. */
  color: number;
  /** Came down from the deck. */
  bonus: boolean;
  /** Who scores for it on the deck ("" for nobody). */
  owner: string;
  /** World seconds when it entered this world. */
  born: number;
  /** Which side of each flipper it was on (+1, -1, or 0 when far away). */
  sides: number[];
  /** For stuck detection: where it was last seen moving, and since when. */
  qx: number;
  qy: number;
  qt: number;
  /** Where the finger holding it is, or null when nobody holds it. */
  hold: { x: number; y: number } | null;
}

interface ShapeBase {
  id: number;
  /** What it is, for scoring and drawing: "wall", "bumper", "sling", "target", ... */
  tag: string;
  /** Which one of its tag. */
  index: number;
  /** Restitution. */
  e: number;
  /** Speed added along the normal when it fires (bumpers and slingshots), 0 for none. */
  kick: number;
  /** Impact speed below which it doesn't fire or report a hit. */
  hitMin: number;
  /** Half thickness. */
  r: number;
  /** Shapes that are off don't collide (for example outlane posts until a gift raises them). */
  on: boolean;
  /** World seconds before which it won't fire again. */
  cool: number;
  /** Reports hits as events. */
  scores: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Seg extends ShapeBase {
  kind: "seg";
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Solid only for balls on this side of it (a one-way gate). */
  oneWay: { nx: number; ny: number } | null;
}

export interface Circle extends ShapeBase {
  kind: "circle";
  x: number;
  y: number;
  /** Velocity of a moving circle, which it gives to the balls it meets. */
  vx: number;
  vy: number;
}

/** A thick arc around (cx, cy) of centreline radius `rad`, from angle a0 to a1 (a1 > a0). */
export interface Arc extends ShapeBase {
  kind: "arc";
  cx: number;
  cy: number;
  rad: number;
  a0: number;
  a1: number;
}

export type Shape = Seg | Circle | Arc;

export interface Flipper {
  index: number;
  name: string;
  /** Pivot. */
  px: number;
  py: number;
  len: number;
  /** Radius at the pivot and at the tip. */
  r0: number;
  r1: number;
  /** Angles in radians, y down: at rest and raised. */
  rest: number;
  up: number;
  angle: number;
  /** Angular velocity over the last sub-step. */
  omega: number;
  held: boolean;
  /** Fastest swing up and back, radians per second. */
  speedUp: number;
  speedDown: number;
  e: number;
}

/** A circle a ball rolls over, reported once each time a ball enters it. */
export interface Rollover {
  tag: string;
  index: number;
  x: number;
  y: number;
  r: number;
  inside: Set<number>;
}

/** A line reported when a ball's centre crosses it. Crossing towards +n is forward. */
export interface Gate {
  tag: string;
  index: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  nx: number;
  ny: number;
}

export type PhysEvent =
  | { type: "hit"; tag: string; index: number; ball: Ball; speed: number; kicked: boolean }
  | { type: "roll"; tag: string; index: number; ball: Ball }
  | { type: "cross"; tag: string; index: number; ball: Ball; dir: number; speed: number }
  | { type: "out"; ball: Ball };

export interface World {
  /** Seconds simulated. */
  t: number;
  /** Down the playfield (+y), px per second squared. */
  gravity: number;
  vmax: number;
  /** Fraction of speed lost per second to rolling. */
  damping: number;
  shapes: Shape[];
  flippers: Flipper[];
  rollovers: Rollover[];
  gates: Gate[];
  balls: Ball[];
  /** A ball whose centre leaves this box is reported out. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  events: PhysEvent[];
  /** Ball-ball restitution. */
  ballE: number;
  /** Called every sub-step before the balls move, to move shapes (see `moveCircle`). */
  tick: ((h: number) => void) | null;
}

/** Normal speeds below this don't bounce: the ball settles instead of jittering. */
const REST_V = 45;
/** Events kept per update at most. */
const MAX_EVENTS = 96;
/** Seconds a kicker waits before it fires again. */
const KICK_COOL = 0.06;
/** A held ball closes the gap to its hold point with this time constant, seconds. */
const HOLD_S = 0.025;

const bound = <T extends ShapeBase>(s: T, x0: number, y0: number, x1: number, y1: number): T => {
  s.x0 = Math.min(x0, x1) - s.r;
  s.y0 = Math.min(y0, y1) - s.r;
  s.x1 = Math.max(x0, x1) + s.r;
  s.y1 = Math.max(y0, y1) + s.r;
  return s;
};

let nextShape = 1;

export interface ShapeOpts {
  tag?: string;
  index?: number;
  e?: number;
  kick?: number;
  hitMin?: number;
  r?: number;
  scores?: boolean;
  on?: boolean;
}

const base = (o: ShapeOpts) => ({
  id: nextShape++,
  tag: o.tag ?? "wall",
  index: o.index ?? 0,
  e: o.e ?? 0.45,
  kick: o.kick ?? 0,
  hitMin: o.hitMin ?? 60,
  r: o.r ?? 7,
  on: o.on ?? true,
  cool: 0,
  scores: o.scores ?? false,
  x0: 0,
  y0: 0,
  x1: 0,
  y1: 0,
});

export const seg = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  o: ShapeOpts & { oneWay?: { nx: number; ny: number } } = {},
): Seg =>
  bound({ ...base(o), kind: "seg", ax, ay, bx, by, oneWay: o.oneWay ?? null }, ax, ay, bx, by);

export const circle = (x: number, y: number, r: number, o: ShapeOpts = {}): Circle =>
  bound({ ...base({ ...o, r }), kind: "circle", x, y, vx: 0, vy: 0 }, x, y, x, y);

/**
 * Move a circle to (x, y) over `h` seconds. Keep each move well under a ball radius, as for
 * flipper tips, so a ball can't end up past a circle's middle.
 */
export const moveCircle = (c: Circle, x: number, y: number, h: number) => {
  c.vx = h > 0 ? (x - c.x) / h : 0;
  c.vy = h > 0 ? (y - c.y) / h : 0;
  c.x = x;
  c.y = y;
  bound(c, x, y, x, y);
};

export const arc = (
  cx: number,
  cy: number,
  rad: number,
  a0: number,
  a1: number,
  o: ShapeOpts = {},
): Arc => {
  const a = bound({ ...base(o), kind: "arc", cx, cy, rad, a0, a1 } as Arc, cx, cy, cx, cy);
  // A loose box: the whole circle.
  a.x0 = cx - rad - a.r;
  a.y0 = cy - rad - a.r;
  a.x1 = cx + rad + a.r;
  a.y1 = cy + rad + a.r;
  return a;
};

export const makeBall = (id: number, x: number, y: number, r: number, born = 0): Ball => ({
  id,
  x,
  y,
  vx: 0,
  vy: 0,
  px: x,
  py: y,
  r,
  color: 0,
  bonus: false,
  owner: "",
  born,
  sides: [],
  qx: x,
  qy: y,
  qt: born,
  hold: null,
});

export const makeWorld = (o: Partial<World> & Pick<World, "bounds">): World => ({
  t: 0,
  gravity: 0,
  vmax: 5000,
  damping: 0.12,
  shapes: [],
  flippers: [],
  rollovers: [],
  gates: [],
  balls: [],
  events: [],
  ballE: 0.85,
  tick: null,
  ...o,
});

const TWO_PI = Math.PI * 2;

const emit = (w: World, e: PhysEvent) => {
  if (w.events.length < MAX_EVENTS) w.events.push(e);
};

/**
 * Push the ball out to distance `reach` from (cx, cy) along (nx, ny) and bounce it off a surface
 * moving at (svx, svy).
 */
const respond = (
  w: World,
  b: Ball,
  cx: number,
  cy: number,
  nx: number,
  ny: number,
  reach: number,
  e: number,
  svx: number,
  svy: number,
  s: ShapeBase | null,
) => {
  b.x = cx + nx * reach;
  b.y = cy + ny * reach;
  const rvx = b.vx - svx;
  const rvy = b.vy - svy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return;
  const ee = -vn < REST_V ? 0 : e;
  b.vx -= (1 + ee) * vn * nx;
  b.vy -= (1 + ee) * vn * ny;
  if (!s) return;
  const impact = -vn;
  let kicked = false;
  if (s.kick > 0 && impact >= s.hitMin && w.t >= s.cool) {
    b.vx += nx * s.kick;
    b.vy += ny * s.kick;
    s.cool = w.t + KICK_COOL;
    kicked = true;
  }
  if (s.scores && impact >= s.hitMin) {
    emit(w, { type: "hit", tag: s.tag, index: s.index, ball: b, speed: impact, kicked });
  }
};

const collideSeg = (w: World, b: Ball, s: Seg) => {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((b.x - s.ax) * dx + (b.y - s.ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = s.ax + dx * t;
  const cy = s.ay + dy * t;
  const ox = b.x - cx;
  const oy = b.y - cy;
  const reach = b.r + s.r;
  const d2 = ox * ox + oy * oy;
  if (d2 >= reach * reach) return;
  if (s.oneWay && (b.x - s.ax) * s.oneWay.nx + (b.y - s.ay) * s.oneWay.ny < 0) return;
  const d = Math.sqrt(d2);
  let nx: number;
  let ny: number;
  if (d > 1e-6) {
    nx = ox / d;
    ny = oy / d;
  } else if (s.oneWay) {
    nx = s.oneWay.nx;
    ny = s.oneWay.ny;
  } else {
    const l = Math.sqrt(len2) || 1;
    nx = -dy / l;
    ny = dx / l;
  }
  respond(w, b, cx, cy, nx, ny, reach, s.e, 0, 0, b.hold ? null : s);
};

const collideCircle = (w: World, b: Ball, c: Circle) => {
  const ox = b.x - c.x;
  const oy = b.y - c.y;
  const reach = b.r + c.r;
  const d2 = ox * ox + oy * oy;
  if (d2 >= reach * reach) return;
  const d = Math.sqrt(d2);
  const nx = d > 1e-6 ? ox / d : 0;
  const ny = d > 1e-6 ? oy / d : -1;
  respond(w, b, c.x, c.y, nx, ny, reach, c.e, c.vx, c.vy, b.hold ? null : c);
};

const collideArc = (w: World, b: Ball, a: Arc) => {
  const ox = b.x - a.cx;
  const oy = b.y - a.cy;
  const dist = Math.sqrt(ox * ox + oy * oy);
  const reach = b.r + a.r;
  // Every point of the arc lies on its circle, so this far from the circle is far from the arc.
  if (Math.abs(dist - a.rad) >= reach) return;
  let phi = Math.atan2(oy, ox);
  let rel = (phi - a.a0) % TWO_PI;
  if (rel < 0) rel += TWO_PI;
  let cx: number;
  let cy: number;
  if (rel <= a.a1 - a.a0) {
    cx = a.cx + Math.cos(phi) * a.rad;
    cy = a.cy + Math.sin(phi) * a.rad;
  } else {
    const ex0 = a.cx + Math.cos(a.a0) * a.rad;
    const ey0 = a.cy + Math.sin(a.a0) * a.rad;
    const ex1 = a.cx + Math.cos(a.a1) * a.rad;
    const ey1 = a.cy + Math.sin(a.a1) * a.rad;
    const d0 = (b.x - ex0) ** 2 + (b.y - ey0) ** 2;
    const d1 = (b.x - ex1) ** 2 + (b.y - ey1) ** 2;
    phi = d0 < d1 ? a.a0 : a.a1;
    cx = d0 < d1 ? ex0 : ex1;
    cy = d0 < d1 ? ey0 : ey1;
  }
  const px = b.x - cx;
  const py = b.y - cy;
  const d2 = px * px + py * py;
  if (d2 >= reach * reach) return;
  const d = Math.sqrt(d2);
  let nx: number;
  let ny: number;
  if (d > 1e-6) {
    nx = px / d;
    ny = py / d;
  } else {
    // On the centreline: push towards the centre side it is nearer.
    nx = dist < a.rad ? -Math.cos(phi) : Math.cos(phi);
    ny = dist < a.rad ? -Math.sin(phi) : Math.sin(phi);
  }
  respond(w, b, cx, cy, nx, ny, reach, a.e, 0, 0, b.hold ? null : a);
};

/** Which side of the flipper's axis (x, y) is on: +1 or -1. */
const sideOf = (f: Flipper, x: number, y: number) => {
  const dx = Math.cos(f.angle);
  const dy = Math.sin(f.angle);
  return dx * (y - f.py) - dy * (x - f.px) >= 0 ? 1 : -1;
};

const collideFlipper = (w: World, b: Ball, f: Flipper) => {
  const dx = Math.cos(f.angle) * f.len;
  const dy = Math.sin(f.angle) * f.len;
  const len2 = f.len * f.len;
  const near = f.len + f.r0 + b.r + 24;
  const fx = b.x - f.px;
  const fy = b.y - f.py;
  if (fx * fx + fy * fy > near * near) {
    b.sides[f.index] = 0;
    return;
  }
  let t = (fx * dx + fy * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = f.px + dx * t;
  const cy = f.py + dy * t;
  const rr = f.r0 + (f.r1 - f.r0) * t;
  const reach = b.r + rr;
  const ox = b.x - cx;
  const oy = b.y - cy;
  const d2 = ox * ox + oy * oy;
  const side = dx * fy - dy * fx >= 0 ? 1 : -1;
  const remembered = b.sides[f.index] ?? 0;
  if (d2 >= reach * reach) {
    b.sides[f.index] = side;
    return;
  }
  const d = Math.sqrt(d2);
  let nx: number;
  let ny: number;
  const interior = t > 0 && t < 1;
  if (interior && remembered !== 0 && remembered !== side) {
    // The axis swept past the ball's centre: put it back on the side it was on.
    const l = f.len;
    nx = (-dy / l) * remembered;
    ny = (dx / l) * remembered;
  } else if (d > 1e-6) {
    nx = ox / d;
    ny = oy / d;
  } else {
    const l = f.len;
    const s = remembered || 1;
    nx = (-dy / l) * s;
    ny = (dx / l) * s;
  }
  // Surface velocity at the contact point.
  const qx = cx + nx * rr - f.px;
  const qy = cy + ny * rr - f.py;
  const svx = -f.omega * qy;
  const svy = f.omega * qx;
  respond(w, b, cx, cy, nx, ny, reach, f.e, svx, svy, null);
  b.sides[f.index] = sideOf(f, b.x, b.y);
};

const collideBalls = (w: World) => {
  const balls = w.balls;
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i]!;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const reach = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2);
      const nx = d > 1e-6 ? dx / d : 1;
      const ny = d > 1e-6 ? dy / d : 0;
      const push = (reach - d) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      const vrel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (vrel <= 0) continue;
      const ee = vrel < REST_V ? 0 : w.ballE;
      const j2 = ((1 + ee) / 2) * vrel;
      a.vx -= j2 * nx;
      a.vy -= j2 * ny;
      b.vx += j2 * nx;
      b.vy += j2 * ny;
    }
  }
};

const collideShapes = (w: World, b: Ball) => {
  const bx0 = b.x - b.r;
  const by0 = b.y - b.r;
  const bx1 = b.x + b.r;
  const by1 = b.y + b.r;
  for (const s of w.shapes) {
    if (!s.on || bx1 < s.x0 || bx0 > s.x1 || by1 < s.y0 || by0 > s.y1) continue;
    if (s.kind === "seg") collideSeg(w, b, s);
    else if (s.kind === "circle") collideCircle(w, b, s);
    else collideArc(w, b, s);
  }
};

const sense = (w: World, b: Ball, sx: number, sy: number) => {
  for (const r of w.rollovers) {
    const inside = (b.x - r.x) ** 2 + (b.y - r.y) ** 2 < r.r * r.r;
    if (inside && !r.inside.has(b.id)) {
      r.inside.add(b.id);
      emit(w, { type: "roll", tag: r.tag, index: r.index, ball: b });
    } else if (!inside) {
      r.inside.delete(b.id);
    }
  }
  for (const g of w.gates) {
    const ds = (sx - g.ax) * g.nx + (sy - g.ay) * g.ny;
    const de = (b.x - g.ax) * g.nx + (b.y - g.ay) * g.ny;
    if ((ds < 0 && de >= 0) || (ds >= 0 && de < 0)) {
      const k = ds / (ds - de);
      const cx = sx + (b.x - sx) * k;
      const cy = sy + (b.y - sy) * k;
      const gx = g.bx - g.ax;
      const gy = g.by - g.ay;
      const t = ((cx - g.ax) * gx + (cy - g.ay) * gy) / (gx * gx + gy * gy);
      if (t >= 0 && t <= 1) {
        const dir = de >= 0 ? 1 : -1;
        const speed = Math.abs(b.vx * g.nx + b.vy * g.ny);
        emit(w, { type: "cross", tag: g.tag, index: g.index, ball: b, dir, speed });
      }
    }
  }
};

/** A held ball still passes over rollovers, quietly, so letting go on one doesn't count. */
const feel = (w: World, b: Ball) => {
  for (const r of w.rollovers) {
    if ((b.x - r.x) ** 2 + (b.y - r.y) ** 2 < r.r * r.r) r.inside.add(b.id);
    else r.inside.delete(b.id);
  }
};

const capSpeed = (b: Ball, vmax: number) => {
  const v2 = b.vx * b.vx + b.vy * b.vy;
  if (v2 > vmax * vmax) {
    const k = vmax / Math.sqrt(v2);
    b.vx *= k;
    b.vy *= k;
  }
};

/** One sub-step of a held ball: towards its hold point, stopped by whatever is in the way. */
const stepHeld = (w: World, b: Ball, hold: { x: number; y: number }, h: number) => {
  const sx = b.x;
  const sy = b.y;
  b.vx = (hold.x - b.x) / HOLD_S;
  b.vy = (hold.y - b.y) / HOLD_S;
  capSpeed(b, w.vmax);
  b.x += b.vx * h;
  b.y += b.vy * h;
  for (let it = 0; it < 2; it++) collideShapes(w, b);
  // Its velocity is how far it actually moved, so a ball pressed against a wall isn't a kicker.
  b.vx = (b.x - sx) / h;
  b.vy = (b.y - sy) / h;
  capSpeed(b, w.vmax);
  b.sides.length = 0;
  feel(w, b);
};

const moveFlippers = (w: World, h: number) => {
  for (const f of w.flippers) {
    const target = f.held ? f.up : f.rest;
    const diff = target - f.angle;
    const max = (f.held ? f.speedUp : f.speedDown) * h;
    const step = diff > max ? max : diff < -max ? -max : diff;
    f.angle += step;
    f.omega = step / h;
  }
};

/** Advance by `dt` seconds in `substeps` equal steps. Events from this call go to `w.events`. */
export const stepWorld = (w: World, dt: number, substeps: number) => {
  for (const b of w.balls) {
    b.px = b.x;
    b.py = b.y;
  }
  const h = dt / substeps;
  const damp = Math.max(0, 1 - w.damping * h);
  const vmax2 = w.vmax * w.vmax;
  for (let s = 0; s < substeps; s++) {
    w.t += h;
    w.tick?.(h);
    moveFlippers(w, h);
    for (const b of w.balls) {
      if (b.hold) {
        stepHeld(w, b, b.hold, h);
        continue;
      }
      b.vy += w.gravity * h;
      b.vx *= damp;
      b.vy *= damp;
      const v2 = b.vx * b.vx + b.vy * b.vy;
      if (v2 > vmax2) {
        const k = w.vmax / Math.sqrt(v2);
        b.vx *= k;
        b.vy *= k;
      }
      const sx = b.x;
      const sy = b.y;
      b.x += b.vx * h;
      b.y += b.vy * h;
      for (let it = 0; it < 2; it++) {
        collideShapes(w, b);
        for (const f of w.flippers) collideFlipper(w, b, f);
      }
      const v2b = b.vx * b.vx + b.vy * b.vy;
      if (v2b > vmax2) {
        const k = w.vmax / Math.sqrt(v2b);
        b.vx *= k;
        b.vy *= k;
      }
      sense(w, b, sx, sy);
    }
    if (w.balls.length > 1) {
      collideBalls(w);
      // Ball pushes can press a ball into a wall; settle that before the next step.
      for (const b of w.balls) collideShapes(w, b);
    }
    const bb = w.bounds;
    for (let i = w.balls.length - 1; i >= 0; i--) {
      const b = w.balls[i]!;
      if (b.hold) continue;
      if (b.x < bb.x0 || b.x > bb.x1 || b.y < bb.y0 || b.y > bb.y1) {
        w.balls.splice(i, 1);
        for (const r of w.rollovers) r.inside.delete(b.id);
        emit(w, { type: "out", ball: b });
      }
    }
  }
};

/** Speed of the fastest possible relative motion per sub-step, for checks. */
export const stepReach = (w: World, dt: number, substeps: number): number => {
  const h = dt / substeps;
  let tip = 0;
  for (const f of w.flippers) tip = Math.max(tip, Math.max(f.speedUp, f.speedDown) * f.len);
  return (w.vmax + tip) * h;
};
