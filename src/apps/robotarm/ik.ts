/**
 * Inverse kinematics for one family of poses: the tool pointing straight down at a point, with
 * the forearm unrolled (q4 = 0). That is all the autopilot needs to pick a piece up from above
 * and put it down. Visitors never need it: they turn the joints themselves.
 *
 * With a spherical wrist the wrist centre is the grip point raised by d6. The base turn faces
 * it; the shoulder and elbow are a two-link arm in the vertical plane through it (law of
 * cosines, elbow up); the wrist bend then points the tool down: q2 + q3 + q5 = 180 degrees.
 * Seen from above the jaws then close along yaw q1 - q6, so the twist picks the jaw yaw.
 */
import { ARM, clampJoint, JOINTS, type Joints, withinLimits } from "./kinematics";
import { wrapAngle, type Vec3 } from "./math";

const QUARTER = Math.PI / 2;

/**
 * Joint angles that put the grip point at `target` with the tool straight down, or null when it
 * is out of reach or a joint limit is in the way. `yaw` is the yaw of a block's face normals
 * (any of the four, since a block is square); null for a ball. The twist is chosen among the
 * jaw yaws that face the block's sides, nearest `twist`.
 */
export const topDown = (target: Vec3, yaw: number | null, twist = 0): Joints | null => {
  const wx = target.x;
  const wy = target.y + ARM.d6;
  const wz = target.z;
  const r = Math.hypot(wx, wz);
  const h = wy - ARM.d1;
  const { a2, d4 } = ARM;
  const d = (r * r + h * h - a2 * a2 - d4 * d4) / (2 * a2 * d4);
  if (d > 1 || d < -1) return null;
  const q1 = r < 1e-9 ? 0 : Math.atan2(wx, wz);
  const q3 = Math.acos(d);
  const q2 = Math.atan2(r, h) - Math.atan2(d4 * Math.sin(q3), a2 + d4 * Math.cos(q3));
  const q5 = Math.PI - q2 - q3;
  const q6 = yaw === null ? clampJoint(5, twist) : twistFor(q1, yaw, twist);
  if (q6 === null) return null;
  const q: Joints = [q1, q2, q3, 0, q5, q6];
  return withinLimits(q) ? q : null;
};

/** Every twist within limits that closes the jaws across a block of `yaw`. */
export const twistsFor = (q1: number, yaw: number): number[] => {
  const j = JOINTS[5]!;
  const base = wrapAngle(q1 - yaw);
  const out: number[] = [];
  for (let k = -4; k <= 4; k++) {
    const q6 = base + k * QUARTER;
    if (q6 >= j.min && q6 <= j.max) out.push(q6);
  }
  return out;
};

/** The twist, within limits and nearest `near`, that closes the jaws across a block of `yaw`. */
export const twistFor = (q1: number, yaw: number, near = 0): number | null => {
  const j = JOINTS[5]!;
  const base = wrapAngle(q1 - yaw);
  let best: number | null = null;
  for (let k = -4; k <= 4; k++) {
    const q6 = base + k * QUARTER;
    if (q6 < j.min || q6 > j.max) continue;
    if (best === null || Math.abs(q6 - near) < Math.abs(best - near)) best = q6;
  }
  return best;
};
