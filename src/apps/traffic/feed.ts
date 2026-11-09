/**
 * The snapshots a frame has heard, and the cars at any shared time between them. Frames draw
 * `delay` ms behind the clock, so there is normally a snapshot on either side of the time drawn
 * and every frame in the bank shows each car in the same place at the same moment, which keeps
 * cars whole as they cross from one frame to the next. Past the newest snapshot cars carry on at
 * their speed for a while, then wait.
 */
import { TIME_SCALE } from "./config";
import type { SnapMsg, WireCar } from "./wire";

/** Ring buffer size: two seconds at the host's rate. */
const SIZE = 48;
/** How far past the newest snapshot cars keep moving, real ms. */
export const EXTRAPOLATE_MS = 1500;

export interface Feed {
  push(snap: SnapMsg, from: string): void;
  readonly latest: SnapMsg | null;
  readonly from: string | null;
  /** Local ms when the latest snapshot arrived. */
  readonly heardAt: number;
  /** Cars at shared time `t` into `out`. False if nothing is held. */
  at(t: number, out: WireCar[]): boolean;
  /** Forget everything newer than `t` (another host's future, when the host changes). */
  dropAfter(t: number): void;
  clear(): void;
  readonly size: number;
}

export const createFeed = (now: () => number = () => performance.now()): Feed => {
  const pool: WireCar[] = [];
  const take = (i: number): WireCar => {
    let c = pool[i];
    if (!c) {
      c = { id: 0, x: 0, v: 0, flags: 0 };
      pool[i] = c;
    }
    return c;
  };
  const snaps: (SnapMsg | null)[] = Array.from({ length: SIZE }, () => null);
  let head = -1;
  let n = 0;
  let from: string | null = null;
  let heardAt = Number.NEGATIVE_INFINITY;
  const index = new Map<number, number>();

  const get = (back: number): SnapMsg | null =>
    back < n ? snaps[(head - back + SIZE * 2) % SIZE]! : null;

  const copyInto = (s: SnapMsg, dt: number, out: WireCar[]) => {
    out.length = 0;
    const k = (Math.min(EXTRAPOLATE_MS, Math.max(0, dt)) / 1000) * TIME_SCALE;
    s.cars.forEach((c, i) => {
      const o = take(i);
      o.id = c.id;
      o.v = c.v;
      o.flags = c.flags;
      let x = c.x + c.v * k;
      if (x >= s.length) x -= s.length;
      o.x = x;
      out.push(o);
    });
  };

  const dropAfter = (t: number) => {
    while (n > 0 && get(0)!.t > t) {
      snaps[head] = null;
      head = (head - 1 + SIZE) % SIZE;
      n--;
    }
  };

  return {
    push(snap, sender) {
      const last = get(0);
      if (last && snap.t <= last.t) {
        // A late or repeated snapshot from the same host adds nothing; a new host's replaces
        // whatever the old one said about the same moments.
        if (sender === from) return;
        dropAfter(snap.t - 1e-3);
      }
      head = (head + 1) % SIZE;
      n = Math.min(SIZE, n + 1);
      snaps[head] = snap;
      from = sender;
      heardAt = now();
    },
    get latest() {
      return get(0);
    },
    get from() {
      return from;
    },
    get heardAt() {
      return heardAt;
    },
    get size() {
      return n;
    },
    at(t, out) {
      const newest = get(0);
      if (!newest) return false;
      if (t >= newest.t) {
        copyInto(newest, t - newest.t, out);
        return true;
      }
      let b = newest;
      for (let back = 1; back < n; back++) {
        const a = get(back)!;
        if (a.t <= t) {
          const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
          index.clear();
          a.cars.forEach((c, i) => index.set(c.id, i));
          out.length = 0;
          const L = b.length;
          const scale = a.length > 0 && a.length !== L ? L / a.length : 1;
          b.cars.forEach((cb, i) => {
            const o = take(i);
            o.id = cb.id;
            const ia = index.get(cb.id);
            if (ia === undefined) {
              o.x = cb.x;
              o.v = cb.v;
              o.flags = cb.flags;
            } else {
              const ca = a.cars[ia]!;
              const xa = ca.x * scale;
              let d = cb.x - xa;
              if (d < -L / 2) d += L;
              else if (d > L / 2) d -= L;
              let x = xa + d * f;
              if (x < 0) x += L;
              else if (x >= L) x -= L;
              o.x = x;
              o.v = ca.v + (cb.v - ca.v) * f;
              o.flags = f < 0.5 ? ca.flags : cb.flags;
            }
            out.push(o);
          });
          return true;
        }
        b = a;
      }
      // Older than anything held: the oldest, as it was.
      copyInto(b, 0, out);
      return true;
    },
    dropAfter,
    clear() {
      snaps.fill(null);
      n = 0;
      head = -1;
      from = null;
      heardAt = Number.NEGATIVE_INFINITY;
    },
  };
};
