/**
 * The packed part of a column: whole balls on a hex lattice inside the tube's outline (shape.ts).
 * Rows alternate between two kinds: "a" rows have n balls touching both walls, "b" rows sit in
 * the hollows with n - 1. In the rounded bottom a row only keeps the positions where a whole ball
 * fits, so the lowest rows hold fewer. The lattice starts with whichever kind of row fits lowest.
 *
 * Counts fill rows from the bottom, each row from the left. Drawing never places single balls:
 * every row is a run of equally spaced balls, so a run is one rectangle of a repeating pattern
 * (`packedRects`).
 */
import { lowestY, type TubeShape } from "./shape";

export const SQRT3 = Math.sqrt(3);

export interface Lattice {
  readonly shape: TubeShape;
  readonly n: number;
  readonly r: number;
  readonly rowH: number;
  /** Rows below this one are narrowed by the rounded bottom. */
  readonly bowl: number;
  /** Row kind: 0 for "a" rows, 1 for "b" rows. */
  kind(j: number): 0 | 1;
  /** Centre y of row j. */
  y(j: number): number;
  /** Centre x of row j's first ball, and how many balls the row holds. */
  first(j: number): number;
  cap(j: number): number;
  /** Balls in the rows below row j. */
  below(j: number): number;
  /** The row `balls` packed balls reach, and how many of them are in it. */
  rowOf(balls: number): { j: number; m: number };
  /** The most balls that fill whole rows without going over `balls`. */
  whole(balls: number): number;
  /** The surface live balls rest on above `balls` packed ones (fractions allowed), as a y. */
  floor(balls: number): number;
  /** The highest point of the drawn packed balls, or the bottom when there are none. */
  top(balls: number): number;
  /** A ball centre of each kind, to anchor that kind's pattern. */
  anchor(kind: 0 | 1): { x: number; y: number };
}

const EPS = 1e-7;

export const createLattice = (shape: TubeShape, n: number): Lattice => {
  const w = shape.x1 - shape.x0;
  const across = Math.max(2, Math.round(n));
  const r = w / (2 * across);
  const rowH = SQRT3 * r;
  const firstOf = (k: 0 | 1) => shape.x0 + (k === 0 ? r : 2 * r);
  const fullOf = (k: 0 | 1) => (k === 0 ? across : across - 1);

  // The kind of row that reaches lowest starts the lattice.
  const lowest = (k: 0 | 1) => {
    let y = -Infinity;
    for (let i = 0; i < fullOf(k); i++) y = Math.max(y, lowestY(shape, firstOf(k) + 2 * r * i, r));
    return y;
  };
  const yA = lowest(0);
  const yB = lowest(1);
  const k0: 0 | 1 = yB > yA + EPS ? 1 : 0;
  const y0 = Math.max(yA, yB);

  const kind = (j: number): 0 | 1 => ((k0 + j) % 2) as 0 | 1;
  const y = (j: number) => y0 - j * rowH;

  // Rows in the rounded bottom: a run of the positions that fit, found ball by ball.
  const runFirst: number[] = [];
  const runCap: number[] = [];
  const prefix: number[] = [0];
  let bowl = 0;
  for (; bowl < 4096 && y(bowl) > shape.bottom - shape.rad + EPS; bowl++) {
    const k = kind(bowl);
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < fullOf(k); i++) {
      if (lowestY(shape, firstOf(k) + 2 * r * i, r) >= y(bowl) - EPS) {
        if (lo < 0) lo = i;
        hi = i;
      }
    }
    runFirst.push(lo < 0 ? firstOf(k) : firstOf(k) + 2 * r * lo);
    runCap.push(lo < 0 ? 0 : hi - lo + 1);
    prefix.push(prefix[bowl]! + runCap[bowl]!);
  }
  const pair = fullOf(0) + fullOf(1);
  const base = prefix[bowl]!;

  const cap = (j: number) => (j < 0 ? 0 : j < bowl ? runCap[j]! : fullOf(kind(j)));
  const first = (j: number) => (j < bowl ? runFirst[Math.max(0, j)]! : firstOf(kind(j)));
  const below = (j: number) => {
    if (j <= 0) return 0;
    if (j <= bowl) return prefix[j]!;
    const rows = j - bowl;
    const pairs = Math.floor(rows / 2);
    return base + pairs * pair + (rows % 2 === 1 ? fullOf(kind(bowl)) : 0);
  };
  const rowOf = (balls: number) => {
    const b = Math.max(0, Math.floor(balls));
    if (b < base) {
      // Rows with no room have the same prefix as the next, so this passes over them.
      let j = 0;
      while (prefix[j + 1]! <= b) j++;
      return { j, m: b - prefix[j]! };
    }
    let rest = b - base;
    const pairs = Math.floor(rest / pair);
    let j = bowl + 2 * pairs;
    rest -= pairs * pair;
    if (rest >= cap(j)) {
      rest -= cap(j);
      j++;
    }
    return { j, m: rest };
  };

  return {
    shape,
    n: across,
    r,
    rowH,
    bowl,
    kind,
    y,
    first,
    cap,
    below,
    rowOf,
    whole(balls) {
      const { j } = rowOf(balls);
      return below(j);
    },
    floor(balls) {
      if (balls <= 0) return shape.bottom;
      const whole = Math.floor(balls);
      const { j, m } = rowOf(whole);
      const c = Math.max(1, cap(j));
      const f = Math.min(1, (m + (balls - whole)) / c);
      return Math.min(shape.bottom, y(j) + r - f * rowH);
    },
    top(balls) {
      if (balls < 1) return shape.bottom;
      const { j, m } = rowOf(balls);
      return (m > 0 ? y(j) : y(j - 1)) - r;
    },
    anchor(k) {
      return { x: firstOf(k), y: kind(0) === k ? y0 : y(1) };
    },
  };
};

export interface PackRect {
  kind: 0 | 1;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Rectangles that show `balls` packed balls when each is filled with its kind's pattern
 * (anchored at `lat.anchor(kind)`): one per narrowed row, one per kind for the full rows, and
 * one for a part-filled top row. Writes into `out` and returns how many it wrote.
 */
export const packedRects = (lat: Lattice, balls: number, out: PackRect[]): number => {
  let k = 0;
  const put = (kind: 0 | 1, x: number, y: number, w: number, h: number) => {
    let rect = out[k];
    if (!rect) {
      rect = { kind, x, y, w, h };
      out[k] = rect;
    } else {
      rect.kind = kind;
      rect.x = x;
      rect.y = y;
      rect.w = w;
      rect.h = h;
    }
    k++;
  };
  if (balls < 1) return 0;
  const { r } = lat;
  const { j: rows, m } = lat.rowOf(balls);
  for (let j = 0; j < Math.min(rows, lat.bowl); j++) {
    const c = lat.cap(j);
    if (c > 0) put(lat.kind(j), lat.first(j) - r, lat.y(j) - r, 2 * r * c, 2 * r);
  }
  for (const kind of [0, 1] as const) {
    // Full rows of one kind are every other row from the bowl up to the top full row.
    const lo = lat.kind(lat.bowl) === kind ? lat.bowl : lat.bowl + 1;
    const hi = rows - 1 - (lat.kind(rows - 1) === kind ? 0 : 1);
    if (lo >= rows || hi < lo) continue;
    const c = lat.cap(lo);
    put(kind, lat.first(lo) - r, lat.y(hi) - r, 2 * r * c, lat.y(lo) - lat.y(hi) + 2 * r);
  }
  if (m > 0) put(lat.kind(rows), lat.first(rows) - r, lat.y(rows) - r, 2 * r * m, 2 * r);
  return k;
};
