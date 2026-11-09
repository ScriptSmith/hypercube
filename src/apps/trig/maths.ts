/**
 * The numbers: angles and their wrapping, sin, cos and tan with exact values at the special
 * angles, the readout's formatting, and the slow turn that attract and the bank's wave follow.
 * Pure.
 *
 * Values are read at the angle rounded to a whole degree, which is also what the readout
 * shows, so "sin 30°" is always 1/2 and never 0.49.
 */
import { DEG, TAU } from "./config";

export const wrap = (a: number): number => ((a % TAU) + TAU) % TAU;

/** The signed change from `a` to `b` the short way round, in (-π, π]. */
export const shortest = (a: number, b: number): number => {
  const d = wrap(b - a);
  return d > Math.PI ? d - TAU : d;
};

/** Multiples of 30° and 45°, in degrees, 0 to 360. */
export const SPECIAL_DEG: readonly number[] = [
  0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330, 360,
];
export const SPECIAL: readonly number[] = SPECIAL_DEG.map((d) => d * DEG);

export const isSpecialDeg = (d: number): boolean => d % 30 === 0 || d % 45 === 0;

/** The special angle nearest `a` (radians, any turn) within `tol`, as an angle in [0, 2π), or null. */
export const nearestSpecial = (a: number, tol: number): number | null => {
  const w = wrap(a);
  let best: number | null = null;
  let bestD = tol;
  for (const s of SPECIAL) {
    const d = Math.abs(shortest(w, s));
    if (d <= bestD) {
      bestD = d;
      best = s;
    }
  }
  return best === null ? null : wrap(best);
};

/**
 * The next special angle from `a` in the direction of `dir` (+1 anticlockwise), as an
 * unwrapped angle on the same turn as `a`. A special angle `a` is already within 1e-9 of
 * counts as reached, so the next one is returned.
 */
export const nextSpecial = (a: number, dir: number): number => {
  const turn = Math.floor(a / TAU) * TAU;
  const w = a - turn;
  if (dir >= 0) {
    for (const s of SPECIAL) if (s > w + 1e-9) return turn + s;
    return turn + TAU + SPECIAL[1]!;
  }
  for (let i = SPECIAL.length - 1; i >= 0; i--) {
    const s = SPECIAL[i]!;
    if (s < w - 1e-9) return turn + s;
  }
  return turn - TAU + SPECIAL[SPECIAL.length - 2]!;
};

/** The readout's angle: θ rounded to a whole degree, 0 to 360. 360 only for θ of a full turn. */
export const wholeDeg = (theta: number): number => {
  const d = theta >= TAU ? 360 : wrap(theta) / DEG;
  return d >= 359.5 ? 360 : Math.round(d);
};

/** An exact value: sign, a numerator of 0, 1, √2 or √3, and a denominator of 1, 2 or 3. */
export interface Exact {
  neg: boolean;
  num: "0" | "1" | "√2" | "√3";
  den: 1 | 2 | 3;
}

const NUM = { "0": 0, "1": 1, "√2": Math.SQRT2, "√3": Math.sqrt(3) } as const;

export const exactValue = (e: Exact): number => ((e.neg ? -1 : 1) * NUM[e.num]) / e.den;

const ex = (num: Exact["num"], den: Exact["den"] = 1): Exact => ({ neg: false, num, den });

/** By reference angle (0, 30, 45, 60, 90): |sin|, |cos| and |tan| (null for 90). */
const REF: Record<number, { sin: Exact; cos: Exact; tan: Exact | null }> = {
  0: { sin: ex("0"), cos: ex("1"), tan: ex("0") },
  30: { sin: ex("1", 2), cos: ex("√3", 2), tan: ex("√3", 3) },
  45: { sin: ex("√2", 2), cos: ex("√2", 2), tan: ex("1") },
  60: { sin: ex("√3", 2), cos: ex("1", 2), tan: ex("√3") },
  90: { sin: ex("1"), cos: ex("0"), tan: null },
};

const signed = (e: Exact, negative: boolean): Exact => ({ ...e, neg: negative && e.num !== "0" });

/** Exact sin, cos and tan of a special angle in whole degrees, or null for other angles. */
export const exactAt = (deg: number): { sin: Exact; cos: Exact; tan: Exact | null } | null => {
  const d = ((Math.round(deg) % 360) + 360) % 360;
  if (!isSpecialDeg(d)) return null;
  const inHalf = d % 180;
  const ref = inHalf <= 90 ? inHalf : 180 - inHalf;
  const r = REF[ref];
  if (!r) return null;
  const sinNeg = d > 180;
  const cosNeg = d > 90 && d < 270;
  return {
    sin: signed(r.sin, sinNeg),
    cos: signed(r.cos, cosNeg),
    tan: r.tan ? signed(r.tan, sinNeg !== cosNeg) : null,
  };
};

export interface Values {
  /** Whole degrees, 0 to 360. */
  deg: number;
  sin: number;
  cos: number;
  /** null where tan has no value (90° and 270°). */
  tan: number | null;
  exact: { sin: Exact; cos: Exact; tan: Exact | null } | null;
  quadrant: 1 | 2 | 3 | 4 | null;
}

/** The values the readout shows for θ (radians). */
export const valuesAt = (theta: number): Values => {
  const deg = wholeDeg(theta);
  const exact = exactAt(deg);
  if (exact) {
    return {
      deg,
      sin: exactValue(exact.sin),
      cos: exactValue(exact.cos),
      tan: exact.tan ? exactValue(exact.tan) : null,
      exact,
      quadrant: quadrantOf(deg),
    };
  }
  const r = deg * DEG;
  return {
    deg,
    sin: Math.sin(r),
    cos: Math.cos(r),
    tan: Math.tan(r),
    exact: null,
    quadrant: quadrantOf(deg),
  };
};

/** The quadrant a whole-degree angle is in, or null on an axis. */
export const quadrantOf = (deg: number): 1 | 2 | 3 | 4 | null => {
  const d = ((deg % 360) + 360) % 360;
  if (d % 90 === 0) return null;
  return (Math.floor(d / 90) + 1) as 1 | 2 | 3 | 4;
};

/** True where tan has no value: the radius is upright and never meets the line x = 1. */
export const tanUndefined = (deg: number): boolean => ((deg % 180) + 180) % 180 === 90;

export const MINUS = "−";

/** A value to two decimals, with a proper minus sign and no "-0.00". */
export const decimal = (v: number, places = 2): string => {
  const f = 10 ** places;
  const r = Math.round(v * f) / f;
  if (r === 0) return (0).toFixed(places);
  return (r < 0 ? MINUS : "") + Math.abs(r).toFixed(places);
};

/** True when the exact value equals its two-decimal form (0, 1, 1/2), so "=" not "≈". */
export const decimalIsExact = (e: Exact): boolean => e.num === "0" || (e.num === "1" && e.den <= 2);

/** θ in degrees, as the readout writes it. */
export const degText = (deg: number): string => `${deg}°`;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** A special angle as a multiple of π: {num: "2π", den: 3}, {num: "π", den: 1}, or 0. */
export const piFraction = (deg: number): { num: string; den: number } | null => {
  if (!isSpecialDeg(deg)) return null;
  if (deg === 0) return { num: "0", den: 1 };
  const g = gcd(deg, 180);
  const n = deg / g;
  const d = 180 / g;
  return { num: n === 1 ? "π" : `${n}π`, den: d };
};

/** θ in radians as plain text: "π/3", "2π", or "1.23". */
export const radText = (deg: number): string => {
  const p = piFraction(deg);
  if (!p) return decimal(deg * DEG);
  return p.den === 1 ? p.num : `${p.num}/${p.den}`;
};

/** An exact value as plain text, for tests and status: "−√3/2", "1", "0". */
export const exactText = (e: Exact): string =>
  (e.neg ? MINUS : "") + e.num + (e.den === 1 ? "" : `/${e.den}`);

/**
 * The slow turn: an eighth of a turn at a time, easing between stops at the multiples of 45°
 * and pausing at each. One turn every TOUR_MS. Unwrapped and never decreasing, so a frame
 * easing back onto it can't be sent the wrong way round.
 */
export const TOUR_STOP = TAU / 8;
export const TOUR_MOVE_MS = 800;
export const TOUR_PAUSE_MS = 700;
export const TOUR_MS = 8 * (TOUR_MOVE_MS + TOUR_PAUSE_MS);

export const tourAngle = (t: number): number => {
  const seg = TOUR_MOVE_MS + TOUR_PAUSE_MS;
  const n = Math.floor(t / seg);
  const into = t - n * seg;
  const u = Math.min(1, into / TOUR_MOVE_MS);
  return (n + u * u * (3 - 2 * u)) * TOUR_STOP;
};

/**
 * A bank frame's place in the bank's wave: frames further right follow the same turn later,
 * spread evenly over one turn, so the bank's beads make one travelling wave.
 */
export const bankTourAngle = (t: number, pos: number, count: number): number =>
  tourAngle(t - (Math.max(0, pos) * TOUR_MS) / Math.max(1, count));

export const smoothstep = (u: number): number => {
  const v = Math.max(0, Math.min(1, u));
  return v * v * (3 - 2 * v);
};
