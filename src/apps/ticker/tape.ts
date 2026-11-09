/**
 * A ring's words as one endless tape, in the ring's own pixels (one turn is `width`).
 *
 * New words appear at the printer, a point on the ring that drifts slowly against the crawl, so
 * no side of the ball is the front. Everything crawls towards lower x, right to left as read from
 * outside, and the tape behind the printer is what the ring shows: a word goes once round (a
 * little less, as the printer drifts to meet it) and is gone when it reaches the printer again.
 * Every place on the ring sees every word pass whole, whatever its length.
 *
 * Positions are kept as numbers of seconds and pixels from the start, so a show that runs for
 * days is exact: after three days the head is near 4e7 px, far inside a double's exact range.
 */

export interface Crawl {
  /** One turn, px. */
  width: number;
  /** px a second, towards lower x. */
  speed: number;
  /** The printer's drift, px a second, towards higher x. */
  drift: number;
  /** The printer's x at the start. */
  x0: number;
}

const mod = (a: number, n: number): number => {
  const r = a % n;
  return r < 0 ? r + n : r;
};

/** Where the printer is at `t` seconds. */
export const printerX = (c: Crawl, t: number): number => mod(c.x0 + c.drift * t, c.width);

/** The tape position at the printer at `t`: everything before it has been printed. */
export const headAt = (c: Crawl, t: number): number => (c.speed + c.drift) * t;

/** Ring x of tape position `s` at `t`, in [0, width). */
export const ringX = (c: Crawl, t: number, s: number): number =>
  mod(printerX(c, t) - (headAt(c, t) - s), c.width);

export interface TapeItem<T> {
  id: number;
  /** Tape position of its left edge. */
  start: number;
  width: number;
  data: T;
}

export interface Tape<T> {
  readonly items: readonly TapeItem<T>[];
  /** Tape position just after the last item. */
  readonly end: number;
  readonly pitch: number;
  /** Add an item after the last one, its width rounded up to whole pitches. */
  append(width: number, data: T): TapeItem<T>;
  /** Forget items that end at or before `s`. */
  dropBefore(s: number): void;
}

/**
 * A tape starting at `start`. Every item starts on a whole number of `pitch`es from it, so a dot
 * grid drawn on the tape lines up across items.
 */
export const createTape = <T>(start: number, pitch: number): Tape<T> => {
  const items: TapeItem<T>[] = [];
  let end = start;
  let id = 0;
  return {
    items,
    get end() {
      return end;
    },
    pitch,
    append(width, data) {
      const w = Math.max(1, Math.ceil(width / pitch - 1e-9)) * pitch;
      const item = { id: id++, start: end, width: w, data };
      items.push(item);
      end += w;
      return item;
    },
    dropBefore(s) {
      let k = 0;
      while (k < items.length && items[k]!.start + items[k]!.width <= s) k++;
      if (k > 0) items.splice(0, k);
    },
  };
};
