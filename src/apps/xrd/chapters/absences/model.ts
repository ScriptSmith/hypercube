/**
 * Chapter 8's model, pure. A flat square cell with a heavy atom at its corner and up to two more
 * atoms that snap to quarters of the cell, each heavy or light; and the two real cases, potassium
 * chloride's cell seen down one edge (both ions with 18 electrons, potassium's held a little
 * closer) and aluminium's face-centred cell, whose powder loses whole rings.
 *
 * A spot's brightness is |F|², with F = Σ f exp(2πi(hx + ky)): one arrow per atom, added tip to
 * tail. For the flat cells f is the engine's own: an atom drawn as a soft disc of width σ scatters
 * z exp(−2π²σ²|S|²), so the arrows and the engine's pattern agree.
 */
import { CRYSTALS, formFactor, powderRings } from "../../crystals";
import { type BasisAtom, latticeAtoms } from "../../engine/model";
import type { PatternJob } from "../../engine/pattern";

/** The cell you fill, Å. */
export const A = 5;
export const HEAVY = 18;
export const LIGHT = 8;
export const SIGMA = 0.45;
/** Snapping grid: quarters of the cell. */
export const GRID = 4;
export const SITES = GRID * GRID;
/** Site index of the cell's centre, (½, ½). */
export const CENTRE = (GRID / 2) * GRID + GRID / 2;
/** Real-space Å per engine pixel at any grid size: the pattern reaches 0.67 Å⁻¹ each way. */
export const A_PER_PX = 0.75;
/** The flat crystal's radius, Å: small enough that its spots are easy to see. */
export const RADIUS = 20;
export const STOP = 0.05;

/** Potassium chloride's cell, Å; and its ions' disc widths (potassium is the smaller ion). */
export const KCL_A = 6.29;
export const SIGMA_K = 0.44;
export const SIGMA_CL = 0.48;

export const CASES = ["mine", "aluminium", "kcl"] as const;
export type Case = (typeof CASES)[number];

export interface Placed {
  /** 0 in the tray, else i·GRID + j for the point (i/GRID, j/GRID); never 0 (the corner). */
  site: number;
  heavy: boolean;
}

export interface AbsencesState {
  kase: Case;
  atoms: readonly [Placed, Placed];
  /** Index into the spot list for the case. */
  spot: number;
}

export const START: AbsencesState = {
  kase: "mine",
  atoms: [
    { site: 0, heavy: true },
    { site: 0, heavy: false },
  ],
  spot: 0,
};

/** The spots whose arrow sums can be shown, in the order the Spot button steps through them. */
export const SPOTS_2D: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 1],
  [2, 0],
  [2, 1],
  [2, 2],
  [3, 1],
];
export const SPOTS_AL: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [1, 1, 0],
  [1, 1, 1],
  [2, 0, 0],
  [2, 1, 0],
  [2, 2, 0],
];

export const STATE_RANGES: readonly (readonly [number, number])[] = [
  [0, CASES.length - 1],
  [0, SITES - 1],
  [0, 1],
  [0, SITES - 1],
  [0, 1],
  [0, SPOTS_2D.length - 1],
];

export const siteUV = (site: number): [number, number] => [
  Math.floor(site / GRID) / GRID,
  (site % GRID) / GRID,
];

/** The site nearest (u, v) (any numbers; the cell repeats), skipping the corner and `taken`. */
export const snap = (u: number, v: number, taken: readonly number[] = []): number => {
  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  for (let site = 1; site < SITES; site++) {
    if (taken.includes(site)) continue;
    const [su, sv] = siteUV(site);
    // Nearest image of the site.
    const du = u - su - Math.round(u - su);
    const dv = v - sv - Math.round(v - sv);
    const d = du * du + dv * dv;
    if (d < bestD - 1e-12) {
      bestD = d;
      best = site;
    }
  }
  return best;
};

export const encode = (s: AbsencesState): number[] => [
  CASES.indexOf(s.kase),
  s.atoms[0].site,
  s.atoms[0].heavy ? 1 : 0,
  s.atoms[1].site,
  s.atoms[1].heavy ? 1 : 0,
  s.spot,
];

export const decode = (v: readonly number[]): AbsencesState => {
  const site = (x: number | undefined) => (Number.isInteger(x) && x! > 0 && x! < SITES ? x! : 0);
  const s0 = site(v[1]);
  let s1 = site(v[3]);
  if (s1 !== 0 && s1 === s0) s1 = 0;
  return {
    kase: CASES[v[0] ?? 0] ?? "mine",
    atoms: [
      { site: s0, heavy: v[2] === 1 },
      { site: s1, heavy: v[4] === 1 },
    ],
    spot: Math.max(0, Math.min(SPOTS_2D.length - 1, v[5] ?? 0)),
  };
};

/** One atom of a flat cell, for the engine and the arrows. */
export interface FlatAtom {
  u: number;
  v: number;
  z: number;
  sigma: number;
  /** For drawing: heavy, light, potassium or chlorine. */
  kind: "heavy" | "light" | "K" | "Cl";
}

export const KCL_CELL: readonly FlatAtom[] = [
  { u: 0, v: 0, z: 18, sigma: SIGMA_K, kind: "K" },
  { u: 0.5, v: 0.5, z: 18, sigma: SIGMA_K, kind: "K" },
  { u: 0.5, v: 0, z: 18, sigma: SIGMA_CL, kind: "Cl" },
  { u: 0, v: 0.5, z: 18, sigma: SIGMA_CL, kind: "Cl" },
];

/** The atoms in your cell: the corner, then each placed atom. */
export const myCell = (s: AbsencesState): FlatAtom[] => {
  const out: FlatAtom[] = [{ u: 0, v: 0, z: HEAVY, sigma: SIGMA, kind: "heavy" }];
  for (const p of s.atoms) {
    if (p.site === 0) continue;
    const [u, v] = siteUV(p.site);
    out.push({
      u,
      v,
      z: p.heavy ? HEAVY : LIGHT,
      sigma: SIGMA,
      kind: p.heavy ? "heavy" : "light",
    });
  }
  return out;
};

/** The flat cell shown for a case, and its edge (Å); aluminium has none (it is shown as rings). */
export const flatCell = (s: AbsencesState): { atoms: FlatAtom[]; a: number } | null =>
  s.kase === "mine"
    ? { atoms: myCell(s), a: A }
    : s.kase === "kcl"
      ? { atoms: [...KCL_CELL], a: KCL_A }
      : null;

export interface Arrow {
  /** Length: how strongly the atom scatters here, electrons. */
  f: number;
  /** Radians: 2π(hx + ky (+ lz)). */
  phase: number;
  kind: FlatAtom["kind"] | "Al";
}

export interface Sum {
  arrows: Arrow[];
  re: number;
  im: number;
  /** |F|². */
  F2: number;
  /** |S|, Å⁻¹. */
  S: number;
  /** The arrows' total length: |F| if they all lined up. */
  inStep: number;
}

const total = (arrows: Arrow[], S: number): Sum => {
  let re = 0;
  let im = 0;
  let len = 0;
  for (const a of arrows) {
    re += a.f * Math.cos(a.phase);
    im += a.f * Math.sin(a.phase);
    len += a.f;
  }
  return { arrows, re, im, F2: re * re + im * im, S, inStep: len };
};

/** The arrow sum of a flat cell for spot (h k). */
export const flatSum = (atoms: readonly FlatAtom[], a: number, h: number, k: number): Sum => {
  const S = Math.hypot(h, k) / a;
  const arrows = atoms.map((at) => ({
    f: at.z * Math.exp(-2 * Math.PI ** 2 * at.sigma ** 2 * S * S),
    phase: 2 * Math.PI * (h * at.u + k * at.v),
    kind: at.kind,
  }));
  return total(arrows, S);
};

/** Aluminium's face-centred cell: a corner and the middle of three faces. */
export const AL_SITES: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [0.5, 0.5, 0],
  [0.5, 0, 0.5],
  [0, 0.5, 0.5],
];
export const AL_A = CRYSTALS.aluminium.cell.a;

export const alSum = (h: number, k: number, l: number): Sum => {
  const S = Math.hypot(h, k, l) / AL_A;
  const f = formFactor("Al", S);
  const arrows = AL_SITES.map(([x, y, z]) => ({
    f,
    phase: 2 * Math.PI * (h * x + k * y + l * z),
    kind: "Al" as const,
  }));
  return total(arrows, S);
};

/** The arrow sum of the chosen spot, in the state's case. */
export const chosenSum = (s: AbsencesState): Sum => {
  if (s.kase === "aluminium") {
    const [h, k, l] = SPOTS_AL[s.spot] ?? SPOTS_AL[0]!;
    return alSum(h, k, l);
  }
  const cell = flatCell(s)!;
  const [h, k] = SPOTS_2D[s.spot] ?? SPOTS_2D[0]!;
  return flatSum(cell.atoms, cell.a, h, k);
};

export const spotName = (s: AbsencesState): string =>
  s.kase === "aluminium"
    ? `(${(SPOTS_AL[s.spot] ?? SPOTS_AL[0]!).join(" ")})`
    : `(${(SPOTS_2D[s.spot] ?? SPOTS_2D[0]!).join(" ")})`;

/** A spot this dim against its arrows' full length has gone. */
export const GONE = 0.12;

/** Spots of a flat cell within |S| ≤ maxS that have (nearly) vanished, as (h, k). */
export const missingSpots = (
  atoms: readonly FlatAtom[],
  a: number,
  maxS: number,
): [number, number][] => {
  const out: [number, number][] = [];
  const m = Math.floor(maxS * a);
  for (let h = -m; h <= m; h++)
    for (let k = -m; k <= m; k++) {
      if (h === 0 && k === 0) continue;
      if (Math.hypot(h, k) / a > maxS) continue;
      const sum = flatSum(atoms, a, h, k);
      if (Math.sqrt(sum.F2) < GONE * sum.inStep) out.push([h, k]);
    }
  return out;
};

/** A heavy atom sits in the middle of your cell: every spot with h + k odd cancels. */
export const centred = (s: AbsencesState): boolean =>
  s.kase === "mine" && s.atoms.some((p) => p.site === CENTRE && p.heavy);

/** Whether spot (h k) of a flat cell has (nearly) vanished. */
const gone = (atoms: readonly FlatAtom[], a: number, h: number, k: number): boolean => {
  const sum = flatSum(atoms, a, h, k);
  return Math.sqrt(sum.F2) < GONE * sum.inStep;
};

/**
 * Your cell shows what the "So" line says: every spot with h + k odd has gone (a matching atom in
 * the middle, and nothing else spoiling it).
 */
export const checkered = (s: AbsencesState): boolean => {
  if (s.kase !== "mine") return false;
  const atoms = myCell(s);
  return [
    [1, 0],
    [0, 1],
    [2, 1],
    [1, 2],
  ].every(([h, k]) => gone(atoms, A, h!, k!));
};

/** The first listed spot that has vanished in a flat case's cell, or -1. */
export const vanishedSpot = (s: AbsencesState): number => {
  const cell = flatCell(s);
  if (!cell) return -1;
  return SPOTS_2D.findIndex(([h, k]) => gone(cell.atoms, cell.a, h, k));
};

/**
 * The spot a case opens on: potassium chloride on (1 1), where its two ions' arrows cancel (its
 * (1 0) cancels for any cell of that shape, matching ions or not); the others on their first.
 */
export const openingSpot = (kase: Case): number => (kase === "kcl" ? 1 : 0);

export const patternJob = (s: AbsencesState, n: number): PatternJob | null => {
  const cell = flatCell(s);
  if (!cell) return null;
  const basis: BasisAtom[] = cell.atoms.map((at) => ({
    u: at.u,
    v: at.v,
    z: at.z,
    sigma: at.sigma,
  }));
  return {
    op: "pattern",
    n,
    span: n * A_PER_PX,
    source: {
      atoms: latticeAtoms({
        a: [cell.a, 0],
        b: [0, cell.a],
        basis,
        extent: { radius: RADIUS, taper: 8 },
      }),
    },
    scale: "sqrt",
    stop: STOP,
  };
};

export const jobKey = (s: AbsencesState, n: number): string => {
  const cell = flatCell(s);
  if (!cell) return `${n}:al`;
  return `${n}:${s.kase}:${cell.atoms.map((a) => `${a.u},${a.v},${a.z}`).join(";")}`;
};

/**
 * Aluminium's rings under copper, beside every ring a simple cubic cell of the same size would
 * make: h² + k² + l² from 1 to 16 (7 and 15 are no sum of three squares), each named by one family.
 */
export interface AlRing {
  N: number;
  hkl: [number, number, number];
  /** |S|, Å⁻¹. */
  S: number;
  /** Height out of 100, 0 when the ring is missing. */
  height: number;
}

const NAMES: Record<number, [number, number, number]> = {
  1: [1, 0, 0],
  2: [1, 1, 0],
  3: [1, 1, 1],
  4: [2, 0, 0],
  5: [2, 1, 0],
  6: [2, 1, 1],
  8: [2, 2, 0],
  9: [3, 0, 0],
  10: [3, 1, 0],
  11: [3, 1, 1],
  12: [2, 2, 2],
  13: [3, 2, 0],
  14: [3, 2, 1],
  16: [4, 0, 0],
};

let alCache: AlRing[] | null = null;
export const alRings = (): AlRing[] => {
  if (alCache) return alCache;
  const found = powderRings(CRYSTALS.aluminium, 1.5406, { maxTwoTheta: 170 });
  alCache = Object.entries(NAMES).map(([key, hkl]) => {
    const N = Number(key);
    const S = Math.sqrt(N) / AL_A;
    const ring = found.find((r) => Math.abs(r.S - S) < 1e-3);
    return { N, hkl, S, height: ring?.height ?? 0 };
  });
  return alCache;
};

/** A screen with nobody touching: fill the cell, the middle, then the two real cases. */
export const playAt = (t: number): AbsencesState => {
  const k = Math.floor(t / 3.5) % 7;
  const spot = Math.floor(t / 1.75) % 2 === 0 ? 0 : 1;
  const atoms = (site: number, heavy: boolean): AbsencesState["atoms"] => [
    { site, heavy },
    { site: 0, heavy: false },
  ];
  switch (k) {
    case 0:
      return { ...START, spot };
    case 1:
      return { kase: "mine", atoms: atoms(CENTRE, false), spot };
    case 2:
      return { kase: "mine", atoms: atoms(CENTRE, true), spot };
    case 3:
      return { kase: "mine", atoms: atoms(2 * GRID, true), spot };
    case 4:
      return { kase: "kcl", atoms: START.atoms, spot: spot === 0 ? 1 : 2 };
    default:
      return { kase: "aluminium", atoms: START.atoms, spot: spot === 0 ? 0 : 2 };
  }
};
