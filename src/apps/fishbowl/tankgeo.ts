/**
 * Meshes for the tank's fixed parts in venue metres, built once from its layout: the ground and
 * where it meets the front glass, the back and side glass, stones and driftwood. Meshes that can
 * show in the surface's mirror are drawn twice by instancing (`aMirror` 0 and 1).
 */
import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Quaternion,
  Euler,
  Vector3,
} from "three";
import type { Rng } from "../../core/types";
import { rockFrame, type TankBox, type TankLayout } from "./tank";

/** Draw `g` twice, once as is and once reflected in the surface. */
export const twice = (g: BufferGeometry): InstancedBufferGeometry => {
  const out = new InstancedBufferGeometry();
  out.copy(g as InstancedBufferGeometry);
  out.instanceCount = 2;
  out.setAttribute("aMirror", new InstancedBufferAttribute(new Float32Array([0, 1]), 1));
  g.dispose();
  return out;
};

const grid = (
  nx: number,
  nz: number,
  at: (u: number, v: number) => [number, number, number],
): BufferGeometry => {
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const index: number[] = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const p = at(i / nx, j / nz);
      pos.set(p, (j * (nx + 1) + i) * 3);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
};

/** The ground's top, finer at the front where it is seen up close. */
export const buildGround = (layout: TankLayout, detail: number): BufferGeometry => {
  const { box, ground } = layout;
  const nx = Math.round(220 * detail);
  const nz = Math.round(70 * detail);
  const g = grid(nx, nz, (u, v) => {
    const x = box.left + (box.right - box.left) * u;
    // Rows close together near the glass.
    const z = box.back * v ** 1.4 - 0.004;
    return [x, ground(x, z), z];
  });
  g.computeVertexNormals();
  return g;
};

/** Where the ground meets the front glass: its cut face, seen straight on. */
export const buildSkirt = (layout: TankLayout): BufferGeometry => {
  const { box, ground } = layout;
  const n = 400;
  const g = grid(n, 1, (u, v) => {
    const x = box.glass.left + (box.glass.right - box.glass.left) * u;
    return [x, box.floor + (ground(x, -0.004) - box.floor) * v, -0.004];
  });
  const normal = new Float32Array(g.getAttribute("position").count * 3);
  for (let i = 0; i < normal.length; i += 3) normal[i + 2] = 1;
  g.setAttribute("normal", new BufferAttribute(normal, 3));
  return g;
};

/**
 * The back glass and the side panes, with fine rows so their mirrored copy can ripple. `aPane`
 * is 0 for the back and 1 for a side.
 */
export const buildPanes = (box: TankBox): InstancedBufferGeometry => {
  const top = box.glass.top + 0.4;
  const back = grid(120, 60, (u, v) => [
    box.left + (box.right - box.left) * u,
    box.floor + (top - box.floor) * v,
    box.back,
  ]);
  const left = grid(20, 30, (u, v) => [box.left, box.floor + (top - box.floor) * v, box.back * u]);
  const right = grid(20, 30, (u, v) => [
    box.right,
    box.floor + (top - box.floor) * v,
    box.back * (1 - u),
  ]);
  const parts = [back, left, right];
  const pos: number[] = [];
  const nrm: number[] = [];
  const pane: number[] = [];
  const index: number[] = [];
  const normals: [number, number, number][] = [
    [0, 0, 1],
    [1, 0, 0],
    [-1, 0, 0],
  ];
  parts.forEach((g, k) => {
    const base = pos.length / 3;
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(...normals[k]!);
      pane.push(k === 0 ? 0 : 1);
    }
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i++) index.push(base + idx.getX(i));
    g.dispose();
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute("aPane", new BufferAttribute(new Float32Array(pane), 1));
  g.setIndex(index);
  return twice(g);
};

interface Merge {
  pos: number[];
  normal: number[];
  mat: number[];
  index: number[];
}

const appendGeometry = (m: Merge, g: BufferGeometry, matrix: Matrix4, mat: number[]) => {
  const base = m.pos.length / 3;
  const p = g.getAttribute("position");
  const n = g.getAttribute("normal");
  const nm = new Matrix4().copy(matrix).invert().transpose();
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(matrix);
    m.pos.push(v.x, v.y, v.z);
    v.fromBufferAttribute(n, i).applyMatrix4(nm).normalize();
    m.normal.push(v.x, v.y, v.z);
    m.mat.push(...mat);
  }
  const idx = g.getIndex();
  if (idx) for (let i = 0; i < idx.count; i++) m.index.push(base + idx.getX(i));
  else for (let i = 0; i < p.count; i++) m.index.push(base + i);
};

const finish = (m: Merge): BufferGeometry => {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(m.pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(m.normal), 3));
  g.setAttribute("aMat", new BufferAttribute(new Float32Array(m.mat), 4));
  g.setIndex(m.index);
  return g;
};

/** Value noise on a lattice, for shaping stones. */
const lattice = (seed: number) => {
  const h = (x: number, y: number, z: number) => {
    let n = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1442695041) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  };
  return (x: number, y: number, z: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const fx = x - xi;
    const fy = y - yi;
    const fz = z - zi;
    const s = (t: number) => t * t * (3 - 2 * t);
    const u = s(fx);
    const v = s(fy);
    const w = s(fz);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    return l(
      l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
      l(
        l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u),
        l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u),
        v,
      ),
      w,
    );
  };
};

/** One stone: a ball pushed about by layered noise, flattened underneath where it sits. */
/** A unit sphere of shared vertices: an icosahedron with each face cut into n x n triangles. */
export const icosphere = (n: number): BufferGeometry => {
  const ico = new IcosahedronGeometry(1, 0);
  const p = ico.getAttribute("position");
  const pos: number[] = [];
  const index: number[] = [];
  const seen = new Map<string, number>();
  const at = (v: Vector3) => {
    v.normalize();
    const key = `${Math.round(v.x * 1e5)},${Math.round(v.y * 1e5)},${Math.round(v.z * 1e5)}`;
    let i = seen.get(key);
    if (i === undefined) {
      i = pos.length / 3;
      pos.push(v.x, v.y, v.z);
      seen.set(key, i);
    }
    return i;
  };
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let f = 0; f < p.count; f += 3) {
    a.fromBufferAttribute(p, f);
    b.fromBufferAttribute(p, f + 1);
    c.fromBufferAttribute(p, f + 2);
    const rows: number[][] = [];
    for (let i = 0; i <= n; i++) {
      const row: number[] = [];
      for (let j = 0; j <= n - i; j++) {
        const v = new Vector3()
          .addScaledVector(a, (n - i - j) / n)
          .addScaledVector(b, j / n)
          .addScaledVector(c, i / n);
        row.push(at(v));
      }
      rows.push(row);
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        index.push(rows[i]![j]!, rows[i]![j + 1]!, rows[i + 1]![j]!);
        if (j < n - i - 1) index.push(rows[i]![j + 1]!, rows[i + 1]![j + 1]!, rows[i + 1]![j]!);
      }
    }
  }
  ico.dispose();
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(index);
  return g;
};

const stone = (seed: number, detail: number, flat: number): BufferGeometry => {
  const g = icosphere(detail);
  const p = g.getAttribute("position");
  const n = lattice(seed);
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let k = 1;
    k += 0.32 * (n(v.x * 1.3 + 5, v.y * 1.3, v.z * 1.3) - 0.5);
    k += 0.14 * (n(v.x * 3.1, v.y * 3.1 + 9, v.z * 3.1) - 0.5);
    k += 0.05 * (n(v.x * 8, v.y * 8, v.z * 8 + 3) - 0.5);
    v.multiplyScalar(k);
    // Squashed where it sits in the ground, without folding over.
    if (v.y < -flat) v.y = -flat + (v.y + flat) * 0.35;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
};

export const buildRocks = (layout: TankLayout, detail: number): InstancedBufferGeometry => {
  const m: Merge = { pos: [], normal: [], mat: [], index: [] };
  const mat = new Matrix4();
  for (const r of layout.rocks) {
    const lod = r.kind === "pebble" ? 4 : detail > 1 ? 28 : 12;
    const g = stone(r.seed % 10000, lod, r.kind === "slab" ? 0.2 : 0.45);
    const f = rockFrame(r, layout.ground);
    mat.compose(
      new Vector3(...f.centre),
      new Quaternion().setFromEuler(new Euler(r.tilt, r.yaw, 0, "YXZ")),
      new Vector3(r.size[0], r.size[1], r.size[2]),
    );
    appendGeometry(m, g, mat, [0, r.tone, r.seed % 997, 0]);
    g.dispose();
  }
  return twice(finish(m));
};

/** Driftwood: tapering, knotted tubes along each branch. */
export const buildWood = (
  layout: TankLayout,
  rng: Rng,
  detail: number,
): InstancedBufferGeometry => {
  const m: Merge = { pos: [], normal: [], mat: [], index: [] };
  const around = Math.round(14 * detail);
  for (const wood of layout.woods) {
    const n = lattice(wood.seed % 10000);
    wood.branches.forEach((b, bi) => {
      const curve = new CatmullRomCurve3(b.points.map((p) => new Vector3(...p)));
      const length = curve.getLength();
      const rows = Math.max(8, Math.round(length * 14 * detail));
      const frames = curve.computeFrenetFrames(rows, false);
      const base = m.pos.length / 3;
      const p = new Vector3();
      const q = new Vector3();
      const twist = rng.range(0, 6);
      for (let i = 0; i <= rows; i++) {
        const t = i / rows;
        curve.getPointAt(t, p);
        const r0 = b.radius * (1 - (1 - b.taper) * t);
        const nn = frames.normals[i]!;
        const bn = frames.binormals[i]!;
        for (let j = 0; j <= around; j++) {
          const a = (j / around) * Math.PI * 2;
          // Ridges along the grain and a knot or two.
          const ridge = 0.08 * Math.sin(a * 5 + t * twist) + 0.05 * Math.sin(a * 11 - t * 3);
          const knot = 0.25 * Math.max(0, n(t * length * 2.2, a * 0.6, bi * 7) - 0.72) * 4;
          const r = r0 * (1 + ridge + knot) * (i === rows ? 0.4 : 1);
          q.copy(p)
            .addScaledVector(nn, Math.cos(a) * r)
            .addScaledVector(bn, Math.sin(a) * r);
          m.pos.push(q.x, q.y, q.z);
          m.normal.push(0, 0, 0);
          m.mat.push(1, t, bi, a / (Math.PI * 2));
        }
      }
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < around; j++) {
          const a0 = base + i * (around + 1) + j;
          const b0 = a0 + around + 1;
          m.index.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
        }
      }
    });
  }
  const g = finish(m);
  g.computeVertexNormals();
  return twice(g);
};
