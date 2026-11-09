/**
 * The ball, our own physics: a solid ball rolling without slipping on a tilted plane, so it
 * accelerates at 5/7 g sin(tilt) along each axis, with rolling resistance and viscous damping
 * (which sets its top speed at a given tilt). Walls are boxes; the ball is a circle against them,
 * pushed out along the line to the nearest point of each box (rounded corners for free) and
 * bounced with a little restitution. Each step is cut into substeps short enough that the ball
 * never moves more than a third of its radius, so it can't pass through a wall at top speed.
 *
 * Holes and the goal take the ball when it stays over one long enough to sink past a small lip:
 * a slow ball drops in, a very fast one can skip across.
 */
import type { Handling } from "./config";
import { cellAt, type Maze } from "./maze";

export const G = 9.81;
const ROLL = 5 / 7;
/** Rolling resistance, as a share of g. */
const MU = 0.011;
/** Restitution against walls, and the impact speed below which there is no bounce at all. */
export const RESTITUTION = 0.3;
const BOUNCE_V = 0.03;
/** Share of the speed along a wall kept at an impact. */
const WALL_SLIDE = 0.88;
/** Hard cap on speed, m/s. */
export const V_CAP = 1.0;
/** Speed below which a ball on a nearly level board stops. */
const REST_V = 0.004;
/** Largest move in one substep, as a share of the radius. */
export const SUBSTEP_K = 0.3;
const MAX_SUBSTEPS = 32;
/** How far below the rim the ball must sink to be caught, as a share of its radius. */
export const HOLE_LIP = 0.3;
export const GOAL_LIP = 0.12;
/** Pull towards a hole's middle while over it, as a share of g. */
const RIM_PULL = 0.6;

export type Quat = [number, number, number, number];

export interface Ball {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Where it was before the last step, for drawing between steps. */
  px: number;
  pz: number;
  q: Quat;
  pq: Quat;
  /** Over hole `over` (index), or -2 the goal, or -1 neither; sunk this far, sinking this fast. */
  over: number;
  sink: number;
  sinkV: number;
}

export type BallEvent = { type: "hole"; hole: number } | { type: "goal" } | null;

export const createBall = (x: number, z: number): Ball => ({
  x,
  z,
  vx: 0,
  vz: 0,
  px: x,
  pz: z,
  q: [0, 0, 0, 1],
  pq: [0, 0, 0, 1],
  over: -1,
  sink: 0,
  sinkV: 0,
});

export const placeBall = (b: Ball, x: number, z: number) => {
  b.x = b.px = x;
  b.z = b.pz = z;
  b.vx = b.vz = 0;
  b.over = -1;
  b.sink = b.sinkV = 0;
};

/** Rotate `q` by `angle` about the unit axis (ax, 0, az), in the board's frame. */
const spin = (q: Quat, ax: number, az: number, angle: number) => {
  const s = Math.sin(angle / 2);
  const c = Math.cos(angle / 2);
  const rx = ax * s;
  const rz = az * s;
  const [x, y, z, w] = q;
  // r * q with r = (rx, 0, rz, c).
  q[0] = c * x + rx * w - rz * y;
  q[1] = c * y + rz * x - rx * z;
  q[2] = c * z + rz * w + rx * y;
  q[3] = c * w - rx * x - rz * z;
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= n;
  q[1] /= n;
  q[2] /= n;
  q[3] /= n;
};

/** Push the ball out of every wall box near it; returns the hardest impact speed. */
export const collide = (b: Ball, m: Maze): number => {
  const r = m.r;
  let hardest = 0;
  const list = m.cellBoxes[cellAt(m, b.x, b.z)] ?? [];
  for (const k of list) {
    const box = m.boxes[k]!;
    const qx = b.x < box.x0 ? box.x0 : b.x > box.x1 ? box.x1 : b.x;
    const qz = b.z < box.z0 ? box.z0 : b.z > box.z1 ? box.z1 : b.z;
    let dx = b.x - qx;
    let dz = b.z - qz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    let d = Math.sqrt(d2);
    if (d < 1e-9) {
      // The centre is inside the box: out along the shallowest side.
      const left = b.x - box.x0;
      const right = box.x1 - b.x;
      const far = b.z - box.z0;
      const nearSide = box.z1 - b.z;
      const m0 = Math.min(left, right, far, nearSide);
      dx = m0 === left ? -1 : m0 === right ? 1 : 0;
      dz = m0 === far ? -1 : m0 === nearSide ? 1 : 0;
      if (dx !== 0) dz = 0;
      b.x = dx < 0 ? box.x0 - r : dx > 0 ? box.x1 + r : b.x;
      b.z = dz < 0 ? box.z0 - r : dz > 0 ? box.z1 + r : b.z;
      d = 1;
    } else {
      dx /= d;
      dz /= d;
      b.x = qx + dx * r;
      b.z = qz + dz * r;
    }
    const vn = b.vx * dx + b.vz * dz;
    if (vn < 0) {
      const e = vn < -BOUNCE_V ? RESTITUTION : 0;
      const tx = b.vx - vn * dx;
      const tz = b.vz - vn * dz;
      const keep = vn < -BOUNCE_V ? WALL_SLIDE : 1;
      b.vx = tx * keep - e * vn * dx;
      b.vz = tz * keep - e * vn * dz;
      hardest = Math.max(hardest, -vn);
    }
  }
  return hardest;
};

/**
 * Advance the ball by `dt` on a board tilted by (tx, tz) radians: +tx lowers the right side,
 * +tz the near side. Returns a hole or goal that caught it, if any.
 */
export const stepBall = (
  b: Ball,
  m: Maze,
  tx: number,
  tz: number,
  handling: Pick<Handling, "damping">,
  dt: number,
): BallEvent => {
  b.px = b.x;
  b.pz = b.z;
  b.pq[0] = b.q[0];
  b.pq[1] = b.q[1];
  b.pq[2] = b.q[2];
  b.pq[3] = b.q[3];
  const gx = ROLL * G * Math.sin(tx);
  const gz = ROLL * G * Math.sin(tz);
  const speed0 = Math.hypot(b.vx, b.vz);
  const gmag = Math.hypot(gx, gz);
  if (speed0 < REST_V && gmag < MU * G * 1.2 && b.over === -1) {
    // At rest; it can still be sitting over a hole (placed there, or the board just levelled).
    b.vx = b.vz = 0;
    return sinkStep(b, m, dt);
  }
  const reach = (speed0 + gmag * dt) * dt;
  const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(reach / (SUBSTEP_K * m.r))));
  const h = dt / n;
  const damp = Math.exp(-handling.damping * h);
  const r = m.r;
  for (let i = 0; i < n; i++) {
    let ax = gx;
    let az = gz;
    if (b.over !== -1) {
      const hx = b.over === -2 ? goalX(m) : (m.holes[b.over]?.x ?? b.x);
      const hz = b.over === -2 ? goalZ(m) : (m.holes[b.over]?.z ?? b.z);
      const dx = hx - b.x;
      const dz = hz - b.z;
      const dl = Math.hypot(dx, dz) || 1;
      ax += (RIM_PULL * G * dx) / dl;
      az += (RIM_PULL * G * dz) / dl;
    }
    b.vx += ax * h;
    b.vz += az * h;
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 1e-6) {
      const drop = Math.min(sp, MU * G * h);
      b.vx -= (b.vx / sp) * drop;
      b.vz -= (b.vz / sp) * drop;
    }
    b.vx *= damp;
    b.vz *= damp;
    const sp2 = Math.hypot(b.vx, b.vz);
    if (sp2 > V_CAP) {
      b.vx *= V_CAP / sp2;
      b.vz *= V_CAP / sp2;
    }
    b.x += b.vx * h;
    b.z += b.vz * h;
    collide(b, m);
    collide(b, m);
    // Roll: angular velocity n x v / r with n up the board.
    const sp3 = Math.hypot(b.vx, b.vz);
    if (sp3 > 1e-6) spin(b.q, b.vz / sp3, -b.vx / sp3, (sp3 * h) / r);
    const caught = sinkStep(b, m, h);
    if (caught) return caught;
  }
  return null;
};

const goalX = (m: Maze) => -m.w / 2 + ((m.goal % m.cols) + 0.5) * m.sx;
const goalZ = (m: Maze) => -m.d / 2 + (Math.floor(m.goal / m.cols) + 0.5) * m.sz;

/** Track the ball over a hole or the goal; returns what caught it once it has sunk past the lip. */
const sinkStep = (b: Ball, m: Maze, h: number): BallEvent => {
  let over = -1;
  let lip = 0;
  const gx = goalX(m);
  const gz = goalZ(m);
  if (Math.hypot(b.x - gx, b.z - gz) < m.goalR) {
    over = -2;
    lip = GOAL_LIP * m.r;
  } else {
    for (const k of m.cellHoles[cellAt(m, b.x, b.z)] ?? []) {
      const hole = m.holes[k]!;
      if (Math.hypot(b.x - hole.x, b.z - hole.z) < hole.r) {
        over = k;
        lip = HOLE_LIP * m.r;
        break;
      }
    }
  }
  if (over === -1) {
    b.over = -1;
    b.sink = b.sinkV = 0;
    return null;
  }
  if (over !== b.over) {
    b.over = over;
    b.sink = b.sinkV = 0;
  }
  b.sinkV += G * h;
  b.sink += b.sinkV * h;
  if (b.sink < lip) return null;
  return over === -2 ? { type: "goal" } : { type: "hole", hole: over };
};
