/**
 * Turning the camera round a stage's shape: a finger dragged on the view swings it, as if
 * turning the shape by hand in ordinary 3D. It never changes the slice. Pure, in degrees.
 *
 * The camera's azimuth is an automatic part (a slow spin, or a fixed angle) plus the finger's
 * offset; elevation is limited so the view never flips. A while after the last drag the offset
 * and elevation ease home; a flick coasts.
 */

export const ORBIT = {
  elevation: 22,
  /** The 3D stage's camera stays above its floor. */
  minElevation: -70,
  maxElevation: 72,
  /** A drag across this many venue px turns the view this many degrees. */
  span: 1400,
  turn: 260,
  slop: 14,
  maxSpin: 220,
  coast: 0.35,
  returnAfter: 20,
  ease: 0.7,
  /** Degrees per second of the slow spin. */
  spinRate: 7,
} as const;

export interface Orbit {
  readonly offset: number;
  readonly elevation: number;
  /** True while a finger turns it, or it coasts or eases home. */
  readonly moving: boolean;
  begin(id: number, x: number, y: number, now: number): void;
  /** Returns true once the touch has become a drag. */
  move(id: number, x: number, y: number, now: number): boolean;
  /** Returns true for a tap (no drag). `vx` is venue px per second. */
  end(id: number, vx: number, now: number): boolean;
  step(dt: number, now: number): void;
  home(): void;
  setSpan(width: number): void;
  readonly holding: boolean;
}

const wrap180 = (a: number) => {
  let r = a % 360;
  if (r <= -180) r += 360;
  else if (r > 180) r -= 360;
  return r;
};

export const createOrbit = (
  width: number = ORBIT.span,
  minEl: number = ORBIT.minElevation,
): Orbit => {
  let offset = 0;
  let el: number = ORBIT.elevation;
  let spin = 0;
  let returning = false;
  let lastTurn = Number.NEGATIVE_INFINITY;
  let rate = ORBIT.turn / Math.min(width, ORBIT.span);
  let finger: {
    id: number;
    x0: number;
    y0: number;
    x: number;
    y: number;
    t0: number;
    drag: boolean;
  } | null = null;
  const clampEl = (e: number) => Math.min(ORBIT.maxElevation, Math.max(minEl, e));
  const away = () => Math.abs(offset) > 0.05 || Math.abs(el - ORBIT.elevation) > 0.05;

  return {
    get offset() {
      return offset;
    },
    get elevation() {
      return el;
    },
    get moving() {
      return finger?.drag === true || spin !== 0 || returning;
    },
    get holding() {
      return finger !== null;
    },
    begin(id, x, y, now) {
      finger = { id, x0: x, y0: y, x, y, t0: now, drag: false };
      spin = 0;
      returning = false;
      lastTurn = now;
    },
    move(id, x, y, now) {
      if (!finger || finger.id !== id) return false;
      if (!finger.drag && Math.hypot(x - finger.x0, y - finger.y0) >= ORBIT.slop) {
        finger.drag = true;
        finger.x = finger.x0;
        finger.y = finger.y0;
      }
      if (finger.drag) {
        offset = wrap180(offset - (x - finger.x) * rate);
        el = clampEl(el + (y - finger.y) * rate);
        lastTurn = now;
      }
      finger.x = x;
      finger.y = y;
      return finger.drag;
    },
    end(id, vx, now) {
      if (!finger || finger.id !== id) return false;
      const tap = !finger.drag && now - finger.t0 < 500;
      if (finger.drag) {
        spin = Math.max(-ORBIT.maxSpin, Math.min(ORBIT.maxSpin, -vx * rate));
        if (Math.abs(spin) < 20) spin = 0;
        lastTurn = now;
      }
      finger = null;
      return tap;
    },
    step(dt, now) {
      if (spin !== 0) {
        offset = wrap180(offset + spin * dt);
        spin *= Math.exp(-dt / ORBIT.coast);
        if (Math.abs(spin) < 2) spin = 0;
        lastTurn = now;
      }
      if (
        !finger &&
        spin === 0 &&
        !returning &&
        away() &&
        now - lastTurn > ORBIT.returnAfter * 1000
      ) {
        returning = true;
      }
      if (returning) {
        const k = 1 - Math.exp(-dt / ORBIT.ease);
        if (!away()) {
          offset = 0;
          el = ORBIT.elevation;
          returning = false;
        } else {
          offset = wrap180(offset - offset * k);
          el += (ORBIT.elevation - el) * k;
        }
      }
    },
    home() {
      finger = null;
      spin = 0;
      returning = away();
    },
    setSpan(w) {
      rate = ORBIT.turn / Math.min(Math.max(1, w), ORBIT.span);
    },
  };
};

/** The automatic azimuth: a slow spin from `seconds`, or a fixed angle. */
export const autoAzimuth = (spin: boolean, seconds: number): number =>
  spin ? -30 + ((seconds * ORBIT.spinRate) % 360) : -30;
