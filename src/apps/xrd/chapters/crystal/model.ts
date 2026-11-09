/**
 * Chapter 3's crystals as geometry: a block of cells of each tile's crystal with its atoms,
 * bonds and one cell outlined, the families of planes through it and the gap d between them, the
 * view that looks along a family's layers edge on, and the everyday grain each crystal comes as.
 * Pure: the canvas drawing (watch.ts) and the 3D figure (scene.ts) both draw from it.
 *
 * World space: Å, the block centred on the origin, x right, y up (the crystal's c axis), z
 * towards the viewer at no turn. Cells and atoms come from `crystals.ts`.
 */
import {
  cellAtoms,
  CRYSTALS,
  type CrystalId,
  directBasis,
  dSpacing,
  reciprocalBasis,
  type Species,
  type Vec3,
} from "../../crystals";

export type TileId = "salt" | "foil" | "diamond" | "lead" | "ice" | "sand";
export type GrainShape = "cube" | "sheet" | "octahedron" | "plate" | "prism" | "point";
export type Hkl = readonly [number, number, number];

export interface Tile {
  id: TileId;
  crystal: CrystalId;
  grain: GrainShape;
  /** Cells along a, b and c in the block. */
  cells: readonly [number, number, number];
  /** Atoms closer than this are joined, Å; 0 for none. */
  bond: number;
  /**
   * Families of planes to show, chosen so that the atoms lie on (or close to) the planes: for
   * salt every layer holds both kinds of atom, for diamond, graphite and ice the layers are the
   * crystal's own sheets.
   */
  families: readonly Hkl[];
}

export const TILES: readonly Tile[] = [
  {
    id: "salt",
    crystal: "salt",
    grain: "cube",
    cells: [3, 3, 3],
    bond: 2.9,
    families: [
      [2, 0, 0],
      [2, 2, 0],
      [2, 2, 2],
    ],
  },
  {
    id: "foil",
    crystal: "aluminium",
    grain: "sheet",
    cells: [4, 4, 4],
    bond: 0,
    families: [
      [1, 1, 1],
      [2, 0, 0],
      [2, 2, 0],
    ],
  },
  {
    id: "diamond",
    crystal: "diamond",
    grain: "octahedron",
    cells: [3, 3, 3],
    bond: 1.6,
    families: [
      [1, 1, 1],
      [2, 2, 0],
      [4, 0, 0],
    ],
  },
  {
    id: "lead",
    crystal: "graphite",
    grain: "plate",
    cells: [5, 5, 2],
    bond: 1.5,
    families: [
      [0, 0, 2],
      [1, 0, 0],
      [1, 1, 0],
    ],
  },
  {
    id: "ice",
    crystal: "ice",
    grain: "prism",
    cells: [3, 3, 2],
    bond: 2.85,
    families: [
      [0, 0, 2],
      [1, 0, 0],
      [1, 1, 0],
    ],
  },
  {
    id: "sand",
    crystal: "quartz",
    grain: "point",
    cells: [3, 3, 3],
    bond: 1.75,
    families: [
      [1, 0, 1],
      [1, 0, 0],
      [0, 0, 3],
    ],
  },
];

export const TILE_IDS: readonly TileId[] = TILES.map((t) => t.id);
export const tileOf = (id: TileId): Tile => TILES.find((t) => t.id === id)!;

/** How each kind of atom is drawn: radius (Å) and colour, all greens (real space). */
export const LOOK: Partial<Record<Species, { r: number; colour: string }>> = {
  "Na+": { r: 0.55, colour: "#5fbf7a" },
  "Cl-": { r: 0.95, colour: "#bdebcb" },
  Al: { r: 0.72, colour: "#89da9b" },
  C: { r: 0.42, colour: "#89da9b" },
  O: { r: 0.56, colour: "#bdebcb" },
  Si: { r: 0.62, colour: "#5fbf7a" },
};
export const lookOf = (sp: Species) => LOOK[sp] ?? { r: 0.6, colour: "#89da9b" };

export interface Atom {
  sp: Species;
  p: Vec3;
}

export interface Block {
  tile: Tile;
  atoms: Atom[];
  /** Pairs of atom indices. */
  bonds: [number, number][];
  /** The outlined cell's edges, as pairs of corners. */
  cell: [Vec3, Vec3][];
  /** The block's corners (fractional box [0, n]), world. */
  corners: Vec3[];
  /** Largest distance of any atom from the middle, Å. */
  radius: number;
  /** World vectors of the cell's edges a, b and c. */
  axes: [Vec3, Vec3, Vec3];
}

/** Crystal Cartesian (c along z) to world (c up): a turn of a right angle about x. */
const toWorld = (v: Vec3): Vec3 => [v[0], v[2], -v[1]];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

const blocks = new Map<TileId, Block>();

/** The tile's block of cells, built once. */
export const blockOf = (tile: Tile): Block => {
  const hit = blocks.get(tile.id);
  if (hit) return hit;
  const c = CRYSTALS[tile.crystal];
  const [A, B, C] = directBasis(c.cell).map(toWorld) as [Vec3, Vec3, Vec3];
  const [na, nb, nc] = tile.cells;
  const at = (u: number, v: number, w: number): Vec3 =>
    add(add(scale(A, u), scale(B, v)), scale(C, w));
  const mid = at(na / 2, nb / 2, nc / 2);
  const eps = 1e-4;
  const atoms: Atom[] = [];
  for (const s of cellAtoms(c)) {
    for (let i = 0; i <= na; i++)
      for (let j = 0; j <= nb; j++)
        for (let k = 0; k <= nc; k++) {
          const u = i + s.x;
          const v = j + s.y;
          const w = k + s.z;
          if (u > na + eps || v > nb + eps || w > nc + eps) continue;
          atoms.push({ sp: s.sp, p: sub(at(u, v, w), mid) });
        }
  }
  const bonds: [number, number][] = [];
  if (tile.bond > 0) {
    const b2 = tile.bond * tile.bond;
    for (let i = 0; i < atoms.length; i++)
      for (let j = i + 1; j < atoms.length; j++) {
        const d = sub(atoms[i]!.p, atoms[j]!.p);
        const q = dot(d, d);
        if (q < b2 && q > 0.25) bonds.push([i, j]);
      }
  }
  // The outlined cell: the one nearest the middle.
  const o: [number, number, number] = [Math.floor(na / 2), Math.floor(nb / 2), Math.floor(nc / 2)];
  const corner = (dx: number, dy: number, dz: number) =>
    sub(at(o[0] + dx, o[1] + dy, o[2] + dz), mid);
  const cell: [Vec3, Vec3][] = [];
  for (const [a, b] of BOX_EDGES) cell.push([corner(...a), corner(...b)]);
  const corners = BOX_CORNERS.map(([u, v, w]) => sub(at(u * na, v * nb, w * nc), mid));
  let radius = 0;
  for (const a of atoms) radius = Math.max(radius, Math.hypot(...a.p));
  const block: Block = { tile, atoms, bonds, cell, corners, radius, axes: [A, B, C] };
  blocks.set(tile.id, block);
  return block;
};

const BOX_CORNERS: readonly [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];
const BOX_EDGES: readonly [[number, number, number], [number, number, number]][] = [
  [
    [0, 0, 0],
    [1, 0, 0],
  ],
  [
    [0, 1, 0],
    [1, 1, 0],
  ],
  [
    [0, 0, 1],
    [1, 0, 1],
  ],
  [
    [0, 1, 1],
    [1, 1, 1],
  ],
  [
    [0, 0, 0],
    [0, 1, 0],
  ],
  [
    [1, 0, 0],
    [1, 1, 0],
  ],
  [
    [0, 0, 1],
    [0, 1, 1],
  ],
  [
    [1, 0, 1],
    [1, 1, 1],
  ],
  [
    [0, 0, 0],
    [0, 0, 1],
  ],
  [
    [1, 0, 0],
    [1, 0, 1],
  ],
  [
    [0, 1, 0],
    [0, 1, 1],
  ],
  [
    [1, 1, 0],
    [1, 1, 1],
  ],
];

export interface Family {
  hkl: Hkl;
  /** The gap between layers, Å. */
  d: number;
  /** Unit normal, world. */
  normal: Vec3;
  /** A short row of atoms lying in the layers, world, unit: looking along it shows them edge on. */
  along: Vec3;
  /** Each layer cut to the block, as a polygon of world points. */
  planes: Vec3[][];
  /** Where each layer crosses the normal through the middle, Å along the normal. */
  levels: number[];
}

export const MAX_PLANES = 24;

const families = new Map<string, Family>();

/** A family of planes through the tile's block, built once. */
export const familyOf = (tile: Tile, hkl: Hkl): Family => {
  const key = `${tile.id}:${hkl.join(",")}`;
  const hit = families.get(key);
  if (hit) return hit;
  const c = CRYSTALS[tile.crystal];
  const [h, k, l] = hkl;
  const block = blockOf(tile);
  const [as, bs, cs] = reciprocalBasis(c.cell);
  const G = toWorld([
    h * as[0] + k * bs[0] + l * cs[0],
    h * as[1] + k * bs[1] + l * cs[1],
    h * as[2] + k * bs[2] + l * cs[2],
  ]);
  const d = dSpacing(c.cell, h, k, l);
  const normal = norm(G);
  // G·r is the layer's number at r: the layers are G·r = m + shift, one per whole number m.
  // The shift puts them through as many atoms as it can.
  const frac = (x: number) => x - Math.floor(x);
  let shift = 0;
  let most = -1;
  for (const a of block.atoms) {
    const t = frac(dot(G, a.p));
    let n = 0;
    for (const b of block.atoms) {
      const e = Math.abs(frac(dot(G, b.p) - t + 0.5) - 0.5);
      if (e < 0.06) n++;
    }
    if (n > most) {
      most = n;
      shift = t;
    }
  }
  const vals = block.corners.map((p) => dot(G, p));
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const planes: Vec3[][] = [];
  const levels: number[] = [];
  const m0 = Math.ceil(lo - shift - 1e-6);
  const m1 = Math.floor(hi - shift + 1e-6);
  for (let m = m0; m <= m1 && planes.length < MAX_PLANES; m++) {
    const t = m + shift;
    const poly = cut(block.corners, G, t);
    if (poly.length >= 3) {
      planes.push(poly);
      levels.push(t * d);
    }
  }
  const fam: Family = { hkl, d, normal, along: alongRow(tile, hkl), planes, levels };
  families.set(key, fam);
  return fam;
};

/** The block (a parallelepiped by its 8 corners, in BOX_CORNERS order) cut by G·r = t. */
const cut = (corners: readonly Vec3[], G: Vec3, t: number): Vec3[] => {
  const pts: Vec3[] = [];
  const idx = (c: readonly [number, number, number]) => c[0] + c[1] * 2 + c[2] * 4;
  for (const [a, b] of BOX_EDGES) {
    const p = corners[idx(a)]!;
    const q = corners[idx(b)]!;
    const fp = dot(G, p) - t;
    const fq = dot(G, q) - t;
    if ((fp < -1e-9 && fq < -1e-9) || (fp > 1e-9 && fq > 1e-9)) continue;
    if (Math.abs(fp - fq) < 1e-12) continue;
    const s = fp / (fp - fq);
    const r = add(p, scale(sub(q, p), s));
    if (!pts.some((x) => Math.hypot(...sub(x, r)) < 1e-6)) pts.push(r);
  }
  if (pts.length < 3) return pts;
  // In order round their middle.
  const n = norm(G);
  const mid = scale(
    pts.reduce((s, p) => add(s, p), [0, 0, 0] as Vec3),
    1 / pts.length,
  );
  const e1 = norm(sub(pts[0]!, mid));
  const e2 = cross(n, e1);
  return pts
    .map((p) => ({ p, a: Math.atan2(dot(sub(p, mid), e2), dot(sub(p, mid), e1)) }))
    .sort((x, y) => x.a - y.a)
    .map((x) => x.p);
};

/** The shortest lattice row [u v w] (|u|, |v|, |w| ≤ 2) in the layers of (h k l), world, unit. */
const alongRow = (tile: Tile, hkl: Hkl): Vec3 => {
  const c = CRYSTALS[tile.crystal];
  const [A, B, C] = directBasis(c.cell).map(toWorld) as [Vec3, Vec3, Vec3];
  let best: Vec3 | null = null;
  let bestLen = Number.POSITIVE_INFINITY;
  for (let u = -2; u <= 2; u++)
    for (let v = -2; v <= 2; v++)
      for (let w = -2; w <= 2; w++) {
        if ((u === 0 && v === 0 && w === 0) || hkl[0] * u + hkl[1] * v + hkl[2] * w !== 0) continue;
        const r = add(add(scale(A, u), scale(B, v)), scale(C, w));
        const len = Math.hypot(...r);
        // Prefer rows that lie level, so the layers come out flat; then the shortest.
        const score = len - 0.01 * Math.abs(norm(r)[0]);
        if (score < bestLen - 1e-9) {
          bestLen = score;
          best = r;
        }
      }
  return norm(best ?? [0, 0, 1]);
};

/** d for a cubic cell from the chapter's formula, d = a / √(h² + k² + l²). */
export const cubicD = (a: number, hkl: Hkl): number =>
  a / Math.sqrt(hkl[0] ** 2 + hkl[1] ** 2 + hkl[2] ** 2);

export const isCubic = (tile: Tile): boolean => {
  const c = CRYSTALS[tile.crystal].cell;
  return c.a === c.b && c.b === c.c && c.alpha === 90 && c.beta === 90 && c.gamma === 90;
};

// ---- Turning ----------------------------------------------------------------------------------

/** A turn as a 3 x 3 matrix, rows the screen's right, up and towards-the-viewer, in world. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

const DEG = Math.PI / 180;

/** Turn about the upright by `yaw`, then tip towards the viewer by `pitch` (degrees). */
export const turnOf = (yaw: number, pitch: number): Mat3 => {
  const cy = Math.cos(yaw * DEG);
  const sy = Math.sin(yaw * DEG);
  const cp = Math.cos(pitch * DEG);
  const sp = Math.sin(pitch * DEG);
  // Rx(pitch) · Ry(yaw)
  return [cy, 0, sy, sp * sy, cp, -sp * cy, -cp * sy, sp, cp * cy];
};

/** The turn that looks along a family's layers, edge on, with the layers lying level. */
export const edgeOn = (f: Family): Mat3 => {
  const up = f.normal;
  const out = f.along;
  const right = cross(up, out);
  return [...right, ...up, ...out] as Mat3;
};

export const apply = (m: Mat3, p: Vec3): Vec3 => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
  m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
  m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
];

type Quat = [number, number, number, number];

const toQuat = (m: Mat3): Quat => {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
};

const fromQuat = ([x, y, z, w]: Quat): Mat3 => [
  1 - 2 * (y * y + z * z),
  2 * (x * y - z * w),
  2 * (x * z + y * w),
  2 * (x * y + z * w),
  1 - 2 * (x * x + z * z),
  2 * (y * z - x * w),
  2 * (x * z - y * w),
  2 * (y * z + x * w),
  1 - 2 * (x * x + y * y),
];

/** The turn `t` of the way from `a` to `b`, along the shortest way round. */
export const between = (a: Mat3, b: Mat3, t: number): Mat3 => {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const p = toQuat(a);
  let q = toQuat(b);
  let c = p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3];
  if (c < 0) {
    q = q.map((x) => -x) as Quat;
    c = -c;
  }
  let k0 = 1 - t;
  let k1 = t;
  if (c < 0.9995) {
    const o = Math.acos(Math.min(1, c));
    k0 = Math.sin((1 - t) * o) / Math.sin(o);
    k1 = Math.sin(t * o) / Math.sin(o);
  }
  const r = p.map((x, i) => x * k0 + q[i]! * k1) as Quat;
  const l = Math.hypot(...r) || 1;
  return fromQuat(r.map((x) => x / l) as Quat);
};

// ---- Grains ---------------------------------------------------------------------------------

export interface Solid {
  vertices: Vec3[];
  faces: number[][];
}

const prism = (sides: number, half: number, cap = 0, radius = 0.55): Solid => {
  const v: Vec3[] = [];
  for (const y of [-half, half])
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      v.push([radius * Math.cos(a), y, radius * Math.sin(a)]);
    }
  const faces: number[][] = [];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    faces.push([i, j, sides + j, sides + i]);
  }
  if (cap > 0) {
    v.push([0, -half - cap, 0], [0, half + cap, 0]);
    const bot = v.length - 2;
    const top = v.length - 1;
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      faces.push([j, i, bot]);
      faces.push([sides + i, sides + j, top]);
    }
  } else {
    faces.push(Array.from({ length: sides }, (_, i) => sides - 1 - i));
    faces.push(Array.from({ length: sides }, (_, i) => sides + i));
  }
  return { vertices: v, faces };
};

/** Each grain's shape, about one unit across. */
export const SOLIDS: Record<GrainShape, Solid> = {
  cube: {
    vertices: BOX_CORNERS.map(([x, y, z]) => [x - 0.5, y - 0.5, z - 0.5] as Vec3),
    faces: [
      [0, 2, 3, 1],
      [4, 5, 7, 6],
      [0, 1, 5, 4],
      [2, 6, 7, 3],
      [0, 4, 6, 2],
      [1, 3, 7, 5],
    ],
  },
  sheet: {
    vertices: BOX_CORNERS.map(
      ([x, y, z]) => [(x - 0.5) * 1.3, (y - 0.5) * 0.08, (z - 0.5) * 1.1] as Vec3,
    ),
    faces: [
      [0, 2, 3, 1],
      [4, 5, 7, 6],
      [0, 1, 5, 4],
      [2, 6, 7, 3],
      [0, 4, 6, 2],
      [1, 3, 7, 5],
    ],
  },
  octahedron: {
    vertices: [
      [0.62, 0, 0],
      [-0.62, 0, 0],
      [0, 0.62, 0],
      [0, -0.62, 0],
      [0, 0, 0.62],
      [0, 0, -0.62],
    ],
    faces: [
      [0, 2, 4],
      [4, 2, 1],
      [1, 2, 5],
      [5, 2, 0],
      [4, 3, 0],
      [1, 3, 4],
      [5, 3, 1],
      [0, 3, 5],
    ],
  },
  plate: prism(6, 0.07, 0, 0.62),
  prism: prism(6, 0.45, 0, 0.5),
  point: prism(6, 0.3, 0.22, 0.4),
};

/** What each grain looks like in the hand: a colour, and how see-through. */
export const GRAIN_LOOK: Record<GrainShape, { colour: [number, number, number]; alpha: number }> = {
  cube: { colour: [232, 238, 245], alpha: 0.95 },
  sheet: { colour: [201, 209, 220], alpha: 1 },
  octahedron: { colour: [205, 232, 255], alpha: 0.8 },
  plate: { colour: [96, 102, 116], alpha: 1 },
  prism: { colour: [190, 226, 255], alpha: 0.82 },
  point: { colour: [217, 196, 154], alpha: 0.95 },
};

/** The zoom's scale bar: a power of ten in metres, from a grain's millimetre to atoms' nanometre. */
export const ZOOM_DECADES = [-3, -4, -5, -6, -7, -8, -9] as const;
