/**
 * Chapter 9's model, pure. A flat crystal of one small molecule per square cell. Each spot (h k)
 * and its mirror (−h −k) are one ripple of density across the crystal, |F| strong, its crests
 * placed by the phase; adding ripples, lowest |S| first, sharpens blurs into atoms. The
 * resolution is the smallest spacing used, 1/|S| of the farthest spot kept.
 *
 * The picture is three cells across, the same 15 Å at every grid size, so each spot lands on a
 * whole pixel (h·3 from the centre) and the 512 picture is the 256 one drawn finer.
 */
import { type BasisAtom, latticeAtoms } from "../../engine/model";
import type { SynthJob } from "../../engine/pattern";
import { picture, type PictureId } from "./pictures";

export const A = 5;
export const CELLS = 3;
export const SPAN = A * CELLS;
export const H_MAX = 3;
export const SIGMA = 0.4;

/** One heavy atom and two light ones, kept clear of the cell's edges. */
export const MOLECULE: readonly BasisAtom[] = [
  { u: 0.3, v: 0.32, z: 16, sigma: SIGMA },
  { u: 0.66, v: 0.36, z: 8, sigma: SIGMA },
  { u: 0.42, v: 0.7, z: 8, sigma: SIGMA },
];

export interface Ripple {
  h: number;
  k: number;
  /** |S|, Å⁻¹. */
  S: number;
  /** How strong the ripple is: |F|, electrons. */
  F: number;
  /** Where its crests sit: the phase of F, radians. */
  phase: number;
}

const structure = (h: number, k: number) => {
  const S = Math.hypot(h, k) / A;
  let re = 0;
  let im = 0;
  for (const at of MOLECULE) {
    const f = at.z * Math.exp(-2 * Math.PI ** 2 * (at.sigma ?? SIGMA) ** 2 * S * S);
    const ph = 2 * Math.PI * (h * at.u + k * at.v);
    re += f * Math.cos(ph);
    im += f * Math.sin(ph);
  }
  return { S, F: Math.hypot(re, im), phase: Math.atan2(im, re) };
};

/** Every ripple once: the upper half of the spots (and the right half of the middle row), lowest first. */
export const RIPPLES: readonly Ripple[] = (() => {
  const out: Ripple[] = [];
  for (let k = 0; k <= H_MAX; k++)
    for (let h = -H_MAX; h <= H_MAX; h++) {
      if (k === 0 && h <= 0) continue;
      out.push({ h, k, ...structure(h, k) });
    }
  out.sort((p, q) => p.S - q.S || Math.atan2(p.k, p.h) - Math.atan2(q.k, q.h));
  return out;
})();
export const COUNT = RIPPLES.length;
export const F_MAX = Math.max(...RIPPLES.map((r) => r.F));
/** The ripple a spot (h k) belongs to: itself or its mirror. */
export const rippleOf = (h: number, k: number): number =>
  RIPPLES.findIndex((r) => (r.h === h && r.k === k) || (r.h === -h && r.k === -k));

/** The detail slider, as the largest |S| kept, Å⁻¹. */
export const S_MIN = 0.2;
export const S_MAX = Math.ceil(Math.max(...RIPPLES.map((r) => r.S)) * 100) / 100;
/** Enough ripples kept that the atoms stand apart. */
export const ENOUGH = 14;

export type Mode = "atoms" | "pictures";

export interface SynthesisState {
  mode: Mode;
  /** Pictures: 0 takes the brightnesses from the lorikeet and the positions from the turtle. */
  role: 0 | 1;
  /** The detail slider, the largest |S| kept, Å⁻¹. */
  cutoff: number;
  /** Bit i: ripple i is added. */
  added: number;
  /** The ripple added last, or −1. */
  last: number;
}

export const START: SynthesisState = { mode: "atoms", role: 0, cutoff: S_MAX, added: 0, last: -1 };

const LOW_BITS = 12;
const LOW = (1 << LOW_BITS) - 1;

export const STATE_RANGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 1],
  [Math.round(S_MIN * 100), Math.round(S_MAX * 100)],
  [0, LOW],
  [0, (1 << (COUNT - LOW_BITS)) - 1],
  [0, COUNT],
];

export const encode = (s: SynthesisState): number[] => [
  s.mode === "pictures" ? 1 : 0,
  s.role,
  Math.round(Math.max(S_MIN, Math.min(S_MAX, s.cutoff)) * 100),
  s.added & LOW,
  Math.floor(s.added / (LOW + 1)),
  s.last + 1,
];

export const decode = (v: readonly number[]): SynthesisState => ({
  mode: v[0] === 1 ? "pictures" : "atoms",
  role: v[1] === 1 ? 1 : 0,
  cutoff: Math.max(S_MIN, Math.min(S_MAX, (v[2] ?? S_MAX * 100) / 100)),
  added: ((v[3] ?? 0) & LOW) + ((v[4] ?? 0) & ((1 << (COUNT - LOW_BITS)) - 1)) * (LOW + 1),
  last: Math.max(-1, Math.min(COUNT - 1, (v[5] ?? 0) - 1)),
});

export const has = (added: number, i: number): boolean => Math.floor(added / 2 ** i) % 2 === 1;
export const toggle = (added: number, i: number): number =>
  has(added, i) ? added - 2 ** i : added + 2 ** i;
export const ALL = 2 ** COUNT - 1;

/** The ripples added and within the cutoff, by index. */
export const kept = (s: SynthesisState): number[] =>
  RIPPLES.flatMap((r, i) => (has(s.added, i) && r.S <= s.cutoff + 1e-9 ? [i] : []));

/** The next ripple to add, lowest first, or −1. */
export const nextRipple = (added: number): number => {
  for (let i = 0; i < COUNT; i++) if (!has(added, i)) return i;
  return -1;
};

export const enough = (s: SynthesisState): boolean =>
  s.mode === "atoms" && kept(s).length >= ENOUGH;

/** Pixel offsets of the kept spots (their mirrors are kept by the engine), with the average. */
export const keepList = (idx: readonly number[]): Int32Array => {
  const out = new Int32Array(2 + idx.length * 2);
  idx.forEach((i, j) => {
    const r = RIPPLES[i]!;
    out[2 + j * 2] = r.h * CELLS;
    out[3 + j * 2] = r.k * CELLS;
  });
  return out;
};

export const crystal = () =>
  latticeAtoms({
    a: [A, 0],
    b: [0, A],
    basis: MOLECULE,
    extent: { na: CELLS, nb: CELLS },
  });

/** The density rebuilt from the kept ripples. */
export const rhoJob = (s: SynthesisState, n: number): SynthJob => ({
  op: "synth",
  n,
  span: SPAN,
  source: { atoms: crystal() },
  keep: keepList(kept(s)),
  maxS: null,
});

/** One ripple on its own (with the average), as stripes. */
export const rippleJob = (i: number, n: number): SynthJob => ({
  op: "synth",
  n,
  span: SPAN,
  source: { atoms: crystal() },
  keep: keepList([i]),
  maxS: null,
});

export const PICTURES: readonly [PictureId, PictureId] = ["lorikeet", "turtle"];

/** Which picture gives the brightnesses and which the positions. */
export const donors = (role: 0 | 1): { bright: PictureId; place: PictureId } =>
  role === 0
    ? { bright: PICTURES[0], place: PICTURES[1] }
    : { bright: PICTURES[1], place: PICTURES[0] };

/** One picture's brightnesses with the other's positions. */
export const swapJob = (role: 0 | 1, n: number): SynthJob => {
  const d = donors(role);
  return {
    op: "synth",
    n,
    span: SPAN,
    // Copies, because a job's arrays are handed to the worker.
    source: { density: picture(d.bright, n).slice() },
    phases: { density: picture(d.place, n).slice() },
    keep: null,
    maxS: null,
  };
};

export const rhoKey = (s: SynthesisState, n: number): string =>
  s.mode === "pictures" ? `${n}:swap:${s.role}` : `${n}:rho:${kept(s).join(",")}`;

/** A screen with nobody touching: add the ripples lowest first, then swap the pictures both ways. */
export const playAt = (t: number): SynthesisState => {
  const k = t % 26;
  if (k < 12) {
    const n = Math.min(COUNT, Math.floor((k / 9) * COUNT));
    let added = 0;
    for (let i = 0; i < n; i++) added += 2 ** i;
    return { ...START, added, last: n > 0 ? n - 1 : -1 };
  }
  return { ...START, mode: "pictures", role: k < 19 ? 0 : 1, added: ALL };
};
