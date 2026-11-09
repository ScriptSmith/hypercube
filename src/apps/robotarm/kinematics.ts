/**
 * The arm's joints and forward kinematics, from the joint angles to where every part is.
 *
 * Six revolute joints in a chain, with a spherical wrist (the last three axes meet at the
 * wrist centre). Each joint's frame is the previous one times a rotation about one local axis;
 * the links run along local y:
 *
 *   J1 base turn   about the world vertical            R1 = rotY(q1)
 *   J2 shoulder    about the lateral axis at height d1  R2 = R1 rotX(q2), elbow at a2 along y
 *   J3 elbow       about the lateral axis               R3 = R2 rotX(q3), wrist at d4 along y
 *   J4 forearm roll about the forearm                   R4 = R3 rotY(q4)
 *   J5 wrist bend  about the rolled lateral axis        R5 = R4 rotX(q5)
 *   J6 twist       about the tool axis                  R6 = R5 rotY(q6), grip point d6 along y
 *
 * At zero the arm points straight up. q1 = 0 faces the front of the bench (+z); positive q2,
 * q3 and q5 lean the next link forward and down. The tool's local y is its approach direction
 * (palm to fingertips), local x the axis the jaws close along.
 */
import { DEG, type Speed } from "./config";
import { addScaled, apply, clamp, col, type Mat3, mul, rotX, rotY, v3, type Vec3 } from "./math";

/** Lengths in world units (a block is 0.36 across). */
export const ARM = {
  /** Shoulder height above the bench. */
  d1: 1.0,
  /** Shoulder to elbow. */
  a2: 1.55,
  /** Elbow to wrist centre. */
  d4: 1.45,
  /** Wrist centre to the grip point between the fingers. */
  d6: 0.62,
} as const;

/** The gripper, along the tool axis from the wrist centre and across it. */
export const GRIP = {
  /** Palm plate centre along the tool axis, and its half sizes. */
  palmAt: 0.24,
  palmHalf: { c: 0.42, t: 0.06, b: 0.11 },
  /** Fingers run along the tool axis between these. */
  fingerFrom: 0.28,
  fingerTo: 0.8,
  /** Finger half sizes across (closing axis) and sideways. */
  fingerHalfC: 0.035,
  fingerHalfB: 0.09,
  /** Half the gap between the fingers' inner faces. */
  openHalf: 0.33,
  closedHalf: 0.015,
  /** Seconds to close fully. */
  closeTime: 0.3,
} as const;

export type JointKey = "base" | "shoulder" | "elbow" | "roll" | "bend" | "twist";

export interface JointDef {
  index: number;
  key: JointKey;
  /** Limits and home, radians. */
  min: number;
  max: number;
  home: number;
  /** Top servo speed at normal speed, radians per second. */
  rate: number;
  /** True for joints whose axis is horizontal at q4 = 0 (they lean the arm). */
  pitch: boolean;
}

const joint = (
  index: number,
  key: JointKey,
  min: number,
  max: number,
  home: number,
  rate: number,
  pitch: boolean,
): JointDef => ({
  index,
  key,
  min: min * DEG,
  max: max * DEG,
  home: home * DEG,
  rate: rate * DEG,
  pitch,
});

export const JOINTS: readonly JointDef[] = [
  joint(0, "base", -160, 160, 0, 70, false),
  joint(1, "shoulder", -40, 105, 15, 55, true),
  joint(2, "elbow", -15, 150, 100, 65, true),
  joint(3, "roll", -170, 170, 0, 100, false),
  joint(4, "bend", -120, 120, 65, 95, true),
  joint(5, "twist", -170, 170, 0, 120, false),
];

export const JOINT_COUNT = 6;

export type Joints = [number, number, number, number, number, number];

export const HOME: Joints = JOINTS.map((j) => j.home) as Joints;

export const SPEED_SCALE: Record<Speed, number> = { normal: 1, slow: 0.6 };

export const clampJoint = (i: number, a: number): number => {
  const j = JOINTS[i];
  return j ? clamp(a, j.min, j.max) : a;
};

export const withinLimits = (q: readonly number[], slack = 1e-9): boolean =>
  JOINTS.every((j) => {
    const a = q[j.index] ?? 0;
    return a >= j.min - slack && a <= j.max + slack;
  });

export interface Pose {
  q: Joints;
  /** Orientation after each joint, R1 to R6. */
  frames: [Mat3, Mat3, Mat3, Mat3, Mat3, Mat3];
  base: Vec3;
  shoulder: Vec3;
  elbow: Vec3;
  wrist: Vec3;
  /** The grip point, midway between the fingers. */
  grip: Vec3;
  /** Tool orientation (R6) and its axes: approach, closing axis, and the third. */
  tool: Mat3;
  approach: Vec3;
  close: Vec3;
  side: Vec3;
}

const Y = v3(0, 1, 0);

export const forward = (q: readonly number[]): Pose => {
  const [q1 = 0, q2 = 0, q3 = 0, q4 = 0, q5 = 0, q6 = 0] = q;
  const r1 = rotY(q1);
  const r2 = mul(r1, rotX(q2));
  const r3 = mul(r2, rotX(q3));
  const r4 = mul(r3, rotY(q4));
  const r5 = mul(r4, rotX(q5));
  const r6 = mul(r5, rotY(q6));
  const base = v3(0, 0, 0);
  const shoulder = v3(0, ARM.d1, 0);
  const elbow = addScaled(shoulder, apply(r2, Y), ARM.a2);
  const wrist = addScaled(elbow, apply(r3, Y), ARM.d4);
  const approach = col(r6, 1);
  const grip = addScaled(wrist, approach, ARM.d6);
  return {
    q: [q1, q2, q3, q4, q5, q6],
    frames: [r1, r2, r3, r4, r5, r6],
    base,
    shoulder,
    elbow,
    wrist,
    grip,
    tool: r6,
    approach,
    close: col(r6, 0),
    side: col(r6, 2),
  };
};

/** A point in the tool frame: `t` along the approach, `c` along the closing axis, `b` sideways. */
export const toolPoint = (p: Pose, t: number, c = 0, b = 0): Vec3 =>
  addScaled(addScaled(addScaled(p.wrist, p.approach, t), p.close, c), p.side, b);

/** Where each finger's tip centre is for a given half gap, as [+close side, -close side]. */
export const fingertips = (p: Pose, half: number): [Vec3, Vec3] => {
  const off = half + GRIP.fingerHalfC;
  return [toolPoint(p, GRIP.fingerTo, off), toolPoint(p, GRIP.fingerTo, -off)];
};

/**
 * The yaw of the closing axis about the vertical, for a tool pointing straight down with the
 * forearm unrolled: q1 - q6 (see ik.ts). Exported for the autopilot and its tests.
 */
export const jawYaw = (p: Pose): number => Math.atan2(-p.close.z, p.close.x);
