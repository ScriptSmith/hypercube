/**
 * Recent trail segments, for redrawing fading trails from scratch. Consecutive segments of one
 * line are merged up to MERGE_LEN long, so a line costs a few dozen entries a second.
 */
const FLOATS = 6;
/** Longest merged segment, in arena units: short enough that a tight turn stays round. */
const MERGE_LEN = 12;
/** Segments laid further apart in time than this are kept separate. */
const MERGE_DT = 0.06;

export interface History {
  /** x0, y0, x1, y1, line id, time laid (s) per entry, oldest from `start`. */
  readonly data: Float32Array;
  readonly cap: number;
  readonly start: number;
  readonly count: number;
  add(x0: number, y0: number, x1: number, y1: number, id: number, t: number): void;
  /** Forget segments laid before `t`. */
  trim(t: number): void;
  clear(): void;
}

export const createHistory = (cap: number): History => {
  const data = new Float32Array(cap * FLOATS);
  let start = 0;
  let count = 0;
  return {
    data,
    cap,
    get start() {
      return start;
    },
    get count() {
      return count;
    },
    add(x0, y0, x1, y1, id, t) {
      if (count > 0) {
        const k = ((start + count - 1) % cap) * FLOATS;
        if (
          data[k + 4] === id &&
          data[k + 2] === x0 &&
          data[k + 3] === y0 &&
          t - data[k + 5]! < MERGE_DT &&
          Math.hypot(x1 - data[k]!, y1 - data[k + 1]!) <= MERGE_LEN
        ) {
          data[k + 2] = x1;
          data[k + 3] = y1;
          return;
        }
      }
      if (count === cap) {
        start = (start + 1) % cap;
        count--;
      }
      const k = ((start + count) % cap) * FLOATS;
      data[k] = x0;
      data[k + 1] = y0;
      data[k + 2] = x1;
      data[k + 3] = y1;
      data[k + 4] = id;
      data[k + 5] = t;
      count++;
    },
    trim(t) {
      while (count > 0 && data[start * FLOATS + 5]! < t) {
        start = (start + 1) % cap;
        count--;
      }
    },
    clear() {
      start = 0;
      count = 0;
    },
  };
};
