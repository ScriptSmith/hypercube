/**
 * Our own fish, built from numbers: a body lofted through elliptical rings along a profile,
 * fins and tails as thin sheets between a base line on the body and an outline, and round
 * eyes. One length long, nose at x = +0.5 and tail tip at x = -0.5, back up (+y). The swimming
 * wave, the mouth and the puffer's puff are done in the vertex shader from the attributes
 * written here.
 */
import { BufferAttribute, BufferGeometry } from "three";
import { PART } from "./shaders";
import type { SpeciesId } from "./species";

type Tail = "fork" | "fan" | "double" | "lyre";

interface FinSpec {
  /** Where along the body it starts and ends, 0 at the nose to 1 at the tail's root. */
  from: number;
  to: number;
  height: number;
  /** How far back its outline leans, as a fraction of its height. */
  sweep: number;
  /**
   * "front" is tallest at the front and falls away behind; "sail" rises all the way back to a
   * point that trails behind its base, as an angelfish's fins do.
   */
  profile?: "front" | "sail";
}

export interface FishShape {
  /** Where the body meets the tail, x. */
  root: number;
  /** Half the body's height and width at its deepest, and at the tail's root. */
  height: number;
  width: number;
  rootHeight: number;
  rootWidth: number;
  /** Where the body is deepest, 0 nose to 1 tail root. */
  peak: number;
  /** Share of the depth above the midline more than below it (a flat belly). */
  arch: number;
  eye: { at: number; up: number; radius: number };
  tail: Tail;
  tailHeight: number;
  dorsal: FinSpec | null;
  anal: FinSpec | null;
  pectoral: { at: number; length: number; width: number };
  pelvic: { at: number; length: number } | null;
  barbels: boolean;
  /** A small fleshy fin on the back between the dorsal and the tail. */
  adipose?: FinSpec;
  /** Long thread-like pelvic fins trailing under the body. */
  threads?: { at: number; length: number; width: number };
  /** Below 1 flattens the belly towards a sole (a bottom-dweller's). Default 1. */
  belly?: number;
  /** Pectorals held out flat to the sides rather than down. */
  flatPectorals?: boolean;
}

export const SHAPES: Record<SpeciesId, FishShape> = {
  goldfish: {
    root: -0.2,
    height: 0.15,
    width: 0.078,
    rootHeight: 0.045,
    rootWidth: 0.022,
    peak: 0.38,
    arch: 0.12,
    eye: { at: 0.16, up: 0.32, radius: 0.034 },
    tail: "fork",
    tailHeight: 0.15,
    dorsal: { from: 0.32, to: 0.78, height: 0.13, sweep: 0.5 },
    anal: { from: 0.72, to: 0.88, height: 0.07, sweep: 0.6 },
    pectoral: { at: 0.27, length: 0.12, width: 0.045 },
    pelvic: { at: 0.5, length: 0.07 },
    barbels: false,
  },
  fancy: {
    root: -0.06,
    height: 0.19,
    width: 0.115,
    rootHeight: 0.045,
    rootWidth: 0.025,
    peak: 0.42,
    arch: 0.06,
    eye: { at: 0.18, up: 0.3, radius: 0.04 },
    tail: "double",
    tailHeight: 0.21,
    dorsal: { from: 0.3, to: 0.8, height: 0.17, sweep: 0.7 },
    anal: { from: 0.74, to: 0.9, height: 0.1, sweep: 0.8 },
    pectoral: { at: 0.27, length: 0.12, width: 0.05 },
    pelvic: { at: 0.52, length: 0.09 },
    barbels: false,
  },
  tetra: {
    root: -0.25,
    height: 0.11,
    width: 0.045,
    rootHeight: 0.035,
    rootWidth: 0.016,
    peak: 0.35,
    arch: 0.05,
    eye: { at: 0.14, up: 0.18, radius: 0.04 },
    tail: "fork",
    tailHeight: 0.12,
    dorsal: { from: 0.45, to: 0.6, height: 0.1, sweep: 0.4 },
    anal: { from: 0.62, to: 0.9, height: 0.06, sweep: 0.4 },
    pectoral: { at: 0.24, length: 0.08, width: 0.03 },
    pelvic: { at: 0.48, length: 0.05 },
    barbels: false,
    adipose: { from: 0.84, to: 0.9, height: 0.03, sweep: 0.3 },
  },
  cory: {
    root: -0.24,
    height: 0.125,
    width: 0.08,
    rootHeight: 0.04,
    rootWidth: 0.022,
    peak: 0.36,
    arch: 0.3,
    eye: { at: 0.17, up: 0.45, radius: 0.033 },
    tail: "fork",
    tailHeight: 0.12,
    dorsal: { from: 0.3, to: 0.45, height: 0.16, sweep: 0.25 },
    anal: { from: 0.74, to: 0.86, height: 0.06, sweep: 0.5 },
    pectoral: { at: 0.26, length: 0.11, width: 0.04 },
    pelvic: { at: 0.48, length: 0.07 },
    barbels: true,
    adipose: { from: 0.86, to: 0.92, height: 0.035, sweep: 0.2 },
  },
  puffer: {
    root: -0.24,
    height: 0.17,
    width: 0.14,
    rootHeight: 0.05,
    rootWidth: 0.035,
    peak: 0.4,
    arch: 0.04,
    eye: { at: 0.2, up: 0.42, radius: 0.058 },
    tail: "fan",
    tailHeight: 0.11,
    dorsal: { from: 0.74, to: 0.86, height: 0.07, sweep: 0.3 },
    anal: { from: 0.74, to: 0.86, height: 0.06, sweep: 0.3 },
    pectoral: { at: 0.3, length: 0.06, width: 0.04 },
    pelvic: null,
    barbels: false,
  },
  harlequin: {
    root: -0.22,
    height: 0.18,
    width: 0.05,
    rootHeight: 0.04,
    rootWidth: 0.016,
    peak: 0.4,
    arch: 0.06,
    eye: { at: 0.15, up: 0.2, radius: 0.042 },
    tail: "fork",
    tailHeight: 0.15,
    dorsal: { from: 0.42, to: 0.58, height: 0.11, sweep: 0.4 },
    anal: { from: 0.58, to: 0.78, height: 0.07, sweep: 0.45 },
    pectoral: { at: 0.24, length: 0.08, width: 0.03 },
    pelvic: { at: 0.45, length: 0.06 },
    barbels: false,
  },
  angel: {
    root: -0.08,
    height: 0.4,
    width: 0.055,
    rootHeight: 0.055,
    rootWidth: 0.016,
    peak: 0.36,
    arch: 0.04,
    eye: { at: 0.16, up: 0.22, radius: 0.04 },
    tail: "lyre",
    tailHeight: 0.22,
    dorsal: { from: 0.26, to: 0.96, height: 0.4, sweep: 0.55, profile: "sail" },
    anal: { from: 0.32, to: 0.96, height: 0.4, sweep: 0.5, profile: "sail" },
    pectoral: { at: 0.27, length: 0.09, width: 0.04 },
    pelvic: null,
    barbels: false,
    threads: { at: 0.27, length: 0.62, width: 0.012 },
  },
  gourami: {
    root: -0.2,
    height: 0.2,
    width: 0.06,
    rootHeight: 0.06,
    rootWidth: 0.02,
    peak: 0.36,
    arch: 0.04,
    eye: { at: 0.14, up: 0.18, radius: 0.036 },
    tail: "fan",
    tailHeight: 0.15,
    dorsal: { from: 0.62, to: 0.9, height: 0.1, sweep: 0.5 },
    anal: { from: 0.34, to: 0.98, height: 0.13, sweep: 0.55, profile: "sail" },
    pectoral: { at: 0.25, length: 0.09, width: 0.04 },
    pelvic: null,
    barbels: false,
    threads: { at: 0.28, length: 0.85, width: 0.008 },
  },
  pleco: {
    root: -0.24,
    height: 0.08,
    width: 0.14,
    rootHeight: 0.035,
    rootWidth: 0.03,
    peak: 0.3,
    arch: 0.4,
    eye: { at: 0.17, up: 0.72, radius: 0.026 },
    tail: "fan",
    tailHeight: 0.1,
    dorsal: { from: 0.32, to: 0.55, height: 0.16, sweep: 0.35, profile: "sail" },
    anal: { from: 0.78, to: 0.88, height: 0.04, sweep: 0.4 },
    pectoral: { at: 0.27, length: 0.15, width: 0.06 },
    pelvic: { at: 0.52, length: 0.09 },
    barbels: false,
    adipose: { from: 0.86, to: 0.94, height: 0.03, sweep: 0.3 },
    belly: 0.35,
    flatPectorals: true,
  },
};

const NOSE = 0.5;
const TIP = -0.5;
interface Builder {
  pos: number[];
  coord: number[];
  anchor: number[];
  index: number[];
  /** Mesh density: 1 for the bowl, more for fish seen large on the wall. */
  detail: number;
}

const steps = (b: Builder, n: number) => Math.max(1, Math.round(n * b.detail));

const push = (b: Builder, p: readonly number[], c: readonly number[], a: readonly number[]) => {
  b.pos.push(p[0]!, p[1]!, p[2]!);
  b.coord.push(c[0]!, c[1]!, c[2]!, c[3]!);
  b.anchor.push(a[0]!, a[1]!, a[2]!);
  return b.pos.length / 3 - 1;
};

/** s for the shader: 0 at the nose, 1 at the tail tip. */
const sOf = (x: number) => NOSE - x;

/** The body's half-height (above and below the midline) and half-width along it. */
export const bodyAt = (shape: FishShape, u: number) => {
  const k =
    u < shape.peak
      ? Math.sqrt(Math.max(0, 1 - (1 - u / shape.peak) ** 2))
      : 0.5 * (1 + Math.cos((Math.PI * (u - shape.peak)) / (1 - shape.peak)));
  const front = u < shape.peak;
  const h = front ? shape.height * k : shape.rootHeight + (shape.height - shape.rootHeight) * k;
  const w = front ? shape.width * k : shape.rootWidth + (shape.width - shape.rootWidth) * k;
  return { top: h * (1 + shape.arch), bottom: h * (1 - shape.arch), width: w };
};

const xOf = (shape: FishShape, u: number) => NOSE + (shape.root - NOSE) * u;

/** A point on the body's surface at `u` along and `angle` round from the top. */
const surface = (shape: FishShape, u: number, angle: number): [number, number, number] => {
  const b = bodyAt(shape, u);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (c >= 0 || (shape.belly ?? 1) >= 1) {
    return [xOf(shape, u), (c > 0 ? b.top : b.bottom) * c, b.width * s];
  }
  // A flatter belly: the lower half pushed out towards a box, so it can lie on the ground.
  const k = shape.belly ?? 1;
  const ax = Math.abs(s) ** k * Math.sign(s);
  return [xOf(shape, u), -b.bottom * Math.abs(c) ** k, b.width * ax];
};

const addBody = (b: Builder, shape: FishShape) => {
  const tip = push(b, [NOSE + 0.004, 0, 0], [0, 0, PART.body, 0], [NOSE, 0, 0]);
  const rings: number[][] = [];
  const RINGS = steps(b, 22);
  const AROUND = steps(b, 18);
  for (let i = 1; i <= RINGS; i++) {
    const u = (i / RINGS) ** 1.25;
    const ring: number[] = [];
    for (let j = 0; j < AROUND; j++) {
      const a = (j / AROUND) * Math.PI * 2;
      const p = surface(shape, u, a);
      const around = Math.acos(Math.cos(a)) / Math.PI;
      ring.push(push(b, p, [sOf(p[0]), around, PART.body, Math.sign(Math.sin(a))], [p[0], 0, 0]));
    }
    rings.push(ring);
  }
  const first = rings[0]!;
  for (let j = 0; j < AROUND; j++) b.index.push(tip, first[j]!, first[(j + 1) % AROUND]!);
  for (let i = 0; i + 1 < rings.length; i++) {
    const r0 = rings[i]!;
    const r1 = rings[i + 1]!;
    for (let j = 0; j < AROUND; j++) {
      const j1 = (j + 1) % AROUND;
      b.index.push(r0[j]!, r1[j]!, r1[j1]!, r0[j]!, r1[j1]!, r0[j1]!);
    }
  }
  // Close the tail's root, hidden by the tail fin.
  const last = rings[rings.length - 1]!;
  const end = push(b, [shape.root, 0, 0], [sOf(shape.root), 0.5, PART.body, 0], [shape.root, 0, 0]);
  for (let j = 0; j < AROUND; j++) b.index.push(end, last[(j + 1) % AROUND]!, last[j]!);
};

/**
 * A thin sheet between `base(v)` and `edge(v)` for v from 0 to 1. `nu` steps out from the base;
 * `u` (0 base, 1 edge) goes to the shader.
 */
const addSheet = (
  b: Builder,
  part: number,
  side: number,
  nvAt1: number,
  nuAt1: number,
  base: (v: number) => [number, number, number],
  edge: (v: number) => [number, number, number],
) => {
  const grid: number[][] = [];
  const nv = steps(b, nvAt1);
  const nu = steps(b, nuAt1);
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const p0 = base(v);
    const p1 = edge(v);
    const row: number[] = [];
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const p: [number, number, number] = [
        p0[0] + (p1[0] - p0[0]) * u,
        p0[1] + (p1[1] - p0[1]) * u,
        p0[2] + (p1[2] - p0[2]) * u,
      ];
      row.push(push(b, p, [sOf(p[0]), u, part, side], p0));
    }
    grid.push(row);
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = grid[j]![i]!;
      const c = grid[j + 1]![i]!;
      const d = grid[j + 1]![i + 1]!;
      const e = grid[j]![i + 1]!;
      b.index.push(a, c, d, a, d, e);
    }
  }
};

const uAt = (shape: FishShape, x: number) => (NOSE - x) / (NOSE - shape.root);

const addMedianFin = (b: Builder, shape: FishShape, fin: FinSpec, down: boolean) => {
  const x0 = xOf(shape, fin.from);
  const x1 = xOf(shape, fin.to);
  const sign = down ? -1 : 1;
  const base = (v: number): [number, number, number] => {
    const x = x0 + (x1 - x0) * v;
    const at = bodyAt(shape, uAt(shape, x));
    return [x, sign * (down ? at.bottom : at.top) * 0.96, 0];
  };
  const edge = (v: number): [number, number, number] => {
    const p = base(v);
    if (fin.profile === "sail") {
      // Rising all the way back to a point that trails out behind the base.
      const h = fin.height * Math.sin((Math.PI / 2) * v) ** 0.8;
      const trail = (x0 - x1) * 0.55 * v ** 3;
      return [p[0] - fin.sweep * h * v - trail, p[1] + sign * h, 0];
    }
    // Tall at the front, falling away behind, with a rounded top.
    const h = fin.height * Math.sin(Math.PI * Math.min(1, v ** 0.55)) ** 0.6 * (1 - 0.35 * v);
    return [p[0] - fin.sweep * h - (x0 - x1) * 0.15 * v, p[1] + sign * h, 0];
  };
  addSheet(
    b,
    PART.fin,
    0,
    fin.profile === "sail" ? 16 : 10,
    fin.profile === "sail" ? 6 : 4,
    base,
    edge,
  );
};

const addTail = (b: Builder, shape: FishShape) => {
  const x = shape.root;
  const hb = bodyAt(shape, 1);
  const base = (v: number): [number, number, number] => [
    x + 0.01,
    -hb.bottom + (hb.top + hb.bottom) * v,
    0,
  ];
  const len = x - TIP;
  const H = shape.tailHeight;
  if (shape.tail === "fork") {
    const edge = (v: number): [number, number, number] => {
      // Two pointed lobes and a notch between them.
      const t = Math.abs(v - 0.5) * 2;
      const reach = 0.42 + 0.58 * t ** 1.4;
      return [x - len * reach, (v - 0.5) * 2 * H * (0.55 + 0.45 * t), 0];
    };
    addSheet(b, PART.tail, 0, 12, 5, base, edge);
  } else if (shape.tail === "fan") {
    const edge = (v: number): [number, number, number] => [
      x - len * (0.7 + 0.3 * Math.sin(Math.PI * v)),
      (v - 0.5) * 2 * H,
      0,
    ];
    addSheet(b, PART.tail, 0, 10, 5, base, edge);
  } else if (shape.tail === "lyre") {
    // A broad fan whose top and bottom rays run out into long streamers.
    const edge = (v: number): [number, number, number] => {
      const t = Math.abs(v - 0.5) * 2;
      const reach = 0.55 + 0.15 * Math.cos(Math.PI * t) + 0.7 * t ** 6;
      return [x - len * reach, (v - 0.5) * 2 * H * (0.75 + 0.35 * t), 0];
    };
    addSheet(b, PART.tail, 0, 16, 6, base, edge);
  } else {
    // Two flowing tails splayed apart, each with a wavy edge.
    for (const side of [-1, 1]) {
      const tilt = side * 0.5;
      const splay = (p: [number, number, number]): [number, number, number] => {
        const d = p[0] - x;
        return [p[0], p[1], p[2] + Math.sin(tilt) * -d * 0.9];
      };
      const edge = (v: number): [number, number, number] => {
        const t = Math.abs(v - 0.5) * 2;
        const reach = 0.7 + 0.3 * t + 0.06 * Math.sin(v * Math.PI * 4);
        return splay([x - len * reach, (v - 0.5) * 2 * H * (0.7 + 0.3 * t), 0]);
      };
      addSheet(b, PART.tail, side, 14, 6, (v) => splay(base(v)), edge);
    }
  }
};

const addPaired = (
  b: Builder,
  shape: FishShape,
  part: number,
  at: number,
  length: number,
  width: number,
  low: number,
  out: number,
  down: number,
) => {
  const x = xOf(shape, at);
  const body = bodyAt(shape, at);
  for (const side of [-1, 1]) {
    const y = -body.bottom * low;
    const z = side * body.width * Math.sqrt(Math.max(0, 1 - low * low)) * 0.95;
    const base = (v: number): [number, number, number] => [x - width * v, y, z];
    const edge = (v: number): [number, number, number] => {
      const reach = length * (0.6 + 0.4 * Math.sin(Math.PI * (0.3 + 0.7 * v)));
      return [x - width * v - reach * 0.75, y - reach * down, z + side * reach * out];
    };
    addSheet(b, part, side, 4, 4, base, edge);
  }
};

/** Long threads trailing back and down from under the chest: an angelfish's or a gourami's. */
const addThreads = (b: Builder, shape: FishShape, t: NonNullable<FishShape["threads"]>) => {
  const x = xOf(shape, t.at);
  const body = bodyAt(shape, t.at);
  for (const side of [-1, 1]) {
    const y = -body.bottom * 0.85;
    const z = side * body.width * 0.35;
    const base = (v: number): [number, number, number] => [x - t.width * v, y, z];
    const edge = (v: number): [number, number, number] => [
      x - t.width * v - t.length * 0.62,
      y - t.length * 0.78,
      z + side * t.length * 0.08,
    ];
    addSheet(b, PART.thread, side, 1, 12, base, edge);
  }
};

const addEyes = (b: Builder, shape: FishShape) => {
  const u = shape.eye.at;
  const x = xOf(shape, u);
  const body = bodyAt(shape, u);
  const r = shape.eye.radius;
  const lat = steps(b, 8);
  const lon = steps(b, 12);
  for (const side of [-1, 1]) {
    const y = body.top * shape.eye.up;
    const z = side * (body.width * Math.sqrt(Math.max(0, 1 - shape.eye.up ** 2)) - r * 0.45);
    const centre = [x, y, z] as const;
    const rows: number[][] = [];
    for (let i = 0; i <= lat; i++) {
      const th = (i / lat) * Math.PI;
      const row: number[] = [];
      for (let j = 0; j <= lon; j++) {
        const ph = (j / lon) * Math.PI * 2;
        const d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        const p = [x + d[0]! * r, y + d[1]! * r, z + d[2]! * r];
        row.push(push(b, p, [sOf(x), 0, PART.eye, side], centre));
      }
      rows.push(row);
    }
    for (let i = 0; i < lat; i++) {
      for (let j = 0; j < lon; j++) {
        const a = rows[i]![j]!;
        const c = rows[i + 1]![j]!;
        const d = rows[i + 1]![j + 1]!;
        const e = rows[i]![j + 1]!;
        b.index.push(a, c, d, a, d, e);
      }
    }
  }
};

const addBarbels = (b: Builder, shape: FishShape) => {
  const x = xOf(shape, 0.04);
  const body = bodyAt(shape, 0.04);
  for (const side of [-1, 1]) {
    for (const k of [0, 1]) {
      const z = side * (0.01 + k * 0.012);
      const base = (v: number): [number, number, number] => [x - 0.008 * v, -body.bottom * 0.8, z];
      const edge = (v: number): [number, number, number] => [
        x + 0.02 - 0.008 * v,
        -body.bottom * 0.8 - 0.035 - k * 0.01,
        z * 1.6,
      ];
      addSheet(b, PART.barbel, side, 1, 3, base, edge);
    }
  }
};

export const buildFishGeometry = (id: SpeciesId, detail = 1): BufferGeometry => {
  const shape = SHAPES[id];
  const b: Builder = { pos: [], coord: [], anchor: [], index: [], detail };
  addBody(b, shape);
  addTail(b, shape);
  if (shape.dorsal) addMedianFin(b, shape, shape.dorsal, false);
  if (shape.anal) addMedianFin(b, shape, shape.anal, true);
  if (shape.adipose) addMedianFin(b, shape, shape.adipose, false);
  const pec = shape.pectoral;
  if (shape.flatPectorals) {
    addPaired(b, shape, PART.pectoral, pec.at, pec.length, pec.width, 0.9, 1.1, 0.05);
  } else {
    addPaired(b, shape, PART.pectoral, pec.at, pec.length, pec.width, 0.45, 0.55, 0.25);
  }
  if (shape.pelvic) {
    addPaired(b, shape, PART.fin, shape.pelvic.at, shape.pelvic.length, 0.03, 0.85, 0.3, 0.55);
  }
  if (shape.threads) addThreads(b, shape, shape.threads);
  addEyes(b, shape);
  if (shape.barbels) addBarbels(b, shape);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(b.pos), 3));
  g.setAttribute("aCoord", new BufferAttribute(new Float32Array(b.coord), 4));
  g.setAttribute("aAnchor", new BufferAttribute(new Float32Array(b.anchor), 3));
  g.setIndex(b.index);
  g.computeVertexNormals();
  return g;
};

/** Radius of the puffer's ball when fully puffed, in body lengths. */
export const PUFF_BALL = 0.24;
