import { amps as ampsOf, type Drive, type Mode, type Point, Q, targets } from "./modes";

/**
 * What rings a plate: keys, glide strips, the attract tune and, on a bank's screen, the drives
 * the touch frames report. Each source is a small state machine with bounded storage; the plate
 * model turns the drives into mode amplitudes that rise and ring down smoothly.
 */

/** A tap rings its note this long; holding keeps it ringing. */
export const LATCH_MS = 4000;
/** The screen drops a drive it hasn't heard about for this long. */
export const REMOTE_TTL_MS = 1500;
/** Most remote drives the screen tracks at once. */
export const MAX_REMOTE = 64;
/** Ring-down time constant (s) at the default damping; it grows with Q, as a real plate's. */
export const FALL_S = 0.6;
/** Longest rise time constant: a light plate still answers a key promptly. */
export const RISE_MAX_S = 0.4;

/** How long the plate takes to ring down, as a time constant (s), for a quality factor. */
export const fallTime = (q: number): number => Math.min(1.5, Math.max(0.05, (FALL_S * q) / Q));
/** How long it takes to rise to a drive. */
export const riseTime = (q: number): number => Math.min(RISE_MAX_S, fallTime(q));
/** Most modes that move the sand at once (the shader's uniform arrays). */
export const MAX_ACTIVE = 8;
/** Below this a mode counts as still. */
export const AMP_FLOOR = 0.01;

interface KeyState {
  mode: number;
  /** Fingers (or bots) on it now. */
  held: number;
  /** It rings at least until then (ms). */
  until: number;
  /** Press count, for status. */
  presses: number;
}

export interface Keys {
  /** A finger goes down on key `key` (which plays `mode`). */
  press(key: number, mode: number, now: number): void;
  release(key: number, now: number): void;
  /** Is the key driving the plate now? */
  ringing(key: number, now: number): boolean;
  /** Keys driving the plate now, with their modes. */
  active(now: number): { key: number; mode: number }[];
  /** Presses since the last clear. */
  readonly presses: number;
  clear(): void;
}

export const createKeys = (latchMs = LATCH_MS): Keys => {
  const keys = new Map<number, KeyState>();
  let presses = 0;
  const on = (k: KeyState, now: number) => k.held > 0 || now < k.until;
  return {
    press(key, mode, now) {
      let k = keys.get(key);
      if (!k) {
        if (keys.size >= 32) keys.clear();
        k = { mode, held: 0, until: 0, presses: 0 };
        keys.set(key, k);
      }
      k.mode = mode;
      k.held = Math.min(10, k.held + 1);
      k.until = now + latchMs;
      k.presses++;
      presses++;
    },
    release(key, now) {
      const k = keys.get(key);
      if (!k || k.held === 0) return;
      k.held--;
      if (k.held === 0) k.until = Math.max(k.until, now);
    },
    ringing(key, now) {
      const k = keys.get(key);
      return k ? on(k, now) : false;
    },
    active(now) {
      const out: { key: number; mode: number }[] = [];
      for (const [key, k] of keys) if (on(k, now)) out.push({ key, mode: k.mode });
      return out;
    },
    get presses() {
      return presses;
    },
    clear() {
      keys.clear();
    },
  };
};

/** Glide strips: each drives the plate at its frequency while a finger holds it. */
export interface Glides {
  set(strip: number, freq: number | null): void;
  freq(strip: number): number | null;
  active(): { strip: number; freq: number }[];
  clear(): void;
}

export const createGlides = (): Glides => {
  const held = new Map<number, number>();
  return {
    set(strip, freq) {
      if (freq === null || !Number.isFinite(freq) || freq <= 0) held.delete(strip);
      else if (held.size < 16 || held.has(strip)) held.set(strip, freq);
    },
    freq(strip) {
      return held.get(strip) ?? null;
    },
    active() {
      return [...held].map(([strip, freq]) => ({ strip, freq }));
    },
    clear() {
      held.clear();
    },
  };
};

/**
 * Drives reported by other frames (the screen's view of a bank). A drive stays on until its
 * frame says it stopped, or until nothing about it arrives for `ttl`, so a frame that vanishes
 * never leaves the plate ringing.
 */
export interface Remote {
  note(from: string, key: number, mode: number, on: boolean, now: number): void;
  glide(from: string, strip: number, freq: number, on: boolean, now: number): void;
  /** Drop drives from a frame at once (it left the roster). */
  forget(from: string): void;
  drives(now: number): Drive[];
  /** Live drives, after expiry. */
  size(now: number): number;
  /** When the last drive arrived (ms), or -Infinity. */
  readonly lastAt: number;
  clear(): void;
}

interface RemoteDrive {
  from: string;
  drive: Drive;
  at: number;
}

export const createRemote = (ttl = REMOTE_TTL_MS, max = MAX_REMOTE): Remote => {
  const map = new Map<string, RemoteDrive>();
  let lastAt = Number.NEGATIVE_INFINITY;
  const expire = (now: number) => {
    for (const [id, d] of map) if (now - d.at > ttl) map.delete(id);
  };
  const put = (id: string, d: RemoteDrive | null) => {
    if (!d) {
      map.delete(id);
      return;
    }
    map.delete(id);
    map.set(id, d);
    while (map.size > max) {
      const first = map.keys().next().value;
      if (first === undefined) break;
      map.delete(first);
    }
  };
  return {
    note(from, key, mode, on, now) {
      lastAt = now;
      const id = `${from}|k${key}`;
      put(id, on ? { from, drive: { kind: "key", mode, freq: 0, level: 1 }, at: now } : null);
    },
    glide(from, strip, freq, on, now) {
      lastAt = now;
      const id = `${from}|g${strip}`;
      put(id, on ? { from, drive: { kind: "glide", mode: -1, freq, level: 1 }, at: now } : null);
    },
    forget(from) {
      for (const [id, d] of map) if (d.from === from) map.delete(id);
    },
    drives(now) {
      expire(now);
      return [...map.values()].map((d) => d.drive);
    },
    size(now) {
      expire(now);
      return map.size;
    },
    get lastAt() {
      return lastAt;
    },
    clear() {
      map.clear();
    },
  };
};

/**
 * One plate's motion: the amplitude and phase of every mode, chasing the target that the drives,
 * the drive point and the fingers on the plate set, rising and ringing down with time constants
 * that follow the damping.
 */
export interface PlateMotion {
  /** In-step and quarter-cycle parts of each mode's amplitude. */
  readonly re: Float64Array;
  readonly im: Float64Array;
  /** Each mode's amplitude (the size of re and im), after the last update. */
  readonly amps: Float64Array;
  update(
    dt: number,
    modes: readonly Mode[],
    drives: readonly Drive[],
    at: Point,
    points: readonly Point[],
    q: number,
  ): void;
  /** Overall amplitude, the root of the summed squares. */
  level(): number;
  /** The strongest modes, at most MAX_ACTIVE, strongest first. */
  active(max?: number): number[];
  /** The strongest mode, or -1 when the plate is still. */
  strongest(): number;
  /** Stop at once. */
  still(): void;
}

export const createMotion = (count: number): PlateMotion => {
  const re = new Float64Array(count);
  const im = new Float64Array(count);
  const amps = new Float64Array(count);
  const goal = ampsOf(count);
  const order: number[] = Array.from({ length: count }, (_, i) => i);
  return {
    re,
    im,
    amps,
    update(dt, modes, drives, at, points, q) {
      targets(modes, drives, at, points, q, goal);
      const up = 1 - Math.exp(-dt / riseTime(q));
      const down = 1 - Math.exp(-dt / fallTime(q));
      for (let i = 0; i < count; i++) {
        const gr = goal.re[i]!;
        const gi = goal.im[i]!;
        const k = Math.hypot(gr, gi) > amps[i]! ? up : down;
        let r = re[i]! + (gr - re[i]!) * k;
        let m = im[i]! + (gi - im[i]!) * k;
        if (gr === 0 && gi === 0 && Math.hypot(r, m) < 1e-4) {
          r = 0;
          m = 0;
        }
        re[i] = r;
        im[i] = m;
        amps[i] = Math.hypot(r, m);
      }
    },
    level() {
      let s = 0;
      for (const a of amps) s += a * a;
      return Math.sqrt(s);
    },
    active(max = MAX_ACTIVE) {
      order.sort((a, b) => amps[b]! - amps[a]!);
      const out: number[] = [];
      for (const i of order) {
        if (out.length >= max || amps[i]! < AMP_FLOOR) break;
        out.push(i);
      }
      return out;
    },
    strongest() {
      let best = -1;
      let at = AMP_FLOOR * 5;
      amps.forEach((a, i) => {
        if (a > at) {
          at = a;
          best = i;
        }
      });
      return best;
    },
    still() {
      re.fill(0);
      im.fill(0);
      amps.fill(0);
    },
  };
};

/**
 * How hard the plate drives the sand, 0 to 1, from its overall level: nothing moves until the
 * plate shakes hard enough to lift a grain, as on a real plate where the sand only jumps once
 * the plate's acceleration beats gravity. Between two resonances the level stays below the lift.
 */
export const LIFT_FROM = 0.4;
export const LIFT_FULL = 0.7;
export const lift = (level: number): number => {
  const t = Math.min(1, Math.max(0, (level - LIFT_FROM) / (LIFT_FULL - LIFT_FROM)));
  return t * t * (3 - 2 * t);
};
