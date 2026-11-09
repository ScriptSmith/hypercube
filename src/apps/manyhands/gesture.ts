/**
 * Gestures for bots and the attract ghost. A gesture says where each finger is at a given time
 * since it began; the player turns that into down, move and up calls on a sink. In the app the
 * sink injects real pointer events through `ctx.input.inject`, so bots take the same path as
 * fingers; in unit tests it calls a task directly. Coordinates are a slot's own venue px.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Finger positions; a null entry is a finger that is up. */
export type Fingers = readonly (Pt | null)[];

export interface Gesture {
  /** Fingers `ms` after the gesture began, or null when it is over. */
  at(ms: number): Fingers | null;
}

export interface Sink {
  down(x: number, y: number): number;
  move(id: number, x: number, y: number): void;
  up(id: number): void;
}

/** A finger down long enough to register, then up. */
export const tap = (p: Pt, ms = 90): Gesture => ({
  at: (t) => (t < ms ? [p] : null),
});

/** Fingers held still for `ms`. */
export const hold = (points: readonly Pt[], ms: number): Gesture => ({
  at: (t) => (t < ms ? points : null),
});

/** Nothing for `ms`. */
export const pause = (ms: number): Gesture => ({
  at: (t) => (t < ms ? [] : null),
});

/** Press at the first point, travel along the path at an even speed over `ms`, then lift. */
export const drag = (path: readonly Pt[], ms: number, settle = 70): Gesture => {
  const lengths = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    lengths.push(lengths[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = lengths[lengths.length - 1] ?? 0;
  const pointAt = (d: number): Pt => {
    let i = 1;
    while (i < path.length - 1 && lengths[i]! < d) i++;
    const a = path[Math.max(0, i - 1)]!;
    const b = path[Math.min(path.length - 1, i)]!;
    const span = lengths[i]! - lengths[i - 1]!;
    const f = span > 0 ? Math.min(1, Math.max(0, (d - lengths[i - 1]!) / span)) : 1;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
  return {
    at(t) {
      if (path.length === 0 || t > settle + ms + settle) return null;
      if (t < settle) return [path[0]!];
      const f = Math.min(1, (t - settle) / Math.max(1, ms));
      return [pointAt(total * f)];
    },
  };
};

/**
 * Press at `start` and keep moving towards `target()` at up to `speed` px per second, lifting
 * when it returns null or after `limit` ms.
 */
export const follow = (
  start: Pt,
  target: () => Pt | null,
  speed: number,
  limit = 30_000,
): Gesture => {
  const p = { x: start.x, y: start.y };
  let last = 0;
  return {
    at(t) {
      if (t >= limit) return null;
      const to = target();
      if (!to) return null;
      const dt = Math.max(0, t - last) / 1000;
      last = t;
      const dx = to.x - p.x;
      const dy = to.y - p.y;
      const d = Math.hypot(dx, dy);
      const step = speed * dt;
      if (d <= step) {
        p.x = to.x;
        p.y = to.y;
      } else if (d > 0) {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
      return [{ x: p.x, y: p.y }];
    },
  };
};

/** One gesture after another. */
export const chain = (parts: readonly Gesture[]): Gesture => {
  let i = 0;
  let offset = 0;
  return {
    at(t) {
      while (i < parts.length) {
        const f = parts[i]!.at(t - offset);
        if (f) return f;
        i++;
        offset = t;
      }
      return null;
    },
  };
};

export interface Player {
  readonly busy: boolean;
  /** Where the fingers are now, for drawing a ghost hand. */
  readonly fingers: Fingers;
  start(g: Gesture, now: number): void;
  /** Advance to `now`. Returns true while the gesture runs. */
  update(now: number): boolean;
  /** Lift every finger and drop the gesture. */
  cancel(): void;
}

const MAX_FINGERS = 4;

export const createPlayer = (sink: Sink): Player => {
  let gesture: Gesture | null = null;
  let t0 = 0;
  const ids: (number | null)[] = [];
  const pos: (Pt | null)[] = [];

  const lift = (i: number) => {
    const id = ids[i];
    if (id !== null && id !== undefined) sink.up(id);
    ids[i] = null;
    pos[i] = null;
  };
  const liftAll = () => {
    for (let i = 0; i < ids.length; i++) lift(i);
  };

  return {
    get busy() {
      return gesture !== null;
    },
    get fingers() {
      return pos;
    },
    start(g, now) {
      liftAll();
      gesture = g;
      t0 = now;
    },
    update(now) {
      if (!gesture) return false;
      const f = gesture.at(now - t0);
      if (!f) {
        liftAll();
        gesture = null;
        return false;
      }
      const n = Math.min(MAX_FINGERS, Math.max(f.length, ids.length));
      for (let i = 0; i < n; i++) {
        const p = i < f.length ? f[i] : null;
        const id = ids[i] ?? null;
        if (p && id === null) {
          const nid = sink.down(p.x, p.y);
          ids[i] = nid >= 0 ? nid : null;
          pos[i] = nid >= 0 ? { x: p.x, y: p.y } : null;
        } else if (p && id !== null) {
          const q = pos[i];
          if (!q || q.x !== p.x || q.y !== p.y) {
            sink.move(id, p.x, p.y);
            pos[i] = { x: p.x, y: p.y };
          }
        } else if (!p && id !== null) {
          lift(i);
        }
      }
      return true;
    },
    cancel() {
      liftAll();
      gesture = null;
    },
  };
};
