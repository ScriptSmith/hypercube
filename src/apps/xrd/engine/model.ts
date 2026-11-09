/**
 * Flat model crystals for the diffraction engine, and drawing them into a grid. Pure.
 *
 * A model is a list of atoms in Å, each a soft disc (a Gaussian of width `sigma`) weighted by its
 * electron count. The functions here make the models chapters 6 to 10 need: a lattice with a
 * basis, a finite crystal, grains scattered over a field, and a helix seen from the side.
 * Everything is labelled a flat model in the app: real crystals are three-dimensional.
 *
 * Model space has y up. In the grid, column = n/2 + x·n/span and row = n/2 − y·n/span, so the
 * grid's centre is the model's origin and `span` Å fit across it.
 */

/** x, y (Å), weight (electrons) and sigma (Å) for each atom. */
export const ATOM_STRIDE = 4;

export interface Atoms {
  data: Float32Array;
  count: number;
}

export type Vec2 = readonly [number, number];

/** One atom of a cell's basis: fractional position (u along a, v along b). */
export interface BasisAtom {
  u: number;
  v: number;
  /** Electrons. */
  z: number;
  /** Soft-disc width, Å. Default 0.45. */
  sigma?: number;
}

export const DEFAULT_SIGMA = 0.45;
/** Most atoms a model may hold, so a job stays small and fast. */
export const MAX_ATOMS = 24_000;

export const atomsFrom = (list: readonly (readonly [number, number, number, number])[]): Atoms => {
  const count = Math.min(list.length, MAX_ATOMS);
  const data = new Float32Array(count * ATOM_STRIDE);
  for (let i = 0; i < count; i++) data.set(list[i]!, i * ATOM_STRIDE);
  return { data, count };
};

/** A growable list that stops at MAX_ATOMS. */
export interface AtomWriter {
  push(x: number, y: number, z: number, sigma: number): boolean;
  done(): Atoms;
  readonly count: number;
}

export const atomWriter = (capacity = 1024): AtomWriter => {
  let data = new Float32Array(Math.max(1, Math.min(capacity, MAX_ATOMS)) * ATOM_STRIDE);
  let count = 0;
  return {
    push(x, y, z, sigma) {
      if (count >= MAX_ATOMS) return false;
      if ((count + 1) * ATOM_STRIDE > data.length) {
        const next = new Float32Array(Math.min(MAX_ATOMS, count * 2 + 16) * ATOM_STRIDE);
        next.set(data);
        data = next;
      }
      const i = count * ATOM_STRIDE;
      data[i] = x;
      data[i + 1] = y;
      data[i + 2] = z;
      data[i + 3] = sigma;
      count++;
      return true;
    },
    done() {
      return { data: data.slice(0, count * ATOM_STRIDE), count };
    },
    get count() {
      return count;
    },
  };
};

const rotate = (x: number, y: number, c: number, s: number): Vec2 => [x * c - y * s, x * s + y * c];

/** The window's weight at radius r: 1 inside, falling smoothly to 0 over the outer `taper`. */
const edge = (r: number, radius: number, taper: number): number => {
  if (taper <= 0) return r <= radius ? 1 : 0;
  if (r <= radius - taper) return 1;
  if (r >= radius) return 0;
  const t = (radius - r) / taper;
  return Math.sin((t * Math.PI) / 2) ** 2;
};

export interface LatticeSpec {
  /** Cell edges, Å. */
  a: Vec2;
  b: Vec2;
  basis: readonly BasisAtom[];
  /** A round crystal of this radius (Å), or `na` by `nb` cells centred on the origin. */
  extent: { radius: number; taper?: number } | { na: number; nb: number };
  /** Turn of the whole crystal, radians, counterclockwise. */
  angle?: number;
  centre?: Vec2;
  /** Weight scale for every atom (a grain's share of the light, say). */
  weight?: number;
}

/** Atoms of a crystal: a lattice of cells, each holding the basis. */
export const latticeAtoms = (spec: LatticeSpec, out: AtomWriter = atomWriter()): Atoms => {
  addLattice(spec, out);
  return out.done();
};

export const addLattice = (spec: LatticeSpec, out: AtomWriter): void => {
  const c = Math.cos(spec.angle ?? 0);
  const s = Math.sin(spec.angle ?? 0);
  const [cx, cy] = spec.centre ?? [0, 0];
  const w0 = spec.weight ?? 1;
  const [ax, ay] = spec.a;
  const [bx, by] = spec.b;
  const place = (i: number, j: number, k: number, wEdge: number) => {
    const at = spec.basis[k]!;
    const lx = (i + at.u) * ax + (j + at.v) * bx;
    const ly = (i + at.u) * ay + (j + at.v) * by;
    const [x, y] = rotate(lx, ly, c, s);
    return out.push(x + cx, y + cy, at.z * w0 * wEdge, at.sigma ?? DEFAULT_SIGMA);
  };
  if ("na" in spec.extent) {
    const na = Math.max(1, Math.round(spec.extent.na));
    const nb = Math.max(1, Math.round(spec.extent.nb));
    // Centre the block of cells on the origin.
    const i0 = -na / 2;
    const j0 = -nb / 2;
    for (let i = 0; i < na; i++) {
      for (let j = 0; j < nb; j++) {
        for (let k = 0; k < spec.basis.length; k++) if (!place(i + i0, j + j0, k, 1)) return;
      }
    }
    return;
  }
  const { radius } = spec.extent;
  const taper = Math.max(0, Math.min(radius, spec.extent.taper ?? 0));
  // Enough cells to cover the disc along both edges, whatever the cell's shape.
  const area = Math.abs(ax * by - ay * bx) || 1;
  const reach = Math.ceil((radius * Math.max(Math.hypot(ax, ay), Math.hypot(bx, by))) / area) + 2;
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      for (let k = 0; k < spec.basis.length; k++) {
        const at = spec.basis[k]!;
        const lx = (i + at.u) * ax + (j + at.v) * bx;
        const ly = (i + at.u) * ay + (j + at.v) * by;
        const w = edge(Math.hypot(lx, ly), radius, taper);
        if (w <= 0) continue;
        if (!place(i, j, k, w)) return;
      }
    }
  }
};

/** A square cell of edge `a` with one atom at its corner, the simplest crystal. */
export const squareCell = (
  a: number,
  z = 13,
  sigma = DEFAULT_SIGMA,
): Pick<LatticeSpec, "a" | "b" | "basis"> => ({
  a: [a, 0],
  b: [0, a],
  basis: [{ u: 0, v: 0, z, sigma }],
});

/** Where each grain sits and how it is turned. */
export interface Grain {
  x: number;
  y: number;
  /** Radians. */
  angle: number;
}

/** A seeded uniform stream in [0, 1) (mulberry32), so grains come out the same on every frame. */
export const seeded = (seed: number): (() => number) => {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export interface GrainSpec {
  count: number;
  /** Radius of the field the grains fill, Å. */
  field: number;
  /** Radius of one grain, Å; grains keep about this far from each other where they can. */
  size: number;
  seed: number;
  /**
   * How far each grain's turn strays from `angle`, radians: π or more is a powder, a small
   * spread a textured foil, 0 grains all lined up like one crystal.
   */
  spread: number;
  angle?: number;
}

/** Grains scattered over a disc without much overlap, turned within the spread. */
export const scatterGrains = (spec: GrainSpec): Grain[] => {
  const rand = seeded(spec.seed);
  const count = Math.max(0, Math.min(2000, Math.round(spec.count)));
  const out: Grain[] = [];
  const reach = Math.max(0, spec.field - spec.size);
  const minGap = spec.size * 1.6;
  for (let i = 0; i < count; i++) {
    let best: Grain | null = null;
    let bestGap = -1;
    // Best of a few tries: the candidate farthest from the grains already placed.
    for (let t = 0; t < 12; t++) {
      const r = reach * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      const x = r * Math.cos(a);
      const y = r * Math.sin(a);
      let gap = Number.POSITIVE_INFINITY;
      for (const g of out) gap = Math.min(gap, Math.hypot(g.x - x, g.y - y));
      if (gap > bestGap) {
        bestGap = gap;
        best = { x, y, angle: 0 };
      }
      if (gap >= minGap) break;
    }
    const turn = (spec.angle ?? 0) + (rand() * 2 - 1) * spec.spread;
    out.push({ ...best!, angle: turn });
  }
  return out;
};

/** Every grain as a small crystal, for drawing a whole powder in one picture. */
export const grainAtoms = (
  cell: Pick<LatticeSpec, "a" | "b" | "basis">,
  grains: readonly Grain[],
  size: number,
): Atoms => {
  const out = atomWriter(grains.length * 32);
  for (const g of grains) {
    addLattice(
      { ...cell, extent: { radius: size, taper: size * 0.3 }, angle: g.angle, centre: [g.x, g.y] },
      out,
    );
    if (out.count >= MAX_ATOMS) break;
  }
  return out.done();
};

export interface HelixSpec {
  /** Rise per turn, Å. */
  pitch: number;
  /** Å. */
  radius: number;
  strands: 1 | 2;
  /** The second strand's shift along the axis, as a fraction of the pitch (DNA: 3/8). */
  offset: number;
  /** Atoms per turn on each strand. */
  perTurn: number;
  turns: number;
  z?: number;
  sigma?: number;
  /** Tilt of the axis from upright, radians. */
  angle?: number;
}

/**
 * A helix seen side on: each strand's atoms at x = r·cos(2π(y/P) + phase), y along the axis,
 * with the axis upright and centred on the origin.
 */
export const helixAtoms = (spec: HelixSpec): Atoms => {
  const out = atomWriter();
  const perTurn = Math.max(1, Math.round(spec.perTurn));
  const steps = Math.max(1, Math.round(spec.turns * perTurn));
  const rise = spec.pitch / perTurn;
  const y0 = -(steps * rise) / 2;
  const c = Math.cos(spec.angle ?? 0);
  const s = Math.sin(spec.angle ?? 0);
  const z = spec.z ?? 15;
  const sigma = spec.sigma ?? 1.2;
  for (let strand = 0; strand < spec.strands; strand++) {
    const shift = strand * spec.offset * spec.pitch;
    for (let i = 0; i < steps; i++) {
      const y = y0 + i * rise + shift;
      const x = spec.radius * Math.cos((2 * Math.PI * (i * rise)) / spec.pitch);
      // A gentle fade at both ends keeps the ends from streaking the pattern.
      const f = Math.min(1, (i + 0.5) / (perTurn * 0.75), (steps - i - 0.5) / (perTurn * 0.75));
      const [rx, ry] = rotate(x, y, c, s);
      out.push(rx, ry, z * Math.max(0.05, f), sigma);
    }
  }
  return out.done();
};

/** The grid pixel (column, row) of a model point. */
export const toGrid = (x: number, y: number, n: number, span: number): Vec2 => [
  n / 2 + (x * n) / span,
  n / 2 - (y * n) / span,
];

/**
 * Draw the atoms into an n x n grid of `span` Å as Gaussians, each holding its weight in total
 * (so the transform at the centre is the sum of the weights). Adds to `out`.
 */
export const rasterise = (
  atoms: Atoms,
  n: number,
  span: number,
  out: Float64Array,
): Float64Array => {
  const scale = n / span;
  const d = atoms.data;
  for (let k = 0; k < atoms.count; k++) {
    const i = k * ATOM_STRIDE;
    const w = d[i + 2]!;
    if (!(w > 0)) continue;
    const [cx, cy] = toGrid(d[i]!, d[i + 1]!, n, span);
    const sp = Math.max(0.6, d[i + 3]! * scale);
    const r = Math.ceil(sp * 3);
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(n - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(n - 1, Math.ceil(cy + r));
    if (x0 > x1 || y0 > y1) continue;
    const inv = 1 / (2 * sp * sp);
    const norm = w / (2 * Math.PI * sp * sp);
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const row = y * n;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const q = (dx * dx + dy * dy) * inv;
        if (q < 4.5) out[row + x] = out[row + x]! + norm * Math.exp(-q);
      }
    }
  }
  return out;
};
