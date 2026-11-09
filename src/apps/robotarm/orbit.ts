/**
 * Turning the view: a finger dragged on an arm's view (not on a control) swings that arm's
 * camera round the bench, as if turning the bench by hand. Pure, in degrees.
 *
 * Across turns the camera about the vertical, freely and with a little coast after a flick; up
 * and down tilts it between a low view and nearly straight down. A short touch without a drag
 * is a tap, not a turn. Some time after the last turn the view eases back to its usual angle,
 * and a reset sends it back at once (still eased).
 */

export const ORBIT = {
  azimuth: -36,
  elevation: 27,
  minElevation: 10,
  maxElevation: 78,
  /** A drag across this many venue px turns the view this many degrees. */
  span: 1400,
  turn: 240,
  /** Movement before a touch counts as a drag, venue px. */
  slop: 14,
  /** Coasting after a flick: top speed (degrees per second) and decay time (s). */
  maxSpin: 200,
  coast: 0.3,
  /** Seconds after the last turn before the view drifts home, and the easing time (s). */
  returnAfter: 20,
  ease: 0.6,
} as const;

export interface Orbit {
  readonly azimuth: number;
  readonly elevation: number;
  /** True while a finger turns it, it coasts or it eases home. */
  readonly moving: boolean;
  /** True when it is away from its usual angle. */
  readonly turned: boolean;
  /** A finger went down on the view. */
  begin(id: number, x: number, y: number, now: number): void;
  /** That finger moved; returns true once the touch has become a drag. */
  move(id: number, x: number, y: number, now: number): boolean;
  /** The finger lifted with a speed across (venue px per second). Returns true for a tap. */
  end(id: number, vx: number, now: number): boolean;
  /** Advance coasting and easing home; returns true when the angle changed. */
  step(dt: number, now: number): boolean;
  /** Ease back to the usual angle now. */
  home(): void;
  /** Lane width in venue px, which sets how far a drag turns. */
  setSpan(width: number): void;
}

const wrap180 = (a: number) => {
  let r = a % 360;
  if (r <= -180) r += 360;
  else if (r > 180) r -= 360;
  return r;
};

const clampEl = (e: number) => Math.min(ORBIT.maxElevation, Math.max(ORBIT.minElevation, e));

export const createOrbit = (width: number = ORBIT.span): Orbit => {
  let az: number = ORBIT.azimuth;
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

  const turned = () =>
    Math.abs(wrap180(az - ORBIT.azimuth)) > 0.05 || Math.abs(el - ORBIT.elevation) > 0.05;

  return {
    get azimuth() {
      return az;
    },
    get elevation() {
      return el;
    },
    get moving() {
      return finger?.drag === true || spin !== 0 || returning;
    },
    get turned() {
      return turned();
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
        // Count the drag from where the touch began, so the turn follows the whole drag.
        finger.drag = true;
        finger.x = finger.x0;
        finger.y = finger.y0;
      }
      if (finger.drag) {
        // Grab the bench: dragging right swings its near edge right, dragging down tips its top
        // towards you.
        az = wrap180(az - (x - finger.x) * rate);
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
      const before = az;
      const elBefore = el;
      if (spin !== 0) {
        az = wrap180(az + spin * dt);
        spin *= Math.exp(-dt / ORBIT.coast);
        if (Math.abs(spin) < 2) spin = 0;
        lastTurn = now;
      }
      if (
        !finger &&
        spin === 0 &&
        !returning &&
        turned() &&
        now - lastTurn > ORBIT.returnAfter * 1000
      ) {
        returning = true;
      }
      if (returning) {
        const k = 1 - Math.exp(-dt / ORBIT.ease);
        const da = wrap180(ORBIT.azimuth - az);
        const de = ORBIT.elevation - el;
        if (Math.abs(da) < 0.05 && Math.abs(de) < 0.05) {
          az = ORBIT.azimuth;
          el = ORBIT.elevation;
          returning = false;
        } else {
          az = wrap180(az + da * k);
          el = el + de * k;
        }
      }
      return az !== before || el !== elBefore;
    },
    home() {
      finger = null;
      spin = 0;
      returning = turned();
    },
    setSpan(w) {
      rate = ORBIT.turn / Math.min(Math.max(1, w), ORBIT.span);
    },
  };
};
