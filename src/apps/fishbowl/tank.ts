/**
 * The wall's tank in venue metres (see `src/core/view3d.ts`): the wall is its front glass on
 * the plane z = 0, the room is at +z and the tank runs back to `back`. Its side panes stand a
 * little beyond what the eye sees through the wall, so the whole wall is tank, framed by the
 * trim at its edges. Pure data from the wall's size, the eye and a seed, shared by the swimming
 * model (things to steer round and land on) and the scene (things to draw).
 */
import type { Rng } from "../../core/types";
import type { Surface, Vec3 } from "../../core/view3d";
import { FLORA } from "./flora";
import { clamp, TAU } from "./vec";

/** Real tanks at ten times life: a tank about 1.3 m long and 45 cm from front to back. */
export const TANK_DEPTH = 4.4;
/** Trim along the glass's edges, metres. */
export const TRIM = 0.07;
/** Air between the water and the top of the glass. */
const AIR = 0.3;

export interface TankBox {
  /** The wall: the front glass as people see it. */
  glass: { left: number; right: number; bottom: number; top: number };
  /** Side panes. */
  left: number;
  right: number;
  /** The back glass. */
  back: number;
  /** The inside of the bottom glass, and the water's surface. */
  floor: number;
  water: number;
}

export type RockKind = "boulder" | "slab" | "pebble";

export interface Rock {
  kind: RockKind;
  x: number;
  z: number;
  /** Half-sizes across, up and along before turning. */
  size: Vec3;
  yaw: number;
  /** Lean forward or back. */
  tilt: number;
  seed: number;
  tone: number;
}

/** A branch of driftwood: a tapering tube through `points`. */
export interface Branch {
  points: Vec3[];
  radius: number;
  /** Radius at its end, as a share of `radius`. */
  taper: number;
}

export interface Wood {
  branches: Branch[];
  seed: number;
}

export type FloraId =
  | "vallis"
  | "sword"
  | "redstem"
  | "greenstem"
  | "crypt"
  | "grass"
  | "fern"
  | "anubias"
  | "moss"
  | "frogbit";

export interface PlantSpot {
  kind: FloraId;
  x: number;
  y: number;
  z: number;
  /** Size relative to the kind's usual size. */
  scale: number;
  seed: number;
  /** Which way it grows, for plants tied to wood or rock (unit vector). */
  grow?: Vec3;
}

/** Something to steer round: a sphere at `centre`. */
export interface Lump {
  centre: Vec3;
  radius: number;
}

/**
 * Something solid that nothing may pass through: an ellipsoid (a stone) or a capsule (a length
 * of wood). An ellipsoid's `axes` are its unit axes, each with its half-size in `size`.
 */
export type Solid =
  | { kind: "ellipsoid"; centre: Vec3; axes: [Vec3, Vec3, Vec3]; size: Vec3 }
  | { kind: "capsule"; a: Vec3; b: Vec3; radius: number };

/** Where a stone's mesh sits: its centre and its turned axes (see `buildRocks`). */
export const rockFrame = (r: Rock, ground: (x: number, z: number) => number) => {
  const sink = r.kind === "pebble" ? 0.3 : 0.25;
  const y = ground(r.x, r.z) + r.size[1] * (1 - sink) - r.size[1] * 0.45;
  // Turned as three.js's Euler(tilt, yaw, 0, "YXZ"): about y by yaw, then about x by tilt.
  const cy = Math.cos(r.yaw);
  const sy = Math.sin(r.yaw);
  const cx = Math.cos(r.tilt);
  const sx = Math.sin(r.tilt);
  const axes: [Vec3, Vec3, Vec3] = [
    [cy, 0, -sy],
    [sy * sx, cx, cy * sx],
    [sy * cx, -sx, cy * cx],
  ];
  return { centre: [r.x, y, r.z] as Vec3, axes };
};

/**
 * How far `p` is inside `s` once `pad` is added all round (positive inside), and the way out.
 * For an ellipsoid both are approximate: exact on its axes, close enough elsewhere.
 */
export const intoSolid = (s: Solid, p: Vec3, pad: number): { depth: number; out: Vec3 } => {
  if (s.kind === "capsule") {
    const ab: Vec3 = [s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]];
    const ap: Vec3 = [p[0] - s.a[0], p[1] - s.a[1], p[2] - s.a[2]];
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = clamp(l2 > 0 ? (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2 : 0, 0, 1);
    const d: Vec3 = [ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t];
    const len = Math.hypot(d[0], d[1], d[2]) || 1e-6;
    return { depth: s.radius + pad - len, out: [d[0] / len, d[1] / len, d[2] / len] };
  }
  const q: Vec3 = [p[0] - s.centre[0], p[1] - s.centre[1], p[2] - s.centre[2]];
  const local = s.axes.map(
    (a, i) => (q[0] * a[0] + q[1] * a[1] + q[2] * a[2]) / (s.size[i]! + pad),
  );
  const k = Math.hypot(local[0]!, local[1]!, local[2]!) || 1e-6;
  // The way out: the gradient of the scaled distance, back in the tank's axes.
  const g = [0, 1, 2].map((i) => local[i]! / (s.size[i]! + pad));
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[j]! += s.axes[i]![j]! * g[i]!;
  const ol = Math.hypot(out[0]!, out[1]!, out[2]!) || 1e-6;
  const scale = Math.min(...s.size) + pad;
  return { depth: (1 - k) * scale, out: [out[0]! / ol, out[1]! / ol, out[2]! / ol] };
};

export interface TankLayout {
  box: TankBox;
  rocks: Rock[];
  woods: Wood[];
  plants: PlantSpot[];
  /** The carpet's patch in front: x from, x to, z from (front), z to (back). */
  carpet: { x0: number; x1: number; z0: number; z1: number };
  /** Rafts of floating plants: centre and radius on the surface. */
  rafts: { x: number; z: number; r: number }[];
  /** The air stone on the ground, and where its bubbles come up. */
  airstone: Vec3;
  /** Height of the ground at (x, z). */
  ground(x: number, z: number): number;
  /** Rocks, wood and plant clumps, for the fish to keep clear of. */
  lumps: Lump[];
  /** Stones and wood, which nothing passes through. */
  solids: Solid[];
}

const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** The tank behind a wall `surface` seen from `eye`. */
export const tankBox = (surface: Surface, eye: Vec3): TankBox => {
  const left = surface.origin[0];
  const right = left + surface.width;
  const bottom = surface.origin[1];
  const top = bottom + surface.height;
  const ez = Math.max(1, eye[2]);
  // Far enough out that the side panes stay just out of sight at the back.
  const out = (TANK_DEPTH / ez) * Math.max(right - eye[0], eye[0] - left) + 0.15;
  return {
    glass: { left, right, bottom, top },
    left: Math.min(left, eye[0] - out - (eye[0] - left)),
    right: Math.max(right, eye[0] + out + (right - eye[0])),
    back: -TANK_DEPTH,
    floor: bottom + TRIM,
    water: top - AIR,
  };
};

interface Mound {
  x: number;
  z: number;
  r: number;
  h: number;
}

/**
 * A planted tank's layout: the ground sloping up to the back with a mound or two, a tall line
 * of background plants with a gap, driftwood in one third and a group of stones in the other,
 * swords and crypts in the middle, a carpet in front and open water above.
 */
export const layoutTank = (box: TankBox, rng: Rng): TankLayout => {
  const { glass } = box;
  const w = glass.right - glass.left;
  const mid = (glass.left + glass.right) / 2;
  const D = -box.back;
  // Which third gets the wood; the stones go in the other.
  const woodLeft = rng.next() < 0.5;
  const woodX = mid + (woodLeft ? -1 : 1) * w * rng.range(0.17, 0.24);
  const stoneX = mid + (woodLeft ? 1 : -1) * w * rng.range(0.15, 0.22);

  const mounds: Mound[] = [
    { x: stoneX, z: -D * 0.55, r: rng.range(2.2, 2.8), h: rng.range(0.25, 0.35) },
    { x: woodX, z: -D * 0.7, r: rng.range(2.4, 3), h: rng.range(0.15, 0.25) },
  ];
  const front = 0.32;
  const rear = 0.95;
  const ground = (x: number, z: number) => {
    const t = clamp(-z / D, 0, 1);
    let h = box.floor + front + (rear - front) * smooth(t * 1.15);
    for (const m of mounds) {
      const d = Math.hypot(x - m.x, (z - m.z) * 1.3) / m.r;
      if (d < 1) h += m.h * (1 - d * d) ** 2;
    }
    // Gentle unevenness, as sand left by hand and stirred by fish.
    h += 0.025 * Math.sin(x * 1.7 + z * 0.6) * Math.cos(z * 2.3 - x * 0.4);
    return h;
  };

  const rocks: Rock[] = [];
  // A main stone, two companions and a few small ones round them, leaning the same way.
  const lean = rng.range(-0.15, 0.15);
  const stones: [number, number, number, number][] = [
    [0, -0.45, 1, 1],
    [rng.range(-1.6, -1.1), -0.25, 0.62, 0],
    [rng.range(1.1, 1.7), -0.55, 0.5, 0],
    [rng.range(-2.6, -2.1), -0.15, 0.3, 0],
    [rng.range(2.1, 2.6), -0.3, 0.26, 0],
  ];
  for (const [dx, zf, s, main] of stones) {
    const x = stoneX + dx;
    const z = -D * (0.5 + zf * 0.5) + rng.range(-0.25, 0.25);
    const big = main > 0;
    rocks.push({
      kind: big ? "boulder" : s > 0.4 ? "boulder" : "slab",
      x,
      z,
      size: [0.75 * s * rng.range(0.9, 1.15), (big ? 1.25 : 0.9) * s, 0.6 * s],
      yaw: rng.range(-0.5, 0.5),
      tilt: lean + rng.range(-0.08, 0.08),
      seed: rng.int(1 << 30),
      tone: rng.next(),
    });
  }
  // Pebbles scattered near the front and round the stones.
  for (let i = 0; i < 9; i++) {
    const x = stoneX + rng.range(-3.2, 3.2);
    const z = -rng.range(0.5, D * 0.6);
    const s = rng.range(0.07, 0.16);
    rocks.push({
      kind: "pebble",
      x,
      z,
      size: [s * rng.range(1, 1.4), s * 0.6, s],
      yaw: rng.range(0, TAU),
      tilt: 0,
      seed: rng.int(1 << 30),
      tone: rng.next(),
    });
  }

  // Driftwood: a trunk lying from the back up towards the front, with branches reaching up.
  const woods: Wood[] = [];
  {
    const dir = woodLeft ? 1 : -1;
    const baseZ = -D * 0.78;
    const base: Vec3 = [woodX - dir * 1.6, ground(woodX - dir * 1.6, baseZ) + 0.05, baseZ];
    const elbow: Vec3 = [woodX - dir * 0.2, ground(woodX, -D * 0.55) + 0.25, -D * 0.55];
    const tip: Vec3 = [woodX + dir * 1.4, ground(woodX + dir * 1.4, -D * 0.4) + 0.12, -D * 0.4];
    const branches: Branch[] = [{ points: [base, elbow, tip], radius: 0.2, taper: 0.45 }];
    // Branches rising from the trunk towards the light.
    for (let i = 0; i < 4; i++) {
      const t = 0.25 + i * 0.18 + rng.range(-0.05, 0.05);
      const from: Vec3 = [
        base[0] + (tip[0] - base[0]) * t,
        base[1] + (elbow[1] - base[1]) * Math.sin(Math.PI * t) + 0.05,
        base[2] + (tip[2] - base[2]) * t,
      ];
      const h = rng.range(1.2, 2.3);
      const lean2 = rng.range(-0.8, 0.8);
      const mid2: Vec3 = [from[0] + lean2 * 0.4, from[1] + h * 0.5, from[2] + rng.range(-0.3, 0.2)];
      const end: Vec3 = [
        from[0] + lean2 + dir * rng.range(-0.3, 0.6),
        from[1] + h,
        from[2] + rng.range(-0.5, 0.3),
      ];
      branches.push({ points: [from, mid2, end], radius: rng.range(0.07, 0.11), taper: 0.25 });
    }
    woods.push({ branches, seed: rng.int(1 << 30) });
  }

  const plants: PlantSpot[] = [];
  const add = (kind: FloraId, x: number, z: number, scale: number, grow?: Vec3, y?: number) => {
    const at = y ?? ground(x, z);
    const seed = rng.int(1 << 30);
    // Plants that don't reach the surface stay under it, however shallow the wall's tank is.
    const f = FLORA[kind];
    const room = f.tall ? scale : (box.water - 0.05 - at) / f.height;
    if (room < 0.3) return;
    plants.push({
      kind,
      x,
      z,
      y: at,
      scale: Math.min(scale, room),
      seed,
      ...(grow ? { grow } : {}),
    });
  };

  // The background: ribbons and stems along the back glass, leaving a gap behind the open water.
  const gap = mid + (woodLeft ? 1 : -1) * w * rng.range(0.02, 0.08);
  for (let x = box.left + 0.4; x < box.right - 0.3; x += rng.range(0.45, 0.85)) {
    if (Math.abs(x - gap) < 1.3) continue;
    const z = box.back + rng.range(0.35, 1.1);
    const r = rng.next();
    const nearWood = Math.abs(x - woodX) < 2.5;
    const kind: FloraId = nearWood
      ? r < 0.55
        ? "redstem"
        : "greenstem"
      : r < 0.5
        ? "vallis"
        : r < 0.75
          ? "greenstem"
          : "redstem";
    add(kind, x, z, rng.range(0.8, 1.15));
  }
  // Midground rosettes.
  for (let i = 0; i < 5; i++) {
    const x = mid + rng.range(-0.45, 0.45) * w;
    const z = -rng.range(D * 0.45, D * 0.7);
    if (Math.abs(x - stoneX) < 1.4) continue;
    add(i % 2 === 0 ? "sword" : "crypt", x, z, rng.range(0.85, 1.2));
  }
  for (let i = 0; i < 9; i++) {
    const x = (i % 2 === 0 ? stoneX : woodX) + rng.range(-2.6, 2.6);
    const z = -rng.range(D * 0.3, D * 0.45);
    add("crypt", x, z, rng.range(0.6, 0.95));
  }
  // On the wood: ferns where it rises, moss along it.
  const wood = woods[0]!;
  for (const [bi, b] of wood.branches.entries()) {
    const p = b.points[b.points.length - 1]!;
    if (bi > 0 && rng.next() < 0.75) add("fern", p[0], p[2], rng.range(0.8, 1.1), [0, 1, 0], p[1]);
    for (let k = 0; k < b.points.length - 1; k++) {
      const a = b.points[k]!;
      const c = b.points[k + 1]!;
      for (let j = 0; j < 3; j++) {
        const t = rng.next();
        add(
          "moss",
          a[0] + (c[0] - a[0]) * t,
          a[2] + (c[2] - a[2]) * t,
          rng.range(0.7, 1.2),
          [0, 1, 0],
          a[1] + (c[1] - a[1]) * t + b.radius * 0.7,
        );
      }
    }
  }
  // Anubias at the foot of the stones.
  for (const rock of rocks.slice(0, 3)) {
    const x = rock.x + rng.range(-0.5, 0.5);
    const z = rock.z + rock.size[2] + 0.15;
    add("anubias", x, z, rng.range(0.85, 1.1));
  }

  const carpet = {
    x0: mid - w * 0.36,
    x1: mid + w * 0.36,
    z0: -0.15,
    z1: -D * 0.38,
  };

  const rafts = [
    { x: mid + w * rng.range(-0.4, -0.2), z: -D * rng.range(0.35, 0.65), r: rng.range(1.1, 1.5) },
    { x: mid + w * rng.range(0.15, 0.4), z: -D * rng.range(0.4, 0.75), r: rng.range(0.8, 1.2) },
  ];

  for (const r of rafts) {
    // Frogbit leaves crowded towards each raft's middle.
    const n = Math.round(r.r * r.r * 60);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU);
      const d = r.r * Math.sqrt(rng.next()) * 0.95;
      add(
        "frogbit",
        r.x + Math.cos(a) * d,
        r.z + Math.sin(a) * d * 0.75,
        rng.range(0.8, 1.2),
        undefined,
        box.water,
      );
    }
  }

  const ax = gap + (woodLeft ? 1 : -1) * 1.9;
  const az = box.back + 0.5;
  const airstone: Vec3 = [ax, ground(ax, az) + 0.05, az];

  const lumps: Lump[] = [];
  const solids: Solid[] = [];
  for (const r of rocks) {
    if (r.kind === "pebble") continue;
    const f = rockFrame(r, ground);
    // The mesh is the ellipsoid pushed in and out by up to about a sixth.
    solids.push({
      kind: "ellipsoid",
      centre: f.centre,
      axes: f.axes,
      size: [r.size[0] * 1.12, r.size[1] * 1.12, r.size[2] * 1.12],
    });
    lumps.push({ centre: f.centre, radius: Math.max(...r.size) * 1.1 });
  }
  // Big plant rosettes are soft: fish swim round them but may brush the leaves.
  for (const p of plants) {
    if (p.kind !== "sword" && p.kind !== "anubias" && p.kind !== "crypt") continue;
    const h = p.kind === "sword" ? 1.1 : p.kind === "crypt" ? 0.5 : 0.4;
    lumps.push({ centre: [p.x, p.y + h * 0.6 * p.scale, p.z], radius: h * 0.75 * p.scale });
  }
  for (const b of wood.branches) {
    for (let k = 0; k < b.points.length - 1; k++) {
      const a = b.points[k]!;
      const c = b.points[k + 1]!;
      const along = (k + 1) / (b.points.length - 1);
      solids.push({
        kind: "capsule",
        a,
        b: c,
        radius: b.radius * (1.2 - 0.5 * along * (1 - b.taper)),
      });
      const n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]) / 0.4));
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        lumps.push({
          centre: [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t],
          radius: b.radius + 0.12,
        });
      }
    }
  }
  return { box, rocks, woods, plants, carpet, rafts, airstone, ground, lumps, solids };
};
