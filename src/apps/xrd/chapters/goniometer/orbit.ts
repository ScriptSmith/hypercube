/**
 * Turning chapter 5's view: a finger dragged on the machine swings the camera round it, within
 * limits, and some time after the last drag the view eases home. Pure, in degrees.
 */
export const VIEW = {
  azimuth: -28,
  elevation: 20,
  minAzimuth: -85,
  maxAzimuth: 35,
  minElevation: 4,
  maxElevation: 62,
  /** Degrees per venue px dragged. */
  perPx: 0.22,
  /** Seconds after the last drag before it eases home, and the easing time constant. */
  returnAfter: 20,
  ease: 0.8,
} as const;

export interface Orbit {
  readonly azimuth: number;
  readonly elevation: number;
  begin(x: number, y: number, now: number): void;
  move(x: number, y: number, now: number): void;
  step(dt: number, now: number): void;
  home(): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const createOrbit = (): Orbit => {
  let az: number = VIEW.azimuth;
  let el: number = VIEW.elevation;
  let last: { x: number; y: number } | null = null;
  let movedAt = Number.NEGATIVE_INFINITY;
  return {
    get azimuth() {
      return az;
    },
    get elevation() {
      return el;
    },
    begin(x, y, now) {
      last = { x, y };
      movedAt = now;
    },
    move(x, y, now) {
      if (!last) return;
      az = clamp(az - (x - last.x) * VIEW.perPx, VIEW.minAzimuth, VIEW.maxAzimuth);
      el = clamp(el + (y - last.y) * VIEW.perPx, VIEW.minElevation, VIEW.maxElevation);
      last = { x, y };
      movedAt = now;
    },
    step(dt, now) {
      if (now - movedAt < VIEW.returnAfter * 1000) return;
      const k = 1 - Math.exp(-dt / VIEW.ease);
      az += (VIEW.azimuth - az) * k;
      el += (VIEW.elevation - el) * k;
    },
    home() {
      movedAt = Number.NEGATIVE_INFINITY;
    },
  };
};
