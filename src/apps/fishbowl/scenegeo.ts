/**
 * Meshes for everything in the bowl but the fish, in bowl space, built once from the scenery
 * layout. Anything that can show in the surface's mirror is drawn twice by instancing, with a
 * per-instance flag the shaders read.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LatheGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import type { Rng } from "../../core/types";
import { GRAVEL_EDGE, GRAVEL_TOP, gravelHeight } from "./bowl";
import type { Plant, Scenery } from "./scenery";
import { TAU } from "./vec";

/** Draw `g` twice, once as is and once reflected in the surface (`aMirror` 0 and 1). */
export const twice = (g: BufferGeometry): InstancedBufferGeometry => {
  const out = new InstancedBufferGeometry();
  out.copy(g as InstancedBufferGeometry);
  out.instanceCount = 2;
  out.setAttribute("aMirror", new InstancedBufferAttribute(new Float32Array([0, 1]), 1));
  g.dispose();
  return out;
};

interface Mesh {
  pos: number[];
  normal: number[];
  index: number[];
  extra: Record<string, { size: number; data: number[] }>;
}

const turned = (yaw: number, tilt = 0): Quaternion =>
  new Quaternion().setFromEuler(new Euler(0, yaw, tilt, "YXZ"));

const newMesh = (extras: Record<string, number>): Mesh => ({
  pos: [],
  normal: [],
  index: [],
  extra: Object.fromEntries(Object.entries(extras).map(([k, size]) => [k, { size, data: [] }])),
});

const toGeometry = (m: Mesh, computeNormals: boolean): BufferGeometry => {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(m.pos), 3));
  if (!computeNormals) g.setAttribute("normal", new BufferAttribute(new Float32Array(m.normal), 3));
  for (const [k, e] of Object.entries(m.extra)) {
    g.setAttribute(k, new BufferAttribute(new Float32Array(e.data), e.size));
  }
  g.setIndex(m.index);
  if (computeNormals) g.computeVertexNormals();
  return g;
};

/** Append a three.js geometry, moved by `matrix`, with fixed extra values on every vertex. */
const append = (m: Mesh, g: BufferGeometry, matrix: Matrix4, extra: Record<string, number[]>) => {
  const base = m.pos.length / 3;
  const p = g.getAttribute("position");
  const n = g.getAttribute("normal");
  const normalMatrix = new Matrix4().copy(matrix).invert().transpose();
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(matrix);
    m.pos.push(v.x, v.y, v.z);
    v.fromBufferAttribute(n, i).applyMatrix4(normalMatrix).normalize();
    m.normal.push(v.x, v.y, v.z);
    for (const [k, values] of Object.entries(extra)) m.extra[k]!.data.push(...values);
  }
  const idx = g.getIndex();
  if (idx) for (let i = 0; i < idx.count; i++) m.index.push(base + idx.getX(i));
  else for (let i = 0; i < p.count; i++) m.index.push(base + i);
};

// ---- Gravel ---------------------------------------------------------------------------------

/** Natural gravel colours (linear) and how common each is. */
const GRAVEL: readonly [number, number, number, number][] = [
  [0.4, 0.29, 0.17, 3],
  [0.3, 0.29, 0.27, 3],
  [0.12, 0.12, 0.13, 2],
  [0.56, 0.5, 0.41, 2],
  [0.32, 0.16, 0.08, 1.5],
  [0.2, 0.22, 0.2, 1],
];

const pickTone = (rng: Rng): [number, number, number] => {
  const total = GRAVEL.reduce((s, g) => s + g[3], 0);
  let k = rng.next() * total;
  for (const g of GRAVEL) {
    k -= g[3];
    if (k <= 0) {
      const v = rng.range(0.8, 1.2);
      return [g[0] * v, g[1] * v, g[2] * v];
    }
  }
  return [0.3, 0.3, 0.3];
};

export interface Pebbles {
  geometry: BufferGeometry;
  /** Rotation and position of each pebble; the shape's stretch goes in `aShape`. */
  matrices: Matrix4[];
  count: number;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * A layer pressed against the glass under the gravel line, for people underneath, and a layer
 * on the top of the heap, which shows only in the surface's mirror (and is drawn twice).
 */
export const buildPebbles = (rng: Rng): Pebbles => {
  const glass = 360;
  const top = 330;
  const total = glass + top * 2;
  const matrices: Matrix4[] = [];
  const shape = new Float32Array(total * 4);
  const tone = new Float32Array(total * 4);
  const up = new Vector3();
  const side = new Vector3();
  const fwd = new Vector3();
  const place = (
    k: number,
    centre: Vector3,
    normal: Vector3,
    a: number,
    b: number,
    c: number,
    mirror: number,
  ) => {
    up.copy(normal).normalize();
    side.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).cross(up);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0).cross(up);
    side.normalize();
    fwd.crossVectors(side, up).normalize();
    const m = new Matrix4().makeBasis(side, up, fwd).setPosition(centre);
    matrices.push(m);
    shape.set([a, c, b, mirror], k * 4);
    tone.set([...pickTone(rng), rng.next()], k * 4);
  };
  for (let i = 0; i < glass; i++) {
    const y = -1 + ((i + 0.5) / glass) * (1 + GRAVEL_TOP + 0.01);
    const ang = i * GOLDEN + rng.range(-0.2, 0.2);
    const r = Math.sqrt(1 - y * y);
    const d = new Vector3(r * Math.sin(ang), y, r * Math.cos(ang)).normalize();
    const a = rng.range(0.02, 0.034);
    const b = rng.range(0.02, 0.034);
    const c = Math.min(a, b) * rng.range(0.55, 0.75);
    place(i, d.clone().multiplyScalar(0.992 - c), d, a, b, c, 0);
  }
  const tops: [Vector3, Vector3, number, number, number][] = [];
  for (let i = 0; i < top; i++) {
    const r = GRAVEL_EDGE * 0.97 * Math.sqrt((i + 0.5) / top);
    const ang = i * GOLDEN + rng.range(-0.15, 0.15);
    const a = rng.range(0.02, 0.034);
    const b = rng.range(0.02, 0.034);
    const c = Math.min(a, b) * rng.range(0.55, 0.75);
    const centre = new Vector3(r * Math.sin(ang), gravelHeight(r) - c * 0.3, r * Math.cos(ang));
    const n = new Vector3(rng.range(-0.4, 0.4), 1, rng.range(-0.4, 0.4)).normalize();
    tops.push([centre, n, a, b, c]);
  }
  tops.forEach(([centre, n, a, b, c], i) => place(glass + i, centre, n, a, b, c, 0));
  tops.forEach(([, , a, b, c], i) => {
    // The same pebble again for the mirror: same tone and shape, flagged.
    const k = glass + top + i;
    matrices.push(matrices[glass + i]!.clone());
    shape.set([a, c, b, 1], k * 4);
    tone.set(tone.subarray((glass + i) * 4, (glass + i) * 4 + 4), k * 4);
  });
  const geometry = new SphereGeometry(1, 10, 7);
  geometry.setAttribute("aShape", new InstancedBufferAttribute(shape, 4));
  geometry.setAttribute("aTone", new InstancedBufferAttribute(tone, 4));
  return { geometry, matrices, count: total };
};

/** The heap under the pebbles: the cap against the glass and the top. */
export const buildBed = (): BufferGeometry => {
  const points: Vector2[] = [];
  const edgeLat = Math.asin(GRAVEL_TOP + 0.012);
  for (let i = 0; i <= 16; i++) {
    const lat = -Math.PI / 2 + ((edgeLat + Math.PI / 2) * i) / 16;
    points.push(new Vector2(Math.max(1e-4, 0.982 * Math.cos(lat)), 0.982 * Math.sin(lat)));
  }
  for (let i = 0; i <= 10; i++) {
    const r = GRAVEL_EDGE * 0.99 * (1 - i / 10);
    points.push(new Vector2(Math.max(1e-4, r), gravelHeight(r) - 0.014));
  }
  return twice(new LatheGeometry(points, 72));
};

// ---- Plants ---------------------------------------------------------------------------------

const leaf = (
  m: Mesh,
  rng: Rng,
  plant: Plant,
  kind: number,
  base: Vector3,
  dir: Vector3,
  length: number,
  width: number,
  arch: number,
  twist: number,
) => {
  const out = new Vector3(dir.x, 0, dir.z).normalize();
  const segs = 12;
  const phase = rng.range(0, TAU);
  const rows: number[][] = [];
  const centre = new Vector3();
  const tangent = new Vector3();
  const across = new Vector3();
  const normal = new Vector3();
  const prev = new Vector3().copy(base);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // Rise along the leaf's direction, bending outwards (and down at the tip for broad leaves).
    centre
      .copy(base)
      .addScaledVector(dir, length * t)
      .addScaledVector(out, arch * length * t * t)
      .add(new Vector3(0, -(kind === 1 ? arch * 0.6 : 0) * length * t ** 3, 0));
    if (i === 0) tangent.copy(dir);
    else tangent.subVectors(centre, prev).normalize();
    prev.copy(centre);
    const spin = twist * t;
    across.crossVectors(tangent, out).normalize();
    if (across.lengthSq() < 1e-6) across.set(1, 0, 0);
    across.applyAxisAngle(tangent, spin);
    normal.crossVectors(across, tangent).normalize();
    const w =
      kind === 1
        ? width * Math.sin(Math.PI * Math.min(1, t * 0.98 + 0.02)) ** 0.7
        : width * Math.min(1, (1 - t) * 6) * (1 - 0.25 * t);
    const row: number[] = [];
    for (const k of [-1, 0, 1]) {
      // A slight fold along the midrib.
      const p = centre
        .clone()
        .addScaledVector(across, k * w)
        .addScaledVector(normal, -Math.abs(k) * w * 0.15);
      m.pos.push(p.x, p.y, p.z);
      m.normal.push(normal.x, normal.y, normal.z);
      m.extra.aLeaf!.data.push(t, k, phase + plant.seed * 0.001, kind);
      row.push(m.pos.length / 3 - 1);
    }
    rows.push(row);
  }
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < 2; k++) {
      const a = rows[i]![k]!;
      const b = rows[i + 1]![k]!;
      const c = rows[i + 1]![k + 1]!;
      const d = rows[i]![k + 1]!;
      m.index.push(a, b, c, a, c, d);
    }
  }
};

export const buildPlants = (scenery: Scenery, rng: Rng): InstancedBufferGeometry => {
  const m = newMesh({ aLeaf: 4 });
  for (const plant of scenery.plants) {
    const own = rng.fork(`plant-${plant.seed}`);
    const root = new Vector3(plant.x, gravelHeight(Math.hypot(plant.x, plant.z)) - 0.01, plant.z);
    const outward = new Vector3(plant.x, 0, plant.z).normalize();
    for (let i = 0; i < plant.leaves; i++) {
      if (plant.kind === "ribbon") {
        const a = own.range(0, TAU);
        const base = root
          .clone()
          .add(new Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(own.range(0, 0.05)));
        const lean = outward
          .clone()
          .multiplyScalar(own.range(0.05, 0.25))
          .add(new Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(own.range(0.05, 0.18)));
        const dir = new Vector3(lean.x, 1, lean.z).normalize();
        leaf(
          m,
          own,
          plant,
          0,
          base,
          dir,
          plant.height * own.range(0.65, 1),
          own.range(0.016, 0.022),
          own.range(0.1, 0.25),
          own.range(-2, 2),
        );
      } else {
        // A rosette of broad leaves arching out all round, the outer ones lower.
        const a = (i / plant.leaves) * TAU + own.range(-0.2, 0.2);
        const outer = i % 2 === 0;
        const dirOut = new Vector3(Math.sin(a), 0, Math.cos(a));
        const dir = dirOut
          .clone()
          .multiplyScalar(outer ? 0.75 : 0.35)
          .add(new Vector3(0, 1, 0))
          .normalize();
        leaf(
          m,
          own,
          plant,
          1,
          root.clone(),
          dir,
          plant.height * own.range(0.75, 1),
          own.range(0.035, 0.05),
          own.range(0.25, 0.45),
          own.range(-0.4, 0.4),
        );
      }
    }
  }
  return twice(toGeometry(m, false));
};

// ---- Stones, pot and air stone ----------------------------------------------------------------

const lumpy = (seed: number) => {
  const g = new SphereGeometry(1, 30, 20);
  const p = g.getAttribute("position");
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k =
      1 +
      0.08 * Math.sin(v.x * 2.1 + seed) * Math.cos(v.z * 1.7 + seed * 2) +
      0.05 * Math.sin(v.y * 3.3 + seed * 3);
    v.multiplyScalar(k);
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
};

export const buildDecor = (scenery: Scenery): InstancedBufferGeometry => {
  const m = newMesh({ aColour: 3, aMat: 4 });
  const mat = new Matrix4();
  scenery.stones.forEach((s, i) => {
    const g = lumpy(i * 7.3 + s.tone * 10);
    const y = gravelHeight(Math.hypot(s.x, s.z)) + s.size[1] * 0.25;
    mat.compose(
      new Vector3(s.x, y, s.z),
      turned(s.yaw),
      new Vector3(s.size[0], s.size[1], s.size[2]),
    );
    const colour = s.tone < 0.5 ? [0.33, 0.33, 0.31] : [0.45, 0.38, 0.28];
    append(m, g, mat, { aColour: colour, aMat: [1, i + 1, 0, 0] });
    g.dispose();
  });

  // A small clay pot lying on its side, half sunk in the gravel.
  const profile = [
    [0.001, 0],
    [0.55, 0],
    [0.62, 0.3],
    [0.75, 0.95],
    [0.83, 0.98],
    [0.84, 1.1],
    [0.72, 1.1],
    [0.64, 0.97],
    [0.5, 0.35],
    [0.45, 0.09],
    [0.001, 0.09],
  ].map(([x, y]) => new Vector2(x, y));
  const pot = new LatheGeometry(profile, 40);
  const inside = new Float32Array(pot.getAttribute("position").count);
  for (let i = 0; i < inside.length; i++) inside[i] = i % profile.length >= 6 ? 1 : 0;
  const p = scenery.pot;
  const base = new Vector3(p.x, gravelHeight(Math.hypot(p.x, p.z)) + p.size * 0.35, p.z);
  mat.compose(base, turned(p.yaw, 1.35), new Vector3(p.size, p.size * 1.3, p.size));
  const start = m.pos.length / 3;
  append(m, pot, mat, { aColour: [0.42, 0.14, 0.06], aMat: [1, 7, 0, 0] });
  const matData = m.extra.aMat!.data;
  for (let i = 0; i < inside.length; i++) matData[(start + i) * 4 + 2] = inside[i]!;
  pot.dispose();

  // The air stone the bubbles come from.
  const air = new SphereGeometry(1, 16, 10);
  mat.compose(
    new Vector3(scenery.air.x, scenery.air.y, scenery.air.z),
    turned(0),
    new Vector3(0.035, 0.022, 0.035),
  );
  append(m, air, mat, { aColour: [0.22, 0.26, 0.3], aMat: [0, 9, 0, 0] });
  air.dispose();
  return twice(toGeometry(m, false));
};

// ---- Snail ----------------------------------------------------------------------------------

/**
 * A snail one foot-length long: sole flat on y = 0 facing -y (the glass), heading +x, the
 * body and shell rising into +y (into the bowl).
 */
export const buildSnail = (): BufferGeometry => {
  const m = newMesh({ aPart: 4 });
  const mat = new Matrix4();
  const add = (g: BufferGeometry, matrix: Matrix4, part: number, t: number, seed: number) => {
    append(m, g, matrix, { aPart: [part, t, 0, seed] });
    g.dispose();
  };
  // Sole: a flat oval.
  const sole = new SphereGeometry(1, 28, 6, 0, TAU, Math.PI / 2, Math.PI / 2);
  mat.compose(new Vector3(0, 0.002, 0), turned(0), new Vector3(0.5, 0.004, 0.2));
  add(sole, mat, 0, 0, 0);
  // Foot and head: a low dome over the sole.
  const foot = new SphereGeometry(1, 28, 10, 0, TAU, 0, Math.PI / 2);
  mat.compose(new Vector3(0, 0.004, 0), turned(0), new Vector3(0.5, 0.15, 0.2));
  add(foot, mat, 1, 0, 0);
  const head = new SphereGeometry(1, 16, 10);
  mat.compose(new Vector3(0.38, 0.08, 0), turned(0), new Vector3(0.14, 0.09, 0.13));
  add(head, mat, 1, 0, 0);
  // Two tentacles with dark eyes at their tips.
  for (const side of [-1, 1]) {
    const g = new IcosahedronGeometry(1, 1);
    const pos = g.getAttribute("position");
    const ts = new Float32Array(pos.count);
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      // Stretch a small ball into a tapering stalk along +x.
      const t = (v.x + 1) / 2;
      v.set(t * 0.26, v.y * 0.016 * (1 - 0.5 * t), v.z * 0.016 * (1 - 0.5 * t));
      pos.setXYZ(i, v.x, v.y, v.z);
      ts[i] = t > 0.88 ? 1 : t * 0.85;
    }
    g.computeVertexNormals();
    const rot = new Quaternion().setFromEuler(new Euler(side * 0.5, side * -0.55, 0.45, "YXZ"));
    mat.compose(new Vector3(0.44, 0.12, side * 0.06), rot, new Vector3(1, 1, 1));
    const start = m.pos.length / 3;
    add(g, mat, 3, 0, side);
    const parts = m.extra.aPart!.data;
    for (let i = 0; i < ts.length; i++) parts[(start + i) * 4 + 1] = ts[i]!;
  }
  // The shell: a coil sitting on the back, a little behind the middle.
  const shell = new SphereGeometry(1, 32, 20);
  const sp = shell.getAttribute("position");
  const v = new Vector3();
  for (let i = 0; i < sp.count; i++) {
    v.fromBufferAttribute(sp, i);
    // A low spire on the side away from the glass.
    const k = Math.max(0, v.y);
    v.set(v.x * (1 - 0.35 * k * k), v.y * (1 + 0.45 * k * k * k), v.z * (1 - 0.35 * k * k));
    sp.setXYZ(i, v.x, v.y, v.z);
  }
  shell.computeVertexNormals();
  // Leaning to one side, as a snail's shell does on the glass, so its coil shows beside the foot.
  const lean = new Quaternion().setFromEuler(new Euler(0.55, 0, -0.3, "XYZ"));
  mat.compose(new Vector3(-0.06, 0.3, 0.1), lean, new Vector3(0.26, 0.25, 0.24));
  add(shell, mat, 2, 0.3, 0);
  return toGeometry(m, false);
};

// ---- Bubbles and specks ---------------------------------------------------------------------

export const BUBBLES = 40;

export const buildBubbles = (rng: Rng): InstancedBufferGeometry => {
  const g = new InstancedBufferGeometry();
  g.copy(new IcosahedronGeometry(1, 2) as unknown as InstancedBufferGeometry);
  const data = new Float32Array(BUBBLES * 2 * 4);
  for (let i = 0; i < BUBBLES; i++) {
    // Bubbles leave in small bursts rather than evenly.
    const at = (i + rng.range(-0.3, 0.3)) / BUBBLES;
    const size = rng.range(0.008, 0.02);
    const seed = rng.next();
    data.set([at, size, seed, 0], i * 4);
    data.set([at, size, seed, 1], (BUBBLES + i) * 4);
  }
  g.setAttribute("aBubble", new InstancedBufferAttribute(data, 4));
  g.instanceCount = BUBBLES * 2;
  return g;
};

export const SPECKS = 420;

export const buildSpecks = (rng: Rng): BufferGeometry => {
  const pos = new Float32Array(SPECKS * 3);
  const data = new Float32Array(SPECKS * 4);
  for (let i = 0; i < SPECKS; i++) {
    // Mostly near the glass, where they make the water's depth show.
    const r = 0.6 + 0.37 * Math.sqrt(rng.next());
    const lon = rng.range(-Math.PI, Math.PI);
    const y = rng.range(-0.8, 0.6);
    const h = Math.sqrt(Math.max(0, r * r - y * y));
    pos.set([h * Math.sin(lon), rng.next(), h * Math.cos(lon)], i * 3);
    data.set([rng.range(0, TAU), rng.range(0, TAU), 8 + rng.int(10), 40 + rng.int(80)], i * 4);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("aSpeck", new BufferAttribute(data, 4));
  return g;
};
