/**
 * The wash of the sea up the sand on the wall. Each wave runs up from the shore line and slides
 * back; now and then a big one runs right down to the balls' line, wets them and floats them a
 * little. The front's height in metres is `edgeAt(x)`, the same formula the beach shader uses,
 * so balls get wet exactly where the water is drawn.
 */
import type { Rng } from "../../core/types";

/** Seconds per ordinary wave, and how far down the sand it runs, metres. */
export const WAVE_PERIOD = [7, 11] as const;
export const WAVE_RUN = [0.12, 0.32] as const;
/** Seconds between big waves, and before the first. */
export const BIG_GAP = [90, 200] as const;
export const FIRST_BIG = [25, 50] as const;
const BIG_PERIOD = 13;
/** Share of a wave spent running up; the rest is the backwash. */
const UP_SHARE = 0.38;
/** How fast wet sand dries back up the beach, metres a second. */
export const DRY_RATE = 0.008;
/** Ripple of the front along the beach, metres. */
export const WOBBLE = 0.05;
/**
 * The ripple repeats every this many seconds, so the shader can be given time wrapped to it and
 * stay precise after days.
 */
export const WOBBLE_PERIOD = 600;
const W1 = (2 * Math.PI * 30) / WOBBLE_PERIOD;
const W2 = (2 * Math.PI * 16) / WOBBLE_PERIOD;

export interface SeaOptions {
  /** Where the wash normally reaches to, metres up the wall. */
  shore: number;
  /** The balls' sand line: a big wave runs just past it. */
  floor: number;
  /** Big waves on. */
  big: boolean;
}

export interface Sea {
  readonly time: number;
  /** Time wrapped to `WOBBLE_PERIOD`, for the shader. */
  readonly wrapped: number;
  /** The front's mean height now, metres. */
  readonly edge: number;
  /** The lowest the sand is still wet. */
  readonly wetTo: number;
  readonly big: boolean;
  readonly bigCount: number;
  /** Seconds until the next big wave. */
  readonly nextBig: number;
  edgeAt(x: number): number;
  step(dt: number): void;
  /** Send a big wave now. */
  surge(): void;
  setOptions(o: SeaOptions): void;
}

/** GLSL twin of `edgeAt`: the front's height given the mean edge, x and wrapped time. */
export const SEA_EDGE_GLSL = /* glsl */ `
float seaEdge(float edge, float x, float t) {
  return edge + ${WOBBLE.toFixed(4)} * (0.6 * sin(0.83 * x + ${W1.toFixed(7)} * t + 1.3)
    + 0.4 * sin(2.1 * x - ${W2.toFixed(7)} * t + 4.1));
}
`;

const wobble = (x: number, t: number) =>
  WOBBLE * (0.6 * Math.sin(0.83 * x + W1 * t + 1.3) + 0.4 * Math.sin(2.1 * x - W2 * t + 4.1));

const ease = (u: number) => 1 - (1 - u) * (1 - u);
const smooth = (u: number) => u * u * (3 - 2 * u);

export const createSea = (rng: Rng, initial: SeaOptions): Sea => {
  let opts = initial;
  let t = 0;
  let start = 0;
  let period = rng.range(WAVE_PERIOD[0], WAVE_PERIOD[1]);
  let run = rng.range(WAVE_RUN[0], WAVE_RUN[1]);
  let big = false;
  let bigCount = 0;
  let nextBig = rng.range(FIRST_BIG[0], FIRST_BIG[1]);
  let edge = opts.shore;
  let wetTo = opts.shore - run * 0.6;

  const newWave = () => {
    start = t;
    if (opts.big && t >= nextBig) {
      big = true;
      bigCount++;
      period = BIG_PERIOD;
      // Down past the balls' line, to a few centimetres off the bottom of the wall.
      run = opts.shore - Math.max(0.03, opts.floor - 0.1);
      nextBig = t + rng.range(BIG_GAP[0], BIG_GAP[1]);
    } else {
      big = false;
      period = rng.range(WAVE_PERIOD[0], WAVE_PERIOD[1]);
      run = rng.range(WAVE_RUN[0], WAVE_RUN[1]);
    }
  };

  const edgeNow = () => {
    const u = (t - start) / period;
    const depth = u < UP_SHARE ? ease(u / UP_SHARE) : 1 - smooth((u - UP_SHARE) / (1 - UP_SHARE));
    return opts.shore - run * depth;
  };

  return {
    get time() {
      return t;
    },
    get wrapped() {
      return t % WOBBLE_PERIOD;
    },
    get edge() {
      return edge;
    },
    get wetTo() {
      return wetTo;
    },
    get big() {
      return big;
    },
    get bigCount() {
      return bigCount;
    },
    get nextBig() {
      return opts.big ? nextBig - t : Infinity;
    },
    edgeAt: (x) => edge + wobble(x, t % WOBBLE_PERIOD),
    step(dt) {
      t += dt;
      if (t - start >= period) newWave();
      edge = edgeNow();
      wetTo = Math.min(wetTo + DRY_RATE * dt, edge - WOBBLE);
      wetTo = Math.min(wetTo, opts.shore);
    },
    surge() {
      nextBig = t;
      newWave();
    },
    setOptions(o) {
      opts = o;
    },
  };
};
