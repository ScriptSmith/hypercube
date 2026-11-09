/**
 * The crane's moving parts, from textbook mechanics. Pure.
 *
 * - Trolley and hoist are rate-limited servos: they head for their target at up to a top speed,
 *   never accelerating or braking harder than a limit, and brake in time to stop on it.
 * - The load is a pendulum hanging from the trolley on a cable whose length the hoist changes.
 *   With the angle from the vertical θ (positive when the load is on the trolley's +x side),
 *   cable length L, the trolley's acceleration a and a sideways push on the load w:
 *
 *       L θ'' + 2 L' θ' + g sin θ = (w - a) cos θ
 *
 *   The 2 L' θ' term is why reeling in makes a swing grow and paying out calms it. Damping is
 *   added on top (a little air, or the anti-sway assist), and the angle is kept within a limit
 *   so a short cable can never blow up.
 */

export interface Servo {
  x: number;
  v: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Moves `s` one step towards `target`. Returns the acceleration it used. */
export const stepServo = (
  s: Servo,
  target: number,
  speed: number,
  accel: number,
  dt: number,
): number => {
  const dx = target - s.x;
  if (Math.abs(dx) < 1e-6 && Math.abs(s.v) <= accel * dt) {
    const a = -s.v / dt;
    s.x = target;
    s.v = 0;
    return a;
  }
  // The fastest speed that can still brake to a stop on the target, within the top speed, and
  // never so fast that one step would carry past it.
  const brake = Math.sqrt(2 * accel * Math.abs(dx)) * 0.97;
  const want = Math.sign(dx) * Math.min(speed, brake, Math.abs(dx) / dt);
  const dv = clamp(want - s.v, -accel * dt, accel * dt);
  s.v += dv;
  const before = dx;
  s.x += s.v * dt;
  // A step's worth of braking can still carry a hair past; stop on the target instead.
  if (Math.sign(target - s.x) !== Math.sign(before) && Math.abs(target - s.x) < accel * dt * dt) {
    s.x = target;
    s.v = 0;
  }
  return dv / dt;
};

export interface Swing {
  theta: number;
  omega: number;
}

export interface SwingInput {
  /** Pivot to the load's centre of mass. */
  length: number;
  /** Rate the length changes (positive paying out). */
  lengthRate: number;
  /** Trolley acceleration along +x. */
  accel: number;
  /** Sideways push on the load along +x (wind), as an acceleration. */
  push: number;
  /** Damping per second. */
  damping: number;
  gravity: number;
  maxAngle: number;
}

/** One semi-implicit Euler step of the swing, in two halves for accuracy on short cables. */
export const stepSwing = (s: Swing, i: SwingInput, dt: number): void => {
  const L = Math.max(0.05, i.length);
  const h = dt / 2;
  for (let k = 0; k < 2; k++) {
    const alpha =
      ((i.push - i.accel) * Math.cos(s.theta) -
        i.gravity * Math.sin(s.theta) -
        2 * i.lengthRate * s.omega) /
        L -
      i.damping * s.omega;
    s.omega += alpha * h;
    s.theta += s.omega * h;
  }
  if (s.theta > i.maxAngle) {
    s.theta = i.maxAngle;
    if (s.omega > 0) s.omega = 0;
  } else if (s.theta < -i.maxAngle) {
    s.theta = -i.maxAngle;
    if (s.omega < 0) s.omega = 0;
  }
  if (!Number.isFinite(s.theta) || !Number.isFinite(s.omega)) {
    s.theta = 0;
    s.omega = 0;
  }
};

/** Small-swing period of a pendulum of this length. */
export const swingPeriod = (length: number, gravity: number): number =>
  2 * Math.PI * Math.sqrt(Math.max(0.05, length) / gravity);

/**
 * How far the swing would carry, as an angle: the amplitude a free pendulum with this angle
 * and rate would reach. Zero means hanging still.
 */
export const swingAmplitude = (s: Swing, length: number, gravity: number): number => {
  const w = Math.sqrt(gravity / Math.max(0.05, length));
  return Math.hypot(s.theta, s.omega / w);
};
