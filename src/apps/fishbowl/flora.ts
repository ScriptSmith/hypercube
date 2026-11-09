/**
 * Plants as data and meshes. Each kind is described by numbers (leaf shape, size, how many,
 * how stiff, which way it grows), sizes in metres at ten times life, and built from leaves:
 * strips along a curve, folded a little along the midrib, with what the shaders need to sway them
 * and colour them.
 *
 * `aLeaf` is (t along the leaf 0 to 1, across -1 to 1, a per-leaf random, kind) and `aSway`
 * is (height above the plant's anchor, the plant's own height, flex, phase): the vertex shader
 * moves every point by the current, more the higher it is up a flexible plant.
 */
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import type { Rng } from "../../core/types";
import type { Vec3 } from "../../core/view3d";
import type { FloraId, PlantSpot } from "./tank";
import { TAU } from "./vec";

/** Kind numbers the plant shader colours by. */
export const FLORA_KIND: Record<FloraId | "root", number> = {
  vallis: 0,
  sword: 1,
  redstem: 2,
  greenstem: 3,
  crypt: 4,
  grass: 5,
  fern: 6,
  anubias: 7,
  moss: 8,
  frogbit: 9,
  root: 10,
};

export interface Flora {
  /** Usual height or reach, metres. */
  height: number;
  /** How far the current bends it: 1 for ribbons, near 0 for stiff leaves. */
  flex: number;
  /** Reaches the surface, so it shows in its mirror. */
  tall: boolean;
}

export const FLORA: Record<FloraId, Flora> = {
  vallis: { height: 4.2, flex: 1, tall: true },
  sword: { height: 2.6, flex: 0.25, tall: false },
  redstem: { height: 3.6, flex: 0.55, tall: true },
  greenstem: { height: 3.4, flex: 0.6, tall: true },
  crypt: { height: 1.1, flex: 0.2, tall: false },
  grass: { height: 0.45, flex: 0.5, tall: false },
  fern: { height: 1.8, flex: 0.2, tall: false },
  anubias: { height: 0.9, flex: 0.05, tall: false },
  moss: { height: 0.2, flex: 0.3, tall: false },
  frogbit: { height: 0, flex: 0.2, tall: true },
};

interface Builder {
  pos: number[];
  normal: number[];
  leaf: number[];
  sway: number[];
  index: number[];
}

const newBuilder = (): Builder => ({ pos: [], normal: [], leaf: [], sway: [], index: [] });

export interface LeafSpec {
  base: Vector3;
  /** Unit direction it sets off in. */
  dir: Vector3;
  length: number;
  /** Half its widest width. */
  width: number;
  /** Width along the leaf, 0 base to 1 tip, as a share of `width`. */
  shape: (t: number) => number;
  /** How far it arches towards `out` over its length, and droops at the end. */
  arch: number;
  droop: number;
  out: Vector3;
  /** Turns about its own length, radians from base to tip. */
  twist: number;
  /** How far the halves fold up along the midrib, as a share of the width. */
  fold: number;
  segments: number;
  kind: number;
  /** Below this height, along the plant, it doesn't sway (the anchor). */
  anchor: number;
  /** The plant's height, for scaling sway. */
  span: number;
  flex: number;
  phase: number;
  seed: number;
  /** Ripples along the edges (a crypt's wavy margin), amplitude as a share of the width. */
  wave?: number;
  /** Clip the leaf against the water's surface, laying the rest along it (vallisneria). */
  surface?: number;
  /** Lie flat in the plane square to this (a floating leaf), rather than face `out`. */
  lay?: Vector3;
}

/** One leaf: three rows of points (edge, midrib, edge) along a curve. */
export const addLeaf = (b: Builder, s: LeafSpec) => {
  const centre = new Vector3();
  const prev = new Vector3().copy(s.base);
  const tangent = new Vector3().copy(s.dir);
  const across = new Vector3();
  const normal = new Vector3();
  const rows: number[][] = [];
  const flat = new Vector3(s.out.x, 0, s.out.z);
  if (flat.lengthSq() < 1e-6) flat.set(1, 0, 0);
  flat.normalize();
  for (let i = 0; i <= s.segments; i++) {
    const t = i / s.segments;
    centre
      .copy(s.base)
      .addScaledVector(s.dir, s.length * t)
      .addScaledVector(s.out, s.arch * s.length * t * t);
    centre.y -= s.droop * s.length * t ** 3;
    if (s.surface !== undefined && centre.y > s.surface) {
      // Lay what is left along the surface, trailing away with the current.
      const over = centre.y - s.surface;
      centre.y = s.surface - 0.01;
      centre.addScaledVector(flat, over * 0.9);
    }
    if (i > 0) tangent.subVectors(centre, prev).normalize();
    prev.copy(centre);
    if (s.lay) across.crossVectors(s.lay, tangent);
    else across.crossVectors(tangent, flat);
    if (across.lengthSq() < 1e-6) across.set(1, 0, 0);
    across.normalize().applyAxisAngle(tangent, s.twist * t);
    normal.crossVectors(across, tangent).normalize();
    const w = s.width * s.shape(t);
    const rows3: number[] = [];
    for (const k of [-1, 0, 1]) {
      let ww = w;
      if (s.wave && k !== 0) ww *= 1 + s.wave * Math.sin(t * 40 + k * 1.3 + s.seed);
      const p = centre
        .clone()
        .addScaledVector(across, k * ww)
        .addScaledVector(normal, Math.abs(k) * w * s.fold);
      if (s.surface !== undefined) p.y = Math.min(p.y, s.surface - 0.005);
      // Leaves that reach the front glass lie against it.
      p.z = Math.min(p.z, -0.02);
      b.pos.push(p.x, p.y, p.z);
      b.normal.push(normal.x, normal.y, normal.z);
      b.leaf.push(t, k, s.seed, s.kind);
      // Hanging things (a negative span) sway more the further down they hang.
      const h = s.span < 0 ? s.anchor - p.y : p.y - s.anchor;
      b.sway.push(Math.max(0, h), Math.abs(s.span), s.flex, s.phase);
      rows3.push(b.pos.length / 3 - 1);
    }
    rows.push(rows3);
  }
  for (let i = 0; i < s.segments; i++) {
    for (let k = 0; k < 2; k++) {
      const a = rows[i]![k]!;
      const c = rows[i + 1]![k]!;
      const d = rows[i + 1]![k + 1]!;
      const e = rows[i]![k + 1]!;
      b.index.push(a, c, d, a, d, e);
    }
  }
};

/** A thin round stem through `points`, as a few-sided tube. */
const addStem = (
  b: Builder,
  points: Vector3[],
  radius: number,
  kind: number,
  anchor: number,
  span: number,
  flex: number,
  phase: number,
  seed: number,
) => {
  const sides = 4;
  const rows: number[][] = [];
  const t = new Vector3();
  const a = new Vector3();
  const c = new Vector3();
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    t.subVectors(
      points[Math.min(points.length - 1, i + 1)]!,
      points[Math.max(0, i - 1)]!,
    ).normalize();
    a.set(1, 0, 0).cross(t);
    if (a.lengthSq() < 1e-6) a.set(0, 0, 1);
    a.normalize();
    c.crossVectors(t, a).normalize();
    const row: number[] = [];
    for (let j = 0; j < sides; j++) {
      const ang = (j / sides) * TAU;
      const n = a.clone().multiplyScalar(Math.cos(ang)).addScaledVector(c, Math.sin(ang));
      const q = p.clone().addScaledVector(n, radius);
      b.pos.push(q.x, q.y, q.z);
      b.normal.push(n.x, n.y, n.z);
      b.leaf.push(i / (points.length - 1), 0, seed, kind);
      b.sway.push(Math.max(0, q.y - anchor), span, flex, phase);
      row.push(b.pos.length / 3 - 1);
    }
    rows.push(row);
  }
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let j = 0; j < sides; j++) {
      const j1 = (j + 1) % sides;
      b.index.push(
        rows[i]![j]!,
        rows[i + 1]![j]!,
        rows[i + 1]![j1]!,
        rows[i]![j]!,
        rows[i + 1]![j1]!,
        rows[i]![j1]!,
      );
    }
  }
};

const smoothstep01 = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

const lanceolate = (t: number) =>
  Math.sin(Math.PI * Math.min(1, t * 0.97 + 0.03)) ** 0.8 * (1 - 0.3 * t);
const ribbon = (t: number) => Math.min(1, (1 - t) * 8) * (0.85 + 0.15 * (1 - t));
const oval = (t: number) =>
  Math.sqrt(Math.max(0, Math.sin(Math.PI * t))) * (t < 0.08 ? t / 0.08 : 1);
const sword = (t: number) => (t < 0.35 ? 0.06 : Math.sin(Math.PI * ((t - 0.35) / 0.65)) ** 0.7);
const strand = (t: number) => 1 - t * 0.7;

const dirFrom = (yaw: number, lean: number) =>
  new Vector3(Math.sin(yaw) * Math.sin(lean), Math.cos(lean), Math.cos(yaw) * Math.sin(lean));

export interface FloraMeshes {
  /** Plants that reach the surface and show in its mirror. */
  tall: BufferGeometry;
  /** Everything else. */
  low: BufferGeometry;
}

export interface FloraContext {
  water: number;
  /** The ground's height. */
  ground(x: number, z: number): number;
  /** 1 for the bowl's lighter meshes, more on the wall. */
  detail: number;
}

const finish = (b: Builder): BufferGeometry => {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(b.pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(b.normal), 3));
  g.setAttribute("aLeaf", new BufferAttribute(new Float32Array(b.leaf), 4));
  g.setAttribute("aSway", new BufferAttribute(new Float32Array(b.sway), 4));
  g.setIndex(b.index);
  return g;
};

/** Build the meshes for every plant in `spots`. */
export const buildFlora = (
  spots: readonly PlantSpot[],
  ctx: FloraContext,
  rng: Rng,
): FloraMeshes => {
  const tall = newBuilder();
  const low = newBuilder();
  const segs = (n: number) => Math.max(3, Math.round(n * ctx.detail));
  for (const spot of spots) {
    const own = rng.fork(`plant-${spot.seed}`);
    const f = FLORA[spot.kind];
    const b = f.tall ? tall : low;
    const kind = FLORA_KIND[spot.kind];
    const root = new Vector3(spot.x, spot.y - 0.02, spot.z);
    const s = spot.scale;
    const phase = own.range(0, TAU);
    const leaf = (
      spec: Omit<LeafSpec, "kind" | "anchor" | "span" | "flex" | "phase" | "seed"> &
        Partial<LeafSpec>,
    ) =>
      addLeaf(b, {
        kind,
        anchor: root.y,
        span: f.height * s,
        flex: f.flex,
        phase,
        seed: own.next(),
        ...spec,
      });
    switch (spot.kind) {
      case "vallis": {
        const n = 7 + own.int(5);
        for (let i = 0; i < n; i++) {
          const yaw = own.range(0, TAU);
          const base = root
            .clone()
            .add(new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(own.range(0, 0.12)));
          const out = new Vector3(own.range(-1, 1), 0, own.range(-0.2, 1)).normalize();
          leaf({
            base,
            dir: dirFrom(yaw, own.range(0.02, 0.12)),
            length: f.height * s * own.range(0.75, 1.15),
            width: own.range(0.035, 0.05),
            shape: ribbon,
            arch: own.range(0.05, 0.15),
            droop: 0,
            out,
            twist: own.range(-3, 3),
            fold: 0.05,
            segments: segs(22),
            surface: ctx.water,
          });
        }
        break;
      }
      case "sword": {
        const n = 11 + own.int(6);
        for (let i = 0; i < n; i++) {
          const yaw = (i / n) * TAU * 2.3 + own.range(-0.3, 0.3);
          const inner = i > n * 0.6;
          const lean = inner ? own.range(0.15, 0.4) : own.range(0.45, 0.8);
          const out = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
          leaf({
            base: root.clone(),
            dir: dirFrom(yaw, lean),
            length: f.height * s * own.range(0.7, 1),
            width: own.range(0.16, 0.22) * s,
            shape: sword,
            arch: own.range(0.15, 0.35),
            droop: own.range(0.1, 0.3),
            out,
            twist: own.range(-0.4, 0.4),
            fold: 0.18,
            segments: segs(14),
          });
        }
        break;
      }
      case "redstem":
      case "greenstem": {
        const red = spot.kind === "redstem";
        const stems = 5 + own.int(5);
        for (let k = 0; k < stems; k++) {
          const a = own.range(0, TAU);
          const r0 = own.range(0, 0.28);
          const h = Math.min(ctx.water - root.y - 0.05, f.height * s * own.range(0.45, 1.1));
          const lean = new Vector3(own.range(-0.12, 0.12), 1, own.range(-0.12, 0.12)).normalize();
          const start = root.clone().add(new Vector3(Math.cos(a) * r0, 0, Math.sin(a) * r0));
          const nodes = Math.round(h / (red ? 0.075 : 0.11));
          const points: Vector3[] = [];
          for (let i = 0; i <= 8; i++) {
            const t = i / 8;
            points.push(
              start
                .clone()
                .addScaledVector(lean, h * t)
                .add(
                  new Vector3(Math.sin(t * 3 + a) * 0.06 * t, 0, Math.cos(t * 2 + a) * 0.05 * t),
                ),
            );
          }
          addStem(b, points, 0.012, kind, root.y, h, f.flex, phase, own.next());
          for (let i = 1; i < nodes; i++) {
            const t = i / nodes;
            const at = points[Math.min(7, Math.floor(t * 8))]!.clone().lerp(
              points[Math.min(8, Math.floor(t * 8) + 1)]!,
              (t * 8) % 1,
            );
            // Leaves in opposite pairs, each pair turned a quarter from the last; small and
            // pointing up near the growing tip, older ones lower down spreading and drooping.
            const turn = i * (Math.PI / 2) + own.range(-0.3, 0.3);
            const top = smoothstep01((t - 0.8) / 0.2);
            for (let j = 0; j < 2; j++) {
              if (t < 0.25 && own.next() < 0.35) continue;
              const yaw = turn + j * Math.PI + own.range(-0.25, 0.25);
              const len = (red ? 0.15 : 0.24) * (1 - 0.55 * top) * own.range(0.75, 1.2);
              const lean = (1 - top) * own.range(0.65, 1.05) + top * own.range(0.25, 0.45);
              leaf({
                base: at,
                dir: dirFrom(yaw, lean),
                length: len,
                width: len * (red ? 0.15 : 0.22),
                shape: lanceolate,
                arch: own.range(-0.15, 0.25),
                droop: (1 - top) * own.range(0, red ? 0.15 : 0.3),
                out: new Vector3(0, 1, 0),
                twist: own.range(-0.4, 0.4),
                fold: 0.15,
                segments: segs(4),
                seed: t,
              });
            }
          }
        }
        break;
      }
      case "crypt": {
        const n = 7 + own.int(5);
        for (let i = 0; i < n; i++) {
          const yaw = own.range(0, TAU);
          leaf({
            base: root.clone(),
            dir: dirFrom(yaw, own.range(0.35, 0.8)),
            length: f.height * s * own.range(0.7, 1.05),
            width: own.range(0.09, 0.12) * s,
            shape: (t) => (t < 0.3 ? 0.08 : lanceolate((t - 0.3) / 0.7)),
            arch: own.range(0.2, 0.4),
            droop: own.range(0.15, 0.35),
            out: new Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
            twist: own.range(-0.5, 0.5),
            fold: 0.12,
            segments: segs(12),
            wave: 0.18,
          });
        }
        break;
      }
      case "fern": {
        const n = 6 + own.int(4);
        const g = spot.grow ? new Vector3(...spot.grow) : new Vector3(0, 1, 0);
        for (let i = 0; i < n; i++) {
          const yaw = own.range(0, TAU);
          const d = dirFrom(yaw, own.range(0.3, 0.75)).addScaledVector(g, 0.5).normalize();
          leaf({
            base: root.clone().add(new Vector3(own.range(-0.15, 0.15), 0, own.range(-0.15, 0.15))),
            dir: d,
            length: f.height * s * own.range(0.6, 1),
            width: own.range(0.13, 0.17) * s,
            shape: lanceolate,
            arch: own.range(0.25, 0.45),
            droop: own.range(0.2, 0.45),
            out: new Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
            twist: own.range(-0.3, 0.3),
            fold: 0.22,
            segments: segs(12),
          });
        }
        break;
      }
      case "anubias": {
        const n = 6 + own.int(4);
        for (let i = 0; i < n; i++) {
          const yaw = own.range(0, TAU);
          const lean = own.range(0.4, 1.1);
          const stalk = own.range(0.15, 0.3) * s;
          const d = dirFrom(yaw, lean);
          const start = root.clone().addScaledVector(d, stalk);
          addStem(
            b,
            [root.clone(), root.clone().addScaledVector(d, stalk * 0.5), start],
            0.018,
            kind,
            root.y,
            f.height * s,
            f.flex,
            phase,
            own.next(),
          );
          leaf({
            base: start,
            dir: dirFrom(yaw, Math.min(1.35, lean + 0.25)),
            length: own.range(0.45, 0.65) * s,
            width: own.range(0.17, 0.22) * s,
            shape: oval,
            arch: -0.05,
            droop: 0.05,
            out: new Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
            twist: own.range(-0.3, 0.3),
            fold: 0.1,
            segments: segs(8),
          });
        }
        break;
      }
      case "moss": {
        // A tuft of short fronds, each a few fine strands.
        const n = 18 + own.int(10);
        for (let i = 0; i < n; i++) {
          const yaw = own.range(0, TAU);
          leaf({
            base: root
              .clone()
              .add(
                new Vector3(
                  own.range(-0.18, 0.18) * s,
                  own.range(-0.05, 0.05),
                  own.range(-0.18, 0.18) * s,
                ),
              ),
            dir: dirFrom(yaw, own.range(0.3, 1.3)),
            length: own.range(0.1, 0.22) * s,
            width: own.range(0.015, 0.025),
            shape: strand,
            arch: own.range(0.1, 0.4),
            droop: own.range(0, 0.4),
            out: new Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
            twist: own.range(-2, 2),
            fold: 0.4,
            segments: segs(3),
          });
        }
        break;
      }
      case "frogbit": {
        // A round leaf lying on the surface, its roots hanging down.
        const r = own.range(0.08, 0.12) * s;
        const centre = new Vector3(spot.x, ctx.water - 0.012, spot.z);
        const yaw = own.range(0, TAU);
        const across = new Vector3(Math.cos(yaw), 0, Math.sin(yaw));
        leaf({
          base: centre.clone().addScaledVector(across, -r),
          dir: across,
          length: r * 2,
          width: r,
          shape: (t) => Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)),
          arch: 0,
          droop: 0,
          out: new Vector3(0, 1, 0),
          twist: 0,
          fold: -0.08,
          segments: segs(6),
          anchor: ctx.water - 3,
          lay: new Vector3(0, 1, 0),
        });
        const roots = 2 + own.int(3);
        for (let i = 0; i < roots; i++) {
          addLeaf(b, {
            kind: FLORA_KIND.root,
            base: centre
              .clone()
              .add(new Vector3(own.range(-0.03, 0.03), -0.01, own.range(-0.03, 0.03))),
            dir: new Vector3(own.range(-0.1, 0.1), -1, own.range(-0.1, 0.1)).normalize(),
            length: own.range(0.25, 0.9),
            width: 0.007,
            shape: strand,
            arch: 0.05,
            droop: 0,
            out: new Vector3(1, 0, 0),
            twist: 0,
            fold: 0,
            segments: segs(6),
            anchor: ctx.water,
            span: -1.2,
            flex: 0.7,
            phase,
            seed: own.next(),
          });
        }
        break;
      }
      case "grass":
        break;
    }
  }
  return { tall: finish(tall), low: finish(low) };
};

/** Blades of a carpet over a patch of ground, as one mesh (they never reach the mirror). */
export const buildCarpet = (
  patch: { x0: number; x1: number; z0: number; z1: number },
  ctx: FloraContext,
  avoid: (x: number, z: number) => boolean,
  rng: Rng,
): BufferGeometry => {
  const b = newBuilder();
  const area = Math.abs((patch.x1 - patch.x0) * (patch.z1 - patch.z0));
  const tufts = Math.round(area * 26 * ctx.detail);
  const kind = FLORA_KIND.grass;
  for (let i = 0; i < tufts; i++) {
    const x = rng.range(patch.x0, patch.x1);
    const z = rng.range(patch.z1, patch.z0);
    // Thinner towards the patch's edges, in drifts.
    const ex = Math.min(x - patch.x0, patch.x1 - x) / 1.2;
    const ez = Math.min(z - patch.z1, patch.z0 - z) / 0.5;
    const drift = 0.5 + 0.5 * Math.sin(x * 0.9 + Math.cos(z * 1.7) * 2);
    if (rng.next() > Math.min(1, ex, ez) * (0.35 + 0.65 * drift)) continue;
    if (avoid(x, z)) continue;
    const y = ctx.ground(x, z);
    const blades = 5 + rng.int(5);
    const phase = rng.range(0, TAU);
    const h = FLORA.grass.height * rng.range(0.6, 1.2) * (0.6 + 0.4 * drift);
    for (let k = 0; k < blades; k++) {
      const yaw = rng.range(0, TAU);
      addLeaf(b, {
        kind,
        base: new Vector3(x + rng.range(-0.05, 0.05), y - 0.01, z + rng.range(-0.05, 0.05)),
        dir: dirFrom(yaw, rng.range(0.05, 0.4)),
        length: h * rng.range(0.7, 1.1),
        width: rng.range(0.008, 0.012),
        shape: strand,
        arch: rng.range(0.05, 0.3),
        droop: 0,
        out: new Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
        twist: rng.range(-1, 1),
        fold: 0.3,
        segments: Math.max(2, Math.round(3 * ctx.detail)),
        anchor: y,
        span: h,
        flex: FLORA.grass.flex,
        phase,
        seed: rng.next(),
      });
    }
  }
  return finish(b);
};

/** Root points where plants of one kind can't go, for the carpet. */
export const near = (points: readonly Vec3[], r: number) => (x: number, z: number) =>
  points.some((p) => Math.hypot(p[0] - x, p[2] - z) < r);
