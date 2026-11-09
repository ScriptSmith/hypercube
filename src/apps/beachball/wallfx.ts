/**
 * Small things round the balls: sand kicked up by a hard landing, water splashed or flung off a
 * wet ball, lumps of damp sand falling out of the bucket, a crab's bubbles, and a ring where a
 * finger lands. All of them live in one fixed pool and fade within about a second or two, so
 * nothing builds up. `createBatch` draws soft discs, drops and rings as quads
 * in one draw call; shadows use it too.
 */
import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  Mesh,
  NormalBlending,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector2,
} from "three";
import type { Rng } from "../../core/types";

export const MAX_PARTICLES = 160;
const SAND_GRAVITY = 9.8;

export type Shape = "soft" | "drop" | "ring" | "clump";
const SHAPE: Record<Shape, number> = { soft: 0, drop: 1, ring: 2, clump: 3 };

export interface Particle {
  shape: Shape;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radius, metres, and how fast it grows. */
  size: number;
  grow: number;
  age: number;
  life: number;
  colour: [number, number, number];
  alpha: number;
  gravity: number;
  /** Ground it lands on, metres up the wall; -Infinity for none. */
  land: number;
  /** Softness of a disc's edge, or a ring's width, 0 to 1. */
  soft: number;
}

export interface Fx {
  readonly list: readonly Particle[];
  readonly spawned: number;
  /** Sand thrown up where a ball landed at `speed` m/s. */
  puff(x: number, y: number, speed: number): void;
  /** Water thrown up where a ball landed in the wash. */
  splash(x: number, y: number, speed: number): void;
  /** `count` drops flung off the rim of a ball at (x, y), radius r, moving at (vx, vy). */
  shed(x: number, y: number, r: number, vx: number, vy: number, count: number): void;
  /** A ring where a finger landed. */
  ripple(x: number, y: number, strength: number): void;
  /**
   * Lumps of damp sand and loose grains thrown from about (x, y) at about (vx, vy), spread by
   * `spread` m/s, each stopping where it lands on the sand at `land`.
   */
  lumps(
    x: number,
    y: number,
    vx: number,
    vy: number,
    lumps: number,
    grains: number,
    spread: number,
    land: number,
  ): void;
  /** A bubble rising from (x, y), as an annoyed crab blows them. */
  bubble(x: number, y: number): void;
  step(dt: number): void;
  clear(): void;
}

/** Damp sand, darker than the dry beach. */
const DAMP: readonly [number, number, number][] = [
  [0.47, 0.4, 0.3],
  [0.42, 0.35, 0.26],
  [0.52, 0.45, 0.34],
];

const SAND: readonly [number, number, number][] = [
  [0.52, 0.43, 0.3],
  [0.62, 0.53, 0.38],
  [0.4, 0.33, 0.24],
  [0.72, 0.64, 0.5],
];

export const createFx = (rng: Rng): Fx => {
  const pool: Particle[] = [];
  let next = 0;
  let spawned = 0;

  const add = (p: Particle) => {
    spawned++;
    if (pool.length < MAX_PARTICLES) {
      pool.push(p);
      return;
    }
    // Full: the oldest slot in turn makes way.
    pool[next] = p;
    next = (next + 1) % MAX_PARTICLES;
  };

  const base = (shape: Shape, x: number, y: number): Particle => ({
    shape,
    x,
    y,
    vx: 0,
    vy: 0,
    size: 0.01,
    grow: 0,
    age: 0,
    life: 1,
    colour: [1, 1, 1],
    alpha: 1,
    gravity: 0,
    land: -Infinity,
    soft: 0.3,
  });

  return {
    list: pool,
    get spawned() {
      return spawned;
    },
    puff(x, y, speed) {
      const k = Math.min(1.6, speed / 4);
      const grains = Math.max(3, Math.min(14, Math.round(speed * 2.2)));
      for (let i = 0; i < grains; i++) {
        const p = base("soft", x + rng.range(-0.25, 0.25), y);
        p.vx = rng.range(-1.6, 1.6) * k;
        p.vy = rng.range(0.8, 2.6) * k;
        p.size = rng.range(0.006, 0.014);
        p.life = rng.range(0.6, 1.1);
        p.colour = [...rng.pick(SAND)];
        p.gravity = SAND_GRAVITY;
        p.land = y - rng.range(0, 0.06);
        p.soft = 0.35;
        add(p);
      }
      const clouds = speed > 5 ? 3 : 2;
      for (let i = 0; i < clouds; i++) {
        const p = base("soft", x + rng.range(-0.3, 0.3), y + rng.range(0, 0.08));
        p.vx = rng.range(-0.35, 0.35);
        p.vy = rng.range(0.08, 0.22);
        p.size = rng.range(0.1, 0.2);
        p.grow = rng.range(0.15, 0.3);
        p.life = rng.range(0.8, 1.3);
        p.colour = [0.8, 0.72, 0.58];
        p.alpha = Math.min(0.3, 0.06 * speed);
        p.soft = 1;
        add(p);
      }
    },
    splash(x, y, speed) {
      const k = Math.min(1.5, speed / 4);
      const n = Math.max(4, Math.min(12, Math.round(speed * 2)));
      for (let i = 0; i < n; i++) {
        const p = base("drop", x + rng.range(-0.3, 0.3), y);
        p.vx = rng.range(-1.4, 1.4) * k;
        p.vy = rng.range(1, 3.2) * k;
        p.size = rng.range(0.008, 0.016);
        p.life = rng.range(0.5, 0.9);
        p.colour = [0.72, 0.86, 0.9];
        p.alpha = 0.9;
        p.gravity = SAND_GRAVITY;
        p.land = y - rng.range(0, 0.05);
        add(p);
      }
      const ring = base("ring", x, y);
      ring.size = 0.15;
      ring.grow = 0.5;
      ring.life = 0.6;
      ring.colour = [0.92, 0.96, 0.97];
      ring.alpha = 0.6;
      ring.soft = 0.25;
      add(ring);
    },
    shed(x, y, r, vx, vy, count) {
      for (let i = 0; i < count; i++) {
        const a = rng.range(0, Math.PI * 2);
        const c = Math.cos(a);
        const s = Math.sin(a);
        const p = base("drop", x + c * r, y + s * r);
        const out = rng.range(0.8, 2.2);
        p.vx = vx * 0.8 + c * out;
        p.vy = vy * 0.8 + s * out;
        p.size = rng.range(0.007, 0.013);
        p.life = rng.range(0.6, 1.0);
        p.colour = [0.74, 0.87, 0.92];
        p.alpha = 0.85;
        p.gravity = SAND_GRAVITY;
        p.land = 0.05;
        add(p);
      }
    },
    ripple(x, y, strength) {
      const p = base("ring", x, y);
      p.size = 0.06;
      p.grow = 0.55;
      p.life = 0.55;
      p.alpha = Math.min(0.55, 0.3 + 0.25 * strength);
      p.colour = [1, 1, 1];
      p.soft = 0.22;
      add(p);
    },
    lumps(x, y, vx, vy, lumps, grains, spread, land) {
      for (let i = 0; i < lumps + grains; i++) {
        const lump = i < lumps;
        const p = base(
          lump ? "clump" : "soft",
          x + rng.range(-0.06, 0.06),
          y + rng.range(-0.04, 0.04),
        );
        p.vx = vx + rng.range(-1, 1) * spread;
        p.vy = vy + rng.range(-1, 1) * spread;
        p.size = lump ? rng.range(0.045, 0.085) : rng.range(0.008, 0.016);
        p.life = rng.range(1.4, 2);
        p.colour = [...rng.pick(lump ? DAMP : SAND)];
        p.gravity = SAND_GRAVITY;
        p.land = land - rng.range(0, 0.04);
        p.soft = lump ? 0.2 : 0.35;
        add(p);
      }
    },
    bubble(x, y) {
      const p = base("ring", x, y);
      p.vx = rng.range(-0.08, 0.08);
      p.vy = rng.range(0.12, 0.3);
      p.gravity = -0.25;
      p.size = rng.range(0.012, 0.024);
      p.grow = 0.012;
      p.life = rng.range(0.6, 1.1);
      p.colour = [0.88, 0.95, 1];
      p.alpha = 0.75;
      p.soft = 0.3;
      add(p);
    },
    step(dt) {
      for (let i = pool.length - 1; i >= 0; i--) {
        const p = pool[i]!;
        p.age += dt;
        if (p.age >= p.life) {
          pool.splice(i, 1);
          if (next > i) next--;
          if (next >= pool.length) next = 0;
          continue;
        }
        p.vy -= p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.size += p.grow * dt;
        if (p.y < p.land && p.vy < 0) {
          // Landed: it stops there and fades out quickly.
          p.y = p.land;
          p.vx = 0;
          p.vy = 0;
          p.gravity = 0;
          // A lump of damp sand sits a moment before it is part of the beach.
          p.life = Math.min(p.life, p.age + (p.shape === "clump" ? 0.6 : 0.15));
        }
      }
    },
    clear() {
      pool.length = 0;
      next = 0;
    },
  };
};

/** How strongly a particle shows now: a quick fade in and a fade out over its last half. */
export const fadeOf = (p: Particle): number => {
  const u = p.age / p.life;
  const inn = Math.min(1, p.age / 0.05);
  return p.alpha * inn * Math.min(1, 2 * (1 - u));
};

const VERTEX = /* glsl */ `
uniform vec2 uStage;
attribute vec2 aCorner;
attribute vec4 aColour;
attribute vec2 aShape;
varying vec2 vCorner;
varying vec4 vColour;
varying vec2 vShape;
void main() {
  vCorner = aCorner;
  vColour = aColour;
  vShape = aShape;
  gl_Position = vec4(position.x / uStage.x * 2.0 - 1.0, 1.0 - position.y / uStage.y * 2.0, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vCorner;
varying vec4 vColour;
varying vec2 vShape;
void main() {
  float r = length(vCorner);
  float e = max(fwidth(r), 1e-4);
  vec3 c = vColour.rgb;
  float a;
  if (vShape.x < 0.5) {
    a = 1.0 - smoothstep(1.0 - max(vShape.y, e), 1.0, r);
  } else if (vShape.x < 1.5) {
    a = 1.0 - smoothstep(1.0 - e, 1.0, r);
    c *= 1.0 - 0.45 * smoothstep(0.5, 1.0, r);
    vec2 g = vCorner - vec2(-0.3, 0.35);
    c += vec3(0.9) * exp(-dot(g, g) / 0.05);
  } else if (vShape.x < 2.5) {
    float w = max(vShape.y, e);
    a = exp(-pow((r - (1.0 - w)) / w, 2.0)) * (1.0 - smoothstep(1.0 - e, 1.0, r));
  } else {
    // A lump of damp sand: lit from above and a little left, darker round its edge.
    a = 1.0 - smoothstep(1.0 - max(vShape.y, e), 1.0, r);
    c *= (0.8 + 0.3 * clamp(dot(vCorner, vec2(-0.45, 0.8)), -1.0, 1.0))
      * (1.0 - 0.3 * smoothstep(0.5, 1.0, r));
  }
  if (a <= 0.002) discard;
  gl_FragColor = vec4(c, vColour.a * a);
  #include <colorspace_fragment>
}
`;

export interface Batch {
  readonly mesh: Mesh;
  readonly count: number;
  begin(width: number, height: number): void;
  /**
   * A quad centred at (x, y) stage px with half-sizes hx and hy, colour linear RGB with alpha
   * `a`; `soft` is a disc's soft edge or a ring's width, 0 to 1.
   */
  add(
    x: number,
    y: number,
    hx: number,
    hy: number,
    colour: readonly number[],
    a: number,
    shape: Shape,
    soft: number,
  ): void;
  end(): void;
}

/**
 * `opaque` draws the batch with the opaque things, blended all the same, so that solid models
 * drawn after it (in a later `renderOrder`) cover it: three.js draws transparent things last.
 */
export const createBatch = (max: number, opts: { opaque?: boolean } = {}): Batch => {
  const position = new Float32Array(max * 4 * 3);
  const corner = new Float32Array(max * 4 * 2);
  const colour = new Float32Array(max * 4 * 4);
  const shape = new Float32Array(max * 4 * 2);
  const index = new Uint16Array(max * 6);
  const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
  for (let i = 0; i < max; i++) {
    corner.set(corners, i * 8);
    index.set(
      [0, 1, 2, 0, 2, 3].map((k) => k + i * 4),
      i * 6,
    );
  }
  const geometry = new BufferGeometry();
  const pos = new BufferAttribute(position, 3);
  const col = new BufferAttribute(colour, 4);
  const shp = new BufferAttribute(shape, 2);
  geometry.setAttribute("position", pos);
  geometry.setAttribute("aCorner", new BufferAttribute(corner, 2));
  geometry.setAttribute("aColour", col);
  geometry.setAttribute("aShape", shp);
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);
  const stage = new Vector2(1, 1);
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uStage: { value: stage } },
    transparent: !opts.opaque,
    blending: opts.opaque ? CustomBlending : NormalBlending,
    blendEquation: AddEquation,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  let n = 0;
  return {
    mesh,
    get count() {
      return n;
    },
    begin(width, height) {
      stage.set(width, height);
      n = 0;
    },
    add(x, y, hx, hy, c, a, kind, soft) {
      if (n >= max) return;
      const p = n * 12;
      position[p] = x - hx;
      position[p + 1] = y + hy;
      position[p + 3] = x + hx;
      position[p + 4] = y + hy;
      position[p + 6] = x + hx;
      position[p + 7] = y - hy;
      position[p + 9] = x - hx;
      position[p + 10] = y - hy;
      const shapeId = SHAPE[kind];
      for (let k = 0; k < 4; k++) {
        const q = n * 16 + k * 4;
        colour[q] = c[0]!;
        colour[q + 1] = c[1]!;
        colour[q + 2] = c[2]!;
        colour[q + 3] = a;
        shape[n * 8 + k * 2] = shapeId;
        shape[n * 8 + k * 2 + 1] = soft;
      }
      n++;
    },
    end() {
      pos.needsUpdate = true;
      col.needsUpdate = true;
      shp.needsUpdate = true;
      geometry.setDrawRange(0, n * 6);
    },
  };
};
