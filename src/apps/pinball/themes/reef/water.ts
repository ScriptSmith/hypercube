/**
 * Reef's moving water, shared by the tables and the deck: caustic light sliding over the sand,
 * motes drifting with the current, air bubbles and kelp. Each is one draw call, built once, with
 * no allocation per frame; counts are fixed, so nothing grows over days.
 *
 * Scene coordinates follow view3d/kit.ts: field px with y flipped, z towards the viewer.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  type InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RepeatWrapping,
  type Texture,
  Vector3,
} from "three";
import { instances } from "../../view3d/deckparts3d";
import type { Kit } from "../../view3d/kit";
import { paintBubble, paintCaustics } from "./art";

interface Tex {
  /** A sharp net of light, and a soft one that the sharp one is multiplied by. */
  caustic: Texture;
  soft: Texture;
  bubble: Texture;
}

const cache = new WeakMap<Kit, Tex>();

const textures = (kit: Kit): Tex => {
  const have = cache.get(kit);
  if (have) return have;
  const caustic = kit.paint(192, 192, (g) => paintCaustics(g, 192, 5, 0.02, 0.045));
  const soft = kit.paint(96, 96, (g) => paintCaustics(g, 96, 8, 0.35, 0.12));
  for (const t of [caustic, soft]) t.wrapS = t.wrapT = RepeatWrapping;
  const t: Tex = { caustic, soft, bubble: kit.paint(64, 64, (g) => paintBubble(g, 64)) };
  cache.set(kit, t);
  return t;
};

/**
 * Caustics over `geometry` (a flat shape in scene coordinates, whose uvs are its scene x and y):
 * two nets of light at different sizes sliding different ways, multiplied, so they shimmer.
 * `tile` is the larger net's size in px.
 */
export const createCaustics = (
  kit: Kit,
  geometry: BufferGeometry,
  o: { tile: number; tint: string; z: number },
) => {
  const T = textures(kit);
  const a = kit.keep(T.caustic.clone());
  const b = kit.keep(T.soft.clone());
  a.repeat.set(1 / o.tile, 1 / o.tile);
  b.repeat.set(1 / (o.tile * 1.6), 1 / (o.tile * 1.6));
  b.rotation = 0.7;
  const mat = kit.keep(
    new MeshBasicMaterial({
      color: o.tint,
      map: a,
      alphaMap: b,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  const mesh = new Mesh(geometry, mat);
  mesh.position.z = o.z;
  mesh.renderOrder = 1;
  return {
    mesh,
    sync(time: number) {
      a.offset.set((time * 0.021) % 1, (time * 0.013) % 1);
      b.offset.set((-time * 0.017) % 1, (time * 0.024) % 1);
    },
  };
};

const m4 = new Matrix4();
const q = new Quaternion();
const v = new Vector3();
const s3 = new Vector3();
const tint = new Color();
const Z = new Vector3(0, 0, 1);

export interface Bubbles {
  readonly mesh: InstancedMesh;
  /** A bubble at field (x, y), height z, radius r, moving (vx, vy, vz) px/s, for `life` s. */
  spawn(
    x: number,
    y: number,
    z: number,
    r: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
  ): void;
  /** Move them all `dt` seconds, drifting `drift` px/s across the field. */
  update(dt: number, drift?: { x: number; y: number }): void;
  clear(): void;
}

/** Up to `max` air bubbles; a new one past the limit takes the oldest one's place. */
export const createBubbles = (kit: Kit, max: number): Bubbles => {
  const T = textures(kit);
  const mat = kit.keep(
    new MeshBasicMaterial({ map: T.bubble, transparent: true, depthWrite: false }),
  );
  const mesh = instances(kit.geo.quad, mat, max);
  mesh.count = 0;
  mesh.renderOrder = 5;
  const list = Array.from({ length: max }, () => ({
    on: false,
    x: 0,
    y: 0,
    z: 0,
    r: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    age: 0,
    life: 1,
    wob: 0,
  }));
  let next = 0;
  return {
    mesh,
    spawn(x, y, z, r, vx, vy, vz, life) {
      const b = list[next]!;
      next = (next + 1) % max;
      b.on = true;
      b.x = x;
      b.y = y;
      b.z = z;
      b.r = r;
      b.vx = vx;
      b.vy = vy;
      b.vz = vz;
      b.age = 0;
      b.life = life;
      b.wob = x * 0.37 + y * 0.11;
    },
    update(dt, drift) {
      let n = 0;
      for (const b of list) {
        if (!b.on) continue;
        b.age += dt;
        if (b.age >= b.life) {
          b.on = false;
          continue;
        }
        const w = Math.sin(b.age * 7 + b.wob);
        b.x += (b.vx + (drift?.x ?? 0) + w * 18) * dt;
        b.y += (b.vy + (drift?.y ?? 0)) * dt;
        b.z += b.vz * dt;
        const k = b.age / b.life;
        // Grows a little as it rises, and pops at the end.
        const r = b.r * (1 + 0.4 * k) * (k > 0.9 ? 1 - (k - 0.9) * 8 : 1);
        q.identity();
        mesh.setMatrixAt(n, m4.compose(v.set(b.x, -b.y, b.z), q, s3.set(r * 2, r * 2, 1)));
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    },
    clear() {
      for (const b of list) b.on = false;
      mesh.count = 0;
    },
  };
};

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * `n` motes drifting through a box along a direction, wrapping round from edge to edge and
 * fading near the edges, wobbling as they go: what shows the current.
 */
export const createMotes = (
  kit: Kit,
  n: number,
  box: Box,
  o: { color: string; size: number; speed: number; z: number; seed: number },
) => {
  const mesh = instances(kit.geo.quad, kit.glow("#ffffff"), n);
  mesh.renderOrder = 4;
  let s = o.seed >>> 0 || 1;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const ps = Array.from({ length: n }, () => ({
    x: box.x0 + rnd() * w,
    y: box.y0 + rnd() * h,
    k: 0.6 + rnd() * 0.8,
    ph: rnd() * 6.28,
  }));
  const base = new Color(o.color);
  return {
    mesh,
    update(dt: number, time: number, dir: { x: number; y: number }, strength = 1) {
      ps.forEach((p, i) => {
        const sp = o.speed * p.k * strength;
        p.x += (dir.x * sp + Math.sin(time * 1.3 + p.ph) * 10) * dt;
        p.y += (dir.y * sp + Math.cos(time * 1.1 + p.ph) * 10) * dt;
        if (p.x < box.x0) p.x += w;
        else if (p.x > box.x1) p.x -= w;
        if (p.y < box.y0) p.y += h;
        else if (p.y > box.y1) p.y -= h;
        const edge = Math.min(p.x - box.x0, box.x1 - p.x, p.y - box.y0, box.y1 - p.y);
        const fade = Math.max(0, Math.min(1, edge / 60));
        // Drawn as a soft streak along the flow, longer the stronger it runs.
        const size = o.size * p.k;
        q.setFromAxisAngle(Z, Math.atan2(-dir.y, dir.x));
        mesh.setMatrixAt(
          i,
          m4.compose(v.set(p.x, -p.y, o.z), q, s3.set(size * (1 + 2.2 * strength), size * 0.7, 1)),
        );
        mesh.setColorAt(
          i,
          tint.copy(base).multiplyScalar(0.8 * fade * (0.7 + 0.3 * Math.sin(time * 3 + p.ph))),
        );
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
};

export interface Strand {
  /** Where it is rooted, field px. */
  x: number;
  y: number;
  /** Which way it grows across the field (radians, y down), how long and how wide. */
  a: number;
  len: number;
  width: number;
}

const SEGS = 14;

/**
 * Kelp: ribbons rooted at their strands' feet, lying low over the field and rising a little
 * towards their tips, swaying with time and leaning with the water's flow.
 */
export const createKelp = (
  kit: Kit,
  strands: readonly Strand[],
  o: { z: number; seed: number },
) => {
  const nv = strands.length * (SEGS + 1) * 2;
  const pos = new Float32Array(Math.max(3, nv * 3));
  const col = new Float32Array(Math.max(3, nv * 3));
  const index: number[] = [];
  const dark = new Color("#2d5a2a");
  const light = new Color("#a6c94a");
  const c = new Color();
  strands.forEach((_, si) => {
    const b = si * (SEGS + 1) * 2;
    for (let i = 0; i <= SEGS; i++) {
      c.copy(dark).lerp(light, i / SEGS);
      for (const k of [0, 1]) {
        const at = (b + i * 2 + k) * 3;
        col[at] = c.r * (k ? 0.85 : 1);
        col[at + 1] = c.g * (k ? 0.85 : 1);
        col[at + 2] = c.b * (k ? 0.85 : 1);
      }
      if (i < SEGS) {
        const p = b + i * 2;
        index.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
      }
    }
  });
  const geo = kit.keep(new BufferGeometry());
  const posAttr = new BufferAttribute(pos, 3);
  geo.setAttribute("position", posAttr);
  geo.setAttribute("color", new BufferAttribute(col, 3));
  geo.setIndex(index);
  const mat = kit.keep(new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  const phase = strands.map((_, i) => (o.seed * 1.7 + i * 2.3) % 6.28);
  return {
    mesh,
    /** Lay the strands for `time`, leaning towards `flow` (a direction scaled 0 to 1). */
    update(time: number, flow: { x: number; y: number }) {
      strands.forEach((s, si) => {
        const b = si * (SEGS + 1) * 2;
        let x = s.x;
        let y = s.y;
        let a = s.a;
        const step = s.len / SEGS;
        const lean = Math.atan2(flow.y, flow.x);
        const pull = Math.min(1, Math.hypot(flow.x, flow.y));
        for (let i = 0; i <= SEGS; i++) {
          const t = i / SEGS;
          // Lean towards the flow, more towards the tip, and sway.
          let d = lean - a;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          const ang = a + d * pull * 0.06 + Math.sin(time * 1.4 + phase[si]! + t * 3) * 0.05;
          const half =
            s.width *
            (0.35 + 0.65 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.95)) *
            (1 + 0.25 * Math.sin(t * 19 + time * 2));
          const nx = -Math.sin(ang);
          const ny = Math.cos(ang);
          const z = o.z + t * 14;
          const at = (b + i * 2) * 3;
          pos[at] = x + nx * half;
          pos[at + 1] = -(y + ny * half);
          pos[at + 2] = z;
          pos[at + 3] = x - nx * half;
          pos[at + 4] = -(y - ny * half);
          pos[at + 5] = z;
          x += Math.cos(ang) * step;
          y += Math.sin(ang) * step;
          a = ang;
        }
      });
      posAttr.needsUpdate = true;
    },
  };
};
