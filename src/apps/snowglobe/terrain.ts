/**
 * What falling snow lands on: a scene's ground and the tops of its pieces, as a height map over
 * the mound's top in the scene's own frame (before it turns). Each cell also says which piece it
 * belongs to, so snow on a roof or a tree can slide off in a clump. Design metres.
 */
import { groundY, type Hills, RIM_RHO } from "./mound";

export type Collider = (
  | { kind: "box"; x: number; z: number; hw: number; hd: number; yaw?: number; top: number }
  /** A pitched roof whose ridge runs along its own x. */
  | {
      kind: "gable";
      x: number;
      z: number;
      hw: number;
      hd: number;
      yaw?: number;
      eave: number;
      ridge: number;
    }
  | { kind: "cone"; x: number; z: number; r: number; base: number; apex: number }
  | { kind: "cyl"; x: number; z: number; r: number; top: number }
  /** The top of an ellipsoid: `h` above `base` in the middle. */
  | { kind: "dome"; x: number; z: number; r: number; base: number; h: number }
) & {
  /** Snow on it slides off now and then, in a clump. */
  shed?: boolean;
};

export const GRID = 128;
export const GRID_HALF = RIM_RHO + 0.04;
const CELL = (2 * GRID_HALF) / GRID;

export interface Terrain {
  /** Heights, row by row in z then x; -Infinity off the mound's top. */
  readonly heights: Float32Array;
  /** 0 for the ground, else 1 + the collider's index. */
  readonly ids: Uint8Array;
  /** Whether snow slides off each collider (index 0 is the ground). */
  readonly sheds: readonly boolean[];
  /** The highest surface at (x, z), or -Infinity. */
  top(x: number, z: number): number;
  id(x: number, z: number): number;
  /** Steepness (rise over run) at (x, z). */
  slope(x: number, z: number): number;
  /** Downhill direction at (x, z), written as [x, z] into `out`. */
  downhill(x: number, z: number, out: Float32Array): void;
}

const colliderTop = (c: Collider, x: number, z: number): number => {
  switch (c.kind) {
    case "box":
    case "gable": {
      const yaw = c.yaw ?? 0;
      const cs = Math.cos(yaw);
      const sn = Math.sin(yaw);
      const dx = x - c.x;
      const dz = z - c.z;
      // Into the piece's own frame (yaw turns its x towards -z, as three.js does about y).
      const u = dx * cs - dz * sn;
      const v = dx * sn + dz * cs;
      if (Math.abs(u) > c.hw || Math.abs(v) > c.hd) return -Infinity;
      if (c.kind === "box") return c.top;
      return c.ridge - (c.ridge - c.eave) * (Math.abs(v) / c.hd);
    }
    case "cone": {
      const d = Math.hypot(x - c.x, z - c.z);
      return d > c.r ? -Infinity : c.base + (c.apex - c.base) * (1 - d / c.r);
    }
    case "cyl":
      return Math.hypot(x - c.x, z - c.z) > c.r ? -Infinity : c.top;
    case "dome": {
      const d = Math.hypot(x - c.x, z - c.z) / c.r;
      return d > 1 ? -Infinity : c.base + c.h * Math.sqrt(1 - d * d);
    }
  }
};

const reach = (c: Collider): number => {
  switch (c.kind) {
    case "box":
    case "gable":
      return Math.hypot(c.hw, c.hd);
    default:
      return c.r;
  }
};

export const buildTerrain = (hills: Hills, colliders: readonly Collider[]): Terrain => {
  const heights = new Float32Array(GRID * GRID);
  const ids = new Uint8Array(GRID * GRID);
  const centre = (i: number) => -GRID_HALF + (i + 0.5) * CELL;
  for (let j = 0; j < GRID; j++) {
    const z = centre(j);
    for (let i = 0; i < GRID; i++) {
      const x = centre(i);
      heights[j * GRID + i] = Math.hypot(x, z) <= RIM_RHO ? groundY(hills, x, z) : -Infinity;
    }
  }
  colliders.forEach((c, n) => {
    const r = reach(c);
    const i0 = Math.max(0, Math.floor((c.x - r + GRID_HALF) / CELL));
    const i1 = Math.min(GRID - 1, Math.ceil((c.x + r + GRID_HALF) / CELL));
    const j0 = Math.max(0, Math.floor((c.z - r + GRID_HALF) / CELL));
    const j1 = Math.min(GRID - 1, Math.ceil((c.z + r + GRID_HALF) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * GRID + i;
        if (heights[k] === -Infinity) continue;
        const h = colliderTop(c, centre(i), centre(j));
        if (h > heights[k]!) {
          heights[k] = h;
          ids[k] = Math.min(255, n + 1);
        }
      }
    }
  });
  const sheds = [false, ...colliders.map((c) => c.shed === true)];

  const cellOf = (x: number, z: number): number => {
    const i = Math.floor((x + GRID_HALF) / CELL);
    const j = Math.floor((z + GRID_HALF) / CELL);
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return -1;
    return j * GRID + i;
  };
  const at = (i: number, j: number): number => {
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return -Infinity;
    return heights[j * GRID + i]!;
  };
  const top = (x: number, z: number): number => {
    const fx = (x + GRID_HALF) / CELL - 0.5;
    const fz = (z + GRID_HALF) / CELL - 0.5;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const a = at(i, j);
    const b = at(i + 1, j);
    const c = at(i, j + 1);
    const d = at(i + 1, j + 1);
    if (a === -Infinity || b === -Infinity || c === -Infinity || d === -Infinity) {
      const k = cellOf(x, z);
      return k < 0 ? -Infinity : heights[k]!;
    }
    const u = fx - i;
    const v = fz - j;
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  const grad = (x: number, z: number, out: Float32Array): number => {
    const i = Math.floor((x + GRID_HALF) / CELL);
    const j = Math.floor((z + GRID_HALF) / CELL);
    const h = at(i, j);
    let l = at(i - 1, j);
    let r = at(i + 1, j);
    let d = at(i, j - 1);
    let u = at(i, j + 1);
    if (l === -Infinity) l = h;
    if (r === -Infinity) r = h;
    if (d === -Infinity) d = h;
    if (u === -Infinity) u = h;
    const gx = (r - l) / (2 * CELL);
    const gz = (u - d) / (2 * CELL);
    out[0] = -gx;
    out[1] = -gz;
    return Math.hypot(gx, gz);
  };
  const scratch = new Float32Array(2);
  return {
    heights,
    ids,
    sheds,
    top,
    id: (x, z) => {
      const k = cellOf(x, z);
      return k < 0 ? 0 : ids[k]!;
    },
    slope: (x, z) => grad(x, z, scratch),
    downhill: (x, z, out) => {
      const g = grad(x, z, out);
      if (g > 1e-6) {
        out[0] = out[0]! / g;
        out[1] = out[1]! / g;
      }
    },
  };
};
