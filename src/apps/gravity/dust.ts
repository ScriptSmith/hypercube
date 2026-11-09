/**
 * Light particles: debris, glowing gas, ring material, asteroid belts and the stars of a galaxy.
 * They feel the heaviest bodies but nothing feels them, so the ribbon (which copies only the
 * bodies) stays exact. A fixed pool: when it is full, the oldest debris and gas go first, then
 * ring material; a scene's own belt or galaxy stars are kept.
 *
 * Particles inside a body are taken in. Near a black hole they lose speed relative to it, so
 * they spiral in as an accretion disc and glow hotter the closer they get.
 */
import { tableRgb, tempIndex } from "./bodies";

export const FREE = 0;
export const DEBRIS = 1;
export const GAS = 2;
export const RING = 3;
export const KEEP = 4;

/** Particle colours: indexes into this table. Hot particles use the temperature range instead. */
export const DUST_RGB: number[] = [
  // Rock looks.
  0x8a8079, 0x9a8670, 0x7a7a80,
  // Planet grounds.
  0x5c8a52, 0x8c4a2e, 0x8e7444, 0x6a6864, 0x3e6a5a,
  // Gas giant bases.
  0xc9a47a, 0xd6bf8a, 0x86c4d2, 0x5a7cd0,
  // Galaxy stars: old, white, young, glowing gas.
  0xffe0b0, 0xf2f0ff, 0xaec6ff, 0xff9ec4,
  // Ice and belt.
  0xe6dccb, 0xb4ab9c,
];
export const COL = {
  rock: 0,
  planet: 3,
  giant: 8,
  galaxyOld: 12,
  galaxyWhite: 13,
  galaxyYoung: 14,
  galaxyGas: 15,
  ice: 16,
  belt: 17,
} as const;
/** Temperatures for hot particles, coolest first. */
export const HOT_STEPS = 8;
const HOT_T = [1000, 1500, 2200, 3200, 4800, 7000, 11_000, 20_000];
export const hotRgb = (i: number) => tableRgb(tempIndex(HOT_T[Math.max(0, Math.min(7, i))]!));

/** How fast hot particles cool, 1/s, by kind. */
const COOL = [0, 0.9, 0.22, 0.5, 0];

export interface Pull {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gm: number;
  /** Softening squared, and the radius inside which particles are taken in. */
  eps2: number;
  absorb: number;
  /** Black holes: particles inside this lose speed relative to it. */
  disc: number;
}

export interface Dust {
  readonly cap: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly size: Float32Array;
  /** Heat 0 to 1; above a little it glows in the temperature colours. */
  readonly hot: Float32Array;
  /** Slowing (1/s) of particles that ignore gravity: a blast's shell sweeping up thin gas. */
  readonly drag: Float32Array;
  readonly kind: Uint8Array;
  readonly col: Uint8Array;
  readonly live: number;
  /** Particles taken in by each pull at the last step (holes glow when fed). */
  readonly fed: Int32Array;
  spawn(
    kind: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    col: number,
    size: number,
    hot?: number,
    drag?: number,
  ): number;
  /** Step every particle by dt in the pull of the first `n` of `pulls`, plus a uniform (ax, ay). */
  step(dt: number, pulls: readonly Pull[], n: number, ax: number, ay: number, bounds: Bounds): void;
  /** Everything but a scene's own particles, or everything. */
  clear(all: boolean): void;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const MAX_PULLS = 16;
/** Speed lost relative to a black hole near it, 1/s at the edge of its disc and more inside. */
const DISC_DRAG = 0.5;

export const createDust = (cap: number): Dust => {
  const x = new Float64Array(cap);
  const y = new Float64Array(cap);
  const vx = new Float64Array(cap);
  const vy = new Float64Array(cap);
  const px = new Float32Array(cap);
  const py = new Float32Array(cap);
  const age = new Float32Array(cap);
  const life = new Float32Array(cap);
  const size = new Float32Array(cap);
  const hot = new Float32Array(cap);
  const drag = new Float32Array(cap);
  const kind = new Uint8Array(cap);
  const col = new Uint8Array(cap);
  const free = new Int32Array(cap);
  const fed = new Int32Array(MAX_PULLS);
  let freeTop = 0;
  let cursor = 0;
  let live = 0;
  for (let i = cap - 1; i >= 0; i--) free[freeTop++] = i;

  const kill = (i: number) => {
    if (kind[i] === FREE) return;
    kind[i] = FREE;
    free[freeTop++] = i;
    live--;
  };

  /** A slot to reuse when the pool is full: the next debris or gas, else ring material. */
  const reuse = (): number => {
    for (const worst of [GAS, RING]) {
      for (let n = 0; n < cap; n++) {
        const i = cursor;
        cursor = (cursor + 1) % cap;
        if (kind[i]! <= worst && kind[i] !== FREE) return i;
      }
    }
    return -1;
  };

  return {
    cap,
    x,
    y,
    vx,
    vy,
    px,
    py,
    age,
    life,
    size,
    hot,
    drag,
    kind,
    col,
    fed,
    get live() {
      return live;
    },
    spawn(k, x0, y0, vx0, vy0, life0, c, s, h = 0, dr = 0) {
      let i: number;
      if (freeTop > 0) {
        i = free[--freeTop]!;
        live++;
      } else {
        i = reuse();
        if (i < 0) return -1;
      }
      kind[i] = k;
      x[i] = x0;
      y[i] = y0;
      px[i] = x0;
      py[i] = y0;
      vx[i] = vx0;
      vy[i] = vy0;
      age[i] = 0;
      life[i] = life0;
      col[i] = c;
      size[i] = s;
      hot[i] = h;
      drag[i] = dr;
      return i;
    },
    step(dt, pulls, count, ax0, ay0, b) {
      const n = Math.min(MAX_PULLS, pulls.length, count);
      fed.fill(0);
      for (let i = 0; i < cap; i++) {
        const k = kind[i]!;
        if (k === FREE) continue;
        const xi = x[i]!;
        const yi = y[i]!;
        let ax = ax0;
        let ay = ay0;
        let gone = false;
        let dragFrom = -1;
        let dragD = 0;
        const free = drag[i]! > 0;
        for (let j = 0; j < (free ? 0 : n); j++) {
          const p = pulls[j]!;
          const dx = p.x - xi;
          const dy = p.y - yi;
          const d2 = dx * dx + dy * dy;
          if (d2 < p.absorb * p.absorb) {
            fed[j]!++;
            gone = true;
            break;
          }
          const r2 = d2 + p.eps2;
          const f = p.gm / (r2 * Math.sqrt(r2));
          ax += dx * f;
          ay += dy * f;
          if (p.disc > 0 && d2 < p.disc * p.disc) {
            dragFrom = j;
            dragD = Math.sqrt(d2);
          }
        }
        if (gone) {
          kill(i);
          continue;
        }
        let ux = vx[i]! + ax * dt;
        let uy = vy[i]! + ay * dt;
        if (free) {
          const k = Math.exp(-drag[i]! * dt);
          ux *= k;
          uy *= k;
        }
        if (dragFrom >= 0) {
          const p = pulls[dragFrom]!;
          const keep = Math.exp(-dt * DISC_DRAG * Math.min(6, p.disc / Math.max(1, dragD)));
          ux = p.vx + (ux - p.vx) * keep;
          uy = p.vy + (uy - p.vy) * keep;
          // Friction in the disc heats it.
          hot[i] = Math.max(hot[i]!, Math.min(1, (p.absorb * 2.2) / Math.max(1, dragD)));
        }
        vx[i] = ux;
        vy[i] = uy;
        px[i] = xi;
        py[i] = yi;
        x[i] = xi + ux * dt;
        y[i] = yi + uy * dt;
        const a = age[i]! + dt;
        age[i] = a;
        if (hot[i]! > 0) hot[i] = hot[i]! * Math.exp(-dt * COOL[k]!);
        if (a >= life[i]! || x[i]! < b.x0 || x[i]! > b.x1 || y[i]! < b.y0 || y[i]! > b.y1) {
          kill(i);
        }
      }
    },
    clear(all) {
      for (let i = 0; i < cap; i++) {
        if (kind[i] !== FREE && (all || kind[i] !== KEEP)) kill(i);
      }
    },
  };
};
