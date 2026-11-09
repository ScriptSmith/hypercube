/**
 * The force arrows' smoothing. A shape's force is read a few times a second as drag and lift
 * coefficients. Moving shapes and swapped ones send short pressure pulses through the tunnel
 * that make single readings jump, so each reading is the median of the last few, eased; and a
 * shape just swapped in shows no arrows until its readings settle.
 */

/**
 * A force (lattice units, per unit depth) as a coefficient: over the dynamic pressure of air at
 * `u` on a shape `length` cells long. With the length taken at the shape's size now, a disc's
 * drag coefficient stays about the same as it grows, while its arrow, drawn in proportion to
 * the shape, grows with it.
 */
export const coefficient = (force: number, u: number, length: number): number =>
  force / (0.5 * u * u * Math.max(1, length));

/**
 * The share of a shape's arrows, drawn from (x, y), that fits inside `box` (its tunnel or
 * chimney) with `margin` to spare: 1 when they fit. Both arrows shrink by the same share, so
 * drag and lift keep their proportion when a large shape near an edge would push them out.
 */
export const fitArrows = (
  x: number,
  y: number,
  arrows: readonly { x: number; y: number }[],
  box: { x: number; y: number; width: number; height: number },
  margin: number,
): number => {
  let k = 1;
  const room = (from: number, d: number, lo: number, hi: number) => {
    if (d > 1e-9) return (hi - margin - from) / d;
    if (d < -1e-9) return (lo + margin - from) / d;
    return Number.POSITIVE_INFINITY;
  };
  for (const a of arrows) {
    k = Math.min(
      k,
      room(x, a.x, box.x, box.x + box.width),
      room(y, a.y, box.y, box.y + box.height),
    );
  }
  return Math.max(0, k);
};

/** Readings in the median. */
export const MEDIAN_OF = 5;
/** Time constant of the easing towards the median, seconds. */
export const EASE_S = 0.6;
/** A swapped shape's readings are ignored this long. */
export const SETTLE_MS = 1500;

export interface ForceTrack {
  drag: number;
  lift: number;
  recent: { drag: number; lift: number }[];
  quietUntil: number;
  /** Readings taken since the last quiet spell; arrows show once there are enough. */
  heard: number;
}

export const createTrack = (): ForceTrack => ({
  drag: 0,
  lift: 0,
  recent: [],
  quietUntil: Number.NEGATIVE_INFINITY,
  heard: 0,
});

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Take a reading `dt` seconds after the last. */
export const hear = (t: ForceTrack, drag: number, lift: number, now: number, dt: number): void => {
  if (now < t.quietUntil || !Number.isFinite(drag) || !Number.isFinite(lift)) return;
  t.recent.push({ drag, lift });
  if (t.recent.length > MEDIAN_OF) t.recent.shift();
  t.heard++;
  const md = median(t.recent.map((r) => r.drag));
  const ml = median(t.recent.map((r) => r.lift));
  if (t.heard <= 1) {
    t.drag = md;
    t.lift = ml;
    return;
  }
  const k = 1 - Math.exp(-Math.max(0, dt) / EASE_S);
  t.drag += (md - t.drag) * k;
  t.lift += (ml - t.lift) * k;
};

/** Forget and ignore readings for `ms` (a new shape on the sting). */
export const settle = (t: ForceTrack, now: number, ms = SETTLE_MS): void => {
  t.quietUntil = now + ms;
  t.recent.length = 0;
  t.heard = 0;
  t.drag = 0;
  t.lift = 0;
};

/**
 * Ignore readings for `ms` and hide the arrows meanwhile (a shape moving fast), keeping what
 * they showed so they come back from there.
 */
export const pause = (t: ForceTrack, now: number, ms: number): void => {
  t.quietUntil = Math.max(t.quietUntil, now + ms);
  t.heard = Math.min(t.heard, 1);
  t.recent.length = 0;
};

/** How much of the arrows to show: none until a few readings are in. */
export const shown = (t: ForceTrack): number => Math.min(1, Math.max(0, (t.heard - 1) / 3));
