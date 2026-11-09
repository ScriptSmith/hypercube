/**
 * The screen's view of the touch frames below it: a short ring of `kite` messages per frame, read
 * back at a moment a little behind the shared clock so there is nearly always a newer message to
 * move towards. How far behind (`delay`) follows how late messages arrive; the screen tells the
 * frames, which draw the lower ends of their lines at the same moment so the two halves join.
 *
 * A frame that stops sending is reeled in and faded from DROP_MS after its last message, then
 * dropped.
 */
import { DROP_MS, FADE_MS, KITE_HZ } from "./config";
import { MAX_POS, type KiteMsg, type WireKite } from "./wire";

export const MAX_FRAMES = MAX_POS;
const SAMPLES = 12;
/** Without a newer message, kites are carried on for at most this long. */
const EXTRAPOLATE_MS = 150;
/** The delay never goes below this, nor above MAX. */
export const MIN_DELAY = 100;
export const MAX_DELAY_MS = 1500;
/**
 * How fast the delay grows, ms a second. Under 1000, so the moment drawn only slows while it
 * grows: faster and every kite on the screen would step backwards.
 */
const RISE = 600;
/** A sender clock that jumps back this far means the frame reloaded. */
const RESTART_MS = 2000;

interface Sample {
  t: number;
  kites: WireKite[];
}

export interface RemoteFrame {
  readonly frame: string;
  pos: number;
  count: number;
  /** Local ms of the last message. */
  heard: number;
  samples: Sample[];
  head: number;
  n: number;
}

export interface KitePose extends WireKite {
  /** 1 normally, falling to 0 while the frame fades out. */
  alpha: number;
}

const copyKite = (k: WireKite, out: KitePose, alpha: number): KitePose => {
  out.slot = k.slot;
  out.u = k.u;
  out.u2 = k.u2;
  out.x = k.x;
  out.y = k.y;
  out.spin = k.spin;
  out.tension = k.tension;
  out.flags = k.flags;
  out.color = k.color;
  out.shape = k.shape;
  out.alpha = alpha;
  return out;
};

const lerpAngle = (a: number, b: number, f: number) => {
  let d = b - a;
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * f;
};

export const blankPose = (): KitePose => ({
  slot: 0,
  u: 0,
  u2: 0,
  x: 0,
  y: 0,
  spin: 0,
  tension: 0,
  flags: 0,
  color: 0,
  shape: 0,
  alpha: 1,
});

export interface Fleet {
  /** Take a message from `from`. `now` is local ms and `clock` the shared clock, both now. */
  accept(msg: KiteMsg, from: string, now: number, clock: number): RemoteFrame | null;
  /** Drop frames gone for DROP_MS + FADE_MS; returns how many went. */
  prune(now: number): number;
  /**
   * Poses of a frame's kites at shared time `at`, into `out` (resized). `now` (local ms) drives
   * the fade. Returns how many.
   */
  poses(r: RemoteFrame, at: number, now: number, out: KitePose[]): number;
  frames(): IterableIterator<RemoteFrame>;
  readonly size: number;
  /** Ms behind the shared clock to draw at. */
  readonly delay: number;
  /** Ease the delay towards what recent lateness asks for; `dt` in seconds. */
  tick(dt: number): void;
  clear(): void;
}

export const createFleet = (): Fleet => {
  const byFrame = new Map<string, RemoteFrame>();
  let delay = MIN_DELAY + 60;
  /** The latest lateness seen, decaying slowly. */
  let peak = 0;

  const sampleAt = (r: RemoteFrame, back: number): Sample | null =>
    back < r.n ? r.samples[(r.head - back + SAMPLES) % SAMPLES]! : null;

  return {
    accept(m, from, now, clock) {
      let r = byFrame.get(from);
      if (!r) {
        if (byFrame.size >= MAX_FRAMES) return null;
        r = {
          frame: from,
          pos: m.pos,
          count: m.count,
          heard: now,
          samples: Array.from({ length: SAMPLES }, () => ({ t: 0, kites: [] })),
          head: 0,
          n: 0,
        };
        byFrame.set(from, r);
      }
      const newest = sampleAt(r, 0);
      if (newest && m.t < newest.t - RESTART_MS) r.n = 0;
      else if (newest && r.n > 0 && m.t <= newest.t) return r;
      r.pos = m.pos;
      r.count = m.count;
      r.heard = now;
      r.head = (r.head + 1) % SAMPLES;
      r.n = Math.min(SAMPLES, r.n + 1);
      const s = r.samples[r.head]!;
      s.t = m.t;
      s.kites = m.kites;
      const late = clock - m.t;
      if (Number.isFinite(late)) peak = Math.max(peak, Math.min(MAX_DELAY_MS, Math.max(0, late)));
      return r;
    },
    prune(now) {
      let n = 0;
      for (const [frame, r] of byFrame) {
        if (now - r.heard > DROP_MS + FADE_MS) {
          byFrame.delete(frame);
          n++;
        }
      }
      return n;
    },
    poses(r, at, now, out) {
      if (r.n === 0) {
        out.length = 0;
        return 0;
      }
      const gone = now - r.heard - DROP_MS;
      const alpha = gone <= 0 ? 1 : Math.max(0, 1 - gone / FADE_MS);
      let older: Sample | null = null;
      let newer: Sample | null = null;
      for (let back = 0; back < r.n; back++) {
        const s = sampleAt(r, back)!;
        if (s.t <= at) {
          older = s;
          break;
        }
        newer = s;
      }
      let base = older ?? newer!;
      let next: Sample | null = older ? newer : null;
      let f = 0;
      if (older && newer && newer.t > older.t) {
        f = (at - older.t) / (newer.t - older.t);
      } else if (older && !newer) {
        // Past the newest message: carry on along the last two, briefly.
        const prev = sampleAt(r, 1);
        if (prev && older.t > prev.t) {
          base = prev;
          next = older;
          f = (Math.min(at, older.t + EXTRAPOLATE_MS) - prev.t) / (older.t - prev.t);
        }
      }
      while (out.length < base.kites.length) out.push(blankPose());
      out.length = base.kites.length;
      for (let i = 0; i < base.kites.length; i++) {
        const a = base.kites[i]!;
        const p = copyKite(a, out[i]!, alpha);
        const b = next?.kites.find((k) => k.slot === a.slot);
        if (b && next !== base) {
          p.x = a.x + (b.x - a.x) * f;
          p.y = a.y + (b.y - a.y) * f;
          p.u = a.u + (b.u - a.u) * f;
          p.u2 = a.u2 + (b.u2 - a.u2) * f;
          p.spin = lerpAngle(a.spin, b.spin, f);
          p.tension = a.tension + (b.tension - a.tension) * f;
          if (f > 0.5) p.flags = b.flags;
        }
      }
      return out.length;
    },
    frames() {
      return byFrame.values();
    },
    get size() {
      return byFrame.size;
    },
    get delay() {
      return delay;
    },
    tick(dt) {
      const want = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY, peak + 1000 / KITE_HZ + 30));
      if (want > delay) delay = Math.min(want, delay + RISE * dt);
      else delay = Math.max(want, delay - 40 * dt);
      peak = Math.max(0, peak - 25 * dt);
    },
    clear() {
      byFrame.clear();
    },
  };
};
