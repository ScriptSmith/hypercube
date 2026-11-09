/**
 * Turning the eye: a finger dragged on the eye (not a tap) turns it within limits, as if turning
 * a model in the hand, and it eases back to its usual angle a while after the last turn. A short
 * touch without a drag is a tap, which picks a part. Pure, in degrees.
 */

export const ORBIT = {
  azimuth: -12,
  elevation: 60,
  minAzimuth: -45,
  maxAzimuth: 45,
  minElevation: 22,
  maxElevation: 82,
  /** Degrees per venue px of drag. */
  rate: 0.12,
  /** Movement before a touch counts as a drag, venue px. */
  slop: 16,
  /** A touch shorter than this without a drag is a tap, ms. */
  tapMs: 600,
  /** Seconds after the last turn before the eye eases home, and the easing time. */
  returnAfter: 25,
  ease: 0.7,
} as const;

export interface Orbit {
  readonly azimuth: number;
  readonly elevation: number;
  readonly dragging: boolean;
  begin(id: number, x: number, y: number, now: number): void;
  move(id: number, x: number, y: number, now: number): void;
  /** Returns true for a tap. */
  end(id: number, now: number): boolean;
  step(dt: number, now: number): void;
  home(): void;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const createOrbit = (): Orbit => {
  let az: number = ORBIT.azimuth;
  let el: number = ORBIT.elevation;
  let last = Number.NEGATIVE_INFINITY;
  let returning = false;
  let finger: {
    id: number;
    x0: number;
    y0: number;
    x: number;
    y: number;
    t0: number;
    drag: boolean;
  } | null = null;
  return {
    get azimuth() {
      return az;
    },
    get elevation() {
      return el;
    },
    get dragging() {
      return finger?.drag === true;
    },
    begin(id, x, y, now) {
      finger = { id, x0: x, y0: y, x, y, t0: now, drag: false };
      returning = false;
      last = now;
    },
    move(id, x, y, now) {
      if (!finger || finger.id !== id) return;
      if (!finger.drag && Math.hypot(x - finger.x0, y - finger.y0) >= ORBIT.slop) {
        finger.drag = true;
        finger.x = finger.x0;
        finger.y = finger.y0;
      }
      if (finger.drag) {
        az = clamp(az - (x - finger.x) * ORBIT.rate, ORBIT.minAzimuth, ORBIT.maxAzimuth);
        el = clamp(el + (y - finger.y) * ORBIT.rate, ORBIT.minElevation, ORBIT.maxElevation);
        last = now;
      }
      finger.x = x;
      finger.y = y;
    },
    end(id, now) {
      if (!finger || finger.id !== id) return false;
      const tap = !finger.drag && now - finger.t0 < ORBIT.tapMs;
      finger = null;
      last = now;
      return tap;
    },
    step(dt, now) {
      const away = Math.abs(az - ORBIT.azimuth) > 0.05 || Math.abs(el - ORBIT.elevation) > 0.05;
      if (!finger && !returning && away && now - last > ORBIT.returnAfter * 1000) returning = true;
      if (!returning) return;
      const k = 1 - Math.exp(-dt / ORBIT.ease);
      az += (ORBIT.azimuth - az) * k;
      el += (ORBIT.elevation - el) * k;
      if (Math.abs(az - ORBIT.azimuth) < 0.05 && Math.abs(el - ORBIT.elevation) < 0.05) {
        az = ORBIT.azimuth;
        el = ORBIT.elevation;
        returning = false;
      }
    },
    home() {
      finger = null;
      returning = true;
    },
  };
};
