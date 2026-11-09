/**
 * Stroking the wall, and the eye's contentment when it is stroked.
 *
 * A stroke is a finger moving steadily over the wall for most of a second or more: back and
 * forth, along it, or the same way again and again with lifts between. A tap isn't, a still
 * finger isn't, and nor is the jitter of a finger held still on an imprecise touch frame.
 * Strokes count anywhere on the wall and on the lids, but not over the open eye: the whole wall
 * is the eye's skin, most of the eye is above a child's reach, and nobody enjoys a finger on
 * the eye itself. Everyone's strokes add up, so one person stroking while others tap is enough.
 *
 * While it is stroked the eye grows content over a couple of seconds, like a cat being petted:
 * it rolls slowly up, the lids grow heavy and blink slowly, and the pupil widens a little. When
 * the stroking stops it lingers a moment, then comes back. A touch on the eye startles it out at
 * once. Someone new touching draws a peek from under the heavy lids before it settles back.
 * Deterministic from the calls it is given.
 */
import { DEG } from "../../core/sphere";

export const PET = {
  /** Movement shorter than this from the last counted point is jitter, metres. */
  jitter: 0.02,
  /** The most a finger's movement counts for, metres a second: a fling is no nicer than a stroke. */
  fastest: 2.5,
  /**
   * Movement past that is counted over the following steps, up to this many seconds' worth, so
   * a slow page's moves, which arrive a frame's worth at a time, count in full.
   */
  carry: 0.25,
  /** How quickly the stroking energy (metres stroked lately) fades, seconds. */
  tau: 0.5,
  /** Energy to count as stroking (a steady 0.2 m/s or so), and below which it stops, metres. */
  on: 0.1,
  off: 0.05,
  /**
   * Seconds of moving fingers before the eye responds; pauses shorter than `gap` (a lift
   * between strokes) don't break it.
   */
  sustain: 0.7,
  gap: 0.5,
  /** Seconds to grow fully content, to wait once the stroking stops, and to come back. */
  rise: 2.2,
  linger: 0.8,
  fall: 2.4,
  /** A startle drops contentment to nothing over this long, seconds. */
  startle: 0.15,
  /** Contentment above which someone new draws a peek. */
  peekFrom: 0.3,
  /** A peek: seconds turning to them, looking, and settling back; and how far it turns. */
  peekIn: 0.15,
  peekHold: 0.9,
  peekOut: 0.7,
  peekMost: 0.85,
  /** Most fingers it keeps track of; the oldest go first. */
  pointers: 24,
};

/**
 * The eye's pose while content: rolled up by `up`, swaying slowly from side to side by `sway`
 * and up and down by `bob` (radians), over `swayPeriod` and `bobPeriod` seconds. The lids'
 * droop and the lower lid's rise, the widening of the pupil (mm), and the slow blink are in
 * `lids.ts` and the wall.
 */
export const BLISS = {
  up: 20 * DEG,
  sway: 9 * DEG,
  bob: 2.5 * DEG,
  swayPeriod: 8.3,
  bobPeriod: 5.9,
  pupil: 0.6,
};

interface Finger {
  x: number;
  y: number;
  /** Counted metres since the last step. */
  pending: number;
  seen: number;
}

export interface Petting {
  /** How content, 0 to 1, rising and falling steadily. */
  readonly level: number;
  /** The same, eased, for the eye's pose. */
  readonly content: number;
  /** Whether it counts as being stroked now. */
  readonly stroking: boolean;
  /** Metres stroked lately, fading. */
  readonly energy: number;
  /** How far a peek has turned the eye, 0 to 1. */
  readonly peek: number;
  /** Times it has grown content. */
  readonly episodes: number;
  readonly fingers: number;
  down(id: number, x: number, y: number): void;
  /** A finger moved to `x`, `y` (metres on the wall); `counts` is false over the open eye. */
  move(id: number, x: number, y: number, counts: boolean): void;
  up(id: number): void;
  step(dt: number): void;
  /** Something touched the eye. */
  startle(): void;
  /** Someone new touched; it peeks if content enough. */
  newcomer(): void;
  /** Forget every finger and calm down at once. */
  release(): void;
}

const ease = (x: number) => x * x * (3 - 2 * x);

/** The pose's offsets from level and straight out at time `t`, radians: elevation and bearing. */
export const blissPose = (t: number): { elevation: number; bearing: number } => ({
  elevation: BLISS.up + BLISS.bob * Math.sin((2 * Math.PI * t) / BLISS.bobPeriod),
  bearing: BLISS.sway * Math.sin((2 * Math.PI * t) / BLISS.swayPeriod + 0.7),
});

export const createPetting = (): Petting => {
  const fingers = new Map<number, Finger>();
  let time = 0;
  let energy = 0;
  let active = false;
  let strokeFor = 0;
  let lastMove = -Infinity;
  let since = Infinity;
  let level = 0;
  let startled = false;
  let peekT = Infinity;
  let episodes = 0;

  const stroking = () => strokeFor >= PET.sustain && time - lastMove <= PET.gap && active;

  return {
    get level() {
      return level;
    },
    get content() {
      return ease(level);
    },
    get stroking() {
      return stroking();
    },
    get energy() {
      return energy;
    },
    get peek() {
      const t = peekT;
      if (t < PET.peekIn) return ease(t / PET.peekIn);
      if (t < PET.peekIn + PET.peekHold) return 1;
      const out = (t - PET.peekIn - PET.peekHold) / PET.peekOut;
      return out < 1 ? 1 - ease(out) : 0;
    },
    get episodes() {
      return episodes;
    },
    get fingers() {
      return fingers.size;
    },
    down(id, x, y) {
      if (!fingers.has(id) && fingers.size >= PET.pointers) {
        let oldest: number | null = null;
        let seen = Infinity;
        for (const [k, f] of fingers) {
          if (f.seen < seen) {
            seen = f.seen;
            oldest = k;
          }
        }
        if (oldest !== null) fingers.delete(oldest);
      }
      fingers.set(id, { x, y, pending: 0, seen: time });
    },
    move(id, x, y, counts) {
      const f = fingers.get(id);
      if (!f) return;
      const d = Math.hypot(x - f.x, y - f.y);
      if (d < PET.jitter) return;
      if (counts) f.pending += d;
      f.x = x;
      f.y = y;
      f.seen = time;
    },
    up(id) {
      fingers.delete(id);
    },
    step(dt) {
      time += dt;
      energy *= Math.exp(-dt / PET.tau);
      let moved = 0;
      for (const f of fingers.values()) {
        const use = Math.min(f.pending, PET.fastest * dt);
        moved += use;
        f.pending = Math.min(f.pending - use, PET.fastest * PET.carry);
      }
      if (!startled) energy += moved;
      if (energy > PET.on) active = true;
      else if (energy < PET.off) active = false;
      // Only time with fingers moving counts towards a stroke, so a flick's fading energy doesn't.
      if (moved > 1e-9 && !startled) {
        // A slow finger's moves come every few frames, past the jitter; count the time between.
        if (active) strokeFor += time - lastMove <= PET.gap ? time - lastMove : dt;
        lastMove = time;
      } else if (time - lastMove > PET.gap) strokeFor = 0;
      peekT += dt;
      const before = level;
      if (startled) {
        level = Math.max(0, level - dt / PET.startle);
        if (level === 0) startled = false;
      } else if (stroking()) {
        since = 0;
        level = Math.min(1, level + dt / PET.rise);
      } else {
        since += dt;
        if (since > PET.linger) level = Math.max(0, level - dt / PET.fall);
      }
      if (before < 0.5 && level >= 0.5) episodes++;
    },
    startle() {
      startled = level > 0;
      energy = 0;
      strokeFor = 0;
      active = false;
      lastMove = -Infinity;
      peekT = Infinity;
    },
    newcomer() {
      if (ease(level) > PET.peekFrom && peekT > PET.peekIn + PET.peekHold) peekT = 0;
    },
    release() {
      fingers.clear();
      energy = 0;
      active = false;
      strokeFor = 0;
      lastMove = -Infinity;
      level = 0;
      startled = false;
      peekT = Infinity;
    },
  };
};
