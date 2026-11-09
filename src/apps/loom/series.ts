/**
 * Fourier series of the target shapes, and how close a set of harmonics is to one. Pure.
 *
 * Harmonic k contributes (amp / k) sin(k theta + phase) to the sum, so a slider at full (amp 1)
 * gives harmonic k a k-th of the fundamental's size: high harmonics can't swamp the picture,
 * and every target fits the sliders. Amplitudes are slider values (0 to 1), phases radians.
 *
 * The coefficients are the textbook ones, written as b_k sin(k theta + psi_k) with b_k >= 0:
 * - square: 1/k for odd k
 * - sawtooth: 1/k for every k, signs alternating (negated, so it ramps up left to right on
 *   the scrolling wave, which runs backwards in time)
 * - triangle: 1/k^2 for odd k, signs alternating in pairs
 * - pulse: a narrow pulse of duty d, sin(k pi d)/k as cosines
 * - bumps: |sin theta| without its mean, -1/(k^2 - 1) cosines for even k
 * - sine: the fundamental alone
 * Each target is scaled so its largest slider value is TARGET_MAX within the harmonics present.
 */
import { TAU } from "./config";

export interface Term {
  /** Slider value, 0 to 1. */
  amp: number;
  /** Radians, 0 to 2 pi. */
  phase: number;
}

interface TargetDef {
  id: string;
  title: string;
  /** Coefficient of sin(k theta + psi), unscaled. */
  coef(k: number): { b: number; psi: number };
  /** Fewest non-zero harmonics for the shape to read as itself. */
  min: number;
}

const PULSE_DUTY = 0.2;
const HALF_PI = Math.PI / 2;

export const TARGET_DEFS: readonly TargetDef[] = [
  {
    id: "square",
    title: "Square",
    coef: (k) => ({ b: k % 2 === 1 ? 1 / k : 0, psi: 0 }),
    min: 2,
  },
  {
    id: "sawtooth",
    title: "Sawtooth",
    coef: (k) => ({ b: 1 / k, psi: k % 2 === 1 ? Math.PI : 0 }),
    min: 2,
  },
  {
    id: "triangle",
    title: "Triangle",
    coef: (k) => ({
      b: k % 2 === 1 ? 1 / (k * k) : 0,
      psi: k % 4 === 3 ? Math.PI : 0,
    }),
    min: 2,
  },
  {
    id: "pulse",
    title: "Pulse",
    coef: (k) => {
      const s = Math.sin(k * Math.PI * PULSE_DUTY) / k;
      return Math.abs(s) < 1e-9
        ? { b: 0, psi: 0 }
        : { b: Math.abs(s), psi: s > 0 ? HALF_PI : -HALF_PI };
    },
    min: 3,
  },
  {
    id: "bumps",
    title: "Bumps",
    coef: (k) => ({ b: k % 2 === 0 ? 1 / (k * k - 1) : 0, psi: -HALF_PI }),
    min: 2,
  },
  {
    id: "sine",
    title: "Sine",
    coef: (k) => ({ b: k === 1 ? 1 : 0, psi: 0 }),
    min: 1,
  },
];

/** The largest slider value a target asks for. */
export const TARGET_MAX = 0.8;

export interface Target {
  /** Index into TARGET_DEFS. */
  index: number;
  id: string;
  title: string;
  /** One term per harmonic present, k = 1 to n. */
  terms: Term[];
  /** Largest |sum| over a period, in fundamental units. */
  peak: number;
}

export const wrapPhase = (p: number): number => {
  const r = p % TAU;
  return r < 0 ? r + TAU : r;
};

/** Shortest signed turn from phase a to phase b, in (-pi, pi]. */
export const phaseDelta = (a: number, b: number): number => {
  const d = wrapPhase(b - a);
  return d > Math.PI ? d - TAU : d;
};

/** The sum of the harmonics at turn angle theta. */
export const valueAt = (terms: readonly Term[], theta: number): number => {
  let v = 0;
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i]!;
    if (t.amp === 0) continue;
    const k = i + 1;
    v += (t.amp / k) * Math.sin(k * theta + t.phase);
  }
  return v;
};

/** The sum sampled at `m` even steps over one period. */
export const sample = (terms: readonly Term[], m: number): number[] =>
  Array.from({ length: m }, (_, i) => valueAt(terms, (TAU * i) / m));

export const peakOf = (terms: readonly Term[], m = 256): number => {
  let p = 0;
  for (const v of sample(terms, m)) p = Math.max(p, Math.abs(v));
  return p;
};

const cache = new Map<string, Target | null>();

/** Target `index` for a setup with `n` harmonics, or null when it can't be made from them. */
export const targetFor = (index: number, n: number): Target | null => {
  const key = `${index}:${n}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const def = TARGET_DEFS[index];
  let out: Target | null = null;
  if (def && n >= 1) {
    const raw = Array.from({ length: n }, (_, i) => {
      const k = i + 1;
      const c = def.coef(k);
      return { s: c.b * k, psi: c.psi };
    });
    const nonzero = raw.filter((r) => r.s > 1e-9).length;
    const top = Math.max(0, ...raw.map((r) => r.s));
    if (nonzero >= def.min && top > 0) {
      const terms = raw.map((r) => ({
        amp: r.s > 1e-9 ? (r.s / top) * TARGET_MAX : 0,
        phase: r.s > 1e-9 ? wrapPhase(r.psi) : 0,
      }));
      out = { index, id: def.id, title: def.title, terms, peak: peakOf(terms) };
    }
  }
  if (cache.size > 256) cache.clear();
  cache.set(key, out);
  return out;
};

/** The targets a setup with `n` harmonics can make, in their usual order. */
export const targetsFor = (n: number): number[] =>
  TARGET_DEFS.map((_, i) => i).filter((i) => targetFor(i, n) !== null);

/** The target after `index` in the cycle for `n` harmonics. */
export const nextTarget = (index: number, n: number): number => {
  const list = targetsFor(n);
  if (list.length === 0) return 0;
  const after = list.find((i) => i > index);
  return after ?? list[0]!;
};

/** How far one harmonic is from its target, in slider units (amp and phase together). */
export const termError = (a: Term, b: Term): number => {
  const d = a.amp * a.amp + b.amp * b.amp - 2 * a.amp * b.amp * Math.cos(a.phase - b.phase);
  return Math.sqrt(Math.max(0, d));
};

/** A harmonic this close to its target counts as right. */
export const MATCH_TOL = 0.12;
/** Beyond the tolerance, a harmonic's share of the fill falls to nothing over this much more. */
const FILL_SPAN = 0.5;

export interface MatchStats {
  /** Per harmonic: within the tolerance. */
  ok: boolean[];
  /** Mean closeness per harmonic, 0 to 1; 1 when every harmonic is right. */
  fill: number;
  /** Every harmonic right. */
  all: boolean;
  /** 1 minus the RMS difference over a period relative to the target's RMS (Parseval). */
  closeness: number;
}

export const matchStats = (
  values: readonly Term[],
  target: Target,
  tol = MATCH_TOL,
): MatchStats => {
  const n = target.terms.length;
  const ok: boolean[] = [];
  let fill = 0;
  let err2 = 0;
  let ref2 = 0;
  for (let i = 0; i < n; i++) {
    const t = target.terms[i]!;
    const v = values[i] ?? { amp: 0, phase: 0 };
    const e = termError(v, t);
    ok.push(e <= tol);
    fill += Math.max(0, Math.min(1, 1 - (e - tol) / FILL_SPAN));
    const k = i + 1;
    // In fundamental units each term is amp / k, so its energy is (amp / k)^2 / 2.
    err2 += (e / k) ** 2;
    ref2 += (t.amp / k) ** 2;
  }
  return {
    ok,
    fill: n > 0 ? fill / n : 0,
    all: ok.every(Boolean),
    closeness: ref2 > 0 ? Math.max(0, 1 - Math.sqrt(err2 / ref2)) : 0,
  };
};
