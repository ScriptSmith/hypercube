/**
 * Which stamp a tap places, and how often taps may place. Pointer ids die when a finger lifts, so
 * "the last swatch this finger touched" is remembered by place: a tap in the culture binds to the
 * nearest memory on its side of the frame (or starts one), and a later tap there places the same
 * stamp again. Tapping a swatch is a pick for its side: the next tap on that side takes it, so a
 * pick is never lost to a neighbour's older memory. Each memory also has a colour, so stamps from
 * different people look different and compete.
 */
export interface HandOptions {
  /** A tap binds to a memory within this distance (venue px). */
  radius: number;
  /** Memories unused for this long are forgotten. */
  ttlMs: number;
  /** At most this many memories; the least recently used goes first. */
  max: number;
  /** A swatch pick waits this long for its tap. */
  pickMs: number;
  /** One stamp per memory per this many ms. */
  perHandMs: number;
  /** At most this many stamps in any second, across the frame. */
  perSecond: number;
  /** The stamp a side places before anyone picks one. */
  fallback: string;
  /** Colours handed out to new memories, in turn. */
  colors: number;
}

export interface Memory {
  readonly id: number;
  x: number;
  y: number;
  readonly side: number;
  stamp: string;
  readonly color: number;
  usedAt: number;
  stampedAt: number;
}

export interface Hands {
  readonly list: readonly Memory[];
  pick(side: number, stamp: string, now: number): void;
  /** The stamp a side shows as selected. */
  current(side: number): string;
  /** A tap in the culture at (x, y) on `side`: the memory it belongs to. */
  bind(x: number, y: number, side: number, now: number): Memory;
  /** Whether this memory may place a stamp now; records the stamp if so. */
  allow(m: Memory, now: number): boolean;
  clear(): void;
}

const MAX_SIDES = 4;

export const createHands = (opts: HandOptions): Hands => {
  let list: Memory[] = [];
  let nextId = 1;
  let nextColor = 0;
  const pending: ({ stamp: string; until: number } | null)[] = Array.from(
    { length: MAX_SIDES },
    () => null,
  );
  const currents: string[] = Array.from({ length: MAX_SIDES }, () => opts.fallback);
  /** Times of the last `perSecond` stamps, oldest first. */
  const recent: number[] = [];
  const sideOf = (s: number) => Math.min(MAX_SIDES - 1, Math.max(0, Math.round(s)));

  const nearest = (x: number, y: number, side: number): Memory | null => {
    let best: Memory | null = null;
    let bestD = opts.radius;
    for (const m of list) {
      if (m.side !== side) continue;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d <= bestD) {
        best = m;
        bestD = d;
      }
    }
    return best;
  };

  return {
    get list() {
      return list;
    },

    pick(side, stamp, now) {
      const s = sideOf(side);
      pending[s] = { stamp, until: now + opts.pickMs };
      currents[s] = stamp;
    },

    current: (side) => currents[sideOf(side)] ?? opts.fallback,

    bind(x, y, side, now) {
      const s = sideOf(side);
      list = list.filter((m) => now - m.usedAt < opts.ttlMs);
      const p = pending[s];
      const picked = p && p.until > now ? p.stamp : null;
      pending[s] = null;
      let m = nearest(x, y, s);
      if (!m) {
        m = {
          id: nextId++,
          x,
          y,
          side: s,
          stamp: picked ?? currents[s] ?? opts.fallback,
          color: nextColor++ % Math.max(1, opts.colors),
          usedAt: now,
          stampedAt: -Infinity,
        };
        list.push(m);
        while (list.length > opts.max) {
          let oldest = 0;
          for (let i = 1; i < list.length; i++) {
            if ((list[i]?.usedAt ?? 0) < (list[oldest]?.usedAt ?? 0)) oldest = i;
          }
          list.splice(oldest, 1);
        }
      } else if (picked) {
        m.stamp = picked;
      }
      m.x = x;
      m.y = y;
      m.usedAt = now;
      return m;
    },

    allow(m, now) {
      if (now - m.stampedAt < opts.perHandMs) return false;
      while (recent.length > 0 && now - (recent[0] ?? 0) >= 1000) recent.shift();
      if (recent.length >= opts.perSecond) return false;
      recent.push(now);
      m.stampedAt = now;
      return true;
    },

    clear() {
      list = [];
      pending.fill(null);
      currents.fill(opts.fallback);
      recent.length = 0;
    },
  };
};

/** One event per `ms` (a pad's pipette refilling). */
export interface Limiter {
  ready(now: number): boolean;
  /** Fraction of the wait that has passed, 0 to 1. */
  fill(now: number): number;
  take(now: number): boolean;
  reset(): void;
}

export const createLimiter = (ms: number): Limiter => {
  let last = -Infinity;
  return {
    ready: (now) => now - last >= ms,
    fill: (now) => Math.min(1, Math.max(0, (now - last) / ms)),
    take(now) {
      if (now - last < ms) return false;
      last = now;
      return true;
    },
    reset() {
      last = -Infinity;
    },
  };
};
