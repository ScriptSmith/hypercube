/**
 * The crystals: cells, atoms and how strongly each kind of atom scatters, with the powder rings
 * they make. Pure. Cells and positions are published ones: salt, potassium chloride and
 * aluminium from NBS Circular 539 (1953), diamond from Hom, Kiszenick and Post (1975), silicon
 * from NIST SRM 640g, graphite from Trucano and Chen (1975), quartz from Antao et al. (2008), ice
 * from Goto, Hondoh and Mae (1990), corundum's cell from NIST SRM 1976c and its atoms from Lewis,
 * Schwarzenbach and Flack (1982), and zircon from Hazen and Finger (1979). Form factors are the
 * Cromer–Mann coefficients of International Tables for Crystallography Vol. C, Table 6.1.1.4.
 *
 * Conventions: lengths in Å, reciprocal lengths in Å⁻¹ with |S| = 1/d (no 2π), θ from the
 * planes, the detector reads 2θ.
 */

export type Species =
  | "H"
  | "C"
  | "O"
  | "Na"
  | "Al"
  | "Si"
  | "S"
  | "Cl"
  | "K"
  | "Ca"
  | "Zr"
  | "O2-"
  | "Na+"
  | "Al3+"
  | "Si4+"
  | "Cl-"
  | "K+";

/** f(s) = Σ aᵢ exp(−bᵢ s²) + c, with s = sin θ / λ = |S| / 2. */
export interface CromerMann {
  a: readonly [number, number, number, number];
  b: readonly [number, number, number, number];
  c: number;
}

export const FORM: Record<Species, CromerMann> = {
  H: {
    a: [0.493002, 0.322912, 0.140191, 0.04081],
    b: [10.5109, 26.1257, 3.14236, 57.7997],
    c: 0.003038,
  },
  C: { a: [2.31, 1.02, 1.5886, 0.865], b: [20.8439, 10.2075, 0.5687, 51.6512], c: 0.2156 },
  O: { a: [3.0485, 2.2868, 1.5463, 0.867], b: [13.2771, 5.7011, 0.3239, 32.9089], c: 0.2508 },
  Na: { a: [4.7626, 3.1736, 1.2674, 1.1128], b: [3.285, 8.8422, 0.3136, 129.424], c: 0.676 },
  Al: { a: [6.4202, 1.9002, 1.5936, 1.9646], b: [3.0387, 0.7426, 31.5472, 85.0886], c: 1.1151 },
  Si: { a: [6.2915, 3.0353, 1.9891, 1.541], b: [2.4386, 32.3337, 0.6785, 81.6937], c: 1.1407 },
  S: { a: [6.9053, 5.2034, 1.4379, 1.5863], b: [1.4679, 22.2151, 0.2536, 56.172], c: 0.8669 },
  Cl: { a: [11.4604, 7.1962, 6.2556, 1.6455], b: [0.0104, 1.1662, 18.5194, 47.7784], c: -9.5574 },
  K: { a: [8.2186, 7.4398, 1.0519, 0.8659], b: [12.7949, 0.7748, 213.187, 41.6841], c: 1.4228 },
  Ca: { a: [8.6266, 7.3873, 1.5899, 1.0211], b: [10.4421, 0.6599, 85.7484, 178.437], c: 1.3751 },
  Zr: {
    a: [17.8765, 10.948, 5.41732, 3.65721],
    b: [1.27618, 11.916, 0.117622, 87.6627],
    c: 2.06929,
  },
  "O2-": {
    a: [3.7504, 2.84294, 1.54298, 1.62091],
    b: [16.5151, 6.59203, 0.319201, 43.3486],
    c: 0.24206,
  },
  "Al3+": {
    a: [4.17448, 3.3876, 1.20296, 0.528137],
    b: [1.93816, 4.14553, 0.228753, 8.28524],
    c: 0.706786,
  },
  "Si4+": {
    a: [4.43918, 3.20345, 1.19453, 0.41653],
    b: [1.64167, 3.43757, 0.2149, 6.65365],
    c: 0.746297,
  },
  "Na+": { a: [3.2565, 3.9362, 1.3998, 1.0032], b: [2.6671, 6.1153, 0.2001, 14.039], c: 0.404 },
  "Cl-": {
    a: [18.2915, 7.2084, 6.5337, 2.3386],
    b: [0.0066, 1.1717, 19.5424, 60.4486],
    c: -16.378,
  },
  "K+": { a: [7.9578, 7.4917, 6.359, 1.1915], b: [12.6331, 0.7674, -0.002, 31.9128], c: -4.9978 },
};

/** Electrons: the form factor at |S| = 0. */
export const electrons = (sp: Species): number => {
  const f = FORM[sp];
  return f.a[0] + f.a[1] + f.a[2] + f.a[3] + f.c;
};

/** How strongly one atom scatters at |S| (Å⁻¹), in electrons. */
export const formFactor = (sp: Species, S: number): number => {
  const f = FORM[sp];
  const s2 = (S / 2) ** 2;
  return (
    f.a[0] * Math.exp(-f.b[0] * s2) +
    f.a[1] * Math.exp(-f.b[1] * s2) +
    f.a[2] * Math.exp(-f.b[2] * s2) +
    f.a[3] * Math.exp(-f.b[3] * s2) +
    f.c
  );
};

export interface Cell {
  a: number;
  b: number;
  c: number;
  /** Degrees. */
  alpha: number;
  beta: number;
  gamma: number;
}

export interface Site {
  sp: Species;
  /** Fractional position. */
  x: number;
  y: number;
  z: number;
  occ?: number;
  /** This atom's displacement B, Å², when it differs from the crystal's. */
  B?: number;
}

export type CrystalId =
  | "salt"
  | "kcl"
  | "aluminium"
  | "diamond"
  | "silicon"
  | "graphite"
  | "quartz"
  | "ice"
  | "corundum"
  | "zircon";

export interface Crystal {
  id: CrystalId;
  formula: string;
  cell: Cell;
  /** The independent atoms; `ops` and `centring` fill the cell from them. */
  sites: readonly Site[];
  /** Symmetry operations as in a CIF, such as "-y,x-y,z+1/3". Default: just "x,y,z". */
  ops?: readonly string[];
  /** Lattice centring translations, beyond (0, 0, 0). */
  centring?: readonly (readonly [number, number, number])[];
  /** Atoms in the cell when full, to check the expansion against. */
  expect: Partial<Record<Species, number>>;
  /** Isotropic displacement B, Å², for the intensity's thermal fade. Default 0.5. */
  B?: number;
}

const F_CENTRES = [
  [0, 0.5, 0.5],
  [0.5, 0, 0.5],
  [0.5, 0.5, 0],
] as const;

const OPS_194 = [
  "x,y,z",
  "-y,x-y,z",
  "-x+y,-x,z",
  "-x,-y,z+1/2",
  "y,-x+y,z+1/2",
  "x-y,x,z+1/2",
  "y,x,-z",
  "x-y,-y,-z",
  "-x,-x+y,-z",
  "-y,-x,-z+1/2",
  "-x+y,y,-z+1/2",
  "x,x-y,-z+1/2",
  "-x,-y,-z",
  "y,-x+y,-z",
  "x-y,x,-z",
  "x,y,-z+1/2",
  "-y,x-y,-z+1/2",
  "-x+y,-x,-z+1/2",
  "-y,-x,z",
  "-x+y,y,z",
  "x,x-y,z",
  "y,x,z+1/2",
  "x-y,-y,z+1/2",
  "-x,-x+y,z+1/2",
];

const OPS_167 = [
  "x,y,z",
  "-y,x-y,z",
  "-x+y,-x,z",
  "y,x,-z+1/2",
  "x-y,-y,-z+1/2",
  "-x,-x+y,-z+1/2",
  "-x,-y,-z",
  "y,-x+y,-z",
  "x-y,x,-z",
  "-y,-x,z+1/2",
  "-x+y,y,z+1/2",
  "x,x-y,z+1/2",
];

/** I4₁/amd, origin choice 2. */
const OPS_141 = [
  "x,y,z",
  "-x+1/2,-y,z+1/2",
  "-y+1/4,x+3/4,z+1/4",
  "y+1/4,-x+1/4,z+3/4",
  "-x+1/2,y,-z+1/2",
  "x,-y,-z",
  "y+1/4,x+3/4,-z+1/4",
  "-y+1/4,-x+1/4,-z+3/4",
  "-x,-y,-z",
  "x+1/2,y,-z+1/2",
  "y+3/4,-x+1/4,-z+3/4",
  "-y+3/4,x+3/4,-z+1/4",
  "x+1/2,-y,z+1/2",
  "-x,y,z",
  "-y+3/4,-x+1/4,z+3/4",
  "y+3/4,x+3/4,z+1/4",
];

/** P3₂21, as the CIF for quartz gives it. */
const OPS_154 = [
  "x,y,z",
  "y,x,-z",
  "-y,x-y,z+2/3",
  "-x,-x+y,-z+2/3",
  "-x+y,-x,z+1/3",
  "x-y,-y,-z+1/3",
];

const cubic = (a: number) => ({ a, b: a, c: a, alpha: 90, beta: 90, gamma: 90 });
const hexagonal = (a: number, c: number) => ({ a, b: a, c, alpha: 90, beta: 90, gamma: 120 });

export const CRYSTALS: Record<CrystalId, Crystal> = {
  salt: {
    id: "salt",
    formula: "NaCl",
    cell: cubic(5.6402),
    sites: [
      { sp: "Na+", x: 0, y: 0, z: 0 },
      { sp: "Cl-", x: 0.5, y: 0.5, z: 0.5 },
    ],
    centring: F_CENTRES,
    expect: { "Na+": 4, "Cl-": 4 },
    B: 1.7,
  },
  kcl: {
    id: "kcl",
    formula: "KCl",
    cell: cubic(6.2931),
    sites: [
      { sp: "K+", x: 0, y: 0, z: 0 },
      { sp: "Cl-", x: 0.5, y: 0.5, z: 0.5 },
    ],
    centring: F_CENTRES,
    expect: { "K+": 4, "Cl-": 4 },
    B: 2.15,
  },
  aluminium: {
    id: "aluminium",
    formula: "Al",
    cell: cubic(4.0494),
    sites: [{ sp: "Al", x: 0, y: 0, z: 0 }],
    centring: F_CENTRES,
    expect: { Al: 4 },
    B: 0.7806,
  },
  diamond: {
    id: "diamond",
    formula: "C",
    cell: cubic(3.566986),
    sites: [
      { sp: "C", x: 0, y: 0, z: 0 },
      { sp: "C", x: 0.25, y: 0.25, z: 0.25 },
    ],
    centring: F_CENTRES,
    expect: { C: 8 },
    B: 0.1435,
  },
  silicon: {
    id: "silicon",
    formula: "Si",
    cell: cubic(5.431109),
    sites: [
      { sp: "Si", x: 0, y: 0, z: 0 },
      { sp: "Si", x: 0.25, y: 0.25, z: 0.25 },
    ],
    centring: F_CENTRES,
    expect: { Si: 8 },
    B: 0.4849,
  },
  graphite: {
    id: "graphite",
    formula: "C",
    cell: hexagonal(2.464, 6.711),
    sites: [
      { sp: "C", x: 0, y: 0, z: 0.25 },
      { sp: "C", x: 1 / 3, y: 2 / 3, z: 0.25 },
    ],
    ops: OPS_194,
    expect: { C: 4 },
    B: 0.6,
  },
  quartz: {
    id: "quartz",
    formula: "SiO₂",
    cell: hexagonal(4.913437, 5.405118),
    sites: [
      { sp: "Si", x: 0.47, y: 0, z: 2 / 3, B: 0.49 },
      { sp: "O", x: 0.4146, y: 0.2678, z: 0.78543, B: 0.86 },
    ],
    ops: OPS_154,
    expect: { Si: 3, O: 6 },
    B: 0.7,
  },
  ice: {
    id: "ice",
    formula: "H₂O",
    cell: hexagonal(4.506, 7.346),
    // Hydrogen is left out: half-filled sites around each oxygen, and one electron each.
    sites: [{ sp: "O", x: 1 / 3, y: 2 / 3, z: 0.0618 }],
    ops: OPS_194,
    expect: { O: 4 },
    B: 2.4,
  },
  corundum: {
    id: "corundum",
    formula: "Al₂O₃",
    cell: hexagonal(4.759092, 12.99337),
    sites: [
      { sp: "Al", x: 0, y: 0, z: 0.35216, B: 0.32 },
      { sp: "O", x: 0.30624, y: 0, z: 0.25, B: 0.33 },
    ],
    ops: OPS_167,
    centring: [
      [2 / 3, 1 / 3, 1 / 3],
      [1 / 3, 2 / 3, 2 / 3],
    ],
    expect: { Al: 12, O: 18 },
    B: 0.33,
  },
  zircon: {
    id: "zircon",
    formula: "ZrSiO₄",
    cell: { a: 6.6042, b: 6.6042, c: 5.9796, alpha: 90, beta: 90, gamma: 90 },
    sites: [
      { sp: "Zr", x: 0, y: 0.75, z: 0.125, B: 0.3 },
      { sp: "Si", x: 0, y: 0.25, z: 0.375, B: 0.32 },
      { sp: "O", x: 0, y: 0.066, z: 0.1951, B: 0.52 },
    ],
    ops: OPS_141,
    centring: [[0.5, 0.5, 0.5]],
    expect: { Zr: 4, Si: 4, O: 16 },
    B: 0.4,
  },
};

export const CRYSTAL_IDS = Object.keys(CRYSTALS) as CrystalId[];

// ---- Symmetry -------------------------------------------------------------------------------

type Affine = { m: number[]; t: number[] };

const parseTerm = (expr: string): { coef: number[]; t: number } => {
  const coef = [0, 0, 0];
  let t = 0;
  const s = expr.replace(/\s+/g, "");
  const re = /([+-]?)([^+-]+)/g;
  for (const m of s.matchAll(re)) {
    const sign = m[1] === "-" ? -1 : 1;
    const body = m[2]!;
    const axis = "xyz".indexOf(body);
    if (axis >= 0) coef[axis] = coef[axis]! + sign;
    else if (body.includes("/")) {
      const [p, q] = body.split("/").map(Number);
      t += (sign * p!) / q!;
    } else t += sign * Number(body);
  }
  return { coef, t };
};

/** "x-y,-y,-z+1/3" as a 3 x 3 matrix and a translation. */
export const parseOp = (op: string): Affine => {
  const parts = op.split(",");
  if (parts.length !== 3) throw new Error(`bad symmetry op ${op}`);
  const m: number[] = [];
  const t: number[] = [];
  for (const p of parts) {
    const r = parseTerm(p);
    m.push(...r.coef);
    t.push(r.t);
  }
  return { m, t };
};

const wrap = (v: number) => {
  const w = v - Math.floor(v);
  return w > 1 - 1e-6 ? 0 : w;
};

const cache = new Map<CrystalId, Site[]>();

/** Every atom in one cell, positions in [0, 1). */
export const cellAtoms = (c: Crystal): Site[] => {
  const hit = cache.get(c.id);
  if (hit) return hit;
  const ops = (c.ops ?? ["x,y,z"]).map(parseOp);
  const shifts: (readonly [number, number, number])[] = [[0, 0, 0], ...(c.centring ?? [])];
  const out: Site[] = [];
  for (const site of c.sites) {
    for (const op of ops) {
      const p = [site.x, site.y, site.z];
      const q = [0, 1, 2].map(
        (r) =>
          op.m[r * 3]! * p[0]! + op.m[r * 3 + 1]! * p[1]! + op.m[r * 3 + 2]! * p[2]! + op.t[r]!,
      );
      for (const sh of shifts) {
        const x = wrap(q[0]! + sh[0]);
        const y = wrap(q[1]! + sh[1]);
        const z = wrap(q[2]! + sh[2]);
        const dup = out.some((o) => {
          if (o.sp !== site.sp) return false;
          const d = (u: number, v: number) => Math.min(Math.abs(u - v), 1 - Math.abs(u - v));
          return d(o.x, x) < 1e-4 && d(o.y, y) < 1e-4 && d(o.z, z) < 1e-4;
        });
        if (!dup) out.push({ sp: site.sp, x, y, z, occ: site.occ, B: site.B });
      }
    }
  }
  cache.set(c.id, out);
  return out;
};

// ---- Geometry -------------------------------------------------------------------------------

export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;

/** The cell's edges as Cartesian vectors: a along x, b in the xy plane. */
export const directBasis = (cell: Cell): [Vec3, Vec3, Vec3] => {
  const ca = Math.cos(cell.alpha * DEG);
  const cb = Math.cos(cell.beta * DEG);
  const cg = Math.cos(cell.gamma * DEG);
  const sg = Math.sin(cell.gamma * DEG);
  const cx = cell.c * cb;
  const cy = (cell.c * (ca - cb * cg)) / sg;
  const cz = Math.sqrt(Math.max(0, cell.c * cell.c - cx * cx - cy * cy));
  return [
    [cell.a, 0, 0],
    [cell.b * cg, cell.b * sg, 0],
    [cx, cy, cz],
  ];
};

const cross = (u: Vec3, v: Vec3): Vec3 => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
];
const dot = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

/** a*, b*, c* with a·a* = 1 (no 2π), Å⁻¹. */
export const reciprocalBasis = (cell: Cell): [Vec3, Vec3, Vec3] => {
  const [a, b, c] = directBasis(cell);
  const v = dot(a, cross(b, c));
  const s = (u: Vec3): Vec3 => [u[0] / v, u[1] / v, u[2] / v];
  return [s(cross(b, c)), s(cross(c, a)), s(cross(a, b))];
};

/** The reciprocal lattice point of (h k l), Å⁻¹, in the cell's Cartesian frame. */
export const gVector = (cell: Cell, h: number, k: number, l: number): Vec3 => {
  const [as, bs, cs] = reciprocalBasis(cell);
  return [
    h * as[0] + k * bs[0] + l * cs[0],
    h * as[1] + k * bs[1] + l * cs[1],
    h * as[2] + k * bs[2] + l * cs[2],
  ];
};

/** Spacing of the (h k l) planes, Å. */
export const dSpacing = (cell: Cell, h: number, k: number, l: number): number => {
  const g = gVector(cell, h, k, l);
  return 1 / Math.hypot(g[0], g[1], g[2]);
};

/** 2θ (degrees) of spacing d under wavelength λ, or null when λ > 2d (it can't reflect). */
export const twoTheta = (d: number, lambda: number): number | null => {
  const s = lambda / (2 * d);
  return s > 1 ? null : (2 * Math.asin(s)) / DEG;
};

// ---- Brightness -----------------------------------------------------------------------------

/** The structure factor of (h k l): one arrow per atom, added tip to tail. */
export const structureFactor = (
  c: Crystal,
  h: number,
  k: number,
  l: number,
): { re: number; im: number } => {
  const S = 1 / dSpacing(c.cell, h, k, l);
  const s2 = (S / 2) ** 2;
  let re = 0;
  let im = 0;
  for (const at of cellAtoms(c)) {
    const f = formFactor(at.sp, S) * (at.occ ?? 1) * Math.exp(-(at.B ?? c.B ?? 0.5) * s2);
    const ph = 2 * Math.PI * (h * at.x + k * at.y + l * at.z);
    re += f * Math.cos(ph);
    im += f * Math.sin(ph);
  }
  return { re, im };
};

export const brightness = (c: Crystal, h: number, k: number, l: number): number => {
  const F = structureFactor(c, h, k, l);
  return F.re * F.re + F.im * F.im;
};

/** Lorentz-polarisation for a powder, unpolarised beam (Dinnebier and Scardi 2023). */
export const lorentzPolarisation = (twoThetaDeg: number): number => {
  const t = (twoThetaDeg * DEG) / 2;
  const c2 = Math.cos(2 * t);
  return (1 + c2 * c2) / (Math.sin(t) ** 2 * Math.cos(t));
};

export interface Ring {
  /** One family's indices (the largest h, then k, then l among those sharing the ring). */
  hkl: [number, number, number];
  d: number;
  /** |S| = 1/d, Å⁻¹. */
  S: number;
  twoTheta: number;
  /** Families sharing this spacing. */
  multiplicity: number;
  /** Height, 100 for the strongest ring. */
  height: number;
  /** |F|² of one family, electrons². */
  F2: number;
}

/** Fraction of the strongest |F|² below which a reflection counts as missing. */
export const ABSENT = 1e-3;

const ringSets = new Map<string, Ring[]>();
const MAX_RING_SETS = 16;

/**
 * A powder's rings under wavelength λ: every reflection grouped by spacing. The machine and the
 * cards ask for them every frame, so the last few sets are kept; the rings are shared, so callers
 * must not change them (the array is the caller's own).
 */
export const powderRings = (
  c: Crystal,
  lambda: number,
  opts: { maxTwoTheta?: number } = {},
): Ring[] => {
  const max2t = opts.maxTwoTheta ?? 150;
  const key = `${c.id}:${lambda}:${max2t}`;
  const hit = ringSets.get(key);
  if (hit) return hit.slice();
  const rings = findRings(c, lambda, max2t);
  if (ringSets.size >= MAX_RING_SETS) ringSets.delete(ringSets.keys().next().value!);
  ringSets.set(key, rings);
  return rings.slice();
};

const findRings = (c: Crystal, lambda: number, max2t: number): Ring[] => {
  const sMax = (2 * Math.sin((max2t * DEG) / 2)) / lambda;
  // h = S·a for a reflection at S, so |S| ≤ sMax needs |h| ≤ sMax·a.
  const hMax = Math.ceil(sMax * c.cell.a) + 1;
  const kMax = Math.ceil(sMax * c.cell.b) + 1;
  const lMax = Math.ceil(sMax * c.cell.c) + 1;
  const groups = new Map<
    string,
    { d: number; F2: number; n: number; hkl: [number, number, number] }
  >();
  let strongest = 0;
  const found: { d: number; F2: number; hkl: [number, number, number] }[] = [];
  for (let h = -hMax; h <= hMax; h++) {
    for (let k = -kMax; k <= kMax; k++) {
      for (let l = -lMax; l <= lMax; l++) {
        if (h === 0 && k === 0 && l === 0) continue;
        const d = dSpacing(c.cell, h, k, l);
        if (1 / d > sMax) continue;
        const F2 = brightness(c, h, k, l);
        strongest = Math.max(strongest, F2);
        found.push({ d, F2, hkl: [h, k, l] });
      }
    }
  }
  for (const r of found) {
    if (r.F2 < strongest * ABSENT) continue;
    const key = r.d.toFixed(4);
    const g = groups.get(key);
    const better = (a: [number, number, number], b: [number, number, number]) =>
      a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
    if (!g) groups.set(key, { d: r.d, F2: r.F2, n: 1, hkl: r.hkl });
    else {
      g.F2 += r.F2;
      g.n++;
      if (better(r.hkl, g.hkl)) g.hkl = r.hkl;
    }
  }
  const rings: Ring[] = [];
  for (const g of groups.values()) {
    const tt = twoTheta(g.d, lambda);
    if (tt === null || tt > max2t) continue;
    rings.push({
      hkl: g.hkl,
      d: g.d,
      S: 1 / g.d,
      twoTheta: tt,
      multiplicity: g.n,
      height: g.F2 * lorentzPolarisation(tt),
      F2: g.F2 / g.n,
    });
  }
  rings.sort((a, b) => b.d - a.d);
  const top = Math.max(...rings.map((r) => r.height), 1e-12);
  for (const r of rings) r.height = (100 * r.height) / top;
  return rings;
};
